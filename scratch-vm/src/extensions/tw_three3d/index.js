const THREE = require('three');
const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');
const StageLayering = require('../../engine/stage-layering');
const uid = require('../../util/uid');

// eslint-disable-next-line max-len
const blockIconURI = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><g stroke="#4b3aa8" stroke-width="2" stroke-linejoin="round"><path fill="#b3a6ff" d="M20 5 34 12.5 20 20 6 12.5z"/><path fill="#8a78ff" d="M6 12.5 20 20v15L6 27.5z"/><path fill="#6c57f0" d="M34 12.5 20 20v15l14-7.5z"/></g></svg>')}`;

const SHAPES = ['cube', 'sphere', 'cylinder', 'cone', 'plane', 'torus'];

const PROPS = ['x', 'y', 'z', 'rotX', 'rotY', 'rotZ', 'scaleX', 'scaleY', 'scaleZ'];

const CAMERA_AXES = ['x', 'y', 'z', 'yaw', 'pitch'];

const MODEL_EXTENSION = /\.(glb|gltf)$/i;

/**
 * @param {THREE.Material|THREE.Material[]} material
 * @returns {THREE.Material[]}
 */
const asArray = material => (Array.isArray(material) ? material : [material]);

// Keep the camera from flipping over when looking straight up or down
const MAX_PITCH = (Math.PI / 2) - 0.001;

// Multisampling for the 3D scene; the stage's own WebGL context has antialiasing off.
const MSAA_SAMPLES = 4;

/**
 * Renders a three.js scene below everything on the stage (backdrop, pen and sprites).
 *
 * Normally three.js shares the stage's WebGL2 context and draws straight into the stage framebuffer through the
 * renderer's underlay hook, so nothing is copied between contexts. If that isn't possible (no WebGL2, or a renderer
 * without setUnderlay), it falls back to an offscreen canvas shown as a bitmap skin in the video layer.
 */
class Scratch3Three3DBlocks {
    constructor (runtime) {
        this.runtime = runtime;

        this._three = null;
        this._canvas = null;
        this._scene = null;
        this._camera = null;
        this._ambient = null;
        this._sun = null;
        this._objects = new Map();
        /** @type {Map<string, Promise<THREE.Object3D>>} parsed models by md5, shared by every loaded copy */
        this._modelCache = new Map();

        this._skinId = -1;
        this._drawableId = -1;
        this._dirty = false;

        /** True when three.js draws into the stage's own WebGL context. */
        this._shared = false;
        /** Multisampled target the scene renders into (shared mode). */
        this._target = null;
        /** Full-screen quad that draws _target onto the stage (shared mode). */
        this._blitScene = null;
        this._blitCamera = null;
        this._layerVisible = true;
        this._drawUnderlay = this._drawUnderlay.bind(this);

        this._lockEnabled = false;
        this._lockSensitivity = 1;
        this._lockCanvas = null;
        this._onLockMouseDown = this._onLockMouseDown.bind(this);
        this._onLockMouseMove = this._onLockMouseMove.bind(this);

        this._render = this._render.bind(this);
        runtime.on('AFTER_EXECUTE', this._render);
        runtime.on('STAGE_SIZE_CHANGED', () => this._resize());
        runtime.on('PROJECT_STOP_ALL', () => this._setPointerLock(false));
        runtime.on('RUNTIME_DISPOSED', () => this._reset());
    }

    /**
     * Mark the scene for re-rendering. This also requests a redraw so that loops
     * which only change 3D state yield once per frame instead of running many
     * times per frame like a loop that doesn't touch the stage.
     */
    _markDirty () {
        this._dirty = true;
        this.runtime.requestRedraw();
    }

    _setPointerLock (enabled) {
        this._lockEnabled = enabled;
        const renderer = this.runtime.renderer;
        if (!renderer || typeof document === 'undefined') return;
        const canvas = renderer.canvas;
        if (enabled && !this._lockCanvas) {
            this._lockCanvas = canvas;
            canvas.addEventListener('mousedown', this._onLockMouseDown);
            document.addEventListener('mousemove', this._onLockMouseMove);
        }
        if (!enabled && document.pointerLockElement === canvas) {
            document.exitPointerLock();
        }
    }

    _onLockMouseDown () {
        const canvas = this._lockCanvas;
        if (!this._lockEnabled || document.pointerLockElement === canvas) return;
        const result = canvas.requestPointerLock();
        // Newer browsers return a promise that rejects e.g. right after pressing Esc
        if (result && typeof result.catch === 'function') result.catch(() => {});
    }

    _onLockMouseMove (e) {
        if (!this._lockEnabled || !this._camera || document.pointerLockElement !== this._lockCanvas) return;
        const speed = 0.002 * this._lockSensitivity;
        const rotation = this._camera.rotation;
        rotation.y -= e.movementX * speed;
        rotation.x = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, rotation.x - (e.movementY * speed)));
        rotation.z = 0;
        this._markDirty();
    }

    _ensure () {
        const renderer = this.runtime.renderer;
        if (this._three || !renderer) return !!this._three;

        this._shared = this._createSharedRenderer(renderer);
        if (!this._shared) {
            const canvas = document.createElement('canvas');
            // BitmapSkin would otherwise call getContext('2d') on this WebGL canvas
            canvas.reusable = false;
            this._canvas = canvas;
            this._three = new THREE.WebGLRenderer({
                canvas,
                alpha: true,
                antialias: true,
                preserveDrawingBuffer: true
            });
        }
        this._three.setClearColor(0x000000, 0);

        this._scene = new THREE.Scene();
        this._camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 1000);
        this._camera.position.set(0, 0, 5);
        // Yaw first, then pitch, so rotation.y / rotation.x are the look angles
        this._camera.rotation.order = 'YXZ';
        this._ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this._sun = new THREE.DirectionalLight(0xffffff, 1.2);
        this._sun.position.set(3, 5, 4);
        this._scene.add(this._ambient, this._sun);

        if (this._shared) {
            renderer.setUnderlay(this._drawUnderlay);
        } else {
            this._resize();
            this._skinId = renderer.createBitmapSkin(this._canvas, this._resolution);
            this._drawableId = renderer.createDrawable(StageLayering.VIDEO_LAYER);
            renderer.markDrawableAsNoninteractive(this._drawableId);
            renderer.updateDrawableSkinId(this._drawableId, this._skinId);
        }
        this._markDirty();
        return true;
    }

    /**
     * Try to make three.js render with the stage's own WebGL context.
     * @param {RenderWebGL} renderer the stage renderer
     * @returns {boolean} true if it worked
     */
    _createSharedRenderer (renderer) {
        const gl = renderer.gl;
        if (
            typeof renderer.setUnderlay !== 'function' ||
            typeof WebGL2RenderingContext === 'undefined' ||
            !(gl instanceof WebGL2RenderingContext)
        ) {
            return false;
        }
        try {
            this._three = new THREE.WebGLRenderer({canvas: renderer.canvas, context: gl});
        } catch (e) {
            console.warn('3D: could not share the stage WebGL context', e);
            this._three = null;
            return false;
        }
        // The stage clears the framebuffer itself; the scene is drawn on top of that.
        this._three.autoClear = false;
        this._three.setPixelRatio(1);
        this._target = new THREE.WebGLRenderTarget(1, 1, {samples: MSAA_SAMPLES});
        this._blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this._blitScene = new THREE.Scene();
        this._blitScene.add(new THREE.Mesh(
            new THREE.PlaneGeometry(2, 2),
            new THREE.MeshBasicMaterial({
                map: this._target.texture,
                // The target was cleared to transparent black, so it already holds premultiplied colors.
                transparent: true,
                blending: THREE.CustomBlending,
                blendSrc: THREE.OneFactor,
                blendDst: THREE.OneMinusSrcAlphaFactor,
                depthTest: false,
                depthWrite: false
            })
        ));
        return true;
    }

    /**
     * Called by the stage renderer in the middle of its draw, after clearing and before any drawable.
     * @param {WebGL2RenderingContext} gl the stage context
     */
    _drawUnderlay (gl) {
        if (!this._layerVisible) return;
        const three = this._three;
        const width = gl.drawingBufferWidth;
        const height = gl.drawingBufferHeight;
        // The stage renderer changed GL state behind three.js's back
        three.resetState();
        if (this._target.width !== width || this._target.height !== height) {
            this._target.setSize(width, height);
            this._camera.aspect = width / height;
            this._camera.updateProjectionMatrix();
            this._dirty = true;
        }
        // The stage redraws for sprite changes too; reuse the last 3D frame unless the scene changed.
        if (this._dirty) {
            this._dirty = false;
            three.setRenderTarget(this._target);
            three.clear();
            three.render(this._scene, this._camera);
        }
        three.setRenderTarget(null);
        three.setViewport(0, 0, width, height);
        three.render(this._blitScene, this._blitCamera);
        three.resetState();
    }

    _resize () {
        if (!this._three) return;
        if (this._shared) {
            // Sizes are read from the stage framebuffer when drawing
            this._markDirty();
            return;
        }
        const renderer = this.runtime.renderer;
        const width = this.runtime.stageWidth;
        const height = this.runtime.stageHeight;
        this._resolution = renderer.useHighQualityRender ?
            Math.max(1, renderer.canvas.width / width) :
            1;
        this._three.setPixelRatio(1);
        this._three.setSize(Math.round(width * this._resolution), Math.round(height * this._resolution), false);
        this._camera.aspect = width / height;
        this._camera.updateProjectionMatrix();
        this._markDirty();
    }

    _render () {
        if (!this._dirty || !this._three) return;
        const renderer = this.runtime.renderer;
        if (this._shared) {
            // Rendered by _drawUnderlay during the stage's draw
            renderer.dirty = true;
            return;
        }
        this._dirty = false;
        const wantResolution = renderer.useHighQualityRender ?
            Math.max(1, renderer.canvas.width / this.runtime.stageWidth) :
            1;
        if (wantResolution !== this._resolution) this._resize();
        this._three.render(this._scene, this._camera);
        renderer.updateBitmapSkin(this._skinId, this._canvas, this._resolution);
        this.runtime.requestRedraw();
    }

    _reset () {
        this._setPointerLock(false);
        this._clearObjects();
        this._clearModelCache();
        if (!this._three) return;
        this._scene.background = null;
        this._camera.position.set(0, 0, 5);
        this._camera.rotation.set(0, 0, 0);
        this._camera.fov = 60;
        this._camera.updateProjectionMatrix();
        this._ambient.intensity = 0.6;
        this._sun.position.set(3, 5, 4);
        this._sun.intensity = 1.2;
        this._setLayerVisible(true);
        this._render();
    }

    _setLayerVisible (visible) {
        this._layerVisible = visible;
        if (this._shared) {
            this.runtime.renderer.dirty = true;
        } else {
            this.runtime.renderer.updateDrawableVisible(this._drawableId, visible);
        }
    }

    _clearModelCache () {
        for (const promise of this._modelCache.values()) {
            promise.then(scene => this._disposeTree(scene, true), () => {});
        }
        this._modelCache.clear();
    }

    _clearObjects () {
        for (const mesh of this._objects.values()) {
            this._disposeMesh(mesh);
        }
        this._objects.clear();
        this._markDirty();
    }

    _disposeMesh (mesh) {
        if (this._scene) this._scene.remove(mesh);
        if (mesh.userData.twModel) {
            // Geometry and textures belong to the cached model; only drop what this copy owns
            this._disposeTree(mesh, false);
            return;
        }
        mesh.geometry.dispose();
        mesh.material.dispose();
    }

    /**
     * @param {THREE.Object3D} root
     * @param {boolean} all true to dispose shared geometry, materials and textures too
     */
    _disposeTree (root, all) {
        root.traverse(child => {
            if (!child.isMesh) return;
            if (all) child.geometry.dispose();
            if (all || child.userData.twOwnMaterial) {
                for (const material of asArray(child.material)) {
                    if (all) {
                        for (const value of Object.values(material)) {
                            if (value && value.isTexture) value.dispose();
                        }
                    }
                    material.dispose();
                }
            }
        });
    }

    _get (name) {
        return this._objects.get(Cast.toString(name));
    }

    _makeGeometry (shape) {
        switch (shape) {
        case 'sphere': return new THREE.SphereGeometry(0.5, 32, 16);
        case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
        case 'cone': return new THREE.ConeGeometry(0.5, 1, 32);
        case 'plane': return new THREE.PlaneGeometry(1, 1);
        case 'torus': return new THREE.TorusGeometry(0.4, 0.15, 16, 48);
        default: return new THREE.BoxGeometry(1, 1, 1);
        }
    }

    getInfo () {
        const xyz = (x, y, z) => ({
            X: {type: ArgumentType.NUMBER, defaultValue: x},
            Y: {type: ArgumentType.NUMBER, defaultValue: y},
            Z: {type: ArgumentType.NUMBER, defaultValue: z}
        });
        const name = {NAME: {type: ArgumentType.STRING, defaultValue: '方塊1'}};
        return {
            id: 'three3d',
            name: '3D',
            color1: '#7c5cff',
            color2: '#6a4ae6',
            color3: '#5a3ccc',
            blockIconURI,
            menuIconURI: blockIconURI,
            blocks: [
                {
                    opcode: 'create',
                    blockType: BlockType.COMMAND,
                    text: '建立 [SHAPE] 名稱 [NAME]',
                    arguments: {
                        SHAPE: {type: ArgumentType.STRING, menu: 'shape', defaultValue: 'cube'},
                        ...name
                    }
                },
                {
                    opcode: 'loadModel',
                    blockType: BlockType.COMMAND,
                    text: '載入模型 [FILE] 名稱 [NAME]',
                    arguments: {
                        FILE: {type: ArgumentType.STRING, menu: 'modelFile', defaultValue: ''},
                        NAME: {type: ArgumentType.STRING, defaultValue: '模型1'}
                    }
                },
                {
                    opcode: 'remove',
                    blockType: BlockType.COMMAND,
                    text: '刪除 [NAME]',
                    arguments: name
                },
                {
                    opcode: 'removeAll',
                    blockType: BlockType.COMMAND,
                    text: '刪除所有 3D 物體'
                },
                {
                    opcode: 'exists',
                    blockType: BlockType.BOOLEAN,
                    text: '[NAME] 存在？',
                    arguments: name
                },
                '---',
                {
                    opcode: 'setPosition',
                    blockType: BlockType.COMMAND,
                    text: '將 [NAME] 位置設為 x:[X] y:[Y] z:[Z]',
                    arguments: {...name, ...xyz(0, 0, 0)}
                },
                {
                    opcode: 'changePosition',
                    blockType: BlockType.COMMAND,
                    text: '將 [NAME] 位置改變 x:[X] y:[Y] z:[Z]',
                    arguments: {...name, ...xyz(0.1, 0, 0)}
                },
                {
                    opcode: 'setRotation',
                    blockType: BlockType.COMMAND,
                    text: '將 [NAME] 旋轉設為 x:[X] y:[Y] z:[Z] 度',
                    arguments: {...name, ...xyz(0, 0, 0)}
                },
                {
                    opcode: 'changeRotation',
                    blockType: BlockType.COMMAND,
                    text: '將 [NAME] 旋轉 x:[X] y:[Y] z:[Z] 度',
                    arguments: {...name, ...xyz(0, 5, 0)}
                },
                {
                    opcode: 'lookAtObject',
                    blockType: BlockType.COMMAND,
                    text: '將 [NAME] 面向 [TARGET]',
                    arguments: {...name, TARGET: {type: ArgumentType.STRING, defaultValue: '方塊2'}}
                },
                {
                    opcode: 'setScale',
                    blockType: BlockType.COMMAND,
                    text: '將 [NAME] 縮放設為 x:[X] y:[Y] z:[Z]',
                    arguments: {...name, ...xyz(1, 1, 1)}
                },
                {
                    opcode: 'setColor',
                    blockType: BlockType.COMMAND,
                    text: '將 [NAME] 顏色設為 [COLOR]',
                    arguments: {...name, COLOR: {type: ArgumentType.COLOR, defaultValue: '#4c97ff'}}
                },
                {
                    opcode: 'setVisible',
                    blockType: BlockType.COMMAND,
                    text: '將 [NAME] [VISIBLE]',
                    arguments: {...name, VISIBLE: {type: ArgumentType.STRING, menu: 'visible', defaultValue: 'show'}}
                },
                {
                    opcode: 'getProp',
                    blockType: BlockType.REPORTER,
                    text: '[NAME] 的 [PROP]',
                    arguments: {...name, PROP: {type: ArgumentType.STRING, menu: 'prop', defaultValue: 'x'}}
                },
                '---',
                {
                    opcode: 'setCameraPosition',
                    blockType: BlockType.COMMAND,
                    text: '相機位置設為 x:[X] y:[Y] z:[Z]',
                    arguments: xyz(0, 0, 5)
                },
                {
                    opcode: 'changeCameraPosition',
                    blockType: BlockType.COMMAND,
                    text: '相機位置改變 x:[X] y:[Y] z:[Z]',
                    arguments: xyz(0, 0, -0.1)
                },
                {
                    opcode: 'cameraLookAt',
                    blockType: BlockType.COMMAND,
                    text: '相機看向 x:[X] y:[Y] z:[Z]',
                    arguments: xyz(0, 0, 0)
                },
                {
                    opcode: 'cameraLookAtObject',
                    blockType: BlockType.COMMAND,
                    text: '相機看向 [NAME]',
                    arguments: name
                },
                {
                    opcode: 'setCameraFov',
                    blockType: BlockType.COMMAND,
                    text: '相機視角設為 [FOV] 度',
                    arguments: {FOV: {type: ArgumentType.NUMBER, defaultValue: 60}}
                },
                {
                    opcode: 'getCamera',
                    blockType: BlockType.REPORTER,
                    text: '相機的 [AXIS]',
                    arguments: {AXIS: {type: ArgumentType.STRING, menu: 'axis', defaultValue: 'x'}}
                },
                {
                    opcode: 'moveCamera',
                    blockType: BlockType.COMMAND,
                    text: '相機向 [DIR] 移動 [STEPS]',
                    arguments: {
                        DIR: {type: ArgumentType.STRING, menu: 'direction', defaultValue: 'forward'},
                        STEPS: {type: ArgumentType.NUMBER, defaultValue: 0.1}
                    }
                },
                {
                    opcode: 'setCameraDirection',
                    blockType: BlockType.COMMAND,
                    text: '相機方向設為 水平:[YAW] 垂直:[PITCH] 度',
                    arguments: {
                        YAW: {type: ArgumentType.NUMBER, defaultValue: 0},
                        PITCH: {type: ArgumentType.NUMBER, defaultValue: 0}
                    }
                },
                '---',
                {
                    opcode: 'enablePointerLock',
                    blockType: BlockType.COMMAND,
                    text: '啟用滑鼠視角控制 靈敏度 [SENS]',
                    arguments: {SENS: {type: ArgumentType.NUMBER, defaultValue: 1}}
                },
                {
                    opcode: 'disablePointerLock',
                    blockType: BlockType.COMMAND,
                    text: '停用滑鼠視角控制'
                },
                {
                    opcode: 'isPointerLocked',
                    blockType: BlockType.BOOLEAN,
                    text: '滑鼠已鎖定？'
                },
                '---',
                {
                    opcode: 'setBackground',
                    blockType: BlockType.COMMAND,
                    text: '將 3D 背景顏色設為 [COLOR]',
                    arguments: {COLOR: {type: ArgumentType.COLOR, defaultValue: '#202040'}}
                },
                {
                    opcode: 'clearBackground',
                    blockType: BlockType.COMMAND,
                    text: '將 3D 背景設為透明'
                },
                {
                    opcode: 'setAmbient',
                    blockType: BlockType.COMMAND,
                    text: '環境光強度設為 [VALUE]',
                    arguments: {VALUE: {type: ArgumentType.NUMBER, defaultValue: 0.6}}
                },
                {
                    opcode: 'setSun',
                    blockType: BlockType.COMMAND,
                    text: '平行光來自 x:[X] y:[Y] z:[Z] 強度 [VALUE]',
                    arguments: {...xyz(3, 5, 4), VALUE: {type: ArgumentType.NUMBER, defaultValue: 1.2}}
                },
                {
                    opcode: 'setLayerVisible',
                    blockType: BlockType.COMMAND,
                    text: '[VISIBLE] 3D 畫面',
                    arguments: {VISIBLE: {type: ArgumentType.STRING, menu: 'visible', defaultValue: 'show'}}
                }
            ],
            menus: {
                modelFile: {
                    acceptReporters: true,
                    items: '_getModelFileMenu'
                },
                shape: {
                    acceptReporters: true,
                    items: [
                        {text: '方塊', value: 'cube'},
                        {text: '球體', value: 'sphere'},
                        {text: '圓柱', value: 'cylinder'},
                        {text: '圓錐', value: 'cone'},
                        {text: '平面', value: 'plane'},
                        {text: '圓環', value: 'torus'}
                    ]
                },
                visible: {
                    acceptReporters: false,
                    items: [
                        {text: '顯示', value: 'show'},
                        {text: '隱藏', value: 'hide'}
                    ]
                },
                prop: {
                    acceptReporters: true,
                    items: [
                        {text: 'x 位置', value: 'x'},
                        {text: 'y 位置', value: 'y'},
                        {text: 'z 位置', value: 'z'},
                        {text: 'x 旋轉', value: 'rotX'},
                        {text: 'y 旋轉', value: 'rotY'},
                        {text: 'z 旋轉', value: 'rotZ'},
                        {text: 'x 縮放', value: 'scaleX'},
                        {text: 'y 縮放', value: 'scaleY'},
                        {text: 'z 縮放', value: 'scaleZ'}
                    ]
                },
                axis: {
                    acceptReporters: false,
                    items: [
                        'x',
                        'y',
                        'z',
                        {text: '水平角度', value: 'yaw'},
                        {text: '垂直角度', value: 'pitch'}
                    ]
                },
                direction: {
                    acceptReporters: true,
                    items: [
                        {text: '前', value: 'forward'},
                        {text: '後', value: 'back'},
                        {text: '左', value: 'left'},
                        {text: '右', value: 'right'},
                        {text: '上', value: 'up'},
                        {text: '下', value: 'down'}
                    ]
                }
            }
        };
    }

    _getModelFileMenu () {
        const names = this.runtime.fileManager.getFileNames().filter(name => MODEL_EXTENSION.test(name));
        if (names.length === 0) {
            return [{text: '（先到「檔案」分頁上傳 .glb）', value: ''}];
        }
        return names;
    }

    /**
     * Resolve a URI referenced from a .gltf (buffers, textures) against the project's files.
     * @param {string} url
     * @param {string[]} blobURLs blob URLs created here, to revoke later
     * @returns {string}
     */
    _resolveModelURL (url, blobURLs) {
        if (/^(data|blob|https?):/i.test(url)) return url;
        let name = url.replace(/^\.\//, '');
        try {
            name = decodeURIComponent(name);
        } catch (e) {
            // keep the raw name
        }
        const fileManager = this.runtime.fileManager;
        const file = fileManager.getFile(name) || fileManager.getFile(name.split('/').pop());
        if (!file) return url;
        const blobURL = URL.createObjectURL(new Blob([file.data], {type: fileManager.getMimeType(file.name)}));
        blobURLs.push(blobURL);
        return blobURL;
    }

    /**
     * @param {{name: string; data: Uint8Array; md5: string}} file
     * @returns {Promise<THREE.Object3D>}
     */
    _parseModel (file) {
        // Loaded lazily since it is only needed by projects that load models
        const {GLTFLoader} = require('three/examples/jsm/loaders/GLTFLoader.js');
        const blobURLs = [];
        const manager = new THREE.LoadingManager();
        manager.setURLModifier(url => this._resolveModelURL(url, blobURLs));
        const loader = new GLTFLoader(manager);
        const data = file.data;
        const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        return new Promise((resolve, reject) => {
            loader.parse(buffer, '', gltf => resolve(gltf.scene), reject);
        }).finally(() => {
            for (const url of blobURLs) URL.revokeObjectURL(url);
        });
    }

    loadModel (args) {
        if (!this._ensure()) return;
        const file = this.runtime.fileManager.getFile(Cast.toString(args.FILE));
        if (!file || !MODEL_EXTENSION.test(file.name)) return;
        const key = Cast.toString(args.NAME);

        // .gltf files can reference other files, so they are cached by name too
        const cacheKey = `${file.md5}/${file.name.toLowerCase()}`;
        let promise = this._modelCache.get(cacheKey);
        if (!promise) {
            promise = this._parseModel(file);
            this._modelCache.set(cacheKey, promise);
            promise.catch(() => this._modelCache.delete(cacheKey));
        }

        return promise.then(scene => {
            const {clone} = require('three/examples/jsm/utils/SkeletonUtils.js');
            const model = clone(scene);
            model.userData.twModel = true;
            const old = this._objects.get(key);
            if (old) {
                model.position.copy(old.position);
                model.rotation.copy(old.rotation);
                model.scale.copy(old.scale);
                this._disposeMesh(old);
            }
            this._objects.set(key, model);
            this._scene.add(model);
            this._markDirty();
        }, error => {
            console.warn(`3D: could not load model ${file.name}`, error);
        });
    }

    create (args) {
        if (!this._ensure()) return;
        const shape = SHAPES.includes(args.SHAPE) ? args.SHAPE : 'cube';
        const key = Cast.toString(args.NAME);
        const old = this._objects.get(key);
        if (old) this._disposeMesh(old);
        const mesh = new THREE.Mesh(
            this._makeGeometry(shape),
            new THREE.MeshStandardMaterial({
                color: 0x4c97ff,
                side: shape === 'plane' ? THREE.DoubleSide : THREE.FrontSide
            })
        );
        if (old) {
            mesh.position.copy(old.position);
            mesh.rotation.copy(old.rotation);
            mesh.scale.copy(old.scale);
        }
        this._objects.set(key, mesh);
        this._scene.add(mesh);
        this._markDirty();
    }

    remove (args) {
        const key = Cast.toString(args.NAME);
        const mesh = this._objects.get(key);
        if (!mesh) return;
        this._disposeMesh(mesh);
        this._objects.delete(key);
        this._markDirty();
    }

    removeAll () {
        this._clearObjects();
    }

    exists (args) {
        return this._objects.has(Cast.toString(args.NAME));
    }

    setPosition (args) {
        const mesh = this._get(args.NAME);
        if (!mesh) return;
        mesh.position.set(Cast.toNumber(args.X), Cast.toNumber(args.Y), Cast.toNumber(args.Z));
        this._markDirty();
    }

    changePosition (args) {
        const mesh = this._get(args.NAME);
        if (!mesh) return;
        mesh.position.x += Cast.toNumber(args.X);
        mesh.position.y += Cast.toNumber(args.Y);
        mesh.position.z += Cast.toNumber(args.Z);
        this._markDirty();
    }

    setRotation (args) {
        const mesh = this._get(args.NAME);
        if (!mesh) return;
        mesh.rotation.set(
            THREE.MathUtils.degToRad(Cast.toNumber(args.X)),
            THREE.MathUtils.degToRad(Cast.toNumber(args.Y)),
            THREE.MathUtils.degToRad(Cast.toNumber(args.Z))
        );
        this._markDirty();
    }

    changeRotation (args) {
        const mesh = this._get(args.NAME);
        if (!mesh) return;
        mesh.rotation.x += THREE.MathUtils.degToRad(Cast.toNumber(args.X));
        mesh.rotation.y += THREE.MathUtils.degToRad(Cast.toNumber(args.Y));
        mesh.rotation.z += THREE.MathUtils.degToRad(Cast.toNumber(args.Z));
        this._markDirty();
    }

    lookAtObject (args) {
        const mesh = this._get(args.NAME);
        const target = this._get(args.TARGET);
        if (!mesh || !target || mesh === target) return;
        // Turns the object's +z side toward the target
        mesh.lookAt(target.position);
        this._markDirty();
    }

    setScale (args) {
        const mesh = this._get(args.NAME);
        if (!mesh) return;
        mesh.scale.set(Cast.toNumber(args.X), Cast.toNumber(args.Y), Cast.toNumber(args.Z));
        this._markDirty();
    }

    setColor (args) {
        const mesh = this._get(args.NAME);
        if (!mesh) return;
        const rgb = Cast.toRgbColorObject(args.COLOR);
        mesh.traverse(child => {
            if (!child.isMesh) return;
            if (mesh.userData.twModel && !child.userData.twOwnMaterial) {
                // Materials are shared with other copies of the model, so give this copy its own
                child.material = Array.isArray(child.material) ?
                    child.material.map(material => material.clone()) :
                    child.material.clone();
                child.userData.twOwnMaterial = true;
            }
            for (const material of asArray(child.material)) {
                if (material.color) material.color.setRGB(rgb.r / 255, rgb.g / 255, rgb.b / 255, THREE.SRGBColorSpace);
            }
        });
        this._markDirty();
    }

    setVisible (args) {
        const mesh = this._get(args.NAME);
        if (!mesh) return;
        mesh.visible = args.VISIBLE !== 'hide';
        this._markDirty();
    }

    getProp (args) {
        const mesh = this._get(args.NAME);
        if (!mesh || !PROPS.includes(args.PROP)) return 0;
        let value;
        switch (args.PROP) {
        case 'x': value = mesh.position.x; break;
        case 'y': value = mesh.position.y; break;
        case 'z': value = mesh.position.z; break;
        case 'rotX': value = THREE.MathUtils.radToDeg(mesh.rotation.x); break;
        case 'rotY': value = THREE.MathUtils.radToDeg(mesh.rotation.y); break;
        case 'rotZ': value = THREE.MathUtils.radToDeg(mesh.rotation.z); break;
        case 'scaleX': value = mesh.scale.x; break;
        case 'scaleY': value = mesh.scale.y; break;
        case 'scaleZ': value = mesh.scale.z; break;
        }
        return Math.round(value * 1e6) / 1e6;
    }

    setCameraPosition (args) {
        if (!this._ensure()) return;
        this._camera.position.set(Cast.toNumber(args.X), Cast.toNumber(args.Y), Cast.toNumber(args.Z));
        this._markDirty();
    }

    changeCameraPosition (args) {
        if (!this._ensure()) return;
        this._camera.position.x += Cast.toNumber(args.X);
        this._camera.position.y += Cast.toNumber(args.Y);
        this._camera.position.z += Cast.toNumber(args.Z);
        this._markDirty();
    }

    cameraLookAt (args) {
        if (!this._ensure()) return;
        this._camera.lookAt(Cast.toNumber(args.X), Cast.toNumber(args.Y), Cast.toNumber(args.Z));
        this._markDirty();
    }

    cameraLookAtObject (args) {
        const mesh = this._get(args.NAME);
        if (!mesh || !this._ensure()) return;
        this._camera.lookAt(mesh.position);
        this._markDirty();
    }

    setCameraFov (args) {
        if (!this._ensure()) return;
        this._camera.fov = Math.min(179, Math.max(1, Cast.toNumber(args.FOV)));
        this._camera.updateProjectionMatrix();
        this._markDirty();
    }

    getCamera (args) {
        if (!this._camera || !CAMERA_AXES.includes(args.AXIS)) return 0;
        let value;
        switch (args.AXIS) {
        case 'yaw': value = THREE.MathUtils.radToDeg(this._camera.rotation.y); break;
        case 'pitch': value = THREE.MathUtils.radToDeg(this._camera.rotation.x); break;
        default: value = this._camera.position[args.AXIS];
        }
        return Math.round(value * 1e6) / 1e6;
    }

    moveCamera (args) {
        if (!this._ensure()) return;
        const steps = Cast.toNumber(args.STEPS);
        // Forward/back/left/right stay level with the ground, like a first-person game
        const yaw = this._camera.rotation.y;
        const forwardX = -Math.sin(yaw);
        const forwardZ = -Math.cos(yaw);
        const position = this._camera.position;
        switch (args.DIR) {
        case 'forward': position.x += forwardX * steps; position.z += forwardZ * steps; break;
        case 'back': position.x -= forwardX * steps; position.z -= forwardZ * steps; break;
        case 'right': position.x -= forwardZ * steps; position.z += forwardX * steps; break;
        case 'left': position.x += forwardZ * steps; position.z -= forwardX * steps; break;
        case 'up': position.y += steps; break;
        case 'down': position.y -= steps; break;
        default: return;
        }
        this._markDirty();
    }

    setCameraDirection (args) {
        if (!this._ensure()) return;
        const pitch = THREE.MathUtils.degToRad(Cast.toNumber(args.PITCH));
        this._camera.rotation.set(
            Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch)),
            THREE.MathUtils.degToRad(Cast.toNumber(args.YAW)),
            0
        );
        this._markDirty();
    }

    enablePointerLock (args, util) {
        // Clicking the block in the palette also adds a WASD example script
        if (util.thread.stackClick && !util.target.blocks.getBlock(util.thread.topBlock)) {
            this._addExampleScript(util.target);
        }
        if (!this._ensure()) return;
        const sensitivity = Cast.toNumber(args.SENS);
        this._lockSensitivity = sensitivity > 0 ? sensitivity : 1;
        this._setPointerLock(true);
    }

    disablePointerLock () {
        this._setPointerLock(false);
    }

    isPointerLocked () {
        return typeof document !== 'undefined' &&
            !!this._lockCanvas &&
            document.pointerLockElement === this._lockCanvas;
    }

    /**
     * Add a "green flag → mouse look → WASD/QE every frame" script to the target,
     * unless it already uses the mouse look block.
     * @param {Target} target The sprite or stage being edited.
     */
    _addExampleScript (target) {
        const existing = target.blocks._blocks;
        if (Object.values(existing).some(block => block.opcode === 'three3d_enablePointerLock')) return;

        const blocks = [];
        const add = (opcode, extra) => {
            const block = {
                id: uid(),
                opcode,
                inputs: {},
                fields: {},
                next: null,
                parent: null,
                shadow: false,
                topLevel: false,
                ...extra
            };
            blocks.push(block);
            return block;
        };
        const shadow = (opcode, field, value) => add(opcode, {
            shadow: true,
            fields: field ? {[field]: {name: field, value}} : {}
        });
        const input = (parent, name, block, obscured = null) => {
            parent.inputs[name] = {name, block: block.id, shadow: block.shadow ? block.id : obscured && obscured.id};
            block.parent = parent.id;
            if (obscured) obscured.parent = parent.id;
        };
        const chain = list => {
            for (let i = 1; i < list.length; i++) {
                list[i - 1].next = list[i].id;
                list[i].parent = list[i - 1].id;
            }
        };

        let x = 0;
        for (const id of target.blocks.getScripts()) {
            x = Math.max(x, (existing[id].x || 0) + 450);
        }

        const hat = add('event_whenflagclicked', {topLevel: true, x, y: 0});
        const enable = add('three3d_enablePointerLock');
        input(enable, 'SENS', shadow('math_number', 'NUM', '1'));
        const loop = add('control_foreachframe');
        input(loop, 'DT', shadow('control_foreachframe_deltatime'));
        chain([hat, enable, loop]);

        const ifs = [
            ['w', 'forward'],
            ['s', 'back'],
            ['a', 'left'],
            ['d', 'right'],
            ['q', 'up'],
            ['e', 'down']
        ].map(([key, dir]) => {
            const ifBlock = add('control_if');
            const pressed = add('sensing_keypressed');
            input(pressed, 'KEY_OPTION', shadow('sensing_keyoptions', 'KEY_OPTION', key));
            input(ifBlock, 'CONDITION', pressed);
            const move = add('three3d_moveCamera');
            input(move, 'DIR', shadow('three3d_menu_direction', 'direction', dir));
            const multiply = add('operator_multiply');
            input(multiply, 'NUM1', shadow('math_number', 'NUM', '5'));
            input(multiply, 'NUM2', add('control_foreachframe_deltatime'), shadow('math_number', 'NUM', ''));
            input(move, 'STEPS', multiply, shadow('math_number', 'NUM', '0.1'));
            input(ifBlock, 'SUBSTACK', move);
            return ifBlock;
        });
        chain(ifs);
        input(loop, 'SUBSTACK', ifs[0]);

        for (const block of blocks) {
            target.blocks.createBlock(block);
        }
        // Let the click finish before the editor reloads the workspace
        setTimeout(() => this.runtime.emit('BLOCKS_NEED_UPDATE'));
    }

    setBackground (args) {
        if (!this._ensure()) return;
        const rgb = Cast.toRgbColorObject(args.COLOR);
        this._scene.background = new THREE.Color().setRGB(rgb.r / 255, rgb.g / 255, rgb.b / 255, THREE.SRGBColorSpace);
        this._markDirty();
    }

    clearBackground () {
        if (!this._ensure()) return;
        this._scene.background = null;
        this._markDirty();
    }

    setAmbient (args) {
        if (!this._ensure()) return;
        this._ambient.intensity = Math.max(0, Cast.toNumber(args.VALUE));
        this._markDirty();
    }

    setSun (args) {
        if (!this._ensure()) return;
        this._sun.position.set(Cast.toNumber(args.X), Cast.toNumber(args.Y), Cast.toNumber(args.Z));
        this._sun.intensity = Math.max(0, Cast.toNumber(args.VALUE));
        this._markDirty();
    }

    setLayerVisible (args) {
        if (!this._ensure()) return;
        this._setLayerVisible(args.VISIBLE !== 'hide');
        this.runtime.requestRedraw();
    }
}

module.exports = Scratch3Three3DBlocks;

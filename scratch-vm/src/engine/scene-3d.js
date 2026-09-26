const StageLayering = require('./stage-layering');

// three.js is only loaded once something 3D is on the stage. The exported player only includes it for projects
// that need it, so nothing may require it at module load.
let THREE = null;
const loadThree = () => {
    if (!THREE) THREE = require('three');
    return THREE;
};

const SHAPES = ['cube', 'sphere', 'cylinder', 'cone', 'plane', 'torus'];

const MODEL_EXTENSION = /\.(glb|gltf)$/i;

// Keep the camera from flipping over when looking straight up or down
const MAX_PITCH = (Math.PI / 2) - 0.001;

// Multisampling for the 3D scene; the stage's own WebGL context has antialiasing off.
const MSAA_SAMPLES = 4;

const DEFAULT_COLOR = '#ffffff';

/**
 * @returns {object} The environment of a new project.
 */
const defaultEnvironment = () => ({
    // type: 'none' (see the 2D backdrop through the scene), 'color' or 'skybox' (an equirectangular image file)
    background: {type: 'none', color: '#87ceeb', file: ''},
    ambient: {color: '#ffffff', intensity: 0.6},
    sun: {color: '#ffffff', intensity: 1.2, x: 3, y: 5, z: 4},
    fog: {enabled: false, color: '#ffffff', near: 10, far: 100},
    camera: {x: 0, y: 0, z: 5, yaw: 0, pitch: 0, fov: 60}
});

/**
 * @returns {object} The material of a new 3D sprite.
 */
const defaultMaterial = () => ({
    color: DEFAULT_COLOR,
    opacity: 1,
    texture: ''
});

/**
 * @param {THREE.Material|THREE.Material[]} material
 * @returns {THREE.Material[]}
 */
const asArray = material => (Array.isArray(material) ? material : [material]);

const toNumber = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const toColor = (value, fallback) => (
    typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback
);

/**
 * Merge a (possibly partial or invalid) environment into a complete, valid one.
 * @param {object} base complete environment
 * @param {object} changes partial environment
 * @returns {object} new environment
 */
const mergeEnvironment = (base, changes) => {
    const result = JSON.parse(JSON.stringify(base));
    if (!changes || typeof changes !== 'object') return result;
    const section = name => (changes[name] && typeof changes[name] === 'object' ? changes[name] : {});

    const background = section('background');
    if (['none', 'color', 'skybox'].includes(background.type)) result.background.type = background.type;
    result.background.color = toColor(background.color, result.background.color);
    if (typeof background.file === 'string') result.background.file = background.file;

    for (const name of ['ambient', 'sun']) {
        const light = section(name);
        result[name].color = toColor(light.color, result[name].color);
        result[name].intensity = Math.max(0, toNumber(light.intensity, result[name].intensity));
    }
    const sun = section('sun');
    for (const axis of ['x', 'y', 'z']) result.sun[axis] = toNumber(sun[axis], result.sun[axis]);

    const fog = section('fog');
    if (typeof fog.enabled === 'boolean') result.fog.enabled = fog.enabled;
    result.fog.color = toColor(fog.color, result.fog.color);
    result.fog.near = Math.max(0, toNumber(fog.near, result.fog.near));
    result.fog.far = Math.max(result.fog.near, toNumber(fog.far, result.fog.far));

    const camera = section('camera');
    for (const key of ['x', 'y', 'z', 'yaw', 'pitch']) result.camera[key] = toNumber(camera[key], result.camera[key]);
    result.camera.pitch = Math.max(-89.9, Math.min(89.9, result.camera.pitch));
    result.camera.fov = Math.max(1, Math.min(179, toNumber(camera.fov, result.camera.fov)));
    return result;
};

/**
 * The 3D scene of the project, owned by the runtime.
 *
 * Normally three.js shares the stage's WebGL2 context and draws straight into the stage framebuffer through the
 * renderer's underlay hook, right before the pen layer, so 2D sprites and pen are always drawn on top of the scene.
 * Nothing is copied between contexts. If that isn't possible (no WebGL2, or a renderer without setUnderlay), it
 * falls back to an offscreen canvas shown as a bitmap skin in the video layer.
 *
 * Holds the 3D sprites (Target3D) and the procedural objects that blocks create by name.
 */
class Scene3D {
    constructor (runtime) {
        this.runtime = runtime;

        /** Saved with the project, see serialization/3dsb.js */
        this.environment = defaultEnvironment();

        /** @type {Set<Target3D>} every 3D sprite and clone */
        this.targets = new Set();
        /** @type {Map<string, THREE.Object3D>} objects that procedural blocks created, by name */
        this.objects = new Map();

        this.three = null;
        this.scene = null;
        this.camera = null;
        this._ambient = null;
        this._sun = null;
        this._canvas = null;
        this._skinId = -1;
        this._drawableId = -1;
        this._resolution = 1;
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

        /** @type {Map<string, Promise<THREE.Object3D>>} parsed models by md5 and name, shared by every copy */
        this._modelCache = new Map();
        /** @type {Map<string, THREE.BufferGeometry>} one geometry per basic shape, shared by every copy */
        this._geometries = new Map();
        /** @type {Map<string, {material: THREE.Material, users: number}>} shared materials of basic shapes */
        this._materials = new Map();
        /** @type {Map<string, THREE.Texture>} textures by file md5 */
        this._textures = new Map();
        this._backgroundTexture = null;
        this._backgroundFile = '';

        this._lockEnabled = false;
        this._lockSensitivity = 1;
        this._lockCanvas = null;
        this._onLockMouseDown = this._onLockMouseDown.bind(this);
        this._onLockMouseMove = this._onLockMouseMove.bind(this);

        this._render = this._render.bind(this);
        runtime.on('AFTER_EXECUTE', this._render);
        runtime.on('STAGE_SIZE_CHANGED', () => this._resize());
        runtime.on('PROJECT_STOP_ALL', () => this.setPointerLock(false));
        runtime.on('RUNTIME_DISPOSED', () => this.reset());
    }

    static get SHAPES () {
        return SHAPES;
    }

    static get MODEL_EXTENSION () {
        return MODEL_EXTENSION;
    }

    static get MAX_PITCH () {
        return MAX_PITCH;
    }

    static defaultEnvironment () {
        return defaultEnvironment();
    }

    static defaultMaterial () {
        return defaultMaterial();
    }

    /**
     * @returns {object} three.js, loading it if needed
     */
    get THREE () {
        return loadThree();
    }

    /**
     * Mark the scene for re-rendering. This also requests a redraw so that loops which only change 3D state
     * yield once per frame instead of running many times per frame like a loop that doesn't touch the stage.
     * The stage is redrawn on the next frame even while the project is stopped (e.g. editing in the sprite info).
     */
    markDirty () {
        this._dirty = true;
        this.runtime.requestRedraw();
        if (this._shared && this.runtime.renderer) {
            this.runtime.renderer.dirty = true;
        }
    }

    /**
     * Create the three.js renderer and scene if possible.
     * @returns {boolean} true if the scene exists
     */
    ensure () {
        const renderer = this.runtime.renderer;
        if (this.three || !renderer || typeof document === 'undefined') return !!this.three;
        loadThree();

        this._shared = this._createSharedRenderer(renderer);
        if (!this._shared) {
            const canvas = document.createElement('canvas');
            // BitmapSkin would otherwise call getContext('2d') on this WebGL canvas
            canvas.reusable = false;
            this._canvas = canvas;
            this.three = new THREE.WebGLRenderer({
                canvas,
                alpha: true,
                antialias: true,
                preserveDrawingBuffer: true
            });
        }
        this.three.setClearColor(0x000000, 0);

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 1000);
        // Yaw first, then pitch, so rotation.y / rotation.x are the look angles
        this.camera.rotation.order = 'YXZ';
        this._ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this._sun = new THREE.DirectionalLight(0xffffff, 1.2);
        this.scene.add(this._ambient, this._sun);
        this._applyEnvironment(true);

        if (this._shared) {
            renderer.setUnderlay(this._drawUnderlay, StageLayering.PEN_LAYER);
        } else {
            this._resize();
            this._skinId = renderer.createBitmapSkin(this._canvas, this._resolution);
            this._drawableId = renderer.createDrawable(StageLayering.VIDEO_LAYER);
            renderer.markDrawableAsNoninteractive(this._drawableId);
            renderer.updateDrawableSkinId(this._drawableId, this._skinId);
        }

        for (const target of this.targets) {
            this._createTargetObject(target);
        }
        this.markDirty();
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
            this.three = new THREE.WebGLRenderer({canvas: renderer.canvas, context: gl});
        } catch (e) {
            console.warn('3D: could not share the stage WebGL context', e);
            this.three = null;
            return false;
        }
        // The stage clears the framebuffer itself; the scene is drawn on top of what is below it.
        this.three.autoClear = false;
        this.three.setPixelRatio(1);
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
     * Called by the stage renderer in the middle of its draw, right before the pen layer.
     * @param {WebGL2RenderingContext} gl the stage context
     */
    _drawUnderlay (gl) {
        if (!this._layerVisible) return;
        const three = this.three;
        const width = gl.drawingBufferWidth;
        const height = gl.drawingBufferHeight;
        // The stage renderer changed GL state behind three.js's back
        three.resetState();
        if (this._target.width !== width || this._target.height !== height) {
            this._target.setSize(width, height);
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
            this._dirty = true;
        }
        // The stage redraws for sprite changes too; reuse the last 3D frame unless the scene changed.
        if (this._dirty) {
            this._dirty = false;
            three.setRenderTarget(this._target);
            three.clear();
            three.render(this.scene, this.camera);
        }
        three.setRenderTarget(null);
        three.setViewport(0, 0, width, height);
        three.render(this._blitScene, this._blitCamera);
        three.resetState();
    }

    _resize () {
        if (!this.three) return;
        if (this._shared) {
            // Sizes are read from the stage framebuffer when drawing
            this.markDirty();
            return;
        }
        const renderer = this.runtime.renderer;
        const width = this.runtime.stageWidth;
        const height = this.runtime.stageHeight;
        this._resolution = renderer.useHighQualityRender ?
            Math.max(1, renderer.canvas.width / width) :
            1;
        this.three.setPixelRatio(1);
        this.three.setSize(Math.round(width * this._resolution), Math.round(height * this._resolution), false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.markDirty();
    }

    _render () {
        if (!this._dirty || !this.three) return;
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
        this.three.render(this.scene, this.camera);
        renderer.updateBitmapSkin(this._skinId, this._canvas, this._resolution);
        this.runtime.requestRedraw();
    }

    /**
     * Back to an empty scene, e.g. before loading another project. 3D sprites remove themselves when disposed.
     */
    reset () {
        this.setPointerLock(false);
        this.clearObjects();
        for (const promise of this._modelCache.values()) {
            promise.then(scene => this.disposeTree(scene, true), () => {});
        }
        this._modelCache.clear();
        for (const texture of this._textures.values()) texture.dispose();
        this._textures.clear();
        this._backgroundTexture = null;
        this._backgroundFile = '';
        this.environment = defaultEnvironment();
        if (!this.three) return;
        this._applyEnvironment(true);
        this.setLayerVisible(true);
        this._render();
    }

    setLayerVisible (visible) {
        this._layerVisible = visible;
        if (!this.three) return;
        if (this._shared) {
            this.runtime.renderer.dirty = true;
        } else {
            this.runtime.renderer.updateDrawableVisible(this._drawableId, visible);
        }
        this.runtime.requestRedraw();
    }

    // Environment

    /**
     * @param {object} changes partial environment, e.g. {fog: {enabled: true}}
     */
    setEnvironment (changes) {
        const hadSkybox = this.environment.background.file;
        this.environment = mergeEnvironment(this.environment, changes);
        if (changes && changes.camera) {
            this._applyEnvironment(true);
        } else {
            this._applyEnvironment(false);
        }
        if (hadSkybox !== this.environment.background.file) this.markDirty();
    }

    /**
     * Replace the whole environment, e.g. when loading a project.
     * @param {object} environment possibly partial environment
     */
    loadEnvironment (environment) {
        this.environment = mergeEnvironment(defaultEnvironment(), environment);
        const isDefault = JSON.stringify(this.environment) === JSON.stringify(defaultEnvironment());
        // A project that changed the environment shows it right away, even before any 3D object exists.
        if (!isDefault) this.ensure();
        this._applyEnvironment(true);
    }

    /**
     * @returns {object} the environment to save, with the camera where it is now
     */
    getEnvironment () {
        if (this.camera) {
            const radToDeg = THREE.MathUtils.radToDeg;
            const round = n => Math.round(n * 1e6) / 1e6;
            this.environment.camera = {
                x: round(this.camera.position.x),
                y: round(this.camera.position.y),
                z: round(this.camera.position.z),
                yaw: round(radToDeg(this.camera.rotation.y)),
                pitch: round(radToDeg(this.camera.rotation.x)),
                fov: round(this.camera.fov)
            };
        }
        return JSON.parse(JSON.stringify(this.environment));
    }

    _color (hex) {
        return new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
    }

    /**
     * @param {boolean} includeCamera also move the camera to the environment's camera
     */
    _applyEnvironment (includeCamera) {
        if (!this.scene) return;
        const env = this.environment;
        const background = env.background;
        if (background.type === 'color') {
            this.scene.background = this._color(background.color);
        } else if (background.type === 'skybox' && background.file) {
            this._loadSkybox(background.file);
        } else {
            this.scene.background = null;
        }
        this._ambient.color = this._color(env.ambient.color);
        this._ambient.intensity = env.ambient.intensity;
        this._sun.color = this._color(env.sun.color);
        this._sun.intensity = env.sun.intensity;
        this._sun.position.set(env.sun.x, env.sun.y, env.sun.z);
        this.scene.fog = env.fog.enabled ?
            new THREE.Fog(this._color(env.fog.color), env.fog.near, env.fog.far) :
            null;
        if (includeCamera) {
            const camera = env.camera;
            this.camera.position.set(camera.x, camera.y, camera.z);
            this.camera.rotation.set(
                THREE.MathUtils.degToRad(camera.pitch),
                THREE.MathUtils.degToRad(camera.yaw),
                0
            );
            this.camera.fov = camera.fov;
            this.camera.updateProjectionMatrix();
        }
        this.markDirty();
    }

    _loadSkybox (fileName) {
        if (this._backgroundFile === fileName && this._backgroundTexture) {
            this.scene.background = this._backgroundTexture;
            return;
        }
        this.scene.background = null;
        this._backgroundFile = fileName;
        this._loadTexture(fileName).then(texture => {
            if (!texture || this.environment.background.file !== fileName) return;
            texture.mapping = THREE.EquirectangularReflectionMapping;
            this._backgroundTexture = texture;
            if (this.environment.background.type === 'skybox') {
                this.scene.background = texture;
                this.markDirty();
            }
        });
    }

    /**
     * @param {string} fileName name of an image in the Files tab
     * @returns {Promise<?THREE.Texture>} shared texture, or null if the file doesn't exist
     */
    _loadTexture (fileName) {
        const file = this.runtime.fileManager.getFile(fileName);
        if (!file) return Promise.resolve(null);
        const cached = this._textures.get(file.md5);
        if (cached) return Promise.resolve(cached);
        const url = URL.createObjectURL(new Blob([file.data], {type: this.runtime.fileManager.getMimeType(file.name)}));
        return new THREE.TextureLoader().loadAsync(url)
            .then(texture => {
                texture.colorSpace = THREE.SRGBColorSpace;
                this._textures.set(file.md5, texture);
                return texture;
            }, error => {
                console.warn(`3D: could not load texture ${fileName}`, error);
                return null;
            })
            .finally(() => URL.revokeObjectURL(url));
    }

    // Camera and mouse look

    setPointerLock (enabled, sensitivity) {
        this._lockEnabled = enabled;
        if (typeof sensitivity === 'number') this._lockSensitivity = sensitivity > 0 ? sensitivity : 1;
        // Nothing to undo if mouse look was never turned on (this runs on every stop)
        if (!enabled && !this._lockCanvas) return;
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

    isPointerLocked () {
        return typeof document !== 'undefined' &&
            !!this._lockCanvas &&
            document.pointerLockElement === this._lockCanvas;
    }

    _onLockMouseDown () {
        const canvas = this._lockCanvas;
        if (!this._lockEnabled || document.pointerLockElement === canvas) return;
        const result = canvas.requestPointerLock();
        // Newer browsers return a promise that rejects e.g. right after pressing Esc
        if (result && typeof result.catch === 'function') result.catch(() => {});
    }

    _onLockMouseMove (e) {
        if (!this._lockEnabled || !this.camera || document.pointerLockElement !== this._lockCanvas) return;
        const speed = 0.002 * this._lockSensitivity;
        const rotation = this.camera.rotation;
        rotation.y -= e.movementX * speed;
        rotation.x = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, rotation.x - (e.movementY * speed)));
        rotation.z = 0;
        this.markDirty();
    }

    // Shared resources

    /**
     * @param {string} shape one of SHAPES
     * @returns {THREE.BufferGeometry} geometry shared by every object with this shape
     */
    getGeometry (shape) {
        if (!SHAPES.includes(shape)) shape = 'cube';
        let geometry = this._geometries.get(shape);
        if (!geometry) {
            switch (shape) {
            case 'sphere': geometry = new THREE.SphereGeometry(0.5, 32, 16); break;
            case 'cylinder': geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32); break;
            case 'cone': geometry = new THREE.ConeGeometry(0.5, 1, 32); break;
            case 'plane': geometry = new THREE.PlaneGeometry(1, 1); break;
            case 'torus': geometry = new THREE.TorusGeometry(0.4, 0.15, 16, 48); break;
            default: geometry = new THREE.BoxGeometry(1, 1, 1);
            }
            this._geometries.set(shape, geometry);
        }
        return geometry;
    }

    /**
     * Get a material shared by every basic shape with the same settings. Release it with releaseMaterial.
     * @param {object} spec material settings, see defaultMaterial
     * @param {boolean} doubleSided true for flat shapes
     * @returns {THREE.Material} material
     */
    acquireMaterial (spec, doubleSided) {
        const key = `${spec.color}|${spec.opacity}|${spec.texture}|${doubleSided}`;
        let entry = this._materials.get(key);
        if (!entry) {
            const material = new THREE.MeshStandardMaterial({
                color: this._color(spec.color),
                opacity: spec.opacity,
                transparent: spec.opacity < 1,
                side: doubleSided ? THREE.DoubleSide : THREE.FrontSide
            });
            material.userData.twKey = key;
            if (spec.texture) {
                this._loadTexture(spec.texture).then(texture => {
                    if (!texture) return;
                    material.map = texture;
                    material.needsUpdate = true;
                    this.markDirty();
                });
            }
            entry = {material, users: 0};
            this._materials.set(key, entry);
        }
        entry.users++;
        return entry.material;
    }

    releaseMaterial (material) {
        const key = material.userData.twKey;
        const entry = this._materials.get(key);
        if (!entry || entry.material !== material) return;
        entry.users--;
        if (entry.users <= 0) {
            this._materials.delete(key);
            material.dispose();
        }
    }

    /**
     * @param {string} fileName name of a .glb or .gltf in the Files tab
     * @returns {?Promise<THREE.Object3D>} the parsed model, shared: copy it with cloneModel before adding it
     */
    getModel (fileName) {
        const file = this.runtime.fileManager.getFile(fileName);
        if (!file || !MODEL_EXTENSION.test(file.name)) return null;
        // .gltf files can reference other files, so they are cached by name too
        const cacheKey = `${file.md5}/${file.name.toLowerCase()}`;
        let promise = this._modelCache.get(cacheKey);
        if (!promise) {
            promise = this._parseModel(file);
            this._modelCache.set(cacheKey, promise);
            promise.catch(error => {
                console.warn(`3D: could not load model ${file.name}`, error);
                this._modelCache.delete(cacheKey);
            });
        }
        return promise;
    }

    /**
     * @param {THREE.Object3D} model from getModel
     * @returns {THREE.Object3D} a copy sharing geometry, materials and textures
     */
    cloneModel (model) {
        const {clone} = require('three/examples/jsm/utils/SkeletonUtils.js');
        const copy = clone(model);
        copy.userData.twModel = true;
        return copy;
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

    /**
     * @param {THREE.Object3D} root
     * @param {boolean} all true to dispose shared geometry, materials and textures too
     */
    disposeTree (root, all) {
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

    // 3D sprites

    /**
     * @param {Target3D} target a new 3D sprite or clone
     */
    addTarget (target) {
        this.targets.add(target);
        if (this.ensure()) {
            this._createTargetObject(target);
        }
    }

    /**
     * @param {Target3D} target a 3D sprite or clone being deleted
     */
    removeTarget (target) {
        this.targets.delete(target);
        const group = target.object3D;
        if (!group) return;
        this._disposeTargetModel(target);
        if (this.scene) this.scene.remove(group);
        target.object3D = null;
        this.markDirty();
    }

    _createTargetObject (target) {
        if (target.object3D) return;
        const group = new THREE.Group();
        group.rotation.order = 'YXZ';
        group.userData.twTarget = target;
        target.object3D = group;
        this.scene.add(group);
        this.updateTargetTransform(target);
        this.updateTargetModel(target);
    }

    /**
     * Copy position, rotation, scale and visibility from the target to its object.
     * @param {Target3D} target
     */
    updateTargetTransform (target) {
        const group = target.object3D;
        if (!group) return;
        const degToRad = THREE.MathUtils.degToRad;
        group.position.set(target.x, target.y, target.z);
        group.rotation.set(degToRad(target.rotationX), degToRad(target.rotationY), degToRad(target.rotationZ));
        group.scale.set(target.scaleX, target.scaleY, target.scaleZ);
        group.visible = target.visible;
        this.markDirty();
    }

    _disposeTargetModel (target) {
        const group = target.object3D;
        const model = group && group.userData.twModelObject;
        if (!model) return;
        group.remove(model);
        group.userData.twModelObject = null;
        if (model.userData.twModel) {
            this.disposeTree(model, false);
        } else if (model.isMesh) {
            this.releaseMaterial(model.material);
        }
    }

    /**
     * Rebuild the object of the target's current model with its material.
     * @param {Target3D} target
     */
    updateTargetModel (target) {
        const group = target.object3D;
        if (!group) return;
        this._disposeTargetModel(target);
        const token = {};
        group.userData.twModelToken = token;
        const model = target.getCurrentModel();
        const material = target.material;
        if (!model) {
            this.markDirty();
            return;
        }
        if (model.file) {
            const promise = this.getModel(model.file);
            if (!promise) {
                this.markDirty();
                return;
            }
            promise.then(scene => {
                // The model or material changed while loading, or the target is gone
                if (group.userData.twModelToken !== token || target.object3D !== group) return;
                const copy = this.cloneModel(scene);
                this._applyModelMaterial(copy, material);
                group.add(copy);
                group.userData.twModelObject = copy;
                this.markDirty();
            }, () => {});
            return;
        }
        const shape = SHAPES.includes(model.shape) ? model.shape : 'cube';
        const mesh = new THREE.Mesh(this.getGeometry(shape), this.acquireMaterial(material, shape === 'plane'));
        group.add(mesh);
        group.userData.twModelObject = mesh;
        this.markDirty();
    }

    /**
     * Models keep their own materials unless the sprite's material changes them.
     * @param {THREE.Object3D} model copy of a model
     * @param {object} spec material settings
     */
    _applyModelMaterial (model, spec) {
        const tinted = spec.color !== DEFAULT_COLOR;
        if (!tinted && spec.opacity >= 1 && !spec.texture) return;
        const texturePromise = spec.texture ? this._loadTexture(spec.texture) : null;
        model.traverse(child => {
            if (!child.isMesh) return;
            // Materials are shared with other copies of the model, so give this copy its own
            child.material = Array.isArray(child.material) ?
                child.material.map(material => material.clone()) :
                child.material.clone();
            child.userData.twOwnMaterial = true;
            for (const material of asArray(child.material)) {
                if (tinted && material.color) material.color = this._color(spec.color);
                if (spec.opacity < 1) {
                    material.transparent = true;
                    material.opacity = spec.opacity;
                }
                if (texturePromise) {
                    texturePromise.then(texture => {
                        if (!texture) return;
                        material.map = texture;
                        material.needsUpdate = true;
                        this.markDirty();
                    });
                }
            }
        });
    }

    // Procedural objects

    getObject (name) {
        return this.objects.get(name);
    }

    /**
     * Add or replace a procedural object. A replaced object leaves its position, rotation and scale to the new one.
     * @param {string} name
     * @param {THREE.Object3D} object
     */
    setObject (name, object) {
        const old = this.objects.get(name);
        if (old) {
            object.position.copy(old.position);
            object.rotation.copy(old.rotation);
            object.scale.copy(old.scale);
            this._disposeObject(old);
        }
        this.objects.set(name, object);
        this.scene.add(object);
        this.markDirty();
    }

    removeObject (name) {
        const object = this.objects.get(name);
        if (!object) return;
        this._disposeObject(object);
        this.objects.delete(name);
        this.markDirty();
    }

    clearObjects () {
        for (const object of this.objects.values()) {
            this._disposeObject(object);
        }
        this.objects.clear();
        this.markDirty();
    }

    _disposeObject (object) {
        if (this.scene) this.scene.remove(object);
        if (object.userData.twModel) {
            // Geometry and textures belong to the cached model; only drop what this copy owns
            this.disposeTree(object, false);
            return;
        }
        if (object.userData.twSharedGeometry) {
            object.material.dispose();
            return;
        }
        object.geometry.dispose();
        object.material.dispose();
    }
}

module.exports = Scene3D;

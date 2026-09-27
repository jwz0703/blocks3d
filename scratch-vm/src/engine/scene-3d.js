const StageLayering = require('./stage-layering');
const Editor3D = require('./scene-3d-editor');
const Environment = require('./scene-3d-environment');
const SkyRenderer = require('./scene-3d-sky');
const CameraFollow = require('./scene-3d-follow');
const Physics3D = require('./scene-3d-physics');
const Instancing = require('./scene-3d-instancing');
const {setAudioParam} = require('./spatial-audio-effect');

// three.js is only loaded once something 3D is on the stage. The exported player only includes it for projects
// that need it, so nothing may require it at module load.
let THREE = null;
const loadThree = () => {
    if (!THREE) THREE = require('three');
    return THREE;
};

const SHAPES = ['cube', 'sphere', 'cylinder', 'cone', 'plane', 'torus'];

// Size of each basic shape's geometry (see getGeometry), centered on the origin
const SHAPE_SIZES = {
    cube: [1, 1, 1],
    sphere: [1, 1, 1],
    cylinder: [1, 1, 1],
    cone: [1, 1, 1],
    plane: [1, 1, 0],
    torus: [1.1, 1.1, 0.3]
};

const MODEL_EXTENSION = /\.(glb|gltf)$/i;

// Keep the camera from flipping over when looking straight up or down
const MAX_PITCH = (Math.PI / 2) - 0.001;

// Multisampling for the 3D scene; the stage's own WebGL context has antialiasing off.
const MSAA_SAMPLES = 4;

const DEFAULT_COLOR = '#ffffff';

// A material texture that starts with this is the canvas of the canvas sprite with the rest as its name, and
// changes whenever the sprite is drawn on. Anything else is the name of an image in the Files tab.
const CANVAS_TEXTURE_PREFIX = 'canvas:';

// Objects on this layer (the frustums of camera sprites) are only seen by the editor camera and editor picking
const EDITOR_LAYER = 1;

// Distance from the camera to the end of the frustum drawn for camera sprites
const FRUSTUM_LENGTH = 1.2;

// Procedural skies are redrawn at most this often while their sun moves, in milliseconds
const SKY_UPDATE_INTERVAL = 100;

const TONE_MAPPING_NAMES = {
    none: 'NoToneMapping',
    neutral: 'NeutralToneMapping',
    agx: 'AgXToneMapping',
    aces: 'ACESFilmicToneMapping'
};

/**
 * @returns {object} the camera the stage shows when the project has no camera sprite
 */
const defaultCamera = () => ({x: 0, y: 0, z: 5, yaw: 0, pitch: 0, roll: 0, fov: 60});

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

// The environment of backdrops that have none: their 2D picture shows behind the scene
const DEFAULT_2D_ENVIRONMENT = Object.freeze(Environment.default2DEnvironment());

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

        /** @type {Set<Target3D>} every 3D sprite and clone, and every camera sprite */
        this.targets = new Set();
        /** @type {Map<string, THREE.Object3D>} objects that procedural blocks created, by name */
        this.objects = new Map();

        /**
         * The camera sprite the stage shows, or null to show defaultCameraState.
         * @type {?CameraTarget}
         */
        this.activeCamera = null;
        /** Where the stage looks from when there is no camera sprite; blocks can move it too */
        this.defaultCameraState = defaultCamera();
        /** Used for projections before three.js has a renderer (e.g. in tests) */
        this._detachedCamera = null;

        /** The environment the scene shows, and how many times it changed, to notice when it must be applied */
        this._appliedEnvironment = null;
        this._environmentVersion = 0;
        this._appliedEnvironmentVersion = -1;
        /** The environment of a project without a stage (tests, before loading) */
        this._fallbackEnvironment = DEFAULT_2D_ENVIRONMENT;

        this.three = null;
        this.scene = null;
        /** The game camera, copied from the current camera before each use, see getGameCamera() */
        this.camera = null;
        this._ambient = null;
        this._sun = null;
        this._canvas = null;
        this._skinId = -1;
        this._drawableId = -1;
        this._resolution = 1;
        this._dirty = false;
        /**
         * Targets whose objects don't show their position, rotation, scale and visibility yet. Blocks change a target
         * many times per frame; its object is updated once, right before it is drawn or looked at.
         * @type {Set<Target3D>}
         */
        this._dirtyTransforms = new Set();

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
        /** @type {Map<string, THREE.Object3D|false>} the models that finished loading (false: couldn't be loaded) */
        this._loadedModels = new Map();
        /** @type {WeakMap<THREE.Object3D, THREE.AnimationClip[]>} animations of each loaded model */
        this._modelAnimations = new WeakMap();
        /** @type {WeakMap<THREE.Object3D, THREE.AnimationMixer>} mixers of the model copies that play animations */
        this._mixers = new WeakMap();
        /** @type {Map<string, THREE.BufferGeometry>} one geometry per basic shape, shared by every copy */
        this._geometries = new Map();
        /** @type {Map<string, {material: THREE.Material, users: number}>} shared materials of basic shapes */
        this._materials = new Map();
        /** @type {Map<string, THREE.Texture>} textures by file md5 */
        this._textures = new Map();
        /** @type {Map<CanvasTarget, THREE.CanvasTexture>} textures of canvas sprites */
        this._canvasTextures = new Map();
        /** @type {Map<string, Promise<?THREE.Texture>>} equirectangular images by file md5 */
        this._equirects = new Map();
        /** @type {?SkyRenderer} */
        this._sky = null;
        this._skyKey = '';
        this._skyTime = 0;
        this._skyTimer = null;
        this._roomTexture = null;
        this._needsRoom = false;
        /** True if the renderer can draw into half float targets, so that the scene keeps colors above 1 */
        this._hdr = false;

        this._lockEnabled = false;
        this._lockSensitivity = 1;
        this._lockCanvas = null;
        this._onLockMouseDown = this._onLockMouseDown.bind(this);
        this._onLockMouseMove = this._onLockMouseMove.bind(this);
        /** The finger that turns the camera on touch screens, see _onLookTouch */
        this._lookTouch = null;
        this._onLookTouch = this._onLookTouch.bind(this);

        /** Editing on the stage, in the editor only */
        this.editor = new Editor3D(this);
        /** Cameras that follow 3D sprites */
        this.follow = new CameraFollow(this);
        /** Collision and physics */
        this.physics = new Physics3D(this);
        /** Clones and copies of the same model are drawn together */
        this.instancing = new Instancing(this);

        /** Frames per second of the runtime and what the last render drew, for the performance panel */
        this._frameTimes = [];
        this._renderStats = {calls: 0, triangles: 0};

        this._render = this._render.bind(this);
        runtime.on('AFTER_EXECUTE', () => {
            this._countFrame();
            this._updateAnimations(runtime.frameDelta);
            this.follow.tick();
            this._updateBubbles();
            this._updateAudio();
            this._render();
        });
        runtime.on('STAGE_SIZE_CHANGED', () => {
            this._resize();
            // Camera frustums have the shape of the stage
            for (const target of this.targets) {
                if (target.isCamera) this.updateTargetModel(target);
            }
        });
        runtime.on('PROJECT_STOP_ALL', () => {
            this.setPointerLock(false);
            this.follow.reset();
            // Animations stop where they are
            for (const target of this.targets) {
                if (target.animation) target.animation.playing = false;
            }
        });
        runtime.on('RUNTIME_DISPOSED', () => this.reset());
        // Give the mouse back while paused, so that the pause button and the editor can be clicked
        runtime.on('RUNTIME_PAUSED', () => {
            if (this.isPointerLocked()) document.exitPointerLock();
        });
        runtime.on('CANVAS_SPRITE_DRAWN', target => this._onCanvasDrawn(target));
        runtime.on('CANVAS_SPRITE_ADDED', target => this._onCanvasAdded(target));
        runtime.on('CANVAS_SPRITE_REMOVED', target => {
            const texture = this._canvasTextures.get(target);
            if (texture) texture.dispose();
            this._canvasTextures.delete(target);
        });
    }

    static get SHAPES () {
        return SHAPES;
    }

    static get MODEL_EXTENSION () {
        return MODEL_EXTENSION;
    }

    static get CANVAS_TEXTURE_PREFIX () {
        return CANVAS_TEXTURE_PREFIX;
    }

    static get MAX_PITCH () {
        return MAX_PITCH;
    }

    static get EDITOR_LAYER () {
        return EDITOR_LAYER;
    }

    static defaultCamera () {
        return defaultCamera();
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
        // Once per frame is enough: the flags below are only reset when the stage is drawn or a frame starts
        if (this._dirty && this.runtime.redrawRequested) return;
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
        this.three.shadowMap.enabled = true;
        this.three.shadowMap.type = THREE.PCFShadowMap;
        if (!this._shared) this._hdr = this.three.extensions.has('EXT_color_buffer_float');

        this.scene = new THREE.Scene();
        this.camera = this._makeCamera();
        this._ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this._sun = new THREE.DirectionalLight(0xffffff, 1.2);
        const shadow = this._sun.shadow;
        this._applyShadowQuality();
        Object.assign(shadow.camera, {left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 150});
        shadow.bias = -0.0005;
        shadow.normalBias = 0.02;
        this.scene.add(this._ambient, this._sun);
        this._appliedEnvironmentVersion = -1;
        this._syncEnvironment();

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
        this.editor.setup();
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
        // Half floats keep colors above 1 (the sun, bright skies) until tone mapping, which happens when the scene
        // is drawn onto the stage
        this._hdr = this.three.extensions.has('EXT_color_buffer_float');
        this._target = new THREE.WebGLRenderTarget(1, 1, {
            samples: MSAA_SAMPLES,
            type: this._hdr ? THREE.HalfFloatType : THREE.UnsignedByteType
        });
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
            this._setAspect(width / height);
            this._dirty = true;
        }
        this._syncEnvironment();
        this.flushTransforms();
        // The stage redraws for sprite changes too; reuse the last 3D frame unless the scene changed.
        if (this._dirty) {
            this._dirty = false;
            this._prepareMaps();
            three.setRenderTarget(this._target);
            three.clear();
            this._renderScene();
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
        this._setAspect(width / height);
        this.markDirty();
    }

    /**
     * @param {number} aspect width / height of the stage
     */
    _setAspect (aspect) {
        this.camera.aspect = aspect;
        this.camera.updateProjectionMatrix();
        this.editor.setAspect(aspect);
    }

    /**
     * Draw the scene with the camera it is seen through, instancing what can be instanced.
     */
    _renderScene () {
        const camera = this._getRenderCamera();
        const info = this.three.info;
        info.autoReset = false;
        info.reset();
        this.instancing.begin(camera);
        try {
            this.three.render(this.scene, camera);
        } finally {
            this.instancing.end();
        }
        this._renderStats.calls = info.render.calls;
        this._renderStats.triangles = info.render.triangles;
    }

    _countFrame () {
        const now = typeof performance === 'undefined' ? Date.now() : performance.now();
        const times = this._frameTimes;
        times.push(now);
        while (times.length > 0 && now - times[0] > 1000) times.shift();
    }

    /**
     * What the performance panel shows (ROADMAP.md 7.4).
     * @returns {object} frames per second of the runtime, and what the last render of the scene drew
     */
    getStats () {
        const times = this._frameTimes;
        const now = typeof performance === 'undefined' ? Date.now() : performance.now();
        // No frames for a while: the project isn't running frames (e.g. the editor is idle)
        const fps = times.length > 1 && now - times[times.length - 1] < 1000 ?
            Math.round((times.length - 1) * 1000 / (times[times.length - 1] - times[0])) :
            0;
        let sprites = 0;
        let clones = 0;
        for (const target of this.targets) {
            if (target.isCamera) continue;
            if (target.isOriginal) sprites++;
            else clones++;
        }
        const memory = this.three ? this.three.info.memory : {geometries: 0, textures: 0};
        return {
            fps,
            active: !!this.three,
            drawCalls: this._renderStats.calls,
            triangles: this._renderStats.triangles,
            sprites,
            clones,
            objects: this.objects.size,
            instanced: this.instancing.stats.instances,
            batches: this.instancing.stats.batches,
            culled: this.instancing.stats.culled,
            geometries: memory.geometries,
            textures: memory.textures,
            shadows: this.castsShadows()
        };
    }

    /**
     * @returns {boolean} true if the sun casts shadows right now
     */
    castsShadows () {
        return !!(this._sun && this._sun.castShadow && this._sun.visible && this._sun.intensity > 0);
    }

    /**
     * @returns {THREE.Camera} the editor's camera while editing, otherwise the game camera
     */
    _getRenderCamera () {
        if (this.editor.active) return this.editor.camera;
        return this.getGameCamera();
    }

    /**
     * Speech bubbles of 3D sprites follow where the sprites are drawn, which changes when the camera moves.
     */
    _updateBubbles () {
        if (!this._dirty) return;
        for (const target of this.targets) {
            if (target.onTargetVisualChange) target.onTargetVisualChange(target);
        }
    }

    _render () {
        if (!this.three) return;
        this._syncEnvironment();
        this.flushTransforms();
        if (!this._dirty) return;
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
        this._prepareMaps();
        this._renderScene();
        renderer.updateBitmapSkin(this._skinId, this._canvas, this._resolution);
        this.runtime.requestRedraw();
    }

    /**
     * Back to an empty scene, e.g. before loading another project. 3D sprites remove themselves when disposed.
     */
    reset () {
        this.setPointerLock(false);
        this.follow.reset();
        this.physics.reset();
        this.instancing.reset();
        this.clearObjects();
        for (const promise of this._modelCache.values()) {
            promise.then(scene => this.disposeTree(scene, true), () => {});
        }
        this._modelCache.clear();
        this._loadedModels.clear();
        for (const texture of this._textures.values()) texture.dispose();
        this._textures.clear();
        for (const texture of this._canvasTextures.values()) texture.dispose();
        this._canvasTextures.clear();
        for (const promise of this._equirects.values()) {
            promise.then(texture => texture && texture.dispose(), () => {});
        }
        this._equirects.clear();
        this.activeCamera = null;
        this.defaultCameraState = defaultCamera();
        this.editor.cameraChanged();
        this._appliedEnvironment = null;
        this._appliedEnvironmentVersion = -1;
        if (!this.three) return;
        this._syncEnvironment();
        this.editor.resetCamera(true);
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
     * @returns {?object} the costume of the stage's current backdrop
     */
    _getBackdrop () {
        const stage = this.runtime.getTargetForStage && this.runtime.getTargetForStage();
        if (!stage) return null;
        const costumes = stage.getCostumes();
        return costumes[stage.currentCostume] || null;
    }

    /**
     * @param {number} [index] a backdrop of the stage; the current one by default
     * @returns {object} its environment. Don't change it: use setEnvironment.
     */
    getEnvironment (index) {
        const stage = this.runtime.getTargetForStage && this.runtime.getTargetForStage();
        if (!stage) return this._fallbackEnvironment;
        const costume = typeof index === 'number' ? stage.getCostumes()[index] : this._getBackdrop();
        return (costume && costume.environment) || DEFAULT_2D_ENVIRONMENT;
    }

    /**
     * The environment of the current backdrop.
     * @returns {object} see getEnvironment
     */
    get environment () {
        return this.getEnvironment();
    }

    /**
     * Change an environment. The current one is shown right away.
     * @param {object} changes partial environment, e.g. {fog: {enabled: true}}
     * @param {number} [index] a backdrop of the stage; the current one by default
     */
    setEnvironment (changes, index) {
        const stage = this.runtime.getTargetForStage && this.runtime.getTargetForStage();
        const costume = stage && (typeof index === 'number' ? stage.getCostumes()[index] : this._getBackdrop());
        const environment = Environment.mergeEnvironment(this.getEnvironment(index), changes);
        if (costume) {
            costume.environment = environment;
        } else if (stage) {
            return;
        } else {
            this._fallbackEnvironment = environment;
        }
        this._environmentVersion++;
        this.onBackdropChanged();
    }

    /**
     * Called when the stage switches backdrops, or when the current environment changed.
     */
    onBackdropChanged () {
        // A project whose environment isn't the 2D backdrop shows it right away, even before any 3D object exists
        if (this.getEnvironment() !== DEFAULT_2D_ENVIRONMENT) this.ensure();
        this.markDirty();
    }

    /**
     * Called when a whole project was loaded: show its environment, and put the editor camera where its camera is.
     */
    onProjectLoaded () {
        // Attach sprites to their parents, which may have been loaded after them
        for (const target of this.targets) {
            if (typeof target._parentName !== 'string') continue;
            const parent = this.runtime.getSpriteTargetByName(target._parentName);
            target._parentName = null;
            if (parent && parent.is3D) {
                target.parent3D = parent;
                this.updateTargetParent(target);
            }
        }
        // Rapier takes a moment to load, so projects that need it get it before they start
        if (this.usesPhysics()) this.physics.load();
        this.onBackdropChanged();
        this.editor.resetCamera(true);
    }

    /**
     * @returns {boolean} true if the project has blocks that need Rapier (collision, physics, raycasts) or bodies
     * that move by themselves
     */
    usesPhysics () {
        for (const target of this.runtime.targets) {
            if (!target.isOriginal) continue;
            if (target.is3D && target.physics && target.physics.body !== 'kinematic') return true;
            const blocks = target.blocks._blocks;
            for (const id in blocks) {
                const opcode = blocks[id].opcode;
                if (opcode.startsWith('physics3d_') || opcode === 'sensing3d_touching' ||
                    (target.is3D && opcode === 'sensing_touchingobject') ||
                    (target.is3D && opcode === 'event_whentouchingobject')) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Apply the current environment to the scene if it changed since it was last applied.
     */
    _syncEnvironment () {
        if (!this.scene) return;
        const environment = this.getEnvironment();
        if (environment === this._appliedEnvironment && this._environmentVersion === this._appliedEnvironmentVersion) {
            return;
        }
        this._appliedEnvironment = environment;
        this._appliedEnvironmentVersion = this._environmentVersion;
        this._applyEnvironment(environment);
    }

    _color (hex) {
        return new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
    }

    /**
     * @param {object} env complete environment
     * @returns {THREE.Vector3} unit vector towards the sun
     */
    _sunDirection (env) {
        return new THREE.Vector3(env.sun.x, env.sun.y, env.sun.z).normalize();
    }

    /**
     * @param {object} env complete environment
     */
    _applyEnvironment (env) {
        const scene = this.scene;
        const degToRad = THREE.MathUtils.degToRad;
        const sky = env.sky;

        // Sky
        scene.background = null;
        if (sky.type === 'color') {
            scene.background = this._color(sky.color);
        } else if (sky.type === 'procedural' || sky.type === 'gradient') {
            // Drawn by _updateSky before rendering, which needs the renderer
            if (this._sky) scene.background = this._sky.texture;
        } else if (sky.type === 'hdri' && sky.file) {
            this._useEquirect(sky.file, env, texture => {
                scene.background = texture;
            });
        }
        scene.backgroundBlurriness = sky.blur / 100;
        scene.backgroundRotation.set(0, degToRad(sky.rotation), 0);

        // Image-based lighting
        scene.environment = null;
        const lighting = env.lighting;
        let lightingType = lighting.type;
        let rotation = lighting.rotation;
        if (lightingType === 'sky') {
            if (sky.type === 'procedural' || sky.type === 'gradient') {
                if (this._sky) scene.environment = this._sky.texture;
                rotation = sky.rotation;
            } else if (sky.type === 'hdri' && sky.file) {
                this._useEquirect(sky.file, env, texture => {
                    scene.environment = texture;
                });
                rotation = sky.rotation;
            } else {
                lightingType = 'room';
            }
        }
        if (lightingType === 'room') {
            scene.environment = this._getRoomTexture();
        } else if (lightingType === 'hdri' && lighting.file) {
            this._useEquirect(lighting.file, env, texture => {
                scene.environment = texture;
            });
        }
        scene.environmentIntensity = lighting.intensity;
        scene.environmentRotation.set(0, degToRad(rotation), 0);

        // Lights
        this._ambient.color = this._color(env.ambient.color);
        this._ambient.intensity = env.ambient.intensity;
        this._sun.color = this._color(env.sun.color);
        this._sun.intensity = env.sun.intensity;
        // Far enough that its shadow covers the area around the origin
        this._sun.position.copy(this._sunDirection(env)).multiplyScalar(50);
        this._sun.castShadow = env.sun.shadows && this._getShadowQuality() !== 'off';

        scene.fog = env.fog.enabled ?
            new THREE.Fog(this._color(env.fog.color), env.fog.near, env.fog.far) :
            null;

        this.three.toneMapping = THREE[TONE_MAPPING_NAMES[env.toneMapping]] || THREE.NoToneMapping;
        this.three.toneMappingExposure = env.exposure;
        this.markDirty();
    }

    /**
     * @returns {string} how good the sun's shadows are, from the screen settings (see engine/screen.js)
     */
    _getShadowQuality () {
        const screen = this.runtime.screen;
        return (screen && screen.shadows) || 'high';
    }

    _applyShadowQuality () {
        const shadow = this._sun.shadow;
        const size = this._getShadowQuality() === 'low' ? 1024 : 2048;
        if (shadow.mapSize.x === size) return;
        shadow.mapSize.set(size, size);
        // Made again with the new size on the next render
        if (shadow.map) {
            shadow.map.dispose();
            shadow.map = null;
        }
    }

    /**
     * The shadow quality in the screen settings changed.
     */
    setShadowQuality () {
        if (!this.three) return;
        this._applyShadowQuality();
        // Turns the sun's shadows on or off
        this._appliedEnvironmentVersion = -1;
        this._syncEnvironment();
        this.markDirty();
    }

    /**
     * Draw the procedural or gradient sky if it changed. Needs the renderer, so it runs right before rendering.
     */
    _updateSky () {
        const env = this.getEnvironment();
        const sky = env.sky;
        if (sky.type !== 'procedural' && sky.type !== 'gradient') return;
        const key = JSON.stringify([sky.type, sky.top, sky.bottom, sky.clouds, env.sun.x, env.sun.y, env.sun.z,
            env.sun.color]);
        if (this._sky && key === this._skyKey) return;
        // A sun that moves every frame redraws the sky (and its lighting) only every so often
        const now = Date.now();
        if (this._sky && now - this._skyTime < SKY_UPDATE_INTERVAL) {
            if (!this._skyTimer) {
                this._skyTimer = setTimeout(() => {
                    this._skyTimer = null;
                    this.markDirty();
                }, SKY_UPDATE_INTERVAL - (now - this._skyTime));
            }
            return;
        }
        const created = !this._sky;
        if (created) this._sky = new SkyRenderer(THREE, this._hdr);
        this._skyKey = key;
        this._skyTime = now;
        this._sky.render(this.three, {
            type: sky.type,
            top: this._color(sky.top),
            bottom: this._color(sky.bottom),
            sunDirection: this._sunDirection(env),
            sunColor: this._color(env.sun.color),
            clouds: sky.clouds / 100
        });
        if (created) {
            // The environment was applied before the sky existed
            this._applyEnvironment(env);
            this._dirty = true;
        }
    }

    /**
     * @returns {?THREE.Texture} neutral studio lighting that needs no file, or null until _prepareMaps made it
     */
    _getRoomTexture () {
        if (!this._roomTexture) this._needsRoom = true;
        return this._roomTexture;
    }

    /**
     * Make what the environment needs from the renderer. PMREMGenerator and the sky draw with it, which is only
     * safe right before the scene is rendered (the stage's WebGL context is shared).
     */
    _prepareMaps () {
        if (this._needsRoom) {
            this._needsRoom = false;
            const {RoomEnvironment} = require('three/examples/jsm/environments/RoomEnvironment.js');
            const room = new RoomEnvironment();
            const generator = new THREE.PMREMGenerator(this.three);
            this._roomTexture = generator.fromScene(room, 0.04).texture;
            generator.dispose();
            room.traverse(child => {
                if (child.isMesh) {
                    child.geometry.dispose();
                    child.material.dispose();
                }
            });
            this._applyEnvironment(this._appliedEnvironment);
        }
        this._updateSky();
    }

    /**
     * Load an equirectangular image and use it once it is loaded, if the environment is still the same.
     * @param {string} fileName in the Files tab
     * @param {object} env the environment that wants it
     * @param {function(THREE.Texture): void} use called with the texture
     */
    _useEquirect (fileName, env, use) {
        const promise = this._loadEquirect(fileName);
        if (!promise) return;
        promise.then(texture => {
            if (!texture || this._appliedEnvironment !== env || !this.scene) return;
            use(texture);
            this.markDirty();
        });
    }

    /**
     * @param {string} fileName .hdr, .exr, UltraHDR .jpg or another image in the Files tab
     * @returns {?Promise<?THREE.Texture>} shared texture with equirectangular mapping, or null without such a file
     */
    _loadEquirect (fileName) {
        const file = this.runtime.fileManager.getFile(fileName);
        if (!file) return null;
        let promise = this._equirects.get(file.md5);
        if (promise) return promise;
        const url = URL.createObjectURL(new Blob([file.data], {type: this.runtime.fileManager.getMimeType(file.name)}));
        const extension = (file.name.split('.').pop() || '').toLowerCase();
        const loadImage = () => new THREE.TextureLoader().loadAsync(url)
            .then(texture => {
                texture.colorSpace = THREE.SRGBColorSpace;
                return texture;
            });
        let load;
        if (extension === 'hdr') {
            const {HDRLoader} = require('three/examples/jsm/loaders/HDRLoader.js');
            load = new HDRLoader().loadAsync(url);
        } else if (extension === 'exr') {
            const {EXRLoader} = require('three/examples/jsm/loaders/EXRLoader.js');
            load = new EXRLoader().loadAsync(url);
        } else if (extension === 'jpg' || extension === 'jpeg') {
            // UltraHDR images are JPEGs with a gain map; ordinary JPEGs are loaded as they are
            const {UltraHDRLoader} = require('three/examples/jsm/loaders/UltraHDRLoader.js');
            load = new UltraHDRLoader().loadAsync(url)
                .catch(loadImage);
        } else {
            load = loadImage();
        }
        promise = load
            .then(texture => {
                texture.mapping = THREE.EquirectangularReflectionMapping;
                return texture;
            }, error => {
                console.warn(`3D: could not load sky ${fileName}`, error);
                this._equirects.delete(file.md5);
                return null;
            })
            .finally(() => URL.revokeObjectURL(url));
        this._equirects.set(file.md5, promise);
        return promise;
    }

    /**
     * @param {string} fileName name of an image in the Files tab
     * @returns {Promise<?THREE.Texture>} shared texture, or null if the file doesn't exist
     */
    loadTexture (fileName) {
        if (fileName.startsWith(CANVAS_TEXTURE_PREFIX)) {
            return Promise.resolve(this._getCanvasTexture(fileName.slice(CANVAS_TEXTURE_PREFIX.length)));
        }
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

    /**
     * @param {string} name a canvas sprite's name
     * @returns {?THREE.CanvasTexture} texture showing its canvas, or null if there is no such sprite (yet)
     */
    _getCanvasTexture (name) {
        const target = this.runtime.canvasSprites.getByName(name);
        if (!target || !target.canvas) return null;
        let texture = this._canvasTextures.get(target);
        if (texture && texture.image !== target.canvas) {
            // The stage size changed, so the sprite has a new canvas
            texture.dispose();
            texture = null;
        }
        if (!texture) {
            texture = new THREE.CanvasTexture(target.canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            this._canvasTextures.set(target, texture);
        }
        return texture;
    }

    _onCanvasDrawn (target) {
        const texture = this._canvasTextures.get(target);
        if (!texture) return;
        if (texture.image === target.canvas) {
            texture.needsUpdate = true;
            this.markDirty();
        } else {
            this._refreshCanvasUsers(target.getName());
        }
    }

    _onCanvasAdded (target) {
        if (target.isOriginal) this._refreshCanvasUsers(target.getName());
    }

    /**
     * Rebuild the models of 3D sprites whose texture is a canvas sprite's, e.g. once the canvas sprite exists.
     * @param {string} name the canvas sprite's name
     */
    _refreshCanvasUsers (name) {
        const texture = `${CANVAS_TEXTURE_PREFIX}${name}`;
        for (const target of this.targets) {
            if (target.material.texture === texture) this.updateTargetModel(target);
        }
    }

    // Cameras and mouse look

    /**
     * @returns {THREE.PerspectiveCamera} a new camera with the game camera's settings
     */
    _makeCamera () {
        loadThree();
        const camera = new THREE.PerspectiveCamera(60, this.runtime.stageWidth / this.runtime.stageHeight, 0.1, 1000);
        // Yaw first, then pitch, then roll, like 3D sprites
        camera.rotation.order = 'YXZ';
        return camera;
    }

    /**
     * @returns {?CameraTarget} the camera sprite the stage shows, or null if it shows the default camera
     */
    getActiveCamera () {
        return this.activeCamera;
    }

    /**
     * Show what a camera sprite sees, or the default camera.
     * @param {?CameraTarget} target a camera sprite (a clone stands for its sprite), or null
     */
    setActiveCamera (target) {
        if (target && !target.isOriginal) target = target.sprite.clones.find(clone => clone.isOriginal) || null;
        if (target && (!target.isCamera || !this.targets.has(target))) return;
        const previous = this.activeCamera;
        if (previous === target) return;
        this.activeCamera = target;
        this.editor.cameraChanged();
        // The frustum of the current camera is drawn differently
        for (const camera of [previous, target]) {
            if (camera) {
                this.updateTargetModel(camera);
                this.runtime.requestTargetsUpdate(camera);
            }
        }
        this.markDirty();
    }

    /**
     * @returns {CameraTarget[]} the camera sprites, in sprite list order
     */
    getCameras () {
        return this.runtime.targets.filter(target => target.isCamera && target.isOriginal && this.targets.has(target));
    }

    /**
     * @returns {{x: number, y: number, z: number, yaw: number, pitch: number, roll: number, fov: number}} where the
     * game camera is, how it is turned (degrees) and its vertical field of view
     */
    getCameraState () {
        const camera = this.activeCamera;
        if (!camera) return Object.assign({}, this.defaultCameraState);
        // A camera can be attached to a sprite, e.g. a first person camera to the player
        const pose = camera.getWorldPose();
        return {
            x: pose.x,
            y: pose.y,
            z: pose.z,
            yaw: pose.yaw,
            pitch: pose.pitch,
            roll: pose.roll,
            fov: camera.fov
        };
    }

    /**
     * Move the game camera: the current camera sprite, or the default camera.
     * @param {object} changes some of the fields of getCameraState()
     */
    setCameraState (changes) {
        const state = Object.assign(this.getCameraState(), changes);
        for (const key of Object.keys(state)) {
            if (!Number.isFinite(state[key])) state[key] = this.getCameraState()[key];
        }
        const camera = this.activeCamera;
        if (camera) {
            camera.setWorldPose(state);
            if (state.fov !== camera.fov) camera.setFov(state.fov);
            return;
        }
        state.fov = Math.max(1, Math.min(179, state.fov));
        this.defaultCameraState = state;
        this.markDirty();
    }

    /**
     * Move the default camera, whether or not the stage shows it.
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} yaw degrees
     * @param {number} pitch degrees
     */
    setDefaultCameraPose (x, y, z, yaw, pitch) {
        const wrapped = ((((yaw + 180) % 360) + 360) % 360) - 180;
        this.defaultCameraState = Object.assign({}, this.defaultCameraState, {x, y, z, yaw: wrapped, pitch, roll: 0});
        if (!this.activeCamera) this.markDirty();
    }

    /**
     * @param {THREE.PerspectiveCamera} camera
     * @returns {THREE.PerspectiveCamera} the same camera, placed like the game camera
     */
    _placeGameCamera (camera) {
        const state = this.getCameraState();
        const degToRad = THREE.MathUtils.degToRad;
        camera.position.set(state.x, state.y, state.z);
        camera.rotation.set(degToRad(state.pitch), degToRad(state.yaw), degToRad(state.roll));
        const aspect = this.runtime.stageWidth / this.runtime.stageHeight;
        if (camera.fov !== state.fov || (!this.three && camera.aspect !== aspect)) {
            camera.fov = state.fov;
            if (!this.three) camera.aspect = aspect;
            camera.updateProjectionMatrix();
        }
        camera.updateMatrixWorld();
        return camera;
    }

    /**
     * @returns {THREE.PerspectiveCamera} the game camera, where the current camera is. Code that changes it
     * directly (three.js style) saves the change with commitGameCamera().
     */
    getGameCamera () {
        if (this.camera) return this._placeGameCamera(this.camera);
        if (!this._detachedCamera) this._detachedCamera = this._makeCamera();
        return this._placeGameCamera(this._detachedCamera);
    }

    /**
     * Save changes made directly to the camera from getGameCamera() in the current camera.
     * @param {THREE.PerspectiveCamera} camera
     */
    commitGameCamera (camera) {
        const radToDeg = THREE.MathUtils.radToDeg;
        const round = n => Math.round(n * 1e6) / 1e6;
        const rotation = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
        this.setCameraState({
            x: round(camera.position.x),
            y: round(camera.position.y),
            z: round(camera.position.z),
            pitch: round(radToDeg(rotation.x)),
            yaw: round(radToDeg(rotation.y)),
            roll: round(radToDeg(rotation.z)),
            fov: camera.fov
        });
    }

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
            // Touch screens have no pointer lock: dragging a finger on the stage turns the camera instead
            canvas.addEventListener('pointerdown', this._onLookTouch);
            document.addEventListener('pointermove', this._onLookTouch);
            document.addEventListener('pointerup', this._onLookTouch);
            document.addEventListener('pointercancel', this._onLookTouch);
        }
        if (!enabled) this._lookTouch = null;
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
        if (!this._lockEnabled || document.pointerLockElement !== this._lockCanvas || this.runtime.paused) return;
        // Degrees per pixel
        const speed = 0.002 * this._lockSensitivity * 180 / Math.PI;
        this.look(-e.movementX * speed, -e.movementY * speed);
    }

    /**
     * Mouse look on touch screens (ROADMAP.md 7.3): the first finger put on the stage turns the camera while it
     * moves. The joysticks of the joystick extension are over the stage, so their fingers never get here.
     * @param {PointerEvent} e
     */
    _onLookTouch (e) {
        if (e.pointerType !== 'touch') return;
        if (e.type === 'pointerdown') {
            if (this._lockEnabled && !this._lookTouch) {
                this._lookTouch = {id: e.pointerId, x: e.clientX, y: e.clientY};
            }
            return;
        }
        const touch = this._lookTouch;
        if (!touch || touch.id !== e.pointerId) return;
        if (e.type !== 'pointermove') {
            this._lookTouch = null;
            return;
        }
        const dx = e.clientX - touch.x;
        const dy = e.clientY - touch.y;
        touch.x = e.clientX;
        touch.y = e.clientY;
        if (!this._lockEnabled || this.runtime.paused) return;
        // Degrees per CSS pixel: a swipe across a phone turns about half way around
        const speed = 0.25 * this._lockSensitivity;
        this.look(-dx * speed, -dy * speed);
    }

    /**
     * Turn the current camera like mouse look does: a following camera turns around its sprite or turns the sprite
     * (see CameraFollow.mouseLook), any other camera turns in place.
     * @param {number} yaw degrees to turn left
     * @param {number} pitch degrees to look up
     */
    look (yaw, pitch) {
        if (this.follow.mouseLook(this.activeCamera, yaw, pitch)) return;
        const maxPitch = MAX_PITCH * 180 / Math.PI;
        const state = this.getCameraState();
        this.setCameraState({
            yaw: state.yaw + yaw,
            pitch: Math.max(-maxPitch, Math.min(maxPitch, state.pitch + pitch)),
            roll: 0
        });
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
                this.loadTexture(spec.texture).then(texture => {
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
        loadThree();
        const cacheKey = this._modelKey(file);
        let promise = this._modelCache.get(cacheKey);
        if (!promise) {
            promise = this._parseModel(file);
            this._modelCache.set(cacheKey, promise);
            promise.then(scene => {
                this._loadedModels.set(cacheKey, scene);
            }, error => {
                console.warn(`3D: could not load model ${file.name}`, error);
                this._modelCache.delete(cacheKey);
                this._loadedModels.set(cacheKey, false);
            });
        }
        return promise;
    }

    /**
     * @param {{name: string, md5: string}} file
     * @returns {string} key of the model in the caches. .gltf files can reference other files, so they are cached
     * by name too.
     */
    _modelKey (file) {
        return `${file.md5}/${file.name.toLowerCase()}`;
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
            loader.parse(buffer, '', gltf => {
                this._fixModel(gltf);
                this._modelAnimations.set(gltf.scene, gltf.animations || []);
                resolve(gltf.scene);
            }, reject);
        }).finally(() => {
            for (const url of blobURLs) URL.revokeObjectURL(url);
        });
    }

    /**
     * Make a freshly loaded model look like it does in Blender.
     * - Meshes without a material get glTF's default material, which is fully metallic: it only reflects the sky and
     *   looks washed out and see-through. Blender shows them as plastic, so they are made non-metallic.
     * - three.js decides which side of a skinned mesh is the front from the mesh's own transform, but the bones move
     *   its vertices. A rig with a negative scale (common after mirroring in Blender) mirrors both, which cancel out,
     *   and the mesh is drawn inside out with its lighting upside down. Such meshes get their triangles turned around.
     * Done once per file, on the cached model that every copy shares.
     * @param {object} gltf result of GLTFLoader
     */
    _fixModel (gltf) {
        const parser = gltf.parser;
        gltf.scene.updateMatrixWorld(true);
        const flipped = new Set();
        gltf.scene.traverse(child => {
            if (!child.isMesh) return;
            for (const material of asArray(child.material)) {
                // Materials from the file are associated with their index in it; the default one isn't (copies of it
                // for skinned meshes are associated with undefined)
                const association = parser && parser.associations && parser.associations.get(material);
                const fromFile = !!association && typeof association.materials === 'number';
                if (!fromFile && material.isMeshStandardMaterial) {
                    material.metalness = 0;
                    material.roughness = 0.5;
                }
            }
            if (!child.isSkinnedMesh || !child.skeleton || child.skeleton.bones.length === 0) return;
            const bone = child.skeleton.bones[0];
            const skinning = new THREE.Matrix4()
                .copy(child.bindMatrixInverse)
                .multiply(bone.matrixWorld)
                .multiply(child.skeleton.boneInverses[0])
                .multiply(child.bindMatrix);
            // three.js only counts the mesh's own mirroring, so the bones' mirroring is the part it gets wrong
            if (skinning.determinant() < 0 && !flipped.has(child.geometry)) {
                flipped.add(child.geometry);
                this._flipWinding(child.geometry);
            }
        });
    }

    /**
     * Turn every triangle of a geometry around, so that its other side is the front.
     * @param {THREE.BufferGeometry} geometry
     */
    _flipWinding (geometry) {
        const index = geometry.index;
        if (index) {
            const array = index.array;
            for (let i = 0; i + 2 < array.length; i += 3) {
                const second = array[i + 1];
                array[i + 1] = array[i + 2];
                array[i + 2] = second;
            }
            index.needsUpdate = true;
            return;
        }
        // Without an index, swap the second and third vertex of each triangle in every attribute
        for (const attribute of Object.values(geometry.attributes)) {
            const size = attribute.itemSize;
            const array = attribute.array;
            for (let vertex = 0; vertex + 2 < attribute.count; vertex += 3) {
                for (let k = 0; k < size; k++) {
                    const a = ((vertex + 1) * size) + k;
                    const b = ((vertex + 2) * size) + k;
                    const value = array[a];
                    array[a] = array[b];
                    array[b] = value;
                }
            }
            attribute.needsUpdate = true;
        }
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
        // The first camera sprite becomes the current camera
        if (target.isCamera && target.isOriginal && !this.activeCamera) {
            this.activeCamera = target;
            this.editor.cameraChanged();
        }
        // A camera alone doesn't need three.js in the player (which only has it for projects that do), since there
        // is nothing to see through it. The editor shows it.
        if (target.isCamera && !this.editor.enabled ? this.three : this.ensure()) {
            this._createTargetObject(target);
        }
    }

    /**
     * @param {Target3D} target a 3D sprite or clone being deleted
     */
    removeTarget (target) {
        this.targets.delete(target);
        this._dirtyTransforms.delete(target);
        this.editor.forget(target);
        this.follow.forget(target);
        if (target === this.activeCamera) {
            // The next camera sprite takes over. Without one, the default camera stays where the last camera was,
            // so that the stage keeps showing the same thing.
            const last = this.getCameraState();
            this.activeCamera = null;
            const next = this.getCameras()[0] || null;
            if (next) {
                this.setActiveCamera(next);
            } else {
                this.defaultCameraState = last;
                this.editor.cameraChanged();
            }
            this.markDirty();
        }
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
        this.updateTargetParent(target);
        // Sprites attached to this one that were made first
        for (const child of this.targets) {
            if (child.parent3D === target && child.object3D) this.updateTargetParent(child);
        }
        this.updateTargetTransform(target);
        this.updateTargetModel(target);
    }

    /**
     * Put the target's object in the object of the sprite it is attached to, or in the scene.
     * @param {Target3D} target
     */
    updateTargetParent (target) {
        const group = target.object3D;
        if (!group || !this.scene) return;
        const parent = target.parent3D && target.parent3D.object3D;
        (parent || this.scene).add(group);
        this.markDirty();
    }

    /**
     * The target's position, rotation, scale or visibility changed. Its object is updated by flushTransforms().
     * @param {Target3D} target
     */
    markTransformDirty (target) {
        if (target.object3D) this._dirtyTransforms.add(target);
        this.markDirty();
    }

    /**
     * Update the objects of every target that changed since the last time. Anything that reads the objects' matrices
     * (drawing, picking, bounding boxes) calls this first.
     */
    flushTransforms () {
        if (this._dirtyTransforms.size === 0) return;
        for (const target of this._dirtyTransforms) this.updateTargetTransform(target);
        this._dirtyTransforms.clear();
    }

    /**
     * Copy position, rotation, scale and visibility from the target to its object right away.
     * @param {Target3D} target
     */
    updateTargetTransform (target) {
        this._dirtyTransforms.delete(target);
        const group = target.object3D;
        if (!group) return;
        const degToRad = THREE.MathUtils.degToRad;
        group.position.set(target.x, target.y, target.z);
        group.rotation.set(degToRad(target.rotationX), degToRad(target.rotationY), degToRad(target.rotationZ));
        group.scale.set(target.scaleX, target.scaleY, target.scaleZ);
        group.visible = target.visible;
        this.markDirty();
    }

    /**
     * @param {Target3D} target
     * @returns {?THREE.Box3} world-space box around the target's model, or null if it is hidden or has nothing to show
     */
    getTargetBox (target) {
        const group = target.object3D;
        // Cameras take no space
        if (!group || !target.visible || target.isCamera) return null;
        this.flushTransforms();
        group.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(group);
        return box.isEmpty() ? null : box;
    }

    /**
     * @param {Target3D} target
     * @returns {{center: {x: number, y: number, z: number}, size: {x: number, y: number, z: number}}} box around the
     * sprite's model, relative to the sprite and before its scale. Models that aren't loaded (or can't be, without
     * three.js) are a unit cube.
     */
    getModelBounds (target) {
        const model = target.getCurrentModel && target.getCurrentModel();
        const group = target.object3D;
        const object = group && group.userData.twModelObject;
        if (model && model.file && object && object.userData.twModel) {
            if (!object.userData.twBounds) {
                // The model's box in the sprite's own space
                group.updateMatrixWorld(true);
                const toGroup = new THREE.Matrix4().copy(group.matrixWorld)
                    .invert();
                const box = new THREE.Box3();
                object.traverse(child => {
                    if (!child.isMesh) return;
                    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
                    const childBox = child.geometry.boundingBox.clone()
                        .applyMatrix4(new THREE.Matrix4().multiplyMatrices(toGroup, child.matrixWorld));
                    box.union(childBox);
                });
                const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
                const size = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3());
                object.userData.twBounds = {
                    center: {x: center.x, y: center.y, z: center.z},
                    size: {x: size.x, y: size.y, z: size.z}
                };
            }
            return object.userData.twBounds;
        }
        const [x, y, z] = SHAPE_SIZES[model && model.shape] || SHAPE_SIZES.cube;
        return {center: {x: 0, y: 0, z: 0}, size: {x, y, z}};
    }

    // GLTF animations (ROADMAP.md 6.4). Each sprite keeps what it plays and how far it is (target.animation), so that
    // blocks work the same whether or not three.js draws the scene; the model's AnimationMixer only shows it.

    /**
     * @param {Target3D} target
     * @returns {?THREE.AnimationClip[]} the animations of the sprite's model; null while the model is loading
     */
    getAnimationClips (target) {
        const model = target.getCurrentModel && target.getCurrentModel();
        if (!model || !model.file) return [];
        const file = this.runtime.fileManager.getFile(model.file);
        if (!file || !MODEL_EXTENSION.test(file.name)) return [];
        const key = this._modelKey(file);
        if (!this._loadedModels.has(key)) {
            this.getModel(model.file);
            return null;
        }
        const scene = this._loadedModels.get(key);
        return scene ? (this._modelAnimations.get(scene) || []) : [];
    }

    /**
     * @param {THREE.Object3D} model resolved from getModel
     * @returns {THREE.AnimationClip[]} the animations in the model's file
     */
    getModelAnimations (model) {
        return (model && this._modelAnimations.get(model)) || [];
    }

    /**
     * @param {Target3D} target
     * @param {*} name the animation's name, or its number starting at 1
     * @returns {?THREE.AnimationClip} the animation, if the model has it and is loaded
     */
    _findClip (target, name) {
        const clips = this.getAnimationClips(target) || [];
        const text = `${name}`;
        const byName = clips.find(clip => clip.name === text);
        if (byName) return byName;
        const index = Number(text);
        return Number.isInteger(index) && index >= 1 ? clips[index - 1] || null : null;
    }

    /**
     * Start playing one of the model's animations from the beginning.
     * @param {Target3D} target
     * @param {*} name see _findClip
     * @param {boolean} loop true to play it again and again, false to play it once and stay at the end
     */
    playAnimation (target, name, loop) {
        target.animation = {name: `${name}`, loop: !!loop, time: 0, playing: true};
        this._poseAnimation(target);
        this.markDirty();
    }

    /**
     * Stop the animation, back to the model's normal pose.
     * @param {Target3D} target
     */
    stopAnimation (target) {
        target.animation = null;
        const model = target.object3D && target.object3D.userData.twModelObject;
        const mixer = model && this._mixers.get(model);
        if (mixer) {
            mixer.stopAllAction();
            mixer.update(0);
        }
        this.markDirty();
    }

    /**
     * Move every playing animation on by one frame.
     * @param {number} delta seconds since the last frame
     */
    _updateAnimations (delta) {
        // Animations stay where they are while the project is paused
        if (this.runtime.paused) return;
        for (const target of this.targets) {
            const animation = target.animation;
            if (!animation || !animation.playing) continue;
            const clips = this.getAnimationClips(target);
            // Starts once the model is loaded
            if (clips === null) continue;
            const clip = this._findClip(target, animation.name);
            if (!clip) {
                animation.playing = false;
                continue;
            }
            animation.time += delta * target.animationSpeed;
            if (!animation.loop && (animation.time >= clip.duration || animation.time < 0)) {
                animation.time = Math.max(0, Math.min(clip.duration, animation.time));
                animation.playing = false;
            }
            this._poseAnimation(target);
            this.markDirty();
        }
    }

    /**
     * Show the model of the sprite where its animation is.
     * @param {Target3D} target
     */
    _poseAnimation (target) {
        const animation = target.animation;
        const model = target.object3D && target.object3D.userData.twModelObject;
        if (!animation || !model || !model.userData.twModel) return;
        const clip = this._findClip(target, animation.name);
        if (!clip) return;
        let mixer = this._mixers.get(model);
        if (!mixer) {
            mixer = new THREE.AnimationMixer(model);
            this._mixers.set(model, mixer);
        }
        const action = mixer.clipAction(clip);
        if (!action.isRunning()) {
            mixer.stopAllAction();
            // Blocks decide when it ends, see _updateAnimations
            action.setLoop(THREE.LoopRepeat, Infinity);
            action.play();
        }
        const duration = clip.duration;
        let time = animation.time;
        if (animation.loop) {
            time = duration > 0 ? ((time % duration) + duration) % duration : 0;
        } else {
            // Just before the end, which a repeating action would wrap around to the start
            time = Math.max(0, Math.min(duration - 1e-4, time));
        }
        action.time = time;
        mixer.update(0);
    }

    // 3D sound (ROADMAP.md 6.8), see spatial-audio-effect.js

    /**
     * Put the listener where the game camera is, and every playing sound of a 3D sprite where its sprite is.
     */
    _updateAudio () {
        const audioEngine = this.runtime.audioEngine;
        const context = audioEngine && audioEngine.audioContext;
        if (!context || !context.listener || this.targets.size === 0) return;
        let playing = false;
        for (const target of this.targets) {
            const soundBank = target.sprite && target.sprite.soundBank;
            if (!soundBank || !soundBank.playerTargets) continue;
            for (const [soundId, playerTarget] of soundBank.playerTargets) {
                if (playerTarget !== target) continue;
                // scratch-audio keeps players in an object and effect chains in a Map
                const player = soundBank.soundPlayers && soundBank.soundPlayers[soundId];
                const chain = soundBank.soundEffects && soundBank.soundEffects.get(soundId);
                if (!player || !player.isPlaying || !chain || !chain.spatial3d) continue;
                chain.spatial3d.set(target.spatial3d);
                playing = true;
            }
        }
        if (playing) this._placeListener(context.listener);
    }

    /**
     * @param {AudioListener} listener
     */
    _placeListener (listener) {
        const camera = this.getGameCamera();
        const forward = camera.getWorldDirection(new THREE.Vector3());
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        const position = camera.position;
        if (listener.positionX) {
            setAudioParam(listener, 'positionX', position.x);
            setAudioParam(listener, 'positionY', position.y);
            setAudioParam(listener, 'positionZ', position.z);
            setAudioParam(listener, 'forwardX', forward.x);
            setAudioParam(listener, 'forwardY', forward.y);
            setAudioParam(listener, 'forwardZ', forward.z);
            setAudioParam(listener, 'upX', up.x);
            setAudioParam(listener, 'upY', up.y);
            setAudioParam(listener, 'upZ', up.z);
        } else if (listener.setPosition) {
            listener.setPosition(position.x, position.y, position.z);
            listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
        }
    }

    // Between the 3D scene and the 2D stage

    /**
     * @returns {THREE.PerspectiveCamera} the camera the stage shows: the editor's while editing, otherwise the game
     * camera. Before three.js has a renderer (e.g. in tests), a camera where the saved game camera is.
     */
    getViewCamera () {
        if (this.camera && this.editor.active) {
            this.editor.camera.updateMatrixWorld();
            return this.editor.camera;
        }
        return this.getGameCamera();
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {{x: number, y: number, onScreen: boolean}} where the point is on the 2D stage, in Scratch
     * coordinates, and whether it is in front of the camera and inside the stage
     */
    projectPoint (x, y, z) {
        loadThree();
        const camera = this.getViewCamera();
        const point = new THREE.Vector3(x, y, z);
        const inFront = point.clone().applyMatrix4(camera.matrixWorldInverse).z < 0;
        point.project(camera);
        return {
            x: point.x * this.runtime.stageWidth / 2,
            y: point.y * this.runtime.stageHeight / 2,
            onScreen: inFront && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1
        };
    }

    /**
     * @param {Target3D} target
     * @returns {{x: number, y: number, onScreen: boolean}} where the sprite's origin is on the 2D stage
     */
    projectTarget (target) {
        const position = target.getWorldPosition();
        return this.projectPoint(position.x, position.y, position.z);
    }

    /**
     * @param {Target3D} target
     * @returns {{left: number, right: number, top: number, bottom: number}} rectangle around the sprite on the 2D
     * stage, in Scratch coordinates, like RenderedTarget.getBounds()
     */
    getStageBounds (target) {
        const box = this.getTargetBox(target);
        const corners = [];
        if (box) {
            for (const x of [box.min.x, box.max.x]) {
                for (const y of [box.min.y, box.max.y]) {
                    for (const z of [box.min.z, box.max.z]) corners.push(this.projectPoint(x, y, z));
                }
            }
        } else {
            corners.push(this.projectTarget(target));
        }
        return {
            left: Math.min(...corners.map(p => p.x)),
            right: Math.max(...corners.map(p => p.x)),
            bottom: Math.min(...corners.map(p => p.y)),
            top: Math.max(...corners.map(p => p.y))
        };
    }

    /**
     * @param {number} stageX Scratch x on the stage
     * @param {number} stageY Scratch y on the stage
     * @returns {?{x: number, y: number, z: number}} where the ray from the camera through that point of the stage
     * hits the ground (y = 0), or null if it doesn't
     */
    stageToGround (stageX, stageY) {
        loadThree();
        const raycaster = new THREE.Raycaster();
        const ndc = new THREE.Vector2(stageX / (this.runtime.stageWidth / 2), stageY / (this.runtime.stageHeight / 2));
        raycaster.setFromCamera(ndc, this.getViewCamera());
        const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const hit = raycaster.ray.intersectPlane(ground, new THREE.Vector3());
        return hit ? {x: hit.x, y: hit.y, z: hit.z} : null;
    }

    /**
     * @param {number} stageX Scratch x on the stage
     * @param {number} stageY Scratch y on the stage
     * @returns {THREE.Raycaster} ray from the camera the stage shows through that point
     */
    _stageRaycaster (stageX, stageY) {
        loadThree();
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(
            stageX / (this.runtime.stageWidth / 2),
            stageY / (this.runtime.stageHeight / 2)
        ), this.getViewCamera());
        return raycaster;
    }

    /**
     * @returns {{origin: {x: number, y: number, z: number}, direction: {x: number, y: number, z: number}}} the ray
     * from the camera through the mouse
     */
    getMouseRay () {
        const mouse = this.runtime.ioDevices.mouse;
        const ray = this._stageRaycaster(mouse.getScratchX(), mouse.getScratchY()).ray;
        return {
            origin: {x: ray.origin.x, y: ray.origin.y, z: ray.origin.z},
            direction: {x: ray.direction.x, y: ray.direction.y, z: ray.direction.z}
        };
    }

    /**
     * @param {Target3D} target
     * @returns {boolean} true if the sprite and every sprite it is attached to are visible
     */
    isShownInScene (target) {
        return this._isShown(target);
    }

    _isShown (target) {
        for (let current = target; current; current = current.parent3D) {
            if (!current.visible) return false;
        }
        return true;
    }

    /**
     * Find the 3D sprite at a point of the stage, for clicks and the mouse (ROADMAP.md 6.2): the first one that the
     * ray from the camera through that point hits. Uses the models when three.js draws the scene, and the colliders
     * otherwise (see Physics3D).
     * @param {number} stageX Scratch x on the stage
     * @param {number} stageY Scratch y on the stage
     * @returns {?Target3D} the sprite or clone, or null if there is none there
     */
    pickTarget (stageX, stageY) {
        if (this.targets.size === 0) return null;
        const raycaster = this._stageRaycaster(stageX, stageY);
        if (this.three) {
            this.flushTransforms();
            const objects = [];
            for (const target of this.targets) {
                if (target.object3D && !target.isCamera && this._isShown(target)) objects.push(target.object3D);
            }
            for (const hit of raycaster.intersectObjects(objects, true)) {
                let object = hit.object;
                while (object && !object.userData.twTarget) object = object.parent;
                const target = object && object.userData.twTarget;
                if (target && !target.isCamera && this._isShown(target)) return target;
            }
            return null;
        }
        if (!this.physics.ready) return null;
        const ray = raycaster.ray;
        const hit = this.physics.raycast(ray.origin, ray.direction, 1e5, null);
        return hit ? hit.target : null;
    }

    /**
     * @param {Target3D} target
     * @returns {boolean} true if the mouse points at the sprite's model, even if something else is in front of it
     */
    isMouseOver (target) {
        if (!this._isShown(target) || target.isCamera) return false;
        const mouse = this.runtime.ioDevices.mouse;
        const raycaster = this._stageRaycaster(mouse.getScratchX(), mouse.getScratchY());
        const object = target.object3D;
        if (object) {
            this.flushTransforms();
            return raycaster.intersectObject(object, true).length > 0;
        }
        if (!this.physics.ready) return false;
        const shape = this.physics.getShape(target);
        const ray = new this.physics.RAPIER.Ray(raycaster.ray.origin, raycaster.ray.direction);
        return !!shape && shape.shape.castRay(ray, shape.position, shape.rotation, 1e5, true) !== null;
    }

    /**
     * @returns {?{x: number, y: number, z: number}} where the mouse points on the ground
     */
    mouseToGround () {
        const mouse = this.runtime.ioDevices.mouse;
        return this.stageToGround(mouse.getScratchX(), mouse.getScratchY());
    }

    /**
     * @returns {{x: number, y: number, z: number}} a random point on the ground that the camera sees, like the 2D
     * random position is a random point on the stage
     */
    randomGroundPoint () {
        for (let i = 0; i < 20; i++) {
            const point = this.stageToGround(
                (Math.random() - 0.5) * this.runtime.stageWidth,
                (Math.random() - 0.5) * this.runtime.stageHeight
            );
            // Not too far away near the horizon
            if (point && Math.hypot(point.x, point.z) <= 100) return point;
        }
        return {x: (Math.random() - 0.5) * 20, y: 0, z: (Math.random() - 0.5) * 20};
    }

    _disposeTargetModel (target) {
        const group = target.object3D;
        const model = group && group.userData.twModelObject;
        if (!model) return;
        group.remove(model);
        group.userData.twModelObject = null;
        if (model.userData.twCameraFrustum) {
            model.geometry.dispose();
        } else if (model.userData.twModel) {
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
        if (target.isCamera) {
            this._addCameraFrustum(target);
            return;
        }
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
                this.applyModelMaterial(copy, material);
                copy.traverse(child => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });
                // glTF models face +z, and sprites face -z (see "Directions" in ROADMAP.md)
                copy.rotation.y += Math.PI;
                group.add(copy);
                group.userData.twModelObject = copy;
                // A new copy (another model, a clone) continues the animation where it is
                if (target.animation) this._poseAnimation(target);
                this.markDirty();
            }, () => {});
            return;
        }
        const shape = SHAPES.includes(model.shape) ? model.shape : 'cube';
        const mesh = new THREE.Mesh(this.getGeometry(shape), this.acquireMaterial(material, shape === 'plane'));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        group.userData.twModelObject = mesh;
        this.markDirty();
    }

    /**
     * Draw what a camera sprite sees as a pyramid of lines with a triangle on top, like Blender. Only the editor
     * camera sees it (and can pick it).
     * @param {CameraTarget} target
     */
    _addCameraFrustum (target) {
        const group = target.object3D;
        const aspect = this.runtime.stageWidth / this.runtime.stageHeight;
        const d = FRUSTUM_LENGTH;
        const h = Math.tan(THREE.MathUtils.degToRad(target.fov / 2)) * d;
        const w = h * aspect;
        const corners = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => [x, y, -d]);
        const points = [];
        const line = (a, b) => points.push(...a, ...b);
        for (let i = 0; i < 4; i++) {
            line([0, 0, 0], corners[i]);
            line(corners[i], corners[(i + 1) % 4]);
        }
        // Which way is up
        const top = [0, h * 1.6, -d];
        line([-w * 0.6, h * 1.1, -d], [w * 0.6, h * 1.1, -d]);
        line([-w * 0.6, h * 1.1, -d], top);
        line([w * 0.6, h * 1.1, -d], top);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
        const lines = new THREE.LineSegments(geometry, this._getFrustumMaterial(target === this.activeCamera));
        lines.layers.set(EDITOR_LAYER);
        lines.userData.twCameraFrustum = true;
        group.add(lines);
        group.userData.twModelObject = lines;
        this.markDirty();
    }

    /**
     * @param {boolean} active true for the current camera
     * @returns {THREE.LineBasicMaterial} shared material of camera frustums
     */
    _getFrustumMaterial (active) {
        const key = active ? '_activeFrustumMaterial' : '_frustumMaterial';
        if (!this[key]) this[key] = new THREE.LineBasicMaterial({color: active ? 0xff9f1a : 0x333333, fog: false});
        return this[key];
    }

    /**
     * Models keep their own materials unless the sprite's material changes them.
     * @param {THREE.Object3D} model copy of a model
     * @param {object} spec material settings
     */
    applyModelMaterial (model, spec) {
        const tinted = spec.color !== DEFAULT_COLOR;
        if (!tinted && spec.opacity >= 1 && !spec.texture) return;
        const texturePromise = spec.texture ? this.loadTexture(spec.texture) : null;
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

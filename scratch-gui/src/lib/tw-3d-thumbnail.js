// Thumbnails of 3D models, rendered offscreen with one small three.js renderer.
// three.js comes from the VM's Scene3D so that there is only one copy of it.

const SIZE = 160;
// Looking from the front-right, a little from above
const VIEW_DIRECTION = [1, 0.75, 1.4];
const FOV = 35;

let renderer = null;
let scene = null;
let camera = null;
/** @type {Map<string, Promise<?string>>} data URLs by model, material and file contents */
const cache = new Map();

const setup = THREE => {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({
        canvas: document.createElement('canvas'),
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true
    });
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(3, 5, 4);
    scene.add(sun);
    camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 1000);
};

/**
 * @param {Scene3D} scene3D the VM's scene, for shared geometry, models and textures
 * @param {object} model {shape} or {file}
 * @param {object} material {color, opacity, texture}
 * @returns {Promise<?{object: THREE.Object3D, dispose: function, source: ?THREE.Object3D}>} object to render and
 * dispose(), and for files the shared model it was copied from
 */
const buildObject = async (scene3D, model, material) => {
    const THREE = scene3D.THREE;
    if (model.file) {
        const promise = scene3D.getModel(model.file);
        if (!promise) return null;
        const loaded = await promise;
        // Cached now, so the texture is applied before the thumbnail is rendered
        if (material.texture) await scene3D.loadTexture(material.texture);
        const copy = scene3D.cloneModel(loaded);
        scene3D.applyModelMaterial(copy, material);
        return {
            object: copy,
            source: loaded,
            dispose: () => scene3D.disposeTree(copy, false)
        };
    }
    const texture = material.texture ? await scene3D.loadTexture(material.texture) : null;
    const meshMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setStyle(material.color, THREE.SRGBColorSpace),
        opacity: material.opacity,
        transparent: material.opacity < 1,
        side: model.shape === 'plane' ? THREE.DoubleSide : THREE.FrontSide,
        map: texture
    });
    return {
        // Geometry is shared with the scene, so only the material is disposed
        object: new THREE.Mesh(scene3D.getGeometry(model.shape), meshMaterial),
        dispose: () => meshMaterial.dispose()
    };
};

/**
 * Point the camera at the object so that it fills the thumbnail.
 * @param {object} THREE three.js
 * @param {THREE.Object3D} object object to frame
 */
const frame = (THREE, object) => {
    const box = new THREE.Box3().setFromObject(object);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = sphere.radius > 0 && Number.isFinite(sphere.radius) ? sphere.radius : 1;
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(FOV / 2));
    const direction = new THREE.Vector3(...VIEW_DIRECTION).normalize();
    camera.position.copy(sphere.center).addScaledVector(direction, distance);
    camera.near = distance / 100;
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    camera.lookAt(sphere.center);
};

/**
 * @param {Scene3D} scene3D the VM's scene
 * @param {object} model {shape} or {file}
 * @param {object} material complete material
 * @returns {Promise<?string>} PNG data URL
 */
const render = async (scene3D, model, material) => {
    const THREE = scene3D.THREE;
    setup(THREE);
    const built = await buildObject(scene3D, model, material);
    if (!built) return null;
    scene.add(built.object);
    try {
        frame(THREE, built.object);
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL('image/png');
    } finally {
        scene.remove(built.object);
        built.dispose();
    }
};

/**
 * @param {VM} vm the VM
 * @param {object} model {name, shape} or {name, file}
 * @param {object} [material] {color, opacity, texture}
 * @returns {Promise<?string>} PNG data URL, or null if the model can't be shown (e.g. a missing file)
 */
const get3DThumbnail = (vm, model, material) => {
    if (!model || typeof document === 'undefined') return Promise.resolve(null);
    const scene3D = vm.runtime.scene3D;
    const fileManager = vm.runtime.fileManager;
    material = Object.assign({color: '#ffffff', opacity: 1, texture: ''}, material);
    const fileKey = name => {
        const file = name && fileManager.getFile(name);
        return file ? file.md5 : '';
    };
    const key = [
        model.file ? `file:${fileKey(model.file)}` : `shape:${model.shape}`,
        material.color,
        material.opacity,
        material.texture ? fileKey(material.texture) : ''
    ].join('|');
    if (model.file && !fileKey(model.file)) return Promise.resolve(null);
    let promise = cache.get(key);
    if (!promise) {
        promise = render(scene3D, model, material).catch(error => {
            // eslint-disable-next-line no-console
            console.warn('3D: could not render thumbnail', error);
            return null;
        });
        cache.set(key, promise);
    }
    return promise;
};

export {
    get3DThumbnail as default,
    buildObject as build3DObject
};

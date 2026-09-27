const {test} = require('tap');
const THREE = require('three');
const Instancing = require('../../src/engine/scene-3d-instancing');

// Automatic instancing (ROADMAP.md 7.1)

const geometry = new THREE.BoxGeometry(1, 1, 1);

const makeScene = () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld();
    const scene3D = {
        THREE,
        scene,
        targets: new Set(),
        objects: new Map(),
        shadows: false,
        castsShadows () {
            return this.shadows;
        },
        isShownInScene: target => target.visible
    };
    const add = (material, x, options = {}) => {
        const group = new THREE.Group();
        const mesh = new THREE.Mesh(options.geometry || geometry, material);
        group.add(mesh);
        group.position.set(x, 0, 0);
        group.userData.twModelObject = mesh;
        scene.add(group);
        const target = {object3D: group, visible: options.visible !== false};
        scene3D.targets.add(target);
        return mesh;
    };
    return {scene3D, camera, add, instancing: new Instancing(scene3D)};
};

const instancedMeshes = scene3D => scene3D.scene.children.filter(child => child.isInstancedMesh);

test('copies of the same geometry and material become one instanced mesh', t => {
    const {scene3D, camera, add, instancing} = makeScene();
    const material = new THREE.MeshStandardMaterial();
    const meshes = [];
    for (let i = 0; i < 6; i++) meshes.push(add(material, i - 3));
    instancing.begin(camera);
    t.ok(meshes.every(mesh => !mesh.visible), 'originals hidden while rendering');
    const [instanced] = instancedMeshes(scene3D);
    t.ok(instanced, 'instanced mesh added');
    t.equal(instanced.count, 6);
    t.equal(instanced.geometry, geometry, 'shares the geometry');
    t.equal(instanced.material, material, 'shares the material');
    const matrix = new THREE.Matrix4();
    instanced.getMatrixAt(0, matrix);
    t.equal(new THREE.Vector3().setFromMatrixPosition(matrix).x, -3, 'world matrix of the first copy');
    t.same(instancing.stats, {batches: 1, instances: 6, culled: 0});
    instancing.end();
    t.ok(meshes.every(mesh => mesh.visible), 'originals shown again');
    t.end();
});

test('what is not instanced', t => {
    const {scene3D, camera, add, instancing} = makeScene();
    const few = new THREE.MeshStandardMaterial();
    for (let i = 0; i < 3; i++) add(few, i);
    const transparent = new THREE.MeshStandardMaterial({transparent: true, opacity: 0.5});
    for (let i = 0; i < 5; i++) add(transparent, i);
    const hidden = new THREE.MeshStandardMaterial();
    for (let i = 0; i < 5; i++) add(hidden, i, {visible: false});
    instancing.begin(camera);
    t.equal(instancedMeshes(scene3D).length, 0, 'too few, transparent and hidden sprites are drawn as they are');
    instancing.end();
    t.end();
});

test('different materials are different batches', t => {
    const {scene3D, camera, add, instancing} = makeScene();
    const red = new THREE.MeshStandardMaterial({color: 'red'});
    const blue = new THREE.MeshStandardMaterial({color: 'blue'});
    for (let i = 0; i < 4; i++) {
        add(red, i);
        add(blue, -i);
    }
    instancing.begin(camera);
    t.equal(instancedMeshes(scene3D).length, 2);
    t.equal(instancing.stats.instances, 8);
    instancing.end();
    t.end();
});

test('instances outside the view are culled, unless the sun casts shadows', t => {
    const {scene3D, camera, add, instancing} = makeScene();
    const material = new THREE.MeshStandardMaterial();
    for (let i = 0; i < 4; i++) add(material, i);
    // Far to the side of the camera
    for (let i = 0; i < 3; i++) add(material, 500 + i);
    instancing.begin(camera);
    t.equal(instancedMeshes(scene3D)[0].count, 4);
    t.equal(instancing.stats.culled, 3);
    instancing.end();

    scene3D.shadows = true;
    instancing.begin(camera);
    t.equal(instancedMeshes(scene3D)[0].count, 7, 'they can cast shadows into the view');
    t.equal(instancing.stats.culled, 0);
    instancing.end();
    t.end();
});

test('instanced meshes grow, and unused ones are thrown away', t => {
    const {scene3D, camera, add, instancing} = makeScene();
    const material = new THREE.MeshStandardMaterial();
    for (let i = 0; i < 4; i++) add(material, i);
    instancing.begin(camera);
    instancing.end();
    const first = instancedMeshes(scene3D)[0];
    for (let i = 0; i < 20; i++) add(material, i * 0.1);
    instancing.begin(camera);
    instancing.end();
    const grown = instancedMeshes(scene3D);
    t.equal(grown.length, 1, 'replaced, not added');
    t.not(grown[0], first);
    t.equal(grown[0].count, 24);

    scene3D.targets.clear();
    instancing.begin(camera);
    instancing.end();
    t.notOk(grown[0].visible, 'hidden when not needed');
    for (let i = 0; i < 200; i++) {
        instancing.begin(camera);
        instancing.end();
    }
    t.equal(instancedMeshes(scene3D).length, 0, 'removed after a while');
    t.end();
});

test('procedural objects are instanced too, and disabled instancing does nothing', t => {
    const {scene3D, camera, instancing} = makeScene();
    const material = new THREE.MeshStandardMaterial();
    for (let i = 0; i < 5; i++) {
        const mesh = new THREE.Mesh(geometry, material);
        scene3D.scene.add(mesh);
        scene3D.objects.set(`box${i}`, mesh);
    }
    instancing.begin(camera);
    t.equal(instancing.stats.instances, 5);
    instancing.end();
    instancing.enabled = false;
    instancing.begin(camera);
    t.equal(instancing.stats.instances, 0);
    instancing.end();
    t.end();
});

const {test} = require('tap');
require('../fixtures/tw_mock_blob'); // must load Blob before VM so JSZip thinks Blob is supported
const fs = require('fs');
const pathUtil = require('path');
const JSZip = require('@turbowarp/jszip');
const VirtualMachine = require('../../src/virtual-machine');
const makeTestStorage = require('../fixtures/make-test-storage');
const tw3dsb = require('../../src/serialization/3dsb');
const placeholder = require('../../src/sprites/tw-3d-placeholder');
const Environment = require('../../src/engine/scene-3d-environment');

const sb3Fixture = fs.readFileSync(pathUtil.join(__dirname, '..', 'fixtures', 'tw-save-project-sb3.sb3'));

const makeVM = () => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());
    vm.addCameraOnImport = true;
    return vm;
};

const readProjectJSON = async buffer => {
    const zip = await JSZip.loadAsync(buffer);
    return {
        zip,
        json: JSON.parse(await zip.file('project.json').async('string'))
    };
};

const add3DSprite = async vm => {
    await vm.addSprite3D({
        name: 'Box',
        position: {x: 1, y: 2, z: -3},
        rotation: {x: 10, y: 200, z: -30},
        scale: {x: 2, y: 1, z: 0.5},
        models: [{name: 'cube', shape: 'cube'}, {name: 'ball', shape: 'sphere'}, {name: 'car', file: 'car.glb'}],
        currentModel: 1,
        material: {color: '#FF0000', opacity: 0.5}
    });
    return vm.runtime.targets.find(target => target.getName() === 'Box');
};

test('.sb3 projects are imported with only 2D sprites and a camera, and saved as .3dsb', async t => {
    const vm = makeVM();
    await vm.loadProject(sb3Fixture);
    const sprites = vm.runtime.targets.filter(target => !target.isStage && !target.isCamera);
    t.ok(sprites.length > 0);
    t.ok(sprites.every(target => !target.is3D), 'no 3D sprites');
    const cameras = vm.runtime.targets.filter(target => target.isCamera);
    t.equal(cameras.length, 1, 'a camera sprite was added');
    t.equal(vm.runtime.scene3D.getActiveCamera(), cameras[0], 'and it is the current camera');
    t.notEqual(vm.editingTarget, cameras[0], 'but not selected');

    const buffer = await vm.saveProject3dsb('arraybuffer');
    const {json} = await readProjectJSON(buffer);
    t.equal(json.meta.format, '3dsb');
    t.equal(json.meta.formatVersion, tw3dsb.FORMAT_VERSION);
    t.ok(json.targets.every(target => target.kind === (target.name === '相機' ? 'camera' : '2d')),
        'every target is 2d, except the camera');
    const stage = json.targets.find(target => target.isStage);
    t.equal(stage.currentCamera, '相機', 'stage has the current camera');
    t.ok(stage.costumes.every(costume => !costume.environment), 'backdrops are 2D backdrops');

    // saveProjectSb3 is only an alias now
    t.equal((await readProjectJSON(await vm.saveProjectSb3('arraybuffer'))).json.meta.format, '3dsb');

    const vm2 = makeVM();
    await vm2.loadProject(buffer);
    t.same(
        vm2.runtime.targets.map(target => target.getName()),
        vm.runtime.targets.map(target => target.getName()),
        'loads again'
    );
    t.end();
});

test('3D sprites', async t => {
    const vm = makeVM();
    await vm.loadProject(sb3Fixture);
    const target = await add3DSprite(vm);
    t.ok(target.is3D);
    t.equal(target.kind, '3d');
    t.equal(target.sprite.kind, '3d');
    t.equal(vm.editingTarget, target, 'new sprite is selected');
    t.same([target.x, target.y, target.z], [1, 2, -3]);
    t.same([target.rotationX, target.rotationY, target.rotationZ], [10, -160, -30], 'angles are wrapped');
    t.same([target.scaleX, target.scaleY, target.scaleZ], [2, 1, 0.5]);
    t.equal(target.currentModel, 1);
    t.same(target.getCurrentModel(), {name: 'ball', shape: 'sphere'});
    t.same(target.material, {color: '#ff0000', opacity: 0.5, texture: ''});
    t.ok(vm.runtime.scene3D.targets.has(target), 'registered in the scene');
    t.equal(target.getCostumes().length, 1, 'has the placeholder costume');
    t.equal(target.getCostumes()[0].assetId, placeholder.MD5);

    target.postSpriteInfo({x: 5, z: 7, rotationY: 45, scaleZ: 3, visible: false});
    t.same([target.x, target.y, target.z], [5, 2, 7]);
    t.equal(target.rotationY, 45);
    t.equal(target.scaleZ, 3);
    t.equal(target.visible, false);
    target.setVisible(true);

    target.setModel(5);
    t.equal(target.currentModel, 2, 'model index wraps around');
    target.setModel(1);

    const json = target.toJSON();
    t.equal(json.kind, '3d');
    t.equal(json.z, 7);
    t.equal(json.models.length, 3);
    t.end();
});

test('3D clones copy their state and leave the scene when deleted', async t => {
    const vm = makeVM();
    await vm.loadProject(sb3Fixture);
    const target = await add3DSprite(vm);
    const clone = target.makeClone();
    vm.runtime.addTarget(clone);
    t.ok(clone.is3D);
    t.notOk(clone.isOriginal);
    t.same([clone.x, clone.y, clone.z], [target.x, target.y, target.z]);
    t.same(clone.material, target.material);
    t.not(clone.material, target.material, 'material settings are not shared objects');
    t.equal(clone.getModels(), target.getModels(), 'models are shared through the sprite');
    t.ok(vm.runtime.scene3D.targets.has(clone));
    vm.runtime.disposeTarget(clone);
    t.notOk(vm.runtime.scene3D.targets.has(clone));

    const duplicate = await target.duplicate();
    t.ok(duplicate.is3D);
    t.not(duplicate.sprite, target.sprite);
    t.same(duplicate.getModels(), target.getModels());
    t.not(duplicate.getModels(), target.getModels());
    t.equal(duplicate.x, target.x + 1);
    t.end();
});

test('3D sprites and the environment are saved and loaded', async t => {
    const vm = makeVM();
    await vm.loadProject(sb3Fixture);
    const target = await add3DSprite(vm);
    target.setXYZ(4, 5, 6);
    vm.runtime.scene3D.setEnvironment({
        sky: {type: 'color', color: '#112233'},
        fog: {enabled: true, near: 3, far: 30},
        sun: {intensity: 2}
    });

    const buffer = await vm.saveProject3dsb('arraybuffer');
    const {json, zip} = await readProjectJSON(buffer);
    const saved = json.targets.find(t2 => t2.name === 'Box');
    t.equal(saved.kind, '3d');
    t.same(saved.position, {x: 4, y: 5, z: 6});
    t.same(saved.rotation, {x: 10, y: -160, z: -30});
    t.same(saved.scale, {x: 2, y: 1, z: 0.5});
    t.equal(saved.visible, true);
    t.equal(saved.currentModel, 1);
    t.same(saved.material, {color: '#ff0000', opacity: 0.5, texture: ''});
    t.equal(saved.models.length, 3);
    t.notOk('costumes' in saved, 'no costumes');
    t.notOk('x' in saved || 'direction' in saved || 'size' in saved, 'no 2D properties');
    t.notOk(zip.file(`${placeholder.MD5}.svg`), 'placeholder costume is not saved');
    const stage = json.targets.find(t2 => t2.isStage);
    const environment = stage.costumes[stage.currentCostume].environment;
    t.equal(environment.sky.type, 'color');
    t.equal(environment.sky.color, '#112233');
    t.equal(environment.fog.enabled, true);
    t.equal(environment.fog.far, 30);

    const vm2 = makeVM();
    await vm2.loadProject(buffer);
    const loaded = vm2.runtime.targets.find(t2 => t2.getName() === 'Box');
    t.ok(loaded.is3D);
    t.same([loaded.x, loaded.y, loaded.z], [4, 5, 6]);
    t.same(loaded.getModels(), target.getModels());
    t.same(loaded.material, target.material);
    t.equal(loaded.getCostumes().length, 1, 'placeholder costume is back');
    t.same(vm2.runtime.scene3D.environment, vm.runtime.scene3D.environment);
    t.ok(vm2.runtime.scene3D.targets.has(loaded));

    // Loading another project clears the scene, except for its new camera
    await vm2.loadProject(sb3Fixture);
    t.same(Array.from(vm2.runtime.scene3D.targets).map(t2 => t2.kind), ['camera']);
    t.same(vm2.runtime.scene3D.environment, Environment.default2DEnvironment());
    t.end();
});

test('.3dsb project.json without a zip', async t => {
    const vm = makeVM();
    await vm.loadProject(sb3Fixture);
    await add3DSprite(vm);
    const projectJSON = vm.toJSON();
    t.equal(JSON.parse(projectJSON).meta.format, '3dsb');

    // Like restore points: project.json only, assets from storage
    const vm2 = makeVM();
    const storage = vm2.runtime.storage;
    for (const asset of vm.assets) {
        if (asset.assetId === placeholder.MD5) continue;
        storage.builtinHelper._store(asset.assetType, asset.dataFormat, asset.data, asset.assetId);
    }
    await vm2.loadProject(new TextEncoder().encode(projectJSON));
    const loaded = vm2.runtime.targets.find(t2 => t2.getName() === 'Box');
    t.ok(loaded.is3D);
    t.equal(loaded.getCostumes().length, 1);
    t.ok(loaded.getCostumes()[0].asset, 'placeholder asset came from storage');
    t.end();
});

test('exported 3D sprites can be added again', async t => {
    const vm = makeVM();
    await vm.loadProject(sb3Fixture);
    const target = await add3DSprite(vm);
    const sprite3 = await vm.exportSprite(target.id, 'uint8array');
    await vm.addSprite(sprite3);
    const added = vm.runtime.targets.filter(t2 => t2.isOriginal && t2.getName().startsWith('Box'));
    t.equal(added.length, 2);
    t.ok(added[1].is3D);
    t.same(added[1].getModels(), target.getModels());
    t.equal(added[1].z, target.z);
    t.end();
});

test('format versions', t => {
    t.throws(() => tw3dsb.migrate({meta: {format: '3dsb', formatVersion: tw3dsb.FORMAT_VERSION + 1}}),
        /newer version/);
    const json = {meta: {format: '3dsb'}};
    tw3dsb.migrate(json);
    t.equal(json.meta.formatVersion, tw3dsb.FORMAT_VERSION, 'missing version counts as 1');
    t.ok(tw3dsb.is3dsb({meta: {format: '3dsb'}}));
    t.notOk(tw3dsb.is3dsb({meta: {semver: '3.0.0'}}));
    t.end();
});

test('unpack', async t => {
    t.equal(await tw3dsb.unpack(sb3Fixture), null, '.sb3 is not .3dsb');
    t.equal(await tw3dsb.unpack('{"meta":{}}'), null);
    t.equal(await tw3dsb.unpack(new Uint8Array([1, 2, 3])), null);
    const unpacked = await tw3dsb.unpack('{"meta":{"format":"3dsb"}}');
    t.same(unpacked.json.meta, {format: '3dsb'});
    t.equal(unpacked.zip, null);
    t.end();
});

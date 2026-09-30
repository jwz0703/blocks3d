// Camera sprites and the environments of backdrops (ROADMAP.md, stage 4.10 and 4.11).
const {test} = require('tap');
require('../fixtures/tw_mock_blob');
const fs = require('fs');
const pathUtil = require('path');
const JSZip = require('@turbowarp/jszip');
const VirtualMachine = require('../../src/virtual-machine');
const BlockSupport = require('../../src/engine/block-support');
const Environment = require('../../src/engine/scene-3d-environment');
const SkyPacks = require('../../src/engine/scene-3d-sky-packs');
const tw3dsb = require('../../src/serialization/3dsb');
const makeTestStorage = require('../fixtures/make-test-storage');
const dispatch = require('../../src/dispatch/central-dispatch');
const {addScript, menu, run} = require('../fixtures/tw-3d-scripts');

const sb3Fixture = fs.readFileSync(pathUtil.join(__dirname, '..', 'fixtures', 'tw-save-project-sb3.sb3'));

const round = n => Math.round(n * 1e6) / 1e6;

// A project with the 2D sprite "Sprite1", the 3D sprite "Box", the camera "相機" that importing added, and two
// more cameras
const makeVM = async () => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());
    vm.addCameraOnImport = true;
    await vm.loadProject(sb3Fixture);
    await vm.addSprite3D({name: 'Box', models: [{name: 'cube', shape: 'cube'}]});
    await vm.addCamera({name: 'Top', position: {x: 0, y: 10, z: 0}, rotation: {x: -90, y: 0, z: 0}});
    await vm.addCamera({name: 'Side', position: {x: 10, y: 0, z: 0}, rotation: {x: 0, y: 90, z: 0}, fov: 40});
    const find = name => vm.runtime.targets.find(t => t.getName() === name);
    return {
        vm,
        scene3D: vm.runtime.scene3D,
        sprite: find('Sprite1'),
        box: find('Box'),
        main: find('相機'),
        top: find('Top'),
        side: find('Side')
    };
};

const call = (vm, opcode, args, target) => vm.runtime.getOpcodeFunction(opcode)(args, {
    target,
    stackFrame: {},
    thread: {stackClick: false}
});

test('camera sprites', async t => {
    const {scene3D, main, top, side} = await makeVM();
    t.ok(main.isCamera && main.is3D);
    t.equal(main.kind, 'camera');
    t.equal(scene3D.getActiveCamera(), main, 'the first camera stays the current one');
    t.same(scene3D.getCameras(), [main, top, side]);
    t.same(scene3D.getCameraState(), {x: 0, y: 0, z: 5, yaw: 0, pitch: 0, roll: 0, fov: 60},
        'importing put the camera where the default camera was');

    main.setScale(3, 3, 3);
    main.setVisible(false);
    t.same([main.scaleX, main.visible], [1, true], 'no scale, always visible');
    t.equal(main.makeClone(), null, 'cameras can\'t be cloned');
    t.equal(scene3D.getTargetBox(main), null, 'cameras take no space');

    main.moveForward(2);
    t.same([main.x, main.y, main.z].map(round), [0, 0, 3], '3D motion moves cameras');
    t.same(scene3D.getCameraState().z, 3, 'the stage looks from there');
    main.setFov(500);
    t.equal(main.fov, 179, 'field of view is limited');
    t.end();
});

test('only the editor gives imported projects a camera', async t => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());
    await vm.loadProject(sb3Fixture);
    t.equal(vm.runtime.targets.filter(target => target.isCamera).length, 0, 'the player adds none');
    t.equal(vm.runtime.scene3D.getActiveCamera(), null);
    t.same(vm.runtime.scene3D.getCameraState(), Object.assign({}, vm.runtime.scene3D.constructor.defaultCamera()),
        'the stage looks from the default camera');
    t.end();
});

test('the table for camera sprites', t => {
    const support = opcode => BlockSupport.getBlockSupport(opcode, 'camera').support;
    t.equal(support('motion3d_moveforward'), BlockSupport.KEEP, 'moves like a 3D sprite');
    t.equal(support('motion3d_facesprite'), BlockSupport.KEEP);
    t.equal(support('camera3d_setfov'), BlockSupport.KEEP);
    t.equal(BlockSupport.getBlockSupport('camera3d_setfov', '3d').support, BlockSupport.HIDE,
        'only cameras have a field of view');
    t.equal(BlockSupport.getBlockSupport('camera3d_fov', '2d').support, BlockSupport.HIDE);
    t.equal(BlockSupport.getBlockSupport('camera3d_switchcamera', '2d').support, BlockSupport.KEEP,
        'every target can switch cameras');
    t.equal(support('looks3d_setcolor'), BlockSupport.HIDE, 'no model');
    t.equal(support('looks_say'), BlockSupport.HIDE, 'no speech bubble');
    t.equal(support('sensing3d_touching'), BlockSupport.HIDE, 'touches nothing');
    t.equal(support('sensing_touchingobject'), BlockSupport.HIDE);
    t.equal(support('sensing3d_distanceto'), BlockSupport.KEEP);
    t.equal(support('control_start_as_clone'), BlockSupport.HIDE, 'no clones');
    t.equal(support('pen_penDown'), BlockSupport.HIDE);
    t.ok(BlockSupport.isInPalette('camera3d_enablemouselook', '2d'));
    t.same(BlockSupport.ATTRIBUTES.camera, BlockSupport.ATTRIBUTES_CAMERA);
    t.equal(BlockSupport.kindOf({isCamera: true, is3D: true}), 'camera');
    t.end();
});

test('switching cameras with blocks', async t => {
    const {vm, scene3D, sprite, main, top, side} = await makeVM();
    const variable = sprite.lookupOrCreateVariable('v', 'switched');
    addScript(sprite, [
        {opcode: 'data_setvariableto', inputs: {VALUE: 'yes'}, fields: {VARIABLE: {value: 'switched', id: 'v'}}}
    ], {opcode: 'camera3d_whencameraswitchesto', fields: {CAMERA: 'Side'}});
    addScript(sprite, [
        {opcode: 'camera3d_switchcamera', inputs: {CAMERA: menu('camera3d_menu_camera', 'camera', 'Side')}}
    ]);
    run(vm);
    t.equal(scene3D.getActiveCamera(), side, 'a 2D sprite switched the camera');
    t.equal(variable.value, 'yes', '"when camera switches to" ran');
    t.equal(call(vm, 'camera3d_currentcamera', {}, sprite), 'Side');
    t.equal(scene3D.getCameraState().fov, 40, 'the stage uses its field of view');

    call(vm, 'camera3d_switchcamera', {CAMERA: '_next_'}, sprite);
    t.equal(scene3D.getActiveCamera(), main, '"next camera" wraps around');
    call(vm, 'camera3d_switchcamera', {CAMERA: 'Box'}, sprite);
    t.equal(scene3D.getActiveCamera(), main, 'a 3D sprite is not a camera');
    call(vm, 'camera3d_switchcamera', {CAMERA: 'Top'}, sprite);
    t.equal(call(vm, 'camera3d_fov', {}, top), 60);
    call(vm, 'camera3d_changefov', {FOV: -20}, top);
    t.equal(scene3D.getCameraState().fov, 40, 'changing the current camera changes the view');
    t.end();
});

test('deleting cameras', async t => {
    const {vm, scene3D, main, top, side} = await makeVM();
    vm.setActiveCamera(top.id);
    vm.deleteSprite(top.id);
    t.equal(scene3D.getActiveCamera(), main, 'the next camera takes over');
    vm.deleteSprite(main.id);
    t.equal(scene3D.getActiveCamera(), side);
    side.setXYZ(1, 2, 3);
    vm.deleteSprite(side.id);
    t.equal(scene3D.getActiveCamera(), null, 'without cameras');
    t.same(scene3D.getCameraState(), {x: 1, y: 2, z: 3, yaw: 90, pitch: 0, roll: 0, fov: 40},
        'the default camera stays where the last camera was, so the view doesn\'t change');
    t.equal(scene3D.editor.getState().hasCamera, false, 'the editor says there is no camera');

    // A new project starts from the usual default camera
    await vm.loadProject(sb3Fixture);
    vm.deleteSprite(vm.runtime.targets.find(target => target.isCamera).id);
    t.same(scene3D.getCameraState(), Object.assign({}, scene3D.constructor.defaultCamera()));
    t.end();
});

test('the current camera is where the stage looks from', async t => {
    const {vm, scene3D, sprite, box, top} = await makeVM();
    box.setXYZ(2, 0, 0);
    t.equal(round(scene3D.projectTarget(box).y), 0, 'seen from the front, it is at the middle height');
    vm.setActiveCamera(top.id);
    const fromAbove = scene3D.projectTarget(box);
    t.ok(fromAbove.x > 0 && round(fromAbove.y) === 0, 'seen from above, x is still to the right');
    top.setXYZ(0, 10, 5);
    t.ok(scene3D.projectTarget(box).y > 0, 'moving the camera moves where sprites are drawn');

    // Blocks that point at "the camera" mean the current camera
    t.equal(round(call(vm, 'sensing3d_distanceto', {TARGET: '_camera_'}, box)), round(Math.hypot(2, 10, 5)));
    t.equal(round(call(vm, 'sensing3d_distanceto', {TARGET: 'Side'}, box)), 8, 'or a camera by name');
    call(vm, 'motion3d_facesprite', {TARGET: 'Top'}, box);
    t.ok(box.rotationX > 0, 'facing a camera');
    t.equal(await call(vm, 'sensing3d_touching', {TARGET: 'Top'}, box), false, 'cameras are never touched');
    t.equal(call(vm, 'sensing3d_onscreen', {SPRITE: 'Top'}, sprite), false, 'cameras aren\'t drawn');
    t.end();
});

test('procedural objects are an extension from the library', async t => {
    const {vm, sprite} = await makeVM();
    t.notOk(vm.extensionManager.isExtensionLoaded('three3d'), 'not loaded by default');
    t.ok(vm.runtime.getOpcodeFunction('environment3d_setlayervisible'), 'hiding the 3D layer is an environment block');

    // A project that uses its blocks loads it
    addScript(sprite, [{opcode: 'three3d_removeAll'}]);
    const json = JSON.parse(vm.toJSON());
    t.ok(json.extensions.includes('three3d'), 'saved as a used extension');
    const other = new VirtualMachine();
    other.attachStorage(makeTestStorage());
    await other.loadProject(await vm.saveProject3dsb('arraybuffer'));
    t.ok(other.extensionManager.isExtensionLoaded('three3d'), 'loaded again with the project');
    t.end();
});

test('the camera belongs to camera sprites, not to the procedural object blocks', async t => {
    const {vm} = await makeVM();
    vm.extensionManager.loadExtensionIdSync('three3d');
    const opcodes = vm.runtime._blockInfo.find(info => info.id === 'three3d').blocks
        .map(block => block.info.opcode)
        .filter(opcode => opcode);
    t.notOk(opcodes.some(opcode => /camera|pointerlock|background|ambient|sun/i.test(opcode)),
        'no camera, mouse look or environment blocks left');
    t.end();
});

test('moving level with the ground', async t => {
    const {vm, main} = await makeVM();
    main.setRotation(45, 90, 0);
    call(vm, 'motion3d_movelevel', {DIRECTION: 'forward', STEPS: 2}, main);
    t.same([main.x, main.y, main.z].map(round), [-2, 0, 5], 'looking up doesn\'t make it fly');
    call(vm, 'motion3d_movelevel', {DIRECTION: 'right', STEPS: 1}, main);
    t.same([main.x, main.y, main.z].map(round), [-2, 0, 4], 'right of yaw 90 is -z');
    call(vm, 'motion3d_movelevel', {DIRECTION: 'up', STEPS: 3}, main);
    call(vm, 'motion3d_movelevel', {DIRECTION: 'back', STEPS: -1}, main);
    t.same([main.x, main.y, main.z].map(round), [-3, 3, 4]);
    call(vm, 'motion3d_movelevel', {DIRECTION: 'nowhere', STEPS: 1}, main);
    t.same([main.x, main.y, main.z].map(round), [-3, 3, 4]);
    t.end();
});

test('menus', async t => {
    const {vm, box} = await makeVM();
    vm.setEditingTarget(box.id);
    const extension = id => dispatch.services[vm.extensionManager._loadedExtensions.get(id)];
    const values = items => items.map(item => item.value);

    t.same(values(extension('camera3d')._getCameraMenu()), ['相機', 'Top', 'Side', '_next_']);
    t.same(values(extension('camera3d')._getCameraFieldMenu()), ['相機', 'Top', 'Side']);
    t.same(values(extension('motion3d')._getFaceTargetMenu()), ['_camera_', '_mouse_', '相機', 'Top', 'Side'],
        'face: the current camera, and every camera');
    t.same(values(extension('sensing3d')._getTouchTargetMenu()), ['_any_', '_mouse_'], 'touching: no cameras');
    t.same(values(extension('sensing3d')._getDistanceTargetMenu()), ['_camera_', '_mouse_', '相機', 'Top', 'Side']);
    t.same(values(extension('sensing3d')._getSpriteMenu()), ['Box'], 'screen position: no cameras');
    t.end();
});

test('formatVersion 1 projects get a camera sprite and an environment on every backdrop', async t => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());
    vm.addCameraOnImport = true;
    await vm.loadProject(sb3Fixture);
    const json = JSON.parse(vm.toJSON());
    json.meta.formatVersion = 1;
    json.targets = json.targets.filter(target => target.kind !== 'camera');
    const stage = json.targets.find(target => target.isStage);
    delete stage.currentCamera;
    stage.environment = {
        background: {type: 'color', color: '#112233'},
        ambient: {color: '#ffffff', intensity: 0.5},
        sun: {color: '#ffffff', intensity: 1, x: 1, y: 2, z: 3},
        fog: {enabled: true, color: '#ffffff', near: 1, far: 50},
        camera: {x: 1, y: 2, z: 8, yaw: 20, pitch: -10, fov: 50}
    };

    const migrated = tw3dsb.migrate(JSON.parse(JSON.stringify(json)));
    t.equal(migrated.meta.formatVersion, tw3dsb.FORMAT_VERSION);
    const migratedStage = migrated.targets.find(target => target.isStage);
    t.notOk('environment' in migratedStage, 'the stage has no environment of its own');
    t.equal(migratedStage.currentCamera, '相機');
    const environment = migratedStage.costumes[0].environment;
    t.same(environment.sky, Object.assign({}, Environment.default2DEnvironment().sky, {type: 'color',
        color: '#112233'}), 'the background became the sky');
    t.equal(environment.lighting.type, 'none', 'it is lit like before');
    t.equal(environment.toneMapping, 'none');
    t.same(environment.sun, {color: '#ffffff', intensity: 1, x: 1, y: 2, z: 3, shadows: false});
    t.equal(environment.fog.far, 50);

    // project.json only, with the assets in storage
    const vm2 = new VirtualMachine();
    vm2.attachStorage(makeTestStorage());
    vm2.addCameraOnImport = true;
    for (const asset of vm.assets) {
        vm2.runtime.storage.builtinHelper._store(asset.assetType, asset.dataFormat, asset.data, asset.assetId);
    }
    await vm2.loadProject(JSON.stringify(json));
    const camera = vm2.runtime.targets.find(target => target.isCamera);
    t.ok(camera, 'the camera became a camera sprite');
    t.same([camera.x, camera.y, camera.z, camera.rotationY, camera.rotationX, camera.fov], [1, 2, 8, 20, -10, 50]);
    t.equal(vm2.runtime.scene3D.getActiveCamera(), camera);
    t.equal(vm2.runtime.scene3D.environment.sky.color, '#112233');
    t.equal(vm2.runtime.targets.filter(target => target.isCamera).length, 1, 'no other camera was added');
    t.end();
});

test('every backdrop has its own environment', async t => {
    const {vm, scene3D} = await makeVM();
    const stage = vm.runtime.getTargetForStage();
    // Like duplicating it in the editor, which needs a renderer
    const first = stage.getCostumes()[0];
    stage.addCostume(Object.assign({}, first, {name: `${first.name}2`}), 1);
    stage.setCostume(1);
    t.same(scene3D.environment, Environment.default2DEnvironment(), 'backdrops start as 2D backdrops');

    vm.setEnvironment3D({sky: {type: 'procedural', clouds: 80}, sun: {shadows: true}});
    t.equal(scene3D.environment.sky.type, 'procedural');
    t.equal(scene3D.getEnvironment(0).sky.type, '2d', 'the other backdrop is unchanged');
    vm.setEnvironment3D({sky: {type: 'color', color: '#ff0000'}}, 0);
    t.equal(scene3D.getEnvironment(0).sky.color, '#ff0000', 'any backdrop can be changed');

    // The backdrop blocks switch environments, and "when backdrop switches to" still runs
    const sprite = vm.runtime.targets.find(target => target.getName() === 'Sprite1');
    const variable = sprite.lookupOrCreateVariable('w', 'when');
    const firstName = stage.getCostumes()[0].name;
    addScript(sprite, [
        {opcode: 'data_setvariableto', inputs: {VALUE: 'ran'}, fields: {VARIABLE: {value: 'when', id: 'w'}}}
    ], {opcode: 'event_whenbackdropswitchesto', fields: {BACKDROP: firstName}});
    addScript(sprite, [
        {opcode: 'looks_switchbackdropto', inputs: {BACKDROP: menu('looks_backdrops', 'BACKDROP', firstName)}}
    ]);
    run(vm);
    t.equal(stage.currentCostume, 0);
    t.equal(scene3D.environment.sky.color, '#ff0000', 'the environment switched with the backdrop');
    t.equal(variable.value, 'ran');

    // Environment blocks change the current environment
    call(vm, 'environment3d_setskytype', {TYPE: 'gradient'}, sprite);
    call(vm, 'environment3d_setskycolor', {PART: 'top', COLOR: '#0000ff'}, sprite);
    call(vm, 'environment3d_setclouds', {CLOUDS: 150}, sprite);
    call(vm, 'environment3d_setsun', {ELEVATION: 30, AZIMUTH: 90}, sprite);
    call(vm, 'environment3d_setexposure', {VALUE: 1.5}, sprite);
    call(vm, 'environment3d_setfog', {STATE: 'on'}, sprite);
    call(vm, 'environment3d_setskytype', {TYPE: 'nonsense'}, sprite);
    const environment = scene3D.environment;
    t.equal(environment.sky.type, 'gradient');
    t.equal(environment.sky.top, '#0000ff');
    t.equal(environment.sky.clouds, 100, 'clouds are a percentage');
    t.same([environment.sun.x, environment.sun.y, environment.sun.z].map(n => Math.round(n * 1000) / 1000),
        [0.866, 0.5, 0]);
    t.equal(call(vm, 'environment3d_sun', {ANGLE: 'elevation'}, sprite), 30);
    t.equal(call(vm, 'environment3d_sun', {ANGLE: 'azimuth'}, sprite), 90);
    t.equal(environment.exposure, 1.5);
    t.equal(environment.fog.enabled, true);
    t.equal(scene3D.getEnvironment(1).sky.type, 'procedural', 'only the current backdrop changed');

    // Saved with the backdrops, and the current camera with the stage
    const top = vm.runtime.targets.find(target => target.getName() === 'Top');
    vm.setActiveCamera(top.id);
    const buffer = await vm.saveProject3dsb('arraybuffer');
    const zip = await JSZip.loadAsync(buffer);
    const json = JSON.parse(await zip.file('project.json').async('string'));
    const savedStage = json.targets.find(target => target.isStage);
    t.equal(savedStage.currentCamera, 'Top');
    t.equal(savedStage.costumes[1].environment.sky.clouds, 80);
    const savedCamera = json.targets.find(target => target.name === 'Side');
    t.same([savedCamera.kind, savedCamera.fov], ['camera', 40]);
    t.notOk('models' in savedCamera || 'scale' in savedCamera || 'costumes' in savedCamera);

    const vm2 = new VirtualMachine();
    vm2.attachStorage(makeTestStorage());
    vm2.addCameraOnImport = true;
    await vm2.loadProject(buffer);
    const scene2 = vm2.runtime.scene3D;
    t.equal(scene2.getActiveCamera().getName(), 'Top', 'the current camera is loaded');
    t.same(scene2.getEnvironment(0), scene3D.getEnvironment(0));
    t.same(scene2.getEnvironment(1), scene3D.getEnvironment(1));
    t.equal(vm2.runtime.targets.filter(target => target.isCamera).length, 3, 'no camera was added');
    t.end();
});

test('sun angles', t => {
    for (const [elevation, azimuth] of [[0, 0], [45, 90], [-30, -120], [89, 170]]) {
        const angles = Environment.sunToAngles(Environment.sunFromAngles(elevation, azimuth));
        t.same([Math.round(angles.elevation), Math.round(angles.azimuth)], [elevation, azimuth]);
    }
    const merged = Environment.mergeEnvironment(Environment.defaultEnvironment(), {
        sky: {type: 'bad', clouds: -5, blur: 500},
        sun: {x: 0, y: 0, z: 0},
        toneMapping: 'bad',
        exposure: 'x'
    });
    t.equal(merged.sky.type, 'procedural');
    t.same([merged.sky.clouds, merged.sky.blur], [0, 100]);
    t.equal(merged.sun.y, 1, 'the sun needs a direction');
    t.equal(merged.toneMapping, 'neutral');
    t.equal(merged.exposure, 1);
    t.end();
});

// Stage 6.5: cameras that follow 3D sprites
test('each kind of sky has its own blocks', async t => {
    const {vm, scene3D, sprite} = await makeVM();
    t.same(Environment.SKY_EXTENSIONS, {
        procedural: 'skyprocedural',
        color: 'skycolor',
        gradient: 'skycolor',
        hdri: 'skyhdri'
    });
    // Backdrop packs: every kind of sky but 2D, with parameters that are keys of the sky
    t.same(SkyPacks.SKY_PACKS.map(pack => pack.id), ['procedural', 'gradient', 'color', 'hdri']);
    const sky = Environment.defaultEnvironment().sky;
    for (const pack of SkyPacks.SKY_PACKS) {
        t.ok(pack.params.every(param => param.key in sky), `${pack.id} parameters are in the sky`);
        t.equal(Environment.defaultSkyEnvironment(pack.id).sky.type, pack.id);
    }
    t.equal(SkyPacks.getSkyPack('2d'), null, '2D backdrops are no pack');
    for (const id of ['skyprocedural', 'skycolor', 'skyhdri']) {
        t.ok(vm.extensionManager.isExtensionLoaded(id), `${id} is built in`);
    }
    // The sky blocks of 環境 still run, but moved to the sky extensions in the palette
    const environmentInfo = vm.runtime._blockInfo.find(info => info.id === 'environment3d');
    const hidden = environmentInfo.blocks
        .filter(block => block.info.hideFromPalette)
        .map(block => block.info.opcode);
    t.same(hidden, ['setskytype', 'setskycolor', 'setclouds']);

    // Only the current backdrop changes, and only when its sky is of the kind
    vm.setEnvironment3D({sky: {type: '2d'}});
    call(vm, 'skyprocedural_setclouds', {CLOUDS: 70}, sprite);
    call(vm, 'skycolor_setcolor', {COLOR: '#ff0000'}, sprite);
    t.same(scene3D.environment.sky, Environment.default2DEnvironment().sky, 'a 2D backdrop is unchanged');
    t.equal(call(vm, 'skyprocedural_clouds', {}, sprite), 0);

    vm.setEnvironment3D({sky: {type: 'procedural', clouds: 30}});
    call(vm, 'skyprocedural_changeclouds', {CLOUDS: 20}, sprite);
    t.equal(call(vm, 'skyprocedural_clouds', {}, sprite), 50);
    call(vm, 'skyprocedural_setclouds', {CLOUDS: 120}, sprite);
    call(vm, 'skyprocedural_setblur', {BLUR: 40}, sprite);
    call(vm, 'skyhdri_setrotation', {DEGREES: 90}, sprite);
    t.same([scene3D.environment.sky.clouds, scene3D.environment.sky.blur, scene3D.environment.sky.rotation],
        [100, 40, 0], 'HDRI blocks don\'t change a procedural sky');

    vm.setEnvironment3D({sky: {type: 'gradient'}});
    call(vm, 'skycolor_setgradient', {PART: 'bottom', COLOR: '#00ff00'}, sprite);
    t.equal(scene3D.environment.sky.bottom, '#00ff00');
    call(vm, 'skycolor_setcolor', {COLOR: '#0000ff'}, sprite);
    t.same([scene3D.environment.sky.top, scene3D.environment.sky.bottom], ['#0000ff', '#0000ff'],
        'one color makes a gradient that color');
    vm.setEnvironment3D({sky: {type: 'color'}});
    call(vm, 'skycolor_setgradient', {PART: 'top', COLOR: '#ffffff'}, sprite);
    t.equal(scene3D.environment.sky.top, '#0000ff', 'a one color sky has no gradient');
    call(vm, 'skycolor_setcolor', {COLOR: '#123456'}, sprite);
    t.equal(scene3D.environment.sky.color, '#123456');

    vm.setEnvironment3D({sky: {type: 'hdri', rotation: 0}});
    call(vm, 'skyhdri_setrotation', {DEGREES: 270}, sprite);
    t.equal(call(vm, 'skyhdri_rotation', {}, sprite), -90, 'rotation stays from -180 to 180');
    call(vm, 'skyhdri_turn', {DEGREES: -100}, sprite);
    t.equal(call(vm, 'skyhdri_rotation', {}, sprite), 170);
    t.end();
});

test('third person follow', async t => {
    const {vm, scene3D, box, main} = await makeVM();
    const pose = camera => [camera.x, camera.y, camera.z, camera.rotationY, camera.rotationX].map(round);
    box.setXYZ(1, 0, 0);
    // A 3D sprite makes the current camera follow itself
    addScript(box, [
        {opcode: 'camera3d_setfollowangles', inputs: {YAW: 0, PITCH: 0}},
        {
            opcode: 'camera3d_followthirdperson',
            inputs: {TARGET: menu('camera3d_menu_followTarget', 'followTarget', '_myself_'), DISTANCE: 4}
        }
    ]);
    run(vm);
    t.same(pose(main), [1, 1, 4, 0, 0], 'behind the sprite, at the offset height, looking the same way');
    t.equal(call(vm, 'camera3d_following', {}, box), 'Box');

    box.setRotation(0, 90, 0);
    box.setXYZ(0, 0, 0);
    scene3D.follow.update(1 / 60);
    t.same(pose(main), [4, 1, 0, 90, 0], 'turns with the sprite: still behind it');

    call(vm, 'camera3d_setfollowangles', {YAW: 0, PITCH: -90}, box);
    scene3D.follow.update(1 / 60);
    t.ok(main.rotationX > -90 && main.rotationX < -89, 'pitch stops short of straight down');
    t.ok(main.y > 3.99, 'above the sprite, looking down on it');

    call(vm, 'camera3d_setfollowangles', {YAW: 0, PITCH: 0}, box);
    call(vm, 'camera3d_setfollowoffset', {X: 1, Y: 2, Z: 0}, box);
    scene3D.follow.update(1 / 60);
    t.same(pose(main), [4, 2, -1, 90, 0], 'the offset turns with the sprite: x is to its right');

    t.equal(scene3D.follow.mouseLook(main, 90, 0), true, 'mouse look orbits a following camera');
    scene3D.follow.update(1 / 60);
    t.same(pose(main), [0, 2, -5, 180, 0]);

    call(vm, 'camera3d_stopfollowing', {}, box);
    box.setXYZ(10, 10, 10);
    scene3D.follow.update(1 / 60);
    t.same(pose(main), [0, 2, -5, 180, 0], 'stopped');
    t.equal(call(vm, 'camera3d_following', {}, box), '');
    t.equal(scene3D.follow.mouseLook(main, 90, 0), false, 'mouse look turns the camera again');
    t.end();
});

test('first person follow', async t => {
    const {vm, scene3D, box, main, top} = await makeVM();
    const pose = camera => [camera.x, camera.y, camera.z, camera.rotationY, camera.rotationX].map(round);
    box.setXYZ(2, 0, 3);
    box.setRotation(10, 30, 0);
    // A camera sprite that isn't the current one follows the sprite by name
    call(vm, 'camera3d_setfollowoffset', {X: 0, Y: 0.5, Z: 0}, top);
    call(vm, 'camera3d_followfirstperson', {TARGET: 'Box'}, top);
    t.same(pose(top), [2, 0.5, 3, 30, 10], 'at the eyes, looking where the sprite looks');
    t.same(pose(main), [0, 0, 5, 0, 0], 'the current camera didn\'t move');

    scene3D.follow.mouseLook(top, 0, 0);
    vm.setActiveCamera(top.id);
    scene3D.follow.mouseLook(top, 20, -5);
    t.equal(round(box.rotationY), 50, 'first person mouse look turns the sprite');
    scene3D.follow.update(1 / 60);
    t.same(pose(top), [2, 0.5, 3, 50, 5], 'and tilts the camera');

    call(vm, 'camera3d_followfirstperson', {TARGET: 'Top'}, top);
    t.equal(scene3D.follow.get(top).target, box, 'cameras can\'t be followed');
    call(vm, 'camera3d_followthirdperson', {TARGET: 'Box', DISTANCE: 2}, top);
    t.same([scene3D.follow.get(top).yaw, scene3D.follow.get(top).pitch], [0, -20],
        'switching modes starts from the new mode\'s angles');

    vm.deleteSprite(box.id);
    scene3D.follow.update(1 / 60);
    t.equal(scene3D.follow.get(top), null, 'deleting the sprite stops following it');
    t.end();
});

test('smooth follow', async t => {
    const {vm, scene3D, box, main} = await makeVM();
    call(vm, 'camera3d_setfollowsmoothing', {SECS: 0.5}, box);
    call(vm, 'camera3d_setfollowangles', {YAW: 0, PITCH: 0}, box);
    call(vm, 'camera3d_followthirdperson', {TARGET: '_myself_', DISTANCE: 5}, box);
    t.same([main.x, main.y, main.z].map(round), [0, 0, 5], 'starts from where the camera was');
    scene3D.follow.update(0.25);
    scene3D.follow.update(0.25);
    const expected = 1 - Math.exp(-1);
    t.equal(round(main.y), round(expected), 'about 63% of the way after the smoothing time');
    for (let i = 0; i < 100; i++) scene3D.follow.update(0.1);
    t.equal(round(main.y), 1, 'catches up');

    box.setRotation(0, 170, 0);
    scene3D.follow.update(0.05);
    box.setRotation(0, -170, 0);
    for (let i = 0; i < 100; i++) scene3D.follow.update(0.1);
    t.equal(Math.abs(round(main.rotationY)), 170, 'turns the short way');

    // Following ends with the project
    vm.stopAll();
    t.equal(scene3D.follow.get(main), null);

    // The default camera follows too
    vm.deleteSprite(main.id);
    vm.deleteSprite(vm.runtime.targets.find(target => target.getName() === 'Top').id);
    vm.deleteSprite(vm.runtime.targets.find(target => target.getName() === 'Side').id);
    box.setXYZ(0, 0, 0);
    box.setRotation(0, 0, 0);
    call(vm, 'camera3d_setfollowangles', {YAW: 0, PITCH: 0}, box);
    call(vm, 'camera3d_followfirstperson', {TARGET: '_myself_'}, box);
    const state = scene3D.getCameraState();
    t.same([state.x, state.y, state.z, state.yaw, state.pitch], [0, 1, 0, 0, 0]);
    t.end();
});

test('orbiting a point or a sprite, like OrbitControls', async t => {
    const {vm, scene3D, box, main, sprite} = await makeVM();
    const pose = () => [main.x, main.y, main.z, main.rotationY, main.rotationX].map(round);
    const mouse = vm.runtime.ioDevices.mouse;
    const frame = (seconds = 1 / 60) => {
        vm.runtime.ioDevices.mouseWheel.stepFrame();
        scene3D.follow.update(seconds, true);
    };
    const at = (x, y, more) => Object.assign({x, y, canvasWidth: 480, canvasHeight: 360}, more);

    call(vm, 'camera3d_setfollowangles', {YAW: 0, PITCH: 0}, main);
    call(vm, 'camera3d_setorbitdamping', {DAMPING: 0}, main);
    call(vm, 'camera3d_orbitpoint', {X: 1, Y: 2, Z: 3, DISTANCE: 10}, main);
    t.same(pose(), [1, 2, 13, 0, 0], 'behind the point, looking at it');
    t.equal(call(vm, 'camera3d_orbitdistance', {}, main), 10);
    t.equal(call(vm, 'camera3d_following', {}, main), '', 'a point is not a sprite');

    // Dragging from the stage: the whole height of the stage is 360 degrees
    mouse.postData(at(240, 180, {isDown: true}));
    t.ok(mouse.getPressTarget().isStage, 'pressed on nothing');
    frame();
    mouse.postData(at(270, 150));
    frame();
    t.same(pose().slice(3), [-30, 30], 'dragging right turns left around it, up looks up at it');
    mouse.postData(at(270, 150, {isDown: false}));
    t.equal(mouse.getPressTarget(), null);

    // Damping: a part of the rest of the drag every frame, whatever the framerate
    call(vm, 'camera3d_setfollowangles', {YAW: 0, PITCH: 0}, main);
    call(vm, 'camera3d_setorbitdamping', {DAMPING: 0.5}, main);
    mouse.postData(at(240, 180, {isDown: true}));
    frame();
    mouse.postData(at(276, 180, {isDown: true}));
    frame();
    t.equal(round(main.rotationY), -18, 'half of the drag in the first frame');
    mouse.postData(at(276, 180, {isDown: false}));
    frame();
    t.equal(round(main.rotationY), -27, 'and it keeps turning after letting go');
    frame(1 / 30);
    t.equal(round(main.rotationY), round(-36 + (9 * 0.25)), 'two frames\' worth in a frame twice as long');
    for (let i = 0; i < 200; i++) frame();
    t.equal(Math.round(main.rotationY * 1000) / 1000, -36, 'all of the drag in the end');

    // The wheel zooms, within the limits
    vm.runtime.ioDevices.mouseWheel.postData({deltaY: -100, deltaMode: 0});
    frame();
    t.equal(call(vm, 'camera3d_orbitdistance', {}, main), round(10 * Math.exp(-0.15)));
    call(vm, 'camera3d_setorbitdistancelimits', {MIN: 2, MAX: 5}, main);
    t.equal(call(vm, 'camera3d_orbitdistance', {}, main), 5, 'limits apply right away');
    call(vm, 'camera3d_setorbitdistance', {DISTANCE: 1}, main);
    frame();
    t.equal(call(vm, 'camera3d_orbitdistance', {}, main), 2);

    // Pitch limits
    call(vm, 'camera3d_setorbitpitchlimits', {MIN: -60, MAX: -10}, main);
    call(vm, 'camera3d_setfollowangles', {YAW: 0, PITCH: 0}, main);
    frame();
    t.equal(round(main.rotationX), -10);
    call(vm, 'camera3d_setfollowangles', {YAW: 0, PITCH: -90}, main);
    frame();
    t.equal(round(main.rotationX), -60);

    // Turning by itself
    call(vm, 'camera3d_setorbitautospeed', {SPEED: 30}, main);
    call(vm, 'camera3d_setfollowangles', {YAW: 0, PITCH: -30}, main);
    frame(0.25);
    frame(0.25);
    t.equal(round(main.rotationY), 15, '30 degrees a second');
    call(vm, 'camera3d_setorbitautospeed', {SPEED: 0}, main);

    // Dragging from a 3D sprite that only collides (like the ground) turns it, from a sprite that uses the mouse
    // (or a 2D sprite) not; turning off the controls neither
    call(vm, 'camera3d_setorbitdamping', {DAMPING: 0}, main);
    call(vm, 'camera3d_setfollowangles', {YAW: 0, PITCH: -30}, main);
    mouse.postData(at(240, 180, {isDown: true}));
    mouse._pressTarget = box;
    frame();
    mouse.postData(at(252, 180));
    frame();
    t.equal(round(main.rotationY), -12, 'a drag from the ground');
    mouse.postData(at(252, 180, {isDown: false}));
    const yaw = main.rotationY;
    for (const [pressed, what] of [[box, 'a draggable sprite'], [sprite, 'a 2D sprite']]) {
        box.setDraggable(true);
        mouse.postData(at(240, 180, {isDown: true}));
        mouse._pressTarget = pressed;
        frame();
        mouse.postData(at(300, 180));
        frame();
        t.equal(main.rotationY, yaw, what);
        mouse.postData(at(300, 180, {isDown: false}));
    }
    box.setDraggable(false);
    call(vm, 'camera3d_setorbitcontrols', {ON: 'off'}, main);
    mouse.postData(at(240, 180, {isDown: true}));
    frame();
    mouse.postData(at(300, 180));
    frame();
    t.equal(main.rotationY, yaw, 'controls off');
    mouse.postData(at(300, 180, {isDown: false}));

    // Orbiting a sprite: it follows it, but doesn't turn with it
    call(vm, 'camera3d_setorbitcontrols', {ON: 'on'}, main);
    call(vm, 'camera3d_setorbitpitchlimits', {MIN: -89, MAX: 89}, main);
    call(vm, 'camera3d_setfollowangles', {YAW: 90, PITCH: 0}, main);
    call(vm, 'camera3d_setfollowoffset', {X: 0, Y: 1, Z: 0}, main);
    call(vm, 'camera3d_orbit', {TARGET: 'Box', DISTANCE: 4}, main);
    box.setXYZ(5, 0, 0);
    box.setRotation(0, 45, 0);
    frame();
    t.same(pose(), [9, 1, 0, 90, 0], 'to the side of the sprite, at the offset');
    t.equal(call(vm, 'camera3d_following', {}, main), 'Box');

    // Only the camera the stage shows gets the mouse
    const top = vm.runtime.targets.find(target => target.getName() === 'Top');
    call(vm, 'camera3d_orbitpoint', {X: 0, Y: 0, Z: 0, DISTANCE: 10}, top);
    const topYaw = top.rotationY;
    mouse.postData(at(240, 180, {isDown: true}));
    frame();
    mouse.postData(at(300, 180));
    frame();
    t.equal(top.rotationY, topYaw);
    t.notEqual(round(main.rotationY), 90, 'the current camera turns');
    mouse.postData(at(300, 180, {isDown: false}));

    vm.stopAll();
    t.equal(scene3D.follow.get(main), null, 'stops with the project');
    t.end();
});

test('camera shake moves where the camera is drawn, not the camera', async t => {
    const {vm, scene3D, main} = await makeVM();
    main.setXYZ(0, 0, 5);
    call(vm, 'camera3d_shake', {STRENGTH: 0.5, SECS: 1}, main);
    scene3D._updateShake(0.1);
    const drawn = scene3D.getGameCamera().position;
    const moved = [drawn.x, drawn.y, drawn.z - 5];
    t.ok(moved.some(n => n !== 0) && moved.every(n => Math.abs(n) <= (0.5 * 0.81) + 1e-9), 'moved a bit, fading');
    t.same([main.x, main.y, main.z], [0, 0, 5], 'the camera sprite stays where it is');
    t.equal(scene3D.getGameCamera().rotation.y, 0, 'doesn\'t turn');

    call(vm, 'camera3d_shake', {STRENGTH: 0.1, SECS: 5}, main);
    t.equal(scene3D._shake.strength, 0.5, 'a weaker shake doesn\'t replace a stronger one');
    scene3D._updateShake(1);
    t.equal(scene3D._shakeOffset, null, 'over after its time');
    const still = scene3D.getGameCamera().position;
    t.same([still.x, still.y, still.z], [0, 0, 5]);

    call(vm, 'camera3d_shake', {STRENGTH: 1, SECS: 1}, main);
    scene3D._updateShake(0.1);
    vm.stopAll();
    t.equal(scene3D._shakeOffset, null, 'stops with the project');
    t.end();
});

test('clicking mouse look in the palette adds an example script', async t => {
    const {vm, box, main, sprite} = await makeVM();
    const click = target => vm.runtime.getOpcodeFunction('camera3d_enablemouselook')({SENS: 1}, {
        target,
        stackFrame: {},
        thread: {stackClick: true, topBlock: 'palette'}
    });
    const opcodes = target => Object.values(target.blocks._blocks).map(block => block.opcode);

    click(main);
    t.ok(opcodes(main).includes('motion3d_movelevel'), 'a camera flies with WASD');
    t.notOk(opcodes(main).includes('camera3d_followfirstperson'));
    click(main);
    t.equal(opcodes(main).filter(opcode => opcode === 'event_whenflagclicked').length, 1, 'only once');

    click(box);
    t.ok(opcodes(box).includes('camera3d_followfirstperson'), 'a 3D sprite walks, seen in first person');
    t.ok(opcodes(box).includes('motion3d_movelevel'));

    click(sprite);
    t.notOk(opcodes(sprite).includes('camera3d_enablemouselook'), 'nothing for 2D sprites');
    t.end();
});

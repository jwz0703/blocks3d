// How blocks behave on 2D and 3D sprites, and when they point at the other kind (ROADMAP.md, stage 4).
const {test} = require('tap');
require('../fixtures/tw_mock_blob');
const fs = require('fs');
const pathUtil = require('path');
const VirtualMachine = require('../../src/virtual-machine');
const BlockSupport = require('../../src/engine/block-support');
const makeTestStorage = require('../fixtures/make-test-storage');

const sb3Fixture = fs.readFileSync(pathUtil.join(__dirname, '..', 'fixtures', 'tw-save-project-sb3.sb3'));

// A project with the 2D sprite "Sprite1" and the 3D sprites "Box" and "Other". The camera is where a new project
// has it: at (0, 0, 5), looking at the origin along -z.
const makeVM = async () => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());
    await vm.loadProject(sb3Fixture);
    await vm.addSprite3D({name: 'Box', models: [{name: 'cube', shape: 'cube'}, {name: 'ball', shape: 'sphere'}]});
    await vm.addSprite3D({name: 'Other', models: [{name: 'cube', shape: 'cube'}]});
    const find = name => vm.runtime.targets.find(t => t.getName() === name);
    return {vm, sprite: find('Sprite1'), box: find('Box'), other: find('Other')};
};

const round = n => Math.round(n * 1e6) / 1e6;

const {addScript, menu, run} = require('../fixtures/tw-3d-scripts');

test('the table: palette and runtime per kind', t => {
    t.equal(BlockSupport.getBlockSupport('control_repeat', '3d').support, BlockSupport.KEEP);
    t.equal(BlockSupport.getBlockSupport('pen_penDown', '3d').support, BlockSupport.HIDE);
    t.equal(BlockSupport.getBlockSupport('motion_goto', '3d').support, BlockSupport.REPLACE);
    t.equal(BlockSupport.getBlockSupport('motion3d_gotoxyz', '2d').support, BlockSupport.HIDE);
    t.equal(BlockSupport.getBlockSupport('motion3d_gotoxyz', '3d').support, BlockSupport.KEEP);

    t.notOk(BlockSupport.isInPalette('looks_gotofrontback', '3d'), 'layers are hidden');
    t.notOk(BlockSupport.isInPalette('sensing_touchingcolor', '3d'), 'touching color is hidden');
    t.notOk(BlockSupport.isInPalette('sensing_setdragmode', '3d'), 'drag mode is hidden');
    t.notOk(BlockSupport.isInPalette('looks_seteffectto', '3d'), 'effects are hidden');
    t.notOk(BlockSupport.isInPalette('motion_setx', '3d'), '3D motion has its own set x');
    t.ok(BlockSupport.isInPalette('motion_goto', '3d'), 'go to random / mouse / sprite');
    t.ok(BlockSupport.isInPalette('looks_say', '3d'));
    t.ok(BlockSupport.isInPalette('sound_play', '3d'));
    t.ok(BlockSupport.isInPalette('sensing3d_screenposition', '2d'), 'HUD blocks for 2D sprites');
    t.notOk(BlockSupport.isInPalette('sensing3d_touching', '2d'));
    t.end();
});

test('hidden blocks do nothing on the other kind, without errors', async t => {
    const {vm, sprite, box} = await makeVM();
    vm.extensionManager.loadExtensionIdSync('pen');
    const call = (opcode, args, target) => vm.runtime.getOpcodeFunction(opcode)(args, {target});

    call('motion_turnright', {DEGREES: 45}, box);
    t.equal(box.direction, 90, '2D turning does nothing');
    t.equal(call('motion_direction', {}, box), 90);
    t.equal(call('looks_costumenumbername', {NUMBER_NAME: 'number'}, box), 0);
    t.equal(call('sensing_touchingcolor', {COLOR: '#ff0000'}, box), false);
    t.doesNotThrow(() => call('pen_penDown', {}, box), 'pen does nothing');
    t.doesNotThrow(() => call('looks_gotofrontback', {FRONT_BACK: 'front'}, box));

    sprite.setXY(1, 2);
    call('motion3d_gotoxyz', {X: 10, Y: 20, Z: 30}, sprite);
    t.same([sprite.x, sprite.y], [1, 2], '3D blocks do nothing on 2D sprites');
    t.equal(call('motion3d_zposition', {}, sprite), 0);
    t.end();
});

test('compiled scripts follow the table too', async t => {
    const {vm, box} = await makeVM();
    addScript(box, [
        {opcode: 'motion_setx', inputs: {X: 5}},
        {opcode: 'motion_changeyby', inputs: {DY: 2}},
        {opcode: 'motion_turnright', inputs: {DEGREES: 15}},
        {opcode: 'motion_movesteps', inputs: {STEPS: 100}},
        {opcode: 'looks_setsizeto', inputs: {SIZE: 200}},
        {opcode: 'looks_changeeffectby', inputs: {CHANGE: 25}, fields: {EFFECT: 'COLOR'}}
    ]);
    run(vm);
    const compiled = Object.values(box.blocks._cache.compiledScripts);
    t.ok(compiled.length > 0 && compiled.every(script => script.success), 'ran through the compiler');
    t.same([box.x, box.y, box.z], [5, 2, 0], 'set x and change y work on the 3D x and y');
    t.equal(box.direction, 90, 'turning does nothing');
    t.same([box.scaleX, box.scaleY, box.scaleZ], [2, 2, 2], 'size is the scale');
    t.end();
});

test('2D blocks pointing at a 3D sprite use where it is drawn', async t => {
    const {vm, sprite, box} = await makeVM();
    const call = (opcode, args, target) => vm.runtime.getOpcodeFunction(opcode)(args, {target});

    box.setXYZ(1, 0, 0);
    const drawn = vm.runtime.scene3D.projectTarget(box);
    t.ok(drawn.x > 0, 'right of the center');
    t.equal(round(drawn.y), 0);

    call('motion_goto', {TO: 'Box'}, sprite);
    t.same([round(sprite.x), round(sprite.y)], [round(drawn.x), 0], 'go to');
    t.equal(round(call('sensing_distanceto', {DISTANCETOMENU: 'Box'}, sprite)), 0, 'distance to');

    sprite.setXY(0, 0);
    call('motion_pointtowards', {TOWARDS: 'Box'}, sprite);
    t.equal(sprite.direction, 90, 'points to the right');
    t.equal(call('sensing_touchingobject', {TOUCHINGOBJECTMENU: 'Box'}, sprite), false, 'never touching 3D');
    t.end();
});

test('3D blocks pointing at a 2D sprite get nothing', async t => {
    const {vm, box} = await makeVM();
    const call = (opcode, args) => vm.runtime.getOpcodeFunction(opcode)(args, {target: box});

    box.setXYZ(1, 2, 3);
    call('motion_goto', {TO: 'Sprite1'});
    t.same([box.x, box.y, box.z], [1, 2, 3], 'go to');
    call('motion3d_facesprite', {TARGET: 'Sprite1'});
    t.same([box.rotationX, box.rotationY], [0, 0], 'face');
    t.equal(call('sensing3d_distanceto', {TARGET: 'Sprite1'}), 10000);
    t.equal(call('sensing_distanceto', {DISTANCETOMENU: 'Sprite1'}), 10000);
    // Touching waits for Rapier the first time
    t.equal(await call('sensing3d_touching', {TARGET: 'Sprite1'}), false);
    t.equal(await call('sensing_touchingobject', {TOUCHINGOBJECTMENU: 'Sprite1'}), false);
    t.end();
});

test('3D sprites touching and distance between each other', async t => {
    const {vm, box, other} = await makeVM();
    const call = (opcode, args) => vm.runtime.getOpcodeFunction(opcode)(args, {target: box});
    other.setXYZ(3, 4, 0);
    t.equal(call('sensing_distanceto', {DISTANCETOMENU: 'Other'}), 5);
    t.equal(call('sensing3d_distanceto', {TARGET: 'Other'}), 5);
    t.end();
});

test('[property] of [sprite] for 3D sprites', async t => {
    const {vm, sprite, box} = await makeVM();
    box.setXYZ(1, 2, 3);
    box.setRotation(10, 20, 30);
    box.setScale(2, 2, 2);
    box.setModel(1);
    box.setMaterial({opacity: 0.5});
    const of = property => vm.runtime.getOpcodeFunction('sensing_of')({OBJECT: 'Box', PROPERTY: property},
        {target: sprite});
    t.same(
        ['x position', 'y position', 'z position', 'pitch', 'yaw', 'roll', 'model #', 'model name', 'scale', 'opacity']
            .map(of),
        [1, 2, 3, 10, 20, 30, 2, 'ball', 2, 50]
    );
    t.equal(of('costume name'), 0, 'no 2D properties');
    t.same(vm.getSpriteAttributes('3d'), BlockSupport.ATTRIBUTES_3D);

    // The compiler knows them too
    const variable = sprite.lookupOrCreateVariable('v', 'v');
    addScript(sprite, [{
        opcode: 'data_setvariableto',
        fields: {VARIABLE: {value: 'v', id: 'v'}},
        inputs: {VALUE: {
            opcode: 'sensing_of',
            fields: {PROPERTY: 'z position'},
            inputs: {OBJECT: menu('sensing_of_object_menu', 'OBJECT', 'Box')}
        }}
    }]);
    run(vm);
    t.equal(variable.value, 3, 'compiled z position of');
    t.end();
});

test('3D sprites go to and glide to random, the mouse and sprites', async t => {
    const {vm, box, other} = await makeVM();
    const call = (opcode, args) => vm.runtime.getOpcodeFunction(opcode)(args, {target: box, stackFrame: {}});
    // Looking down at the origin, so that the middle of the stage is on the ground
    vm.runtime.scene3D.setCameraState({x: 0, y: 5, z: 5, yaw: 0, pitch: -45});

    call('motion_goto', {TO: '_mouse_'});
    t.same([box.x, box.y, box.z].map(round), [0, 0, 0], 'the mouse points at the origin');

    call('motion_goto', {TO: '_random_'});
    t.equal(round(box.y), 0, 'random positions are on the ground');

    other.setXYZ(4, 5, 6);
    call('motion_glideto', {SECS: 0, TO: 'Other'});
    t.same([box.x, box.y, box.z], [4, 5, 6], 'glide to a sprite');
    call('motion3d_glidexyz', {SECS: 0, X: 1, Y: 2, Z: 3});
    t.same([box.x, box.y, box.z], [1, 2, 3], 'glide to x y z');

    call('motion_pointtowards', {TOWARDS: 'Other'});
    t.ok(box.rotationY !== 0 || box.rotationX !== 0, 'point towards a 3D sprite');
    t.end();
});

test('speech bubbles sit on top of where the 3D sprite is drawn', async t => {
    const {box} = await makeVM();
    box.setXYZ(0, 1, 0);
    const bounds = box.getBoundsForBubble();
    const center = box.getStagePosition();
    t.equal(bounds.bottom, bounds.top, 'the top edge');
    t.ok(bounds.top >= center.y);
    t.end();
});

test('HUD blocks: screen position and on screen', async t => {
    const {vm, sprite, box} = await makeVM();
    const call = (opcode, args) => vm.runtime.getOpcodeFunction(opcode)(args, {target: sprite});
    t.equal(call('sensing3d_screenposition', {SPRITE: 'Box', AXIS: 'x'}), 0);
    t.equal(call('sensing3d_onscreen', {SPRITE: 'Box'}), true);
    box.setXYZ(0, 1, 0);
    t.ok(call('sensing3d_screenposition', {SPRITE: 'Box', AXIS: 'y'}) > 0, 'up is up');
    box.setXYZ(0, 0, 10);
    t.equal(call('sensing3d_onscreen', {SPRITE: 'Box'}), false, 'behind the camera');
    t.equal(call('sensing3d_onscreen', {SPRITE: 'Sprite1'}), false, 'not a 3D sprite');
    t.equal(call('sensing3d_screenposition', {SPRITE: 'Sprite1', AXIS: 'x'}), 0);
    t.end();
});

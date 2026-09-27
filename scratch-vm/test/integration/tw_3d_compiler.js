// The compiler's fast paths for 3D blocks, and one update of the 3D scene per frame (ROADMAP.md, stage 5).
const {test} = require('tap');
require('../fixtures/tw_mock_blob');
const fs = require('fs');
const pathUtil = require('path');
const VirtualMachine = require('../../src/virtual-machine');
const JSGenerator = require('../../src/compiler/jsgen');
const makeTestStorage = require('../fixtures/make-test-storage');
const {addScript, menu, run} = require('../fixtures/tw-3d-scripts');

const sb3Fixture = fs.readFileSync(pathUtil.join(__dirname, '..', 'fixtures', 'tw-save-project-sb3.sb3'));

const makeVM = async () => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());
    await vm.loadProject(sb3Fixture);
    await vm.addSprite3D({name: 'Box', models: [{name: 'cube', shape: 'cube'}]});
    const box = vm.runtime.targets.find(t => t.getName() === 'Box');
    return {vm, box};
};

/**
 * @param {function(): void} fn compiles scripts
 * @returns {string[]} JS of every script compiled meanwhile
 */
const captureCompiledJS = fn => {
    const sources = [];
    JSGenerator.testingApparatus = {
        report: (generator, source) => sources.push(source)
    };
    try {
        fn();
    } finally {
        JSGenerator.testingApparatus = null;
    }
    return sources;
};

const round = n => Math.round(n * 1e6) / 1e6;

const moves = [
    {opcode: 'motion3d_gotoxyz', inputs: {X: 1, Y: 2, Z: 3}},
    {opcode: 'motion3d_changeaxis', fields: {AXIS: 'z'}, inputs: {VALUE: 0.1}},
    {opcode: 'motion3d_changeaxis', fields: {AXIS: 'z'}, inputs: {VALUE: 0.2}},
    {opcode: 'motion3d_setaxis', fields: {AXIS: 'x'}, inputs: {VALUE: 5}},
    {opcode: 'motion3d_setangle', fields: {ANGLE: 'yaw'}, inputs: {DEGREES: 90}},
    {opcode: 'motion3d_turn', fields: {ANGLE: 'pitch'}, inputs: {DEGREES: 10}},
    {opcode: 'motion3d_turn', fields: {ANGLE: 'yaw'}, inputs: {DEGREES: 100}},
    {opcode: 'motion3d_moveforward', inputs: {STEPS: 2}},
    {opcode: 'motion3d_movelevel',
        inputs: {
            DIRECTION: menu('motion3d_menu_direction', 'direction', 'left'),
            STEPS: 1
        }},
    {opcode: 'looks3d_setscale', inputs: {SCALE: 2}},
    {opcode: 'looks3d_setscalexyz', inputs: {X: 1, Y: 'banana', Z: 3}}
];

const state = target => [target.x, target.y, target.z, target.rotationX, target.rotationY, target.rotationZ,
    target.scaleX, target.scaleY, target.scaleZ].map(round);

test('3D motion blocks compile to direct calls, and do what the extension does', async t => {
    const compiled = await makeVM();
    addScript(compiled.box, moves);
    const sources = captureCompiledJS(() => run(compiled.vm));
    const js = sources.join('\n');
    t.match(js, /target\.setXYZ\(/, 'go to x y z');
    t.match(js, /target\.setRotation\(/, 'turn');
    t.match(js, /target\.moveForward\(/, 'move forward');
    t.match(js, /target\.moveLevel\(/, 'move level');
    t.match(js, /target\.setScale\(/, 'scale');
    t.notMatch(js, /executeInCompatibilityLayer/, 'no extension calls');

    const interpreted = await makeVM();
    interpreted.vm.setCompilerOptions({enabled: false});
    addScript(interpreted.box, moves);
    run(interpreted.vm);

    t.same(state(compiled.box), state(interpreted.box), 'same result as the interpreter');
    t.equal(compiled.box.scaleY, 0, 'invalid numbers are 0, like everywhere else');
    t.end();
});

test('3D reporters compile to fields, with the same rounding', async t => {
    const {vm, box} = await makeVM();
    const variable = box.lookupOrCreateVariable('v', 'v');
    addScript(box, [
        {opcode: 'motion3d_setaxis', fields: {AXIS: 'z'}, inputs: {VALUE: 0.1}},
        {opcode: 'motion3d_changeaxis', fields: {AXIS: 'z'}, inputs: {VALUE: 0.2}},
        {
            opcode: 'data_setvariableto',
            fields: {VARIABLE: {value: 'v', id: 'v'}},
            inputs: {VALUE: {opcode: 'motion3d_zposition'}}
        }
    ]);
    const js = captureCompiledJS(() => run(vm)).join('\n');
    t.match(js, /limitPrecision3D\(target\.z\)/);
    t.equal(variable.value, 0.3, '0.1 + 0.2 is 0.3');
    t.end();
});

test('2D sprites still ignore 3D blocks when compiled', async t => {
    const {vm} = await makeVM();
    const sprite = vm.runtime.targets.find(target => target.getName() === 'Sprite1');
    sprite.setXY(1, 2);
    addScript(sprite, [{opcode: 'motion3d_gotoxyz', inputs: {X: 10, Y: 20, Z: 30}}]);
    const js = captureCompiledJS(() => run(vm)).join('\n');
    t.notMatch(js, /setXYZ/);
    t.same([sprite.x, sprite.y], [1, 2]);
    t.end();
});

test('camera sprites compile field of view blocks', async t => {
    const {vm} = await makeVM();
    await vm.addCamera({name: 'Cam'});
    const camera = vm.runtime.targets.find(target => target.getName() === 'Cam');
    addScript(camera, [
        {opcode: 'camera3d_setfov', inputs: {FOV: 50}},
        {opcode: 'camera3d_changefov', inputs: {FOV: 5}}
    ]);
    const js = captureCompiledJS(() => run(vm)).join('\n');
    t.match(js, /target\.setFov\(/);
    t.equal(camera.fov, 55);
    t.end();
});

test('the 3D object of a sprite is updated once per frame, however often it moves', async t => {
    const {vm, box} = await makeVM();
    const scene3D = vm.runtime.scene3D;
    // Stands in for the three.js object, which only exists with a renderer
    t.ok(scene3D.THREE, 'three.js is loaded');
    let updates = 0;
    const vector = () => ({set: () => {}});
    box.object3D = {position: vector(), rotation: vector(), scale: vector()};
    const original = scene3D.updateTargetTransform.bind(scene3D);
    scene3D.updateTargetTransform = target => {
        updates++;
        original(target);
    };

    for (let i = 0; i < 100; i++) box.setXYZ(i, 0, 0);
    box.setRotation(0, 45, 0);
    t.equal(updates, 0, 'nothing is updated while blocks run');
    t.ok(scene3D._dirtyTransforms.has(box));

    scene3D.flushTransforms();
    t.equal(updates, 1, 'one update before drawing');
    scene3D.flushTransforms();
    t.equal(updates, 1, 'and none when nothing changed');

    box.setXYZ(1, 2, 3);
    box.object3D = null;
    vm.runtime.disposeTarget(box);
    t.notOk(scene3D._dirtyTransforms.has(box), 'deleted sprites are forgotten');
    t.end();
});

const {test} = require('tap');
require('../fixtures/tw_mock_blob');
const fs = require('fs');
const pathUtil = require('path');
const VirtualMachine = require('../../src/virtual-machine');
const makeTestStorage = require('../fixtures/make-test-storage');

const sb3Fixture = fs.readFileSync(pathUtil.join(__dirname, '..', 'fixtures', 'tw-save-project-sb3.sb3'));

const makeVM = async () => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());
    await vm.loadProject(sb3Fixture);
    await vm.addSprite3D({
        name: 'Box',
        models: [{name: 'cube', shape: 'cube'}, {name: 'ball', shape: 'sphere'}, {name: 'cone', shape: 'cone'}]
    });
    const target = vm.runtime.targets.find(t => t.getName() === 'Box');
    vm.setEditingTarget(target.id);
    return {vm, target};
};

const names = target => target.getModels().map(model => model.name);

const round = n => Math.round(n * 1e6) / 1e6;

test('model list: add, rename, duplicate, reorder, delete and restore', async t => {
    const {vm, target} = await makeVM();
    vm.postSpriteInfo({currentModel: 1});
    t.equal(target.getCurrentModel().name, 'ball');

    t.equal(vm.addModel3D({name: 'cube', shape: 'torus'}), 3, 'added at the end');
    t.same(names(target), ['cube', 'ball', 'cone', 'cube2'], 'names stay unique');

    vm.renameModel3D(3, 'ball');
    t.same(names(target), ['cube', 'ball', 'cone', 'ball2']);

    t.equal(vm.duplicateModel3D(0), 1, 'copy goes after the original');
    t.same(names(target), ['cube', 'cube2', 'ball', 'cone', 'ball2']);
    t.equal(target.getCurrentModel().name, 'ball', 'still shows the same model');

    t.ok(vm.reorderModel3D(target.id, 2, 0));
    t.same(names(target), ['ball', 'cube', 'cube2', 'cone', 'ball2']);
    t.equal(target.currentModel, 0, 'current model follows the move');

    const restore = vm.deleteModel3D(0);
    t.type(restore, 'function');
    t.same(names(target), ['cube', 'cube2', 'cone', 'ball2']);
    t.equal(target.currentModel, 0, 'shows the model before the deleted one');
    restore();
    t.same(names(target), ['ball', 'cube', 'cube2', 'cone', 'ball2'], 'restored in place');

    vm.setModelSource3D(1, {file: 'car.glb'});
    t.same(target.getModels()[1], {name: 'cube', file: 'car.glb'}, 'source changes, name stays');

    for (let i = 0; i < 4; i++) vm.deleteModel3D(0);
    t.equal(target.getModels().length, 1);
    t.equal(vm.deleteModel3D(0), null, 'the last model is kept');
    t.end();
});

test('clones keep their models when the list changes', async t => {
    const {vm, target} = await makeVM();
    target.setModel(2);
    const clone = target.makeClone();
    clone.setModel(1);
    target.reorderModel(1, 2);
    t.equal(target.getCurrentModel().name, 'cone');
    t.equal(clone.getCurrentModel().name, 'ball');
    vm.runtime.disposeTarget(clone);
    t.end();
});

test('3D motion blocks', async t => {
    const {vm, target} = await makeVM();
    const call = (opcode, args) => vm.runtime.getOpcodeFunction(opcode)(args, {target});

    call('motion3d_gotoxyz', {X: 1, Y: 2, Z: 3});
    t.same([target.x, target.y, target.z], [1, 2, 3]);
    call('motion3d_changeaxis', {AXIS: 'z', VALUE: -1});
    call('motion3d_setaxis', {AXIS: 'x', VALUE: 0});
    t.same([target.x, target.y, target.z], [0, 2, 2]);

    call('motion3d_moveforward', {STEPS: 1});
    t.same([target.x, target.y, target.z].map(round), [0, 2, 1], 'yaw 0 faces -z');
    call('motion3d_setangle', {ANGLE: 'yaw', DEGREES: 90});
    call('motion3d_moveforward', {STEPS: 2});
    t.same([target.x, target.y, target.z].map(round), [-2, 2, 1], 'positive yaw turns left: yaw 90 faces -x');
    call('motion3d_turn', {ANGLE: 'pitch', DEGREES: 90});
    call('motion3d_moveforward', {STEPS: 1});
    t.same([target.x, target.y, target.z].map(round), [-2, 3, 1], 'positive pitch looks up');

    call('motion3d_facexyz', {X: -2, Y: 3, Z: -5});
    t.same([target.rotationX, target.rotationY].map(round), [0, 0], 'faces -z');
    call('motion3d_facexyz', {X: -2, Y: 3, Z: 5});
    t.same([target.rotationX, target.rotationY].map(round), [0, 180], 'faces +z');
    call('motion3d_facexyz', {X: -2, Y: 4, Z: 0});
    t.same([target.rotationX, target.rotationY].map(round), [45, 0], 'looks up');
    t.equal(call('motion3d_pitch', {}), 45);
    t.equal(call('motion3d_xposition', {}), -2);
    t.end();
});

test('3D looks and sensing blocks', async t => {
    const {vm, target} = await makeVM();
    const call = (opcode, args, on = target) => vm.runtime.getOpcodeFunction(opcode)(args, {target: on});

    call('looks3d_switchmodelto', {MODEL: 'cone'});
    t.equal(call('looks3d_model', {NUMBER_NAME: 'name'}), 'cone');
    call('looks3d_switchmodelto', {MODEL: 1});
    t.equal(call('looks3d_model', {NUMBER_NAME: 'number'}), 1);
    call('looks3d_nextmodel', {});
    t.equal(target.getCurrentModel().name, 'ball');

    call('looks3d_setcolor', {COLOR: '#00ff00'});
    call('looks3d_setopacity', {OPACITY: 150});
    call('looks3d_changeopacity', {OPACITY: -25});
    t.same(target.material, {color: '#00ff00', opacity: 0.75, texture: ''});
    t.equal(call('looks3d_opacity', {}), 75);

    call('looks3d_setscalexyz', {X: 1, Y: 2, Z: 3});
    call('looks3d_changescale', {SCALE: 2});
    t.same([target.scaleX, target.scaleY, target.scaleZ], [2, 4, 6]);
    t.equal(call('looks3d_scale', {}), 4);

    await vm.addSprite3D({name: 'Other', position: {x: 3, y: 4, z: 0}});
    t.equal(call('sensing3d_distanceto', {TARGET: 'Other'}), 5);
    t.equal(call('sensing3d_distanceto', {TARGET: 'nobody'}), 10000);
    t.end();
});

test('the editor camera comes back once the green flag scripts finish, not only on stop', async t => {
    const {vm, target} = await makeVM();
    const editor = vm.runtime.scene3D.editor;
    const addFlagScript = next => {
        target.blocks.createBlock({
            id: 'hat',
            opcode: 'event_whenflagclicked',
            topLevel: true,
            next: next ? 'next' : null,
            parent: null,
            inputs: {},
            fields: {},
            shadow: false
        });
        if (next) {
            target.blocks.createBlock({
                id: 'next',
                opcode: next,
                topLevel: false,
                next: null,
                parent: 'hat',
                inputs: {},
                fields: {},
                shadow: false
            });
        }
    };

    vm.greenFlag();
    t.equal(editor.useEditorCamera, false, 'the green flag shows the game camera');
    vm.runtime._step();
    t.equal(editor.useEditorCamera, true, 'no scripts: back right away');

    addFlagScript('control_forever');
    vm.greenFlag();
    vm.runtime._step();
    vm.runtime._step();
    t.equal(editor.useEditorCamera, false, 'stays on the game camera while scripts run');
    vm.stopAll();
    t.equal(editor.useEditorCamera, true, 'stop sign');

    editor.setUseEditorCamera(false);
    vm.runtime._step();
    t.equal(editor.useEditorCamera, false, 'looking through the camera by hand stays');
    t.end();
});

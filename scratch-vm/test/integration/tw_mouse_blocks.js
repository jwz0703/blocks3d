// The mouse blocks (twmouse, ROADMAP.md 9 輸入與點擊): the wheel, taps, sprites that clicks go through, what the
// mouse points at and the cursor.
const {test} = require('tap');
require('../fixtures/tw_mock_blob');
const fs = require('fs');
const pathUtil = require('path');
const JSZip = require('@turbowarp/jszip');
const VirtualMachine = require('../../src/virtual-machine');
const MouseWheel = require('../../src/io/mouseWheel');
const makeTestStorage = require('../fixtures/make-test-storage');
const {addScript} = require('../fixtures/tw-3d-scripts');

const sb3Fixture = fs.readFileSync(pathUtil.join(__dirname, '..', 'fixtures', 'tw-save-project-sb3.sb3'));

// The 3D sprites "Box" at the origin and "Other" in front of it; the camera is at (0, 0, 5), looking at the origin
const makeVM = async () => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());
    await vm.loadProject(sb3Fixture);
    await vm.addSprite3D({name: 'Box', models: [{name: 'cube', shape: 'cube'}]});
    await vm.addSprite3D({name: 'Other', models: [{name: 'cube', shape: 'cube'}]});
    const find = name => vm.runtime.targets.find(t => t.getName() === name);
    const box = find('Box');
    const other = find('Other');
    box.setXYZ(0, 0, 0);
    other.setXYZ(0, 0, 2);
    await vm.runtime.scene3D.physics.load();
    return {vm, box, other, stage: vm.runtime.getTargetForStage()};
};

const call = (vm, opcode, args, target) =>
    vm.runtime.getOpcodeFunction(opcode)(args, {target, stackFrame: {}, yield: () => {}});

// A counter variable on the target, and a script that adds 1 to it
const countWith = (target, name, hat) => {
    const variable = target.lookupOrCreateVariable(name, name);
    variable.value = 0;
    addScript(target, [{
        opcode: 'data_changevariableby',
        fields: {VARIABLE: {value: name, id: name}},
        inputs: {VALUE: 1}
    }], hat);
    return variable;
};

const step = (vm, frames = 2) => {
    for (let i = 0; i < frames; i++) vm.runtime._step();
};

const at = (x, y, more) => Object.assign({x, y, canvasWidth: 480, canvasHeight: 360}, more);

test('the wheel starts its hats and reports how far it turned in the last frame', async t => {
    const {vm, stage} = await makeVM();
    const up = countWith(stage, 'up', {opcode: 'twmouse_whenwheel', fields: {DIRECTION: 'UP'}});
    const down = countWith(stage, 'down', {opcode: 'twmouse_whenwheel', fields: {DIRECTION: 'DOWN'}});
    const any = countWith(stage, 'any', {opcode: 'twmouse_whenwheel', fields: {DIRECTION: 'ANY'}});
    const wheel = vm.runtime.ioDevices.mouseWheel;
    wheel.postData({deltaX: 0, deltaY: -100, deltaMode: 0});
    step(vm, 1);
    t.same([up.value, down.value, any.value], [1, 0, 1]);
    t.equal(call(vm, 'twmouse_wheel', {}, stage), 1, 'one notch up');
    step(vm, 1);
    t.equal(call(vm, 'twmouse_wheel', {}, stage), 0, 'only for the frame after it turned');

    wheel.postData({deltaX: 0, deltaY: 3, deltaMode: 1});
    wheel.postData({deltaX: 0, deltaY: 3, deltaMode: 1});
    step(vm, 1);
    t.equal(call(vm, 'twmouse_wheel', {}, stage), -2, 'lines, added up over the frame');
    t.same([up.value, down.value], [1, 1], 'the hat doesn\'t start again while it runs');

    t.equal(MouseWheel.notches({deltaY: 5, ctrlKey: true}), -0.5, 'pinching in is down, and made bigger');
    t.end();
});

test('the wheel zooms the editor camera, not the game', async t => {
    const {vm, stage} = await makeVM();
    const any = countWith(stage, 'any', {opcode: 'twmouse_whenwheel', fields: {DIRECTION: 'ANY'}});
    Object.defineProperty(vm.runtime.scene3D.editor, 'active', {value: true});
    vm.runtime.ioDevices.mouseWheel.postData({deltaX: 0, deltaY: -100});
    step(vm, 1);
    t.equal(any.value, 0);
    t.equal(call(vm, 'twmouse_wheel', {}, stage), 0);
    t.end();
});

test('a short press is a tap; dragging the view is not', async t => {
    const {vm, box, other, stage} = await makeVM();
    other.setXYZ(5, 0, 0);
    const clicked = countWith(box, 'clicked', {opcode: 'event_whenthisspriteclicked'});
    const tapped = countWith(box, 'tapped', {opcode: 'twmouse_whentapped'});
    const stageTapped = countWith(stage, 'stage tapped', {opcode: 'twmouse_whenstagetapped'});
    const mouse = vm.runtime.ioDevices.mouse;
    mouse.postData(at(240, 180, {isDown: true}));
    step(vm);
    t.same([clicked.value, tapped.value], [1, 0], 'clicks start on the press, taps don\'t');
    mouse.postData(at(243, 182));
    mouse.postData(at(243, 182, {isDown: false}));
    step(vm);
    t.same([clicked.value, tapped.value], [1, 1], 'moving a little is still a tap');

    mouse.postData(at(240, 180, {isDown: true}));
    mouse.postData(at(300, 180));
    mouse.postData(at(240, 180));
    mouse.postData(at(240, 180, {isDown: false}));
    step(vm);
    t.same([clicked.value, tapped.value], [2, 1], 'dragging and coming back is not a tap');

    const now = Date.now;
    mouse.postData(at(240, 180, {isDown: true}));
    Date.now = () => now() + 1000;
    try {
        mouse.postData(at(240, 180, {isDown: false}));
    } finally {
        Date.now = now;
    }
    step(vm);
    t.equal(tapped.value, 1, 'holding down for long is not a tap');

    mouse.postData(at(240, 180, {isDown: true, button: 2}));
    mouse.postData(at(240, 180, {isDown: false, button: 2}));
    step(vm);
    t.equal(tapped.value, 1, 'only the left button taps');

    mouse.postData(at(10, 10, {isDown: true}));
    mouse.postData(at(10, 10, {isDown: false}));
    step(vm);
    t.same([tapped.value, stageTapped.value], [1, 1], 'nothing there: the stage is tapped');
    t.end();
});

test('clicks and the mouse go through sprites that can\'t be clicked', async t => {
    const {vm, box, other} = await makeVM();
    const clickedBox = countWith(box, 'box', {opcode: 'event_whenthisspriteclicked'});
    const clickedOther = countWith(other, 'other', {opcode: 'event_whenthisspriteclicked'});
    const mouse = vm.runtime.ioDevices.mouse;
    const click = () => {
        mouse.postData(at(240, 180, {isDown: true}));
        mouse.postData(at(240, 180, {isDown: false}));
        step(vm);
    };
    click();
    t.same([clickedBox.value, clickedOther.value], [0, 1], 'the sprite in front gets the click');
    call(vm, 'twmouse_setclickable', {CLICKABLE: 'off'}, other);
    t.equal(other.mouseMode, 'pass', 'the old block still works');
    click();
    t.same([clickedBox.value, clickedOther.value], [1, 1], 'now the one behind it does');
    t.equal(vm.runtime.scene3D.pickTarget(0, 0), box, 'and the hover hats see the one behind');

    const pointed = skip => call(vm, 'twmouse_pointed', {SKIP: skip}, box);
    t.same(pointed(''), {hit: true, sprite: 'Other', id: 0, distance: 2.5, x: 0, y: 0, z: 2.5},
        'the sprite under the mouse can be one that the mouse goes through');
    t.equal(pointed('_unclickable_').sprite, 'Box', 'unless those are skipped');
    t.equal(pointed('Other').sprite, 'Box', 'sprites can be skipped by name');
    t.equal(pointed(['Other', 'Box']).hit, false, 'or a list of names');
    t.equal(pointed('["Other"]').sprite, 'Box', 'also as JSON');

    const clone = box.makeClone();
    vm.runtime.addTarget(clone);
    clone.cloneId = 7;
    clone.setXYZ(0, 0, 3);
    t.same([pointed('Other').sprite, pointed('Other').id], ['Box', 7], 'clones report their id');
    t.equal(other.makeClone().mouseMode, 'pass', 'clones copy the setting');
    t.end();
});

test('the mouse mode is saved, set from the sprite info panel, and read from older projects', async t => {
    const {vm, box, other} = await makeVM();
    vm.setEditingTarget(other.id);
    vm.postSpriteInfo({mouseMode: 'pass'});
    t.equal(other.mouseMode, 'pass');
    t.equal(other.toJSON().mouseMode, 'pass', 'the GUI sees it');
    call(vm, 'twmouse_setmousemode', {MODE: 'block'}, box);
    call(vm, 'twmouse_setmousemode', {MODE: 'nonsense'}, box);
    t.equal(box.mouseMode, 'block');
    const saved = await vm.saveProject3dsb('arraybuffer');
    const load = async data => {
        const loaded = new VirtualMachine();
        loaded.attachStorage(makeTestStorage());
        await loaded.loadProject(data);
        return name => loaded.runtime.targets.find(target => target.getName() === name);
    };
    let find = await load(saved);
    t.same([find('Other').mouseMode, find('Box').mouseMode, find('Sprite1').mouseMode], ['pass', 'block', 'auto']);

    // "can be clicked: off" from before mouse modes
    const zip = await JSZip.loadAsync(saved);
    const json = JSON.parse(await zip.file('project.json').async('string'));
    for (const target of json.targets) {
        delete target.mouseMode;
        if (target.name === 'Other') target.clickable = false;
    }
    zip.file('project.json', JSON.stringify(json));
    find = await load(await zip.generateAsync({type: 'arraybuffer'}));
    t.same([find('Other').mouseMode, find('Box').mouseMode], ['pass', 'auto']);
    t.end();
});

test('with the mouse mode on auto, only 3D sprites that are clicked or solid stop the mouse', async t => {
    const {vm, box, other} = await makeVM();
    const sprite = vm.runtime.targets.find(target => target.getName() === 'Sprite1');
    t.equal(sprite.blocksMouse(), true, '2D sprites stop it, e.g. a HUD');
    t.equal(other.blocksMouse(), true, 'visible sprites that collide stop it, e.g. walls');
    const pick = () => vm.runtime.scene3D.pickTarget(0, 0);
    t.equal(pick(), other);

    call(vm, 'physics3d_setcollide', {ON: 'off'}, other);
    t.equal(other.blocksMouse(), false, 'decorations that don\'t collide let it through');
    t.equal(pick(), box, 'to what is behind them');
    t.equal(call(vm, 'twmouse_pointed', {SKIP: '_unclickable_'}, box).sprite, 'Box');

    const hat = addScript(other, [], {opcode: 'twmouse_whentapped'});
    t.equal(other.blocksMouse(), true, 'unless they have their own mouse scripts');
    t.equal(other.makeClone().blocksMouse(), true, 'and so do their clones');
    other.blocks.deleteBlock(hat);
    t.equal(other.blocksMouse(), false, 'the scripts are looked at again when they change');

    // (Without three.js, as here, picking uses the colliders, so a sprite that doesn't collide can't be picked)
    call(vm, 'twmouse_setmousemode', {MODE: 'block'}, other);
    t.equal(other.blocksMouse(), true, '"stop" stops it anyway');
    call(vm, 'physics3d_setcollide', {ON: 'on'}, other);
    call(vm, 'twmouse_setmousemode', {MODE: 'pass'}, other);
    t.equal(other.blocksMouse(), false, '"go through" lets it through anyway');
    t.equal(pick(), box);

    t.equal(vm.isMouseHatIgnored('event_whenthisspriteclicked', other), true, 'the editor fades its mouse hats');
    t.equal(vm.isMouseHatIgnored('event_whenflagclicked', other), false);
    t.equal(vm.isMouseHatIgnored('event_whenthisspriteclicked', sprite), false);
    t.end();
});

test('the cursor', async t => {
    const {vm, stage} = await makeVM();
    const seen = [];
    vm.runtime.on('CURSOR_CHANGED', cursor => seen.push(cursor));
    call(vm, 'twmouse_setcursor', {CURSOR: 'pointer'}, stage);
    call(vm, 'twmouse_setcursor', {CURSOR: 'pointer'}, stage);
    call(vm, 'twmouse_setcursor', {CURSOR: 'url(evil), auto'}, stage);
    t.equal(vm.runtime.cursor, 'pointer', 'only the cursors in the menu');
    vm.runtime.stopAll();
    t.equal(vm.runtime.cursor, 'default', 'back to the default when the project stops');
    t.same(seen, ['pointer', 'default']);
    t.end();
});

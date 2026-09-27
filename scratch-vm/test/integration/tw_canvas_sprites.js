// Canvas sprites and the pen drawing on them (ROADMAP.md, stage 4.8). Node has no Canvas2D, so the runtime gets a
// fake canvas that records what is drawn.
const {test} = require('tap');
require('../fixtures/tw_mock_blob');
const fs = require('fs');
const pathUtil = require('path');
const VirtualMachine = require('../../src/virtual-machine');
const CanvasTarget = require('../../src/sprites/canvas-target');
const makeTestStorage = require('../fixtures/make-test-storage');

const sb3Fixture = fs.readFileSync(pathUtil.join(__dirname, '..', 'fixtures', 'tw-save-project-sb3.sb3'));
const penFixture = fs.readFileSync(pathUtil.join(__dirname, '..', 'fixtures', 'pen.sb2'));

/**
 * @param {number} width canvas width in pixels
 * @param {number} height canvas height in pixels
 * @returns {object} a canvas whose 2D context records every call as [method, ...args]
 */
const makeFakeCanvas = (width, height) => {
    const calls = [];
    const context = {calls};
    for (const method of ['clearRect', 'beginPath', 'arc', 'fill', 'moveTo', 'lineTo', 'stroke', 'drawImage',
        'putImageData', 'fillRect']) {
        context[method] = (...args) => calls.push([method, ...args]);
    }
    return {
        width,
        height,
        getContext: type => (type === '2d' ? context : null)
    };
};

const makeVM = async (project = sb3Fixture) => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());
    vm.runtime.createCanvas2D = makeFakeCanvas;
    await vm.loadProject(project);
    return vm;
};

// What was drawn on a canvas sprite, by method
const drawn = (canvasTarget, method) => canvasTarget.canvas.getContext('2d').calls
    .filter(call => call[0] === method);

test('a canvas sprite covers the stage and is saved as a canvas sprite', async t => {
    const vm = await makeVM();
    const canvas = await vm.addCanvasSprite({name: 'Paper'});
    t.ok(canvas instanceof CanvasTarget);
    t.equal(canvas.kind, 'canvas');
    t.equal(vm.getTargetKind(canvas), '2d', 'blocks treat it as a 2D sprite');
    t.equal(vm.editingTarget, canvas, 'selected');
    t.same([canvas.canvas.width, canvas.canvas.height],
        [480 * CanvasTarget.RESOLUTION, 360 * CanvasTarget.RESOLUTION]);
    t.equal(canvas.getCostumes().length, 1, 'placeholder costume');

    const json = JSON.parse(vm.toJSON());
    const saved = json.targets.find(target => target.name === 'Paper');
    t.equal(saved.kind, 'canvas');
    t.notOk(saved.costumes, 'no costumes saved');

    const vm2 = await makeVM(await vm.saveProject3dsb('arraybuffer'));
    const loaded = vm2.runtime.getSpriteTargetByName('Paper');
    t.ok(loaded && loaded.isCanvas, 'loads as a canvas sprite');
    t.equal(loaded.getCostumes().length, 1);
    t.end();
});

test('Scratch projects that use the pen get a canvas behind every sprite', async t => {
    const vm = await makeVM(penFixture);
    const canvas = vm.runtime.canvasSprites.getDefault();
    t.ok(canvas, 'default canvas');
    t.equal(canvas.getName(), '畫筆');
    t.equal(vm.runtime.executableTargets[1], canvas, 'right above the stage, where the pen layer was');
    t.notEqual(vm.editingTarget, canvas, 'the project\'s sprite stays selected');

    const noPen = await makeVM();
    t.equal(noPen.runtime.canvasSprites.getDefault(), null, 'not for projects without the pen');

    const reloaded = await makeVM(await vm.saveProject3dsb('arraybuffer'));
    t.equal(reloaded.runtime.canvasSprites.getOriginals().length, 1, 'no second canvas when loading .3dsb');
    t.end();
});

test('pen blocks draw on the current canvas', async t => {
    const vm = await makeVM();
    vm.extensionManager.loadExtensionIdSync('pen');
    const first = await vm.addCanvasSprite({name: 'First'});
    const second = await vm.addCanvasSprite({name: 'Second'});
    const sprite = vm.runtime.getSpriteTargetByName('Sprite1');
    const call = (opcode, args = {}) => vm.runtime.getOpcodeFunction(opcode)(args, {target: sprite});

    sprite.setXY(0, 0);
    call('pen_penDown');
    t.same(drawn(first, 'arc')[0].slice(1, 3), [240 * CanvasTarget.RESOLUTION, 180 * CanvasTarget.RESOLUTION],
        'a dot at the center of the first canvas');
    sprite.setXY(10, 20);
    const line = drawn(first, 'lineTo')[0];
    t.same(line.slice(1), [250 * CanvasTarget.RESOLUTION, 160 * CanvasTarget.RESOLUTION], 'a line, y up');
    t.equal(drawn(second, 'lineTo').length, 0);

    call('pen_setCanvas', {CANVAS: 'Second'});
    sprite.setXY(0, 0);
    t.equal(drawn(second, 'lineTo').length, 1, 'now on the second canvas');
    call('pen_clear');
    t.equal(drawn(second, 'clearRect').length, 1, 'erase all clears the current canvas');
    t.equal(drawn(first, 'clearRect').length, 0);
    call('pen_penUp');
    sprite.setXY(50, 50);
    t.equal(drawn(second, 'lineTo').length, 1, 'no line with the pen up');
    t.end();
});

test('canvases are uploaded only in frames where they were drawn on', async t => {
    const vm = await makeVM();
    const canvas = await vm.addCanvasSprite();
    const uploads = [];
    vm.runtime.on('CANVAS_SPRITE_DRAWN', target => uploads.push(target));

    vm.runtime._step();
    t.equal(uploads.length, 0, 'nothing drawn');

    // Libraries get the context from the canvas and draw with it
    const context = canvas.getCanvas().getContext('2d');
    context.fillStyle = 'red';
    context.fillRect(0, 0, 10, 10);
    t.equal(canvas.getContext(), context, 'the same context either way');
    vm.runtime._step();
    t.same(uploads, [canvas], 'uploaded once');
    vm.runtime._step();
    t.equal(uploads.length, 1, 'not again');
    t.end();
});

test('clones start with a copy of the drawing', async t => {
    const vm = await makeVM();
    const canvas = await vm.addCanvasSprite();
    const clone = canvas.makeClone();
    t.ok(clone.isCanvas);
    t.notEqual(clone.canvas, canvas.canvas, 'its own canvas');
    t.equal(drawn(clone, 'drawImage')[0][1], canvas.canvas);
    t.end();
});

test('3D sprites don\'t draw with the pen, and materials can use a canvas', async t => {
    const vm = await makeVM();
    vm.extensionManager.loadExtensionIdSync('pen');
    const canvas = await vm.addCanvasSprite({name: 'Paper'});
    await vm.addSprite3D({name: 'Box', material: {texture: 'canvas:Paper'}});
    const box = vm.runtime.getSpriteTargetByName('Box');
    vm.runtime.getOpcodeFunction('pen_penDown')({}, {target: box});
    box.setXYZ(5, 5, 5);
    t.equal(drawn(canvas, 'arc').length + drawn(canvas, 'lineTo').length, 0, 'nothing drawn');
    t.equal(box.material.texture, 'canvas:Paper', 'the texture is the canvas sprite');
    t.end();
});

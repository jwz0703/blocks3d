const {test} = require('tap');
require('../fixtures/tw_mock_blob'); // must load Blob before VM so JSZip thinks Blob is supported
const fs = require('fs');
const pathUtil = require('path');
const JSZip = require('@turbowarp/jszip');
const VirtualMachine = require('../../src/virtual-machine');
const makeTestStorage = require('../fixtures/make-test-storage');
const Screen = require('../../src/engine/screen');

// How the stage fits the screen (ROADMAP.md 7.5)

const sb3Fixture = fs.readFileSync(pathUtil.join(__dirname, '..', 'fixtures', 'tw-save-project-sb3.sb3'));

const makeVM = () => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());
    return vm;
};

const stageSize = vm => [vm.runtime.stageWidth, vm.runtime.stageHeight];

test('stage size of each mode', t => {
    const settings = mode => Screen.normalize({mode, width: 1280, height: 720});
    t.same(Screen.computeStageSize(settings('fixed'), 4 / 3), {width: 1280, height: 720}, 'fixed ignores the screen');
    t.same(Screen.computeStageSize(settings('height'), 4 / 3), {width: 960, height: 720}, 'height stays');
    t.same(Screen.computeStageSize(settings('height'), 21 / 9), {width: 1680, height: 720});
    t.same(Screen.computeStageSize(settings('width'), 9 / 16), {width: 1280, height: 2276}, 'width stays');
    t.same(Screen.computeStageSize(settings('expand'), 21 / 9), {width: 1680, height: 720},
        'expand: wider screen, wider stage');
    t.same(Screen.computeStageSize(settings('expand'), 4 / 3), {width: 1280, height: 960},
        'expand: taller screen, taller stage');
    t.same(Screen.computeStageSize(settings('height'), null), {width: 1280, height: 720},
        'the reference size without a screen');
    t.end();
});

test('settings are checked', t => {
    t.same(Screen.normalize({mode: 'nope', width: -5, height: 'x', renderScale: 5}), {
        mode: 'fixed',
        width: 1,
        height: 360,
        renderScale: 1,
        shadows: 'high'
    });
    t.same(Screen.normalize(null), Screen.defaultSettings());
    t.equal(Screen.normalize({shadows: 'low'}).shadows, 'low', 'shadow quality (ROADMAP.md 7.1)');
    t.equal(Screen.normalize({shadows: 'ultra'}).shadows, 'high');
    t.equal(Screen.getUIScale(Screen.normalize({width: 1280, height: 720})), 2, 'bubbles and monitors 2x at 720');
    t.equal(Screen.getUIScale(Screen.defaultSettings()), 1);
    t.end();
});

test('the runtime follows the shape of the screen', t => {
    const vm = makeVM();
    const sizes = [];
    vm.on('STAGE_SIZE_CHANGED', (width, height) => sizes.push([width, height]));
    t.same(stageSize(vm), [480, 360], 'Scratch stage at first');
    vm.setViewportAspect(16 / 9);
    t.same(stageSize(vm), [480, 360], 'fixed mode keeps it');
    vm.setScreenSettings({mode: 'height', width: 1280, height: 720});
    t.same(stageSize(vm), [1280, 720]);
    vm.setViewportAspect(4 / 3);
    t.same(stageSize(vm), [960, 720]);
    t.same(sizes, [[1280, 720], [960, 720]]);
    t.equal(vm.runtime.getOpcodeFunction('screen_size')({SIDE: 'width'}), 960, 'screen width block');
    t.equal(vm.runtime.getOpcodeFunction('screen_size')({SIDE: 'height'}), 720, 'screen height block');
    t.end();
});

test('.3dsb saves the screen settings, .sb3 keeps the Scratch stage', async t => {
    const vm = makeVM();
    await vm.loadProject(sb3Fixture);
    vm.setViewportAspect(16 / 9);
    t.same(vm.runtime.getScreenSettings(), Screen.defaultSettings(), '.sb3 is fixed 480x360');
    vm.setScreenSettings({mode: 'height', width: 1280, height: 720, renderScale: 0.5});
    t.same(stageSize(vm), [1280, 720]);

    const buffer = await vm.saveProject3dsb('arraybuffer');
    const zip = await JSZip.loadAsync(buffer);
    const json = JSON.parse(await zip.file('project.json').async('string'));
    const stage = json.targets.find(target => target.isStage);
    t.same(stage.screen, {mode: 'height', width: 1280, height: 720, renderScale: 0.5, shadows: 'high'});

    const vm2 = makeVM();
    vm2.setViewportAspect(4 / 3);
    await vm2.loadProject(buffer);
    t.same(vm2.runtime.getScreenSettings(), stage.screen, 'loaded');
    t.same(stageSize(vm2), [960, 720], 'and fits the screen');

    await vm2.loadProject(sb3Fixture);
    t.same(stageSize(vm2), [480, 360], 'the next .sb3 is 480x360 again');

    delete stage.screen;
    zip.file('project.json', JSON.stringify(json));
    await vm2.loadProject(await zip.generateAsync({type: 'arraybuffer'}));
    t.same(vm2.runtime.getScreenSettings(), Screen.defaultSettings(), 'older .3dsb without screen settings');
    t.end();
});

test('"when the screen size changes" runs when the stage size changes', async t => {
    const vm = makeVM();
    await vm.loadProject(sb3Fixture);
    const stage = vm.runtime.getTargetForStage();
    stage.blocks.createBlock({
        id: 'resized',
        opcode: 'screen_whenresized',
        topLevel: true,
        parent: null,
        next: null,
        inputs: {},
        fields: {},
        shadow: false
    });
    const started = () => vm.runtime.threads.filter(thread => thread.topBlock === 'resized').length;
    vm.setViewportAspect(16 / 9);
    t.equal(started(), 0, 'fixed stage: no change');
    vm.setScreenSettings({mode: 'height', width: 1280, height: 720});
    t.equal(started(), 1);
    vm.runtime.threads = [];
    vm.setViewportAspect(16 / 9);
    t.equal(started(), 0, 'same shape: no change');
    vm.setViewportAspect(1);
    t.equal(started(), 1);
    t.end();
});

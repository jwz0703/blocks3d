const {test} = require('tap');
require('../fixtures/tw_mock_blob'); // must load Blob before VM so JSZip thinks Blob is supported
const fs = require('fs');
const pathUtil = require('path');
const VirtualMachine = require('../../src/virtual-machine');
const makeTestStorage = require('../fixtures/make-test-storage');

// Projects run at 60 FPS unless they store another framerate (ROADMAP.md 7.5)

const sb3Fixture = fs.readFileSync(pathUtil.join(__dirname, '..', 'fixtures', 'tw-save-project-sb3.sb3'));

const makeVM = () => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());
    return vm;
};

test('60 FPS by default, and for projects that store no framerate', async t => {
    const vm = makeVM();
    t.equal(vm.runtime.frameLoop.framerate, 60);
    vm.setFramerate(30);
    await vm.loadProject(sb3Fixture);
    t.equal(vm.runtime.frameLoop.framerate, 60, 'not left over from the last project');
    t.end();
});

test('another framerate is saved with the project', async t => {
    const vm = makeVM();
    await vm.loadProject(sb3Fixture);
    vm.setFramerate(30);
    vm.storeProjectOptions();
    const saved = await vm.saveProject3dsb('arraybuffer');

    const vm2 = makeVM();
    await vm2.loadProject(saved);
    t.equal(vm2.runtime.frameLoop.framerate, 30);
    t.end();
});

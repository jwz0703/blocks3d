const {test} = require('tap');
const JSZip = require('@turbowarp/jszip');
const path = require('path');
const VirtualMachine = require('../../src/virtual-machine');
const makeTestStorage = require('../fixtures/make-test-storage');
const {readFileToBuffer} = require('../fixtures/readProjectFile');

const emptyProject = readFileToBuffer(path.join(__dirname, '../fixtures/tw-empty-project.sb3'));

const makeVM = async () => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());
    await vm.loadProject(emptyProject);
    return vm;
};

const bytes = text => new TextEncoder().encode(text);

test('add, rename, delete', t => {
    const vm = new VirtualMachine();
    const files = vm.runtime.fileManager;
    let changes = 0;
    files.on('change', () => changes++);

    t.equal(files.addFile('model.glb', bytes('a')), 'model.glb');
    t.equal(files.addFile('MODEL.glb', bytes('b')), 'MODEL (2).glb');
    t.equal(files.addFile('a/b\\c.txt', bytes('c')), 'a_b_c.txt');
    t.equal(files.addFile('', bytes('d')), 'file');
    t.same(files.getFileNames(), ['model.glb', 'MODEL (2).glb', 'a_b_c.txt', 'file']);
    t.ok(files.hasFile('Model.GLB'));
    t.equal(files.getFile('model.glb').size, 1);

    t.equal(files.renameFile('file', 'model.glb'), 'model (3).glb');
    // Renaming to the same name in a different case is allowed
    t.equal(files.renameFile('model.glb', 'Model.glb'), 'Model.glb');
    t.equal(files.renameFile('missing', 'x'), null);

    t.ok(files.deleteFile('a_b_c.txt'));
    t.notOk(files.deleteFile('a_b_c.txt'));
    t.same(files.getFileNames(), ['Model.glb', 'MODEL (2).glb', 'model (3).glb']);
    t.ok(files.moveFile(2, 0));
    t.notOk(files.moveFile(0, 5));
    t.same(files.getFileNames(), ['model (3).glb', 'Model.glb', 'MODEL (2).glb']);
    t.equal(changes, 8);
    t.end();
});

test('md5ext follows the extension', t => {
    const vm = new VirtualMachine();
    const files = vm.runtime.fileManager;
    files.addFile('scene.gltf', bytes('{}'));
    files.addFile('noext', bytes('{}'));
    t.same(files.serializeJSON(), [
        {name: 'scene.gltf', md5ext: '99914b932bd37a50b983c5e7c90ae93b.gltf'},
        {name: 'noext', md5ext: '99914b932bd37a50b983c5e7c90ae93b.bin'}
    ]);
    files.renameFile('noext', 'data.JSON');
    t.equal(files.serializeJSON()[1].md5ext, '99914b932bd37a50b983c5e7c90ae93b.json');
    t.end();
});

test('sb3 round trip', async t => {
    const vm = await makeVM();
    vm.runtime.fileManager.addFile('hello.txt', bytes('hello'));
    vm.runtime.fileManager.addFile('model.glb', new Uint8Array([1, 2, 3]));

    const project = JSON.parse(vm.toJSON());
    t.same(project.customFiles.map(i => i.name), ['hello.txt', 'model.glb']);
    const assetNames = vm.serializeAssets().map(i => i.fileName);
    t.ok(assetNames.includes(project.customFiles[0].md5ext));
    t.ok(vm.assets.some(i => i.dataFormat === 'glb'));

    const sb3 = await vm.saveProjectSb3('arraybuffer');
    const zip = await JSZip.loadAsync(sb3);
    t.ok(zip.file(project.customFiles[1].md5ext));

    const vm2 = new VirtualMachine();
    vm2.attachStorage(makeTestStorage());
    await vm2.loadProject(sb3);
    t.same(vm2.runtime.fileManager.getFileNames(), ['hello.txt', 'model.glb']);
    t.equal(new TextDecoder().decode(vm2.runtime.fileManager.getFile('hello.txt').data), 'hello');
    t.same(Array.from(vm2.runtime.fileManager.getFile('model.glb').data), [1, 2, 3]);

    // Loading another project clears them
    await vm2.loadProject(emptyProject);
    t.same(vm2.runtime.fileManager.getFileNames(), []);
    t.end();
});

test('sprites never include project files', async t => {
    const vm = await makeVM();
    vm.runtime.fileManager.addFile('hello.txt', bytes('hello'));
    const targetId = vm.runtime.targets[0].id;
    const md5ext = vm.runtime.fileManager.serializeJSON()[0].md5ext;
    t.notOk(vm.serializeAssets(targetId).some(i => i.fileName === md5ext));
    t.notOk(JSON.parse(vm.toJSON(targetId)).customFiles);
    t.end();
});

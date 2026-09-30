/* eslint-disable object-property-newline */
const {test} = require('tap');
require('../fixtures/tw_mock_blob');
const fs = require('fs');
const pathUtil = require('path');
const JSZip = require('@turbowarp/jszip');
const VirtualMachine = require('../../src/virtual-machine');
const makeTestStorage = require('../fixtures/make-test-storage');
const FakeRenderer = require('../fixtures/fake-renderer');
const dataPath = require('../../src/util/data-path');

const sb3Fixture = fs.readFileSync(pathUtil.join(__dirname, '..', 'fixtures', 'tw-save-project-sb3.sb3'));

/**
 * @returns {FakeRenderer} a renderer that remembers where drawables are
 */
const makeRenderer = () => {
    const renderer = new FakeRenderer();
    let nextDrawable = 1;
    renderer.createDrawable = () => nextDrawable++;
    renderer.positions = {};
    renderer.updateDrawablePosition = (id, position) => {
        renderer.positions[id] = position.slice();
    };
    renderer.getCurrentSkinSize = () => [2, 2];
    renderer.destroyDrawable = () => {};
    renderer.destroySkin = () => {};
    renderer.draw = () => {};
    return renderer;
};

const assert = (value, message) => {
    if (!value) throw new Error(message);
};

// The runtime asks whether the page is hidden before it draws
global.document = {hidden: true};

const near = (t, actual, expected, message) => t.ok(Math.abs(actual - expected) < 1e-6,
    `${message}: ${actual} is ${expected}`);

/**
 * @returns {Promise<{vm: VirtualMachine, root: Target, card: Target, label: Target}>} a component "面板" with two
 * sprites in it, its one instance at (100, 50)
 */
const makeComponent = async () => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());
    const renderer = makeRenderer();
    vm.attachRenderer(renderer);
    await vm.loadProject(sb3Fixture);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2" viewBox="0 0 2 2"></svg>';
    const storage = vm.runtime.storage;
    const data = new TextEncoder().encode(svg);
    const asset = storage.createAsset(storage.AssetType.ImageVector, storage.DataFormat.SVG, data, null, true);
    const sprite = name => ({
        isStage: false,
        name,
        variables: {},
        lists: {},
        broadcasts: {},
        blocks: {},
        comments: {},
        currentCostume: 0,
        sounds: [],
        volume: 100,
        visible: true,
        x: 0,
        y: 0,
        size: 100,
        direction: 90,
        draggable: false,
        rotationStyle: 'all around',
        costumes: [{
            name: '空白',
            bitmapResolution: 1,
            dataFormat: 'svg',
            assetId: asset.assetId,
            md5ext: `${asset.assetId}.svg`,
            rotationCenterX: 1,
            rotationCenterY: 1
        }]
    });
    for (const name of ['根', '卡片', '文字', '外面']) await vm.addSprite(sprite(name));
    const find = name => vm.runtime.targets.find(t => t.isOriginal && t.getName() === name);
    const root = find('根');
    const card = find('卡片');
    const label = find('文字');
    const outside = find('外面');
    root.setXY(100, 50);
    card.setXY(100, 50);
    label.setXY(110, 50);
    vm.makeComponent(root.id);
    assert(vm.runtime.components.adoptMember(root, card), 'card goes in');
    assert(vm.runtime.components.adoptMember(root, label), 'label goes in');
    return {vm, root, card, label, outside, renderer};
};

test('members are placed in the component: the root moves, turns and scales them', async t => {
    const {vm, root, card, label, renderer} = await makeComponent();
    near(t, card.x, 0, 'a member is where it was, in the component');
    near(t, label.x, 10, 'x in the component');
    near(t, label.y, 0, 'y in the component');
    t.same(label._renderedPosition().map(Math.round), [110, 50], 'on the stage');
    t.same(renderer.positions[label.drawableID].map(Math.round), [110, 50], 'and so is the drawable');

    root.setXY(0, 0);
    t.same(label._renderedPosition().map(Math.round), [10, 0], 'moving the root moves the members');
    t.same(renderer.positions[label.drawableID].map(Math.round), [10, 0], 'and their drawables');
    near(t, label.x, 10, 'and doesn\'t change theirs');

    root.setDirection(180); // turned a quarter clockwise
    near(t, label._renderedPosition()[0], 0, 'turned: x');
    near(t, label._renderedPosition()[1], -10, 'turned: y');
    near(t, label._worldFrame().angle, 90, 'members turn with it');

    root.setDirection(90);
    root.setSize(200);
    near(t, label._renderedPosition()[0], 20, 'scaled: x');
    near(t, label._worldFrame().k, 2, 'and are bigger');

    const [x, y] = label.stageToLocal(40, 0);
    near(t, x, 20, 'a place on the stage in the component: x');
    near(t, y, 0, 'y');
    const back = label.localToStage(x, y);
    near(t, back[0], 40, 'and back');

    // The mouse in a component (its root's scripts too) is where it is in the component
    root.setXY(100, 50);
    root.setDirection(90);
    root.setSize(100);
    t.same(root.stageToComponent(130, 50).map(Math.round), [30, 0], 'root: mouse in the component');
    t.same(label.stageToComponent(130, 50).map(Math.round), [30, 0], 'member: mouse in the component');
    root.setDirection(180);
    t.same(root.stageToComponent(100, 20).map(Math.round), [30, 0], 'and it turns with the component');
    root.setDirection(90);
    t.same(vm.runtime.getTargetForStage().stageToComponent(3, 4), [3, 4], 'outside components it is the stage');
    root.setXY(0, 0);

    // Dragging on the stage gives places on the stage
    root.setSize(100);
    root.setXY(0, 0);
    label.postSpriteInfo({x: 50, y: 30, force: true});
    near(t, label.x, 50, 'dragged member: x in the component');
    near(t, label.y, 30, 'dragged member: y');
    label.postSpriteInfo({x: 12, y: 0});
    near(t, label.x, 12, 'the fields of the sprite info are in the component');
    void vm;
    t.end();
});

test('hiding the root hides the component', async t => {
    const {root, label} = await makeComponent();
    t.ok(label._effectiveVisible());
    root.setVisible(false);
    t.notOk(label._effectiveVisible(), 'members are hidden with it');
    root.setVisible(true);
    t.ok(label._effectiveVisible());
    t.end();
});

test('global. in a component is the variables of its root', async t => {
    const {vm, root, card, label} = await makeComponent();
    const stage = vm.runtime.getTargetForStage();
    const path = (target, text) => dataPath.parse(text, 'global');
    dataPath.set(label, null, path(label, '分數'), 5);
    t.equal(dataPath.get(card, null, path(card, '分數')), 5, 'the other member sees it');
    t.equal(dataPath.get(root, null, path(root, 'self.分數')), 5, 'self. of the root is global. of the members');
    t.equal(dataPath.get(root, null, path(root, '分數')), 5, 'and its own global.');
    t.equal(dataPath.get(stage, null, path(stage, '分數')), '', 'the project has none of it');
    dataPath.set(stage, null, path(stage, '外面'), 9);
    t.notOk(dataPath.get(label, null, path(label, '外面')), 'the project\'s variables aren\'t read from inside');

    // A second instance has its own
    const second = vm.addComponentInstance(root.id);
    const other = vm.runtime.getTargetById(second);
    dataPath.set(other, null, path(other, '分數'), 7);
    t.equal(dataPath.get(root, null, path(root, '分數')), 5, 'each instance has its own');
    const otherLabel = vm.runtime.components.membersOf(other).find(m => m.getName() === '文字');
    t.equal(dataPath.get(otherLabel, null, path(otherLabel, '分數')), 7, 'and its members share it');
    t.end();
});

test('properties are variables of the root that the outside can set', async t => {
    const {vm, root, label} = await makeComponent();
    const components = vm.runtime.components;
    t.ok(vm.editComponentProp(root.id, 'add', {name: '標題', type: 'string', default: '你好'}));
    t.ok(vm.editComponentProp(root.id, 'add', {name: '寬度', type: 'number', default: 100}));
    const path = text => dataPath.parse(text, 'global');
    t.equal(dataPath.get(label, null, path('標題')), '你好', 'a member reads the default');
    t.same(root.componentProps, {}, 'nothing is saved of a default');

    vm.setComponentProp(root.id, '標題', '再見');
    t.equal(dataPath.get(label, null, path('標題')), '再見', 'set from outside');
    dataPath.set(label, null, path('寬度'), 250);
    t.equal(components.getProp(root, '寬度'), 250, 'set from inside');
    t.same(root.componentProps, {標題: '再見', 寬度: 250}, 'what differs is saved');

    const second = vm.runtime.getTargetById(vm.addComponentInstance(root.id));
    t.equal(components.getProp(second, '標題'), '你好', 'another instance has the default');

    vm.editComponentProp(root.id, 'rename', '標題', '文字');
    t.equal(dataPath.get(label, null, path('文字')), '再見', 'a renamed property keeps its value');
    t.same(root.componentProps, {文字: '再見', 寬度: 250});

    // Saved and loaded
    const json = JSON.parse(vm.toJSON());
    const instance = json.targets.find(target => target.name === '根');
    t.same(instance.props, {文字: '再見', 寬度: 250}, 'in the file');
    t.notOk(Object.values(instance.variables || {}).some(v => v[0] === '文字'), 'not as variables too');
    const vm2 = new VirtualMachine();
    vm2.attachStorage(makeTestStorage());
    vm2.attachRenderer(makeRenderer());
    await vm2.loadProject(JSON.stringify(json));
    const loaded = vm2.runtime.targets.find(each => each.isOriginal && each.getName() === '根');
    t.equal(vm2.runtime.components.getProp(loaded, '文字'), '再見');
    t.equal(vm2.runtime.components.getProp(loaded, '寬度'), 250);
    const loadedLabel = vm2.runtime.components.membersOf(loaded).find(m => m.getName() === '文字');
    t.same(loadedLabel.x, 10, 'members keep their places in the component');
    t.end();
});

/**
 * Add a stack of blocks to a target.
 * @param {Target} target the target to add it to
 * @param {Array<object>} stack {opcode, fields: {NAME: value}, inputs: {NAME: value | {block: [...]}}}; a value is
 * a literal (a text shadow), {block} is a reporter given like a stack block; the top block is a hat
 * @returns {string} id of the top block
 */
const addScript = (target, stack) => {
    let counter = 0;
    const id = () => `${target.getName()}_b${Object.keys(target.blocks._blocks).length}_${counter++}`;
    const make = (block, parent, top) => {
        const made = {
            id: id(),
            opcode: block.opcode,
            fields: {},
            inputs: {},
            next: null,
            parent,
            shadow: false,
            topLevel: top,
            x: 0,
            y: 0
        };
        target.blocks.createBlock(made);
        for (const [name, value] of Object.entries(block.fields || {})) {
            made.fields[name] = {name, value};
        }
        for (const [name, value] of Object.entries(block.inputs || {})) {
            if (value && typeof value === 'object' && value.opcode) {
                const inner = make(value, made.id, false);
                made.inputs[name] = {name, block: inner, shadow: null};
            } else {
                const shadow = {
                    id: id(),
                    opcode: 'text',
                    fields: {},
                    inputs: {},
                    next: null,
                    parent: made.id,
                    shadow: true,
                    topLevel: false
                };
                target.blocks.createBlock(shadow);
                shadow.fields.TEXT = {name: 'TEXT', value};
                made.inputs[name] = {name, block: shadow.id, shadow: shadow.id};
            }
        }
        return made.id;
    };
    let previous = null;
    let first = null;
    for (const block of stack) {
        const blockId = make(block, previous, previous === null);
        if (previous) target.blocks.getBlock(previous).next = blockId;
        else first = blockId;
        previous = blockId;
    }
    target.blocks.resetCache();
    return first;
};

const readVariable = (target, name) => dataPath.get(target, null, dataPath.parse(name, 'global'));

const step = (vm, times = 4) => {
    for (let i = 0; i < times; i++) vm.runtime._step();
};

test('outputs: a component says something, the level around it hears it with the arguments', async t => {
    const {vm, root, label, outside} = await makeComponent();
    const output = vm.editComponentOutput(root.id, 'define', {
        proccode: '被點擊 次數 %s 開啟 %b',
        argumentIds: [],
        argumentNames: ['次數', '開啟']
    });
    t.ok(output, 'an output is made');
    t.same(output.params.map(p => p.type), ['s', 'b'], 'the types come from the text');
    const [count, open] = output.params;
    t.notOk(vm.editComponentOutput(root.id, 'define', {proccode: '被點擊 次數 %s 開啟 %b'}), 'same text twice');

    // Inside, a sprite of the component says it when the component starts
    addScript(label, [
        {opcode: 'twcomp_whenCreated'},
        {opcode: 'twcomp_emit', fields: {PORT: output.id}, inputs: {
            [count.id]: 7,
            [open.id]: {opcode: 'operator_equals', inputs: {OPERAND1: '1', OPERAND2: '1'}}
        }}
    ]);
    // Outside, a sprite of the project hears it and keeps the arguments
    addScript(outside, [
        {opcode: 'twcomp_whenOutput', fields: {SPRITE: '根', PORT: output.id}},
        {opcode: 'twdata_set', inputs: {
            PATH: '次數',
            VALUE: {opcode: 'twcomp_outputParam', fields: {PORT: output.id, PARAM: count.id}}
        }},
        {opcode: 'twdata_set', inputs: {
            PATH: '開啟',
            VALUE: {opcode: 'twcomp_outputParam', fields: {PORT: output.id, PARAM: open.id}}
        }}
    ]);
    // The green flag starts nothing inside the component, but the component starts
    addScript(label, [
        {opcode: 'event_whenflagclicked'},
        {opcode: 'twdata_set', inputs: {PATH: '旗子', VALUE: '跑了'}}
    ]);
    addScript(outside, [
        {opcode: 'event_whenflagclicked'},
        {opcode: 'twdata_set', inputs: {PATH: '外面的旗子', VALUE: '跑了'}}
    ]);
    vm.greenFlag();
    step(vm);
    const stage = vm.runtime.getTargetForStage();
    t.equal(String(readVariable(stage, '次數')), '7', 'the argument arrives');
    t.equal(readVariable(stage, '開啟'), true, 'and the boolean is a boolean');
    t.equal(readVariable(stage, '外面的旗子'), '跑了', 'the green flag starts the project');
    t.equal(readVariable(root, '旗子'), '', 'but nothing inside the component');
    t.equal(readVariable(stage, '旗子'), '', 'and nothing of it leaks out');
    vm.stopAll();
    t.end();
});

test('broadcasts stay where they are sent: in a component, or outside all of them', async t => {
    const {vm, root, label, outside} = await makeComponent();
    const stage = vm.runtime.getTargetForStage();
    const listen = (target, name, into) => addScript(target, [
        {opcode: 'event_whenbroadcastreceived', fields: {BROADCAST_OPTION: name}},
        {opcode: 'twdata_set', inputs: {PATH: into, VALUE: 'ok'}}
    ]);
    const send = (target, name) => addScript(target, [
        {opcode: 'event_whenflagclicked'},
        {opcode: 'event_broadcast', inputs: {BROADCAST_INPUT: name}}
    ]);
    listen(label, '嗨', '裡面聽到');
    listen(outside, '嗨', '外面聽到');
    // The project says it: only the project hears
    send(outside, '嗨');
    vm.greenFlag();
    step(vm);
    t.equal(readVariable(stage, '外面聽到'), 'ok', 'the project hears its own');
    t.equal(readVariable(root, '裡面聽到'), '', 'the component doesn\'t');
    vm.stopAll();

    // The component says it: only the component hears
    outside.blocks.deleteBlock(Object.keys(outside.blocks._blocks).find(id => outside.blocks.getBlock(id).opcode ===
        'event_broadcast'));
    stage.variables = {};
    root.variables = {};
    addScript(label, [
        {opcode: 'twcomp_whenCreated'},
        {opcode: 'event_broadcast', inputs: {BROADCAST_INPUT: '嗨'}}
    ]);
    vm.greenFlag();
    step(vm);
    t.equal(readVariable(root, '裡面聽到'), 'ok', 'the component hears its own');
    t.equal(readVariable(stage, '外面聽到'), '', 'the project doesn\'t');
    vm.stopAll();
    t.end();
});

test('the page of a component: a copy that is not saved, the project stays still, outputs go to the log', async t => {
    const {vm, root, outside} = await makeComponent();
    const stage = vm.runtime.getTargetForStage();
    const components = vm.runtime.components;
    const output = vm.editComponentOutput(root.id, 'define', {proccode: '好了 數字 %s', argumentNames: ['數字']});
    // The component: an input "設定 ( )" that says it, and something that runs every frame
    const definition = addScript(root, [
        {opcode: 'procedures_definition', inputs: {}},
        {opcode: 'twcomp_emit', fields: {PORT: output.id}, inputs: {[output.params[0].id]: '42'}}
    ]);
    t.ok(definition);
    // A custom block made the way the editor does: a definition with its prototype
    const blocks = root.blocks;
    const protoId = 'proto1';
    blocks.createBlock({
        id: protoId, opcode: 'procedures_prototype', fields: {}, inputs: {}, next: null, parent: definition,
        shadow: true, topLevel: false,
        mutation: {
            tagName: 'mutation', children: [], proccode: '設定 %s', argumentids: '["arg1"]',
            argumentnames: '["文字"]', argumentdefaults: '[""]', warp: 'false'
        }
    });
    blocks.getBlock(definition).inputs.custom_block = {name: 'custom_block', block: protoId, shadow: protoId};
    blocks.createBlock({
        id: 'argrep', opcode: 'argument_reporter_string_number', fields: {VALUE: {name: 'VALUE', value: '文字'}},
        inputs: {}, next: null, parent: protoId, shadow: true, topLevel: false
    });
    blocks.resetCache();

    // The project has a script that would run all the time
    addScript(outside, [
        {opcode: 'event_whenflagclicked'},
        {opcode: 'twdata_set', inputs: {PATH: '專案跑了', VALUE: '是'}}
    ]);
    addScript(outside, [
        {opcode: 'twcomp_whenOutput', fields: {SPRITE: '根', PORT: output.id}},
        {opcode: 'twdata_set', inputs: {PATH: '專案聽到', VALUE: '是'}}
    ]);
    const count = vm.runtime.targets.length;

    const previewId = vm.openComponentPage(root.id);
    const preview = vm.runtime.getTargetById(previewId);
    t.ok(preview && preview.isPreview, 'the page has an instance of its own');
    t.not(preview, root, 'not the one of the project');
    t.same([preview.x, preview.y], [0, 0], 'at the origin');
    t.equal(vm.getComponentPage().path.join('>'), root.sprite.name);
    t.ok(vm.runtime.targets.length > count, 'with members');
    t.notOk(JSON.parse(vm.toJSON()).targets.some(target => target.name === preview.getName() && target !== root.name),
        'it is not saved');
    t.equal(components.instancesOf(root.sprite).length, 1, 'and the project does not know it');

    // What it says goes to the log and not to the project
    const log = [];
    vm.runtime.on('COMPONENT_OUTPUT', entry => log.push(entry));
    const info = vm.getComponentInterface(previewId);
    t.equal(info.inputs.length, 0, 'the input is not public yet');
    vm.setProcedurePublic(root.id, protoId, true);
    const info2 = vm.getComponentInterface(previewId);
    t.equal(info2.inputs.length, 1, 'a public custom block is an input');
    t.equal(info2.inputs[0].proccode, '設定 %s');
    t.equal(info2.outputs.length, 1);
    const done = vm.runComponentInput(protoId, {arg1: 'hi'});
    step(vm);
    await done;
    t.equal(log.length, 1, 'the input ran and the component said something');
    t.equal(Number(log[0].args[output.params[0].id]), 42);
    t.equal(readVariable(stage, '專案聽到'), '', 'the project heard nothing');

    vm.greenFlag();
    step(vm);
    t.equal(readVariable(stage, '專案跑了'), '', 'the green flag does not start the project on the page');

    vm.closeComponentPage();
    t.notOk(vm.getComponentPage(), 'back to the project');
    t.equal(vm.runtime.targets.length, count, 'the copy is gone');
    t.equal(vm.editingTarget.isPreview, undefined);
    vm.greenFlag();
    step(vm);
    t.equal(readVariable(stage, '專案跑了'), '是', 'and the project runs');
    vm.stopAll();
    t.end();
});

test('a component file: it goes out with what it needs and comes back as a component of its own', async t => {
    const {vm, root, label} = await makeComponent();
    const components = vm.runtime.components;
    vm.editComponentProp(root.id, 'add', {name: '文字', type: 'string', default: '你好'});
    const output = vm.editComponentOutput(root.id, 'define', {proccode: '好了 數字 %s', argumentNames: ['數字']});
    addScript(label, [
        {opcode: 'twcomp_whenCreated'},
        {opcode: 'twcomp_emit', fields: {PORT: output.id}, inputs: {[output.params[0].id]: '7'}}
    ]);
    // Moving it while the component is edited moves it in the component
    components.editScope = root;
    label.setXY(12, 5);
    components.editScope = null;
    vm.setComponentProp(root.id, '文字', '再見');

    const bytes = await vm.exportComponent(root.id, 'uint8array');
    const zip = await JSZip.loadAsync(bytes);
    const file = JSON.parse(await zip.file('component.json').async('string'));
    t.equal(file.meta.format, '3dsc');
    t.equal(file.root, root.sprite.component.id);
    t.same(file.instance.x, 0, 'where it was in the project is not in the file');
    t.equal(Object.keys(file.components).length, 1);
    t.ok(Object.keys(zip.files).some(name => name.endsWith('.svg')), 'the costumes are in it');

    const summary = await vm.describeComponentFile(bytes);
    t.equal(summary.name, root.sprite.name);
    t.same(summary.props, ['文字']);
    t.same(summary.outputs, ['好了 數字 ( )']);

    // Into the same project: nothing is replaced
    const before = components.definitions.size;
    const id = await vm.importComponent(bytes);
    t.equal(components.definitions.size, before + 1, 'a component of its own');
    const copy = vm.runtime.getTargetById(id);
    t.not(copy.sprite, root.sprite);
    t.not(copy.sprite.name, root.sprite.name, 'with another name');
    t.not(copy.sprite.component.id, root.sprite.component.id, 'and another id');
    t.equal(components.getProp(copy, '文字'), '再見', 'its properties');
    t.equal(copy.sprite.component.outputs[0].id, output.id, 'its outputs, with the ids they had');
    const copyLabel = components.membersOf(copy).find(member => member.getName() === '文字');
    t.same([copyLabel.x, copyLabel.y], [12, 5], 'its members are where they were in it');
    t.equal(components.instancesOf(root.sprite).length, 1, 'the first is as it was');
    t.equal(components.getProp(root, '文字'), '再見');
    t.end();
});

test('a component inside another: its property follows the one of the component around it', async t => {
    const {vm, root, outside} = await makeComponent();
    const components = vm.runtime.components;
    // A sprite of the project becomes a component of its own that the first one holds
    t.ok(vm.makeComponent(outside.id), 'a sprite that is not in a component becomes one');
    vm.editComponentProp(outside.id, 'add', {name: '文字', type: 'string', default: ''});
    vm.editComponentProp(root.id, 'add', {name: '標題', type: 'string', default: '嗨'});
    const inner = components.addComponentMember(root, outside.sprite);
    t.ok(inner, 'the component is put in the other');
    // Its property is worked out from the one of the component around it
    const spec = components.specOf(inner);
    spec.props = {文字: '{標題} 你好'};
    inner.componentProps = spec.props;
    t.equal(components.getProp(inner, '文字'), '嗨 你好', 'at first');
    vm.setComponentProp(root.id, '標題', '再見');
    step(vm, 2);
    t.equal(components.getProp(inner, '文字'), '再見 你好', 'and when the outside changes');
    t.same(inner.componentProps, {文字: '{標題} 你好'}, 'what is saved is how it is worked out');
    // The inside can't change it
    components.setProp(inner, '文字', '偷改');
    t.equal(components.getProp(inner, '文字'), '再見 你好', 'set from the outside of the binding: ignored');
    dataPath.set(inner, null, dataPath.parse('文字', 'global'), '從裡面改');
    step(vm, 2);
    t.equal(components.getProp(inner, '文字'), '再見 你好', 'a write from inside is undone by the next frame');
    t.end();
});

test('an output can be the one of a component inside: said whenever that one is, arguments mapped', async t => {
    const {vm, root, outside} = await makeComponent();
    const components = vm.runtime.components;
    t.ok(vm.makeComponent(outside.id));
    const inside = vm.editComponentOutput(outside.id, 'define', {
        proccode: '按了 次數 %s 開啟 %b',
        argumentIds: [],
        argumentNames: ['次數', '開啟']
    });
    const inner = components.addComponentMember(root, outside.sprite);
    const forwarded = vm.editComponentOutput(root.id, 'forward', {instance: inner.getName(), port: inside.id});
    t.ok(forwarded, 'made from the output of the one inside');
    t.equal(forwarded.proccode, inside.proccode, 'same words');
    t.notSame(forwarded.params.map(p => p.id), inside.params.map(p => p.id), 'its own ids for the arguments');
    t.equal(vm.editComponentOutput(root.id, 'forward', {instance: inner.getName(), port: inside.id}).id, forwarded.id,
        'once');

    const said = [];
    vm.runtime.on('COMPONENT_OUTPUT', e => said.push(`${e.instance.getName()}:${e.output.id}:` +
        `${JSON.stringify(e.args)}`));
    components.emitOutput(inner, inside.id, {[inside.params[0].id]: 3, [inside.params[1].id]: true});
    t.same(said, [
        `${inner.getName()}:${inside.id}:` +
            `${JSON.stringify({[inside.params[0].id]: 3, [inside.params[1].id]: true})}`,
        `根:${forwarded.id}:${JSON.stringify({[forwarded.params[0].id]: 3, [forwarded.params[1].id]: true})}`
    ], 'the one inside, then the one around it');

    // It follows when the instance is renamed
    components.renameInstance(inner.getName(), '新名字');
    t.equal(forwarded.forward.instance, '新名字');
    t.end();
});

test('the outside can\'t set what is inside a component with a block: it calls an input', async t => {
    const {vm, root, outside} = await makeComponent();
    vm.editComponentProp(root.id, 'add', {name: '標題', type: 'string', default: '嗨'});
    addScript(outside, [
        {opcode: 'event_whenflagclicked'},
        {opcode: 'twcomp_setInstanceProp', inputs: {INSTANCE: '根', VALUE: '偷改'}, fields: {PROP: '標題'}}
    ]);
    vm.greenFlag();
    step(vm, 2);
    t.equal(vm.runtime.components.getProp(root, '標題'), '嗨', 'nothing changed');
    t.end();
});

/**
 * Tests of tools/3dsb-text.js: node --test --test-force-exit tools/3dsb-text/test/run.js
 * (the VM keeps timers running, so the runner has to be told to exit)
 */
const {test} = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {getDefs, makeVM} = require('../vm-host');
const {readProject} = require('../project-file');
const {dump, deepEqual} = require('../dump');
const syntax = require('../syntax');
const {build} = require('../build');
const {check} = require('../check');
const edit = require('../edit');
const query = require('../query');
const simple = require('../simple');
const {VM} = require('../paths');

const defs = getDefs();
const durian = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'durian-voxel-physics.json'), 'utf8'));

const buildText = text => {
    const result = build(syntax.parse(text), {defs});
    assert.deepStrictEqual(result.errors.map(e => e.message), []);
    return result;
};

// A project with a stage and one empty 2D sprite, as text
const EMPTY = `blocks3d-text 1
project meta {"semver":"3.0.0","format":"3dsb","formatVersion":3}
stage "Stage"
  prop currentCostume 0
  prop costumes []
  prop kind "2d"
sprite "角色"
  prop kind "2d"
`;

test('durian-voxel: project → text → project gives the same blocks', async () => {
    const report = await edit.roundtrip(durian(), defs);
    assert.ok(report.ok, report.lines.join('\n'));
});

test('every .sb3 fixture of scratch-vm survives the round trip', async () => {
    const fixtures = path.join(VM, 'test', 'fixtures');
    const files = [];
    const walk = dir => {
        for (const name of fs.readdirSync(dir)) {
            const file = path.join(dir, name);
            if (fs.statSync(file).isDirectory()) walk(file);
            else if (name.endsWith('.sb3')) files.push(file);
        }
    };
    walk(fixtures);
    assert.ok(files.length > 50);
    for (const file of files) {
        const {json} = await readProject(file);
        const report = await edit.roundtrip(json, defs);
        assert.ok(report.ok, `${path.relative(fixtures, file)}\n${report.lines.join('\n')}`);
    }
});

test('the text has the editor\'s words as comments, and sugar for menus and custom blocks', () => {
    const text = dump(durian(), {defs});
    assert.match(text, /event_whenflagclicked {2}# 當綠旗被點擊/);
    assert.match(text, /looks_switchcostumeto COSTUME=menu\("一般"\) {2}# 造型換成 \[一般\]/);
    assert.match(text, /define "spawn %s" "anywhere" @warp/);
    assert.match(text, /call "spawn %s" anywhere=1/);
    assert.doesNotMatch(text, /rawblock/);
});

test('build makes parents, shadows, menus and custom blocks', () => {
    const {json} = buildText(`${EMPTY}  script 10 20
    event_whenflagclicked
    motion_movesteps STEPS=(operator_add NUM1=1 NUM2=2)
    looks_switchcostumeto COSTUME=menu("一般")
    call "jump %s" height=5
  script 0 400
    define "jump %s" "height" @warp
    motion_changeyby DY=(argument_reporter_string_number VALUE:"height")
`);
    const blocks = json.targets[1].blocks;
    const byOpcode = opcode => Object.entries(blocks).filter(([, b]) => b.opcode === opcode);
    const [[hatId, hat]] = byOpcode('event_whenflagclicked');
    assert.deepStrictEqual([hat.topLevel, hat.x, hat.y, hat.parent], [true, 10, 20, null]);
    const [[moveId, move]] = byOpcode('motion_movesteps');
    assert.strictEqual(hat.next, moveId);
    assert.strictEqual(move.parent, hatId);
    // A block in a number input gets an empty number shadow under it
    assert.strictEqual(move.inputs.STEPS[0], 3);
    assert.deepStrictEqual(move.inputs.STEPS[2], [4, '']);
    const [[, add]] = byOpcode('operator_add');
    assert.deepStrictEqual(add.inputs, {NUM1: [1, [4, '1']], NUM2: [1, [4, '2']]});
    const [[menuId, menu]] = byOpcode('looks_costume');
    assert.deepStrictEqual([menu.shadow, menu.fields.COSTUME], [true, ['一般', null]]);
    assert.deepStrictEqual(byOpcode('looks_switchcostumeto')[0][1].inputs.COSTUME, [1, menuId]);
    const [[prototypeId, prototype]] = byOpcode('procedures_prototype');
    const argumentIds = JSON.parse(prototype.mutation.argumentids);
    assert.deepStrictEqual(JSON.parse(prototype.mutation.argumentnames), ['height']);
    assert.strictEqual(prototype.mutation.warp, 'true');
    const [[, call]] = byOpcode('procedures_call');
    assert.deepStrictEqual(call.mutation, {
        tagName: 'mutation', children: [], proccode: 'jump %s', argumentids: JSON.stringify(argumentIds), warp: 'true'
    });
    assert.deepStrictEqual(call.inputs[argumentIds[0]], [1, [10, '5']]);
    assert.strictEqual(blocks[byOpcode('procedures_definition')[0][0]].inputs.custom_block[1], prototypeId);
});

test('mistakes are reported with their line', async () => {
    const parseError = text => {
        try {
            syntax.parse(text);
        } catch (e) {
            return [e.line, e.reason];
        }
        return null;
    };
    assert.deepStrictEqual(parseError(`${EMPTY}  script 0 0\n    motion_movesteps STEPS=(operator_add NUM1=1\n`)[0], 10);
    assert.strictEqual(parseError(`${EMPTY}  script 0 0\n    motion_movesteps STEPS\n`)[0], 10);

    const text = `${EMPTY}  script 0 0
    event_whenflagclicked
    motion_movestep STEPS=10
    motion_setrotationstyle STYLE:"sideways"
    motion_gotoxy X=1 Z=2
    looks_say MESSAGE=(twdata_get PATH="scroe")
`;
    const result = build(syntax.parse(text), {defs});
    const problems = await check(result.json, {defs, lines: result.lines});
    const at = line => problems.filter(p => p.line === line).map(p => `${p.level}: ${p.message}`)
        .join('\n');
    assert.match(at(11), /error: 未知的 opcode「motion_movestep」（是不是 motion_movesteps？）/);
    assert.match(at(12), /error: .*"sideways"，不在選項裡/);
    assert.match(at(13), /error: motion_gotoxy 沒有輸入「Z」/);
    assert.match(at(14), /warning: 全域變數「scroe」只有讀取/);

    const missing = build(syntax.parse(`${EMPTY}  script 0 0\n    call "nothing"\n`), {defs});
    assert.strictEqual(missing.errors[0].line, 10);
    assert.match(missing.errors[0].reason, /找不到自訂積木「nothing」/);
});

test('a correct project passes, compiled in the VM', async () => {
    const problems = await check(durian(), {defs});
    assert.deepStrictEqual(problems.filter(p => p.level === 'error'), []);
});

test('changing one script leaves everything else as it was', () => {
    const original = durian();
    const json = durian();
    const sprite = '搖樹按鈕';
    const index = json.targets.findIndex(t => t.name === sprite);
    edit.replaceScript(json, {defs, sprite, script: 3, snippet: `script 0 1200
  event_whenthisspriteclicked
  event_broadcast BROADCAST_INPUT=broadcast("shake")
  twdata_change PATH="shakeCount" VALUE=1
`});
    json.targets.forEach((target, i) => {
        if (i !== index) assert.ok(deepEqual(target, original.targets[i]), target.name);
    });
    const before = original.targets[index].blocks;
    const after = json.targets[index].blocks;
    for (const id of ['pw', 'dp', 'pz', 'O']) assert.ok(deepEqual(after[id], before[id]), id);
    assert.ok(!after.pD && !after.pE, 'the old script is gone');
    // Still the third script
    const text = dump(json, {defs, targets: [sprite]});
    assert.match(text, /script 0 1200 {2}# script 3\n {4}event_whenthisspriteclicked/);

    const hat = Object.keys(after).find(id => after[id].opcode === 'event_whenthisspriteclicked');
    const broadcast = after[hat].next;
    edit.insertAfter(json, {defs, sprite, after: broadcast, snippet: 'looks_log MESSAGE="hi"\n'});
    const log = json.targets[index].blocks[broadcast].next;
    assert.strictEqual(json.targets[index].blocks[log].opcode, 'looks_log');
    assert.strictEqual(json.targets[index].blocks[json.targets[index].blocks[log].next].opcode, 'twdata_change');

    edit.addScript(json, {defs, sprite, snippet: 'script 0 2000\n  event_whenflagclicked\n  looks_say MESSAGE="a"\n'});
    assert.match(dump(json, {defs, targets: [sprite]}), /# script 4\n {4}event_whenflagclicked {2}#[^\n]*\n {4}looks_say MESSAGE="a"/);
    edit.deleteScript(json, {sprite, script: 4});
    assert.doesNotMatch(dump(json, {defs, targets: [sprite]}), /# script 4/);
});

test('queries', () => {
    const json = durian();
    assert.match(query.stats(json, null), /榴槤 +3D +10 +384 +393/);
    const refs = query.refs(json, 'cardX');
    assert.match(refs, /「cardX」（全域變數）用到 9 次/);
    assert.match(refs, /卡片 +3 +twdata_set +寫/);
    assert.match(query.refs(json, 'shake'), /搖樹按鈕 +3 +event_broadcast +送出/);
});

test('the simplified syntax compiles to blocks that run', async () => {
    const program = `
when flag {
  總和 = 0
  for i in 1..4 {
    總和 += twice(i)
  }
  if 總和 == 20 and not (總和 < 0) {
    結果 = "對"
  } else {
    結果 = "錯"
  }
  self.hp = 10
  self.hp -= 3
  剩下 = self.hp
}

define twice(n) warp {
  return n * 2
}
`;
    const scripts = simple.compile(program, {defs});
    const {json} = buildText(`${EMPTY}${scripts}`);
    const problems = await check(json, {defs});
    assert.deepStrictEqual(problems.filter(p => p.level === 'error'), []);

    const vm = makeVM();
    await vm.loadProject(json);
    vm.greenFlag();
    for (let i = 0; i < 10; i++) vm.runtime._step();
    const DataPath = require('../data-refs').DataPath;
    const stage = vm.runtime.getTargetForStage();
    const get = (target, text) => DataPath.get(target, null, DataPath.parse(text, 'global'));
    assert.strictEqual(Number(get(stage, '總和')), 20);
    assert.strictEqual(get(stage, '結果'), '對');
    assert.strictEqual(Number(get(stage, '剩下')), 7);
    vm.stopAll();
});

test('the simplified syntax reports mistakes with their line', () => {
    const error = source => {
        try {
            simple.compile(source, {defs});
        } catch (e) {
            return [e.line, e.reason];
        }
        return null;
    };
    assert.deepStrictEqual(error('when flag {\n  motion_movesteps(STEP: 1)\n}'), [2, 'motion_movesteps 沒有參數「STEP」（有：STEPS）']);
    assert.strictEqual(error('when flag {\n  x = \n}')[0], 3);
    assert.match(error('when flag {\n  nothing(1)\n}')[1], /不認得「nothing」/);
});

test('nested "讓 i 從 1 跑到 10" loops: i, j, k run, and a loop inside one with its name is reported', async () => {
    const scripts = simple.compile(`
when flag {
  次數 = 0
  總和 = 0
  for i in 1..10 {
    for j in 1..10 {
      for k in 1..10 {
        次數 += 1
        總和 += i * 100 + j * 10 + k
      }
    }
  }
}
`, {defs});
    assert.match(scripts, /control_for_range VAR=\[control_for_range_index VALUE:"j"\]/);
    const {json} = buildText(`${EMPTY}${scripts}`);
    const problems = await check(json, {defs});
    assert.deepStrictEqual(problems, []);
    const vm = makeVM();
    await vm.loadProject(json);
    vm.greenFlag();
    for (let i = 0; i < 10; i++) vm.runtime._step();
    const DataPath = require('../data-refs').DataPath;
    const stage = vm.runtime.getTargetForStage();
    assert.strictEqual(Number(DataPath.get(stage, null, DataPath.parse('次數', 'global'))), 1000);
    // Each of i, j, k goes 1..10 100 times: (100 + 10 + 1) * 55 * 100
    assert.strictEqual(Number(DataPath.get(stage, null, DataPath.parse('總和', 'global'))), 610500);
    vm.stopAll();

    // The same name inside: the simplified syntax refuses, like the editor renames
    assert.throws(() => simple.compile('when flag {\n  for i in 1..3 {\n    for i in 1..3 {\n    }\n  }\n}', {defs}),
        e => e.line === 3 && /外層的迴圈已經叫 i/.test(e.reason));
    // Written as text, check warns
    const text = buildText(`${EMPTY}  script 0 0
    event_whenflagclicked
    control_for_range VAR=[control_for_range_index VALUE:"i"] FROM=1 TO=3
      SUBSTACK:
        control_for_range VAR=[control_for_range_index VALUE:"i"] FROM=1 TO=3
          SUBSTACK:
            looks_log MESSAGE=(control_for_range_index VALUE:"i")
    looks_log MESSAGE=(control_for_range_index VALUE:"j")
`);
    const warnings = (await check(text.json, {defs, lines: text.lines})).map(p => `${p.line} ${p.message}`);
    assert.match(warnings.join('\n'), /^13 迴圈 i 在另一個也叫 i 的迴圈裡/m);
    assert.match(warnings.join('\n'), /^16 迴圈變數 j 不在叫 j 的/m);
});

test('SVG bindings: expressions, formats, what costumes read, and mistakes with their line', async () => {
    const E = require(path.join(VM, 'src/util/b3-expression'));
    const values = {分數: 42, 時間: 3.14159, 比例: 0.256, hp: '7', 名字: 'Bob', 玩家: {x: 5}};
    const read = node => {
        const [first, field] = node.name.split('.');
        const value = values[first];
        return field ? value[field] : (value === undefined ? '' : value);
    };
    const fill = text => E.parseTemplate(text).map(part => (typeof part === 'string' ? part :
        (part.format ? part.format(E.evaluate(part.tree, read)) : String(E.evaluate(part.tree, read)))))
        .join('');
    assert.strictEqual(fill('{分數:00000} {時間:0.0} {比例:0%}'), '00042 3.1 26%');
    assert.strictEqual(fill('{{x}} {名字 + "!"} {hp + 1} {分數 > 10 ? \'大\' : "小"} {玩家.x * 2} {clamp(分數, 0, 10)}'),
        '{x} Bob! 8 大 10 10');
    assert.strictEqual(E.parseTemplate('沒有綁定 }'), null);
    assert.throws(() => E.parseTemplate('{分數'), /大括號沒有關起來/);
    assert.throws(() => E.parseTemplate('{eval(1)}'), /沒有函式「eval」/);

    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60">\n' +
        '<g data-bind-origin="10 30" data-bind-scale-x="self.hp / 100"><rect width="180" height="20"/></g>\n' +
        '<text>掉落 {掉落數目:000} 個</text>\n' +
        '<text>{壞掉(1)}</text>\n</svg>';
    const json = buildText(`${EMPTY}  prop costumes [{"name":"計數","dataFormat":"svg","assetId":"abc","md5ext":"abc.svg","rotationCenterX":0,"rotationCenterY":0}]
  script 0 0
    event_whenflagclicked
    twdata_set PATH="掉落數目" VALUE=0
`).json;
    const svgs = {'abc.svg': svg};
    const found = query.refs(json, '掉落數目', svgs);
    assert.match(found, /造型「計數」第 3 行（綁定）/);
    assert.match(found, /twdata_set/);
    assert.match(query.refs(json, 'self.hp', svgs), /造型「計數」第 2 行/);
    const problems = await check(json, {defs, vm: false, svgs});
    assert.ok(problems.some(p => /造型「計數」第 4 行：沒有函式「壞掉」/.test(p.message)), JSON.stringify(problems));
    // self.hp is only read (by the binding)
    assert.ok(problems.some(p => /分身變數「hp」只有讀取.*造型「計數」的綁定/.test(p.message)), JSON.stringify(problems));
    const text = dump(json, {defs, svgs});
    assert.match(text, /# 造型「計數」綁定：data-bind-scale-x="self.hp \/ 100"  掉落 \{掉落數目:000\} 個/);
});

test('events of sprite interfaces: .b3s, check, refs, and they run', async () => {
    const button = simple.compile(`
when flag {
  emit "被點到" 42
}
`, {defs});
    const listener = simple.compile(`
when 按鈕.被點到 {
  收到 = event_value()
  來源 = triggered_sprite()
}
`, {defs});
    const text = `${EMPTY.replace('sprite "角色"\n  prop kind "2d"\n', '')}sprite "按鈕"
  prop kind "2d"
  prop interface {"events":[{"name":"被點到"}],"public":[]}
${button}sprite "舞台控制"
  prop kind "2d"
${listener}`;
    const {json} = buildText(text);
    const problems = await check(json, {defs});
    assert.deepStrictEqual(problems.filter(p => p.level === 'error'), []);
    assert.match(query.refs(json, '被點到'), /發出[\s\S]*接收|接收[\s\S]*發出/);

    const vm = makeVM();
    await vm.loadProject(json);
    vm.greenFlag();
    for (let i = 0; i < 5; i++) vm.runtime._step();
    const DataPath = require('../data-refs').DataPath;
    const stage = vm.runtime.getTargetForStage();
    const get = name => DataPath.get(stage, null, DataPath.parse(name, 'global'));
    assert.strictEqual(Number(get('收到')), 42);
    assert.strictEqual(get('來源'), '按鈕');
    vm.stopAll();

    // A hat of an event the sprite doesn't have
    const wrong = buildText(text.replace('when 按鈕.被點到', 'when 按鈕.不存在')).json;
    const wrongText = text.replace('twiface_whenEvent SPRITE:"按鈕" EVENT:"被點到"', 'twiface_whenEvent SPRITE:"按鈕" EVENT:"不存在"');
    const errors = (await check(buildText(wrongText).json, {defs, vm: false})).filter(p => p.level === 'error');
    assert.ok(errors.some(p => /沒有事件「不存在」/.test(p.message)), JSON.stringify(errors));
    assert.ok(wrong);
});

test('components: outputs, root variables and local coordinates through the text', async () => {
    // A button: its properties are variables of its root, 「clicked」 is what it says to the outside
    const inside = simple.compile(`
when created {
  global.次數 = 0
}
when clicked {
  global.次數 += 1
  emit out clicked(count: global.次數, text: global.文字)
}
when prop.文字 {
  改變 = this_instance()
}
`, {defs});
    const listener = simple.compile(`
when out 開始按鈕.clicked (count, text) {
  收到 = count
  文字內容 = text
  目前文字 = getprop("開始按鈕", "文字")
}
`, {defs});
    const listenerAny = simple.compile(`
when out any 開始按鈕.clicked (count) {
  任一 = count
}
`, {defs});
    assert.match(inside, /twcomp_whenCreated/);
    assert.match(inside, /twcomp_emit PORT:"clicked"/);
    assert.match(listener, /twcomp_whenOutput SPRITE:"開始按鈕" PORT:"clicked"/);
    assert.match(listenerAny, /SPRITE:"_any_開始按鈕"/);

    const base = buildText(`${EMPTY.replace('sprite "角色"\n  prop kind "2d"\n', '')}sprite "開始按鈕"
  prop kind "2d"
${inside}sprite "舞台控制"
  prop kind "2d"
${listener}${listenerAny}`).json;
    const vm = makeVM();
    await vm.loadProject(base);
    const button = vm.runtime.targets.find(t => t.getName() === '開始按鈕');
    assert.ok(vm.makeComponent(button.id));
    vm.editComponentProp(button.id, 'add', {name: '文字', type: 'string', default: '按鈕'});
    const output = vm.editComponentOutput(button.id, 'define', {
        id: 'clicked',
        proccode: '被點擊 次數 %s 文字 %s',
        argumentIds: ['count', 'text'],
        argumentNames: ['次數', '文字']
    });
    assert.strictEqual(output.id, 'clicked');
    assert.deepStrictEqual(output.params.map(p => p.id), ['count', 'text'], 'the ids of the arguments stay');
    vm.setComponentProp(button.id, '文字', '開始');
    const json = JSON.parse(vm.toJSON());
    vm.stopAll();
    assert.strictEqual(Object.keys(json.components).length, 1);
    const definition = Object.values(json.components)[0];
    assert.deepStrictEqual(definition.outputs, [{
        id: 'clicked',
        proccode: '被點擊 次數 %s 文字 %s',
        params: [{id: 'count', name: '次數', type: 's'}, {id: 'text', name: '文字', type: 's'}]
    }]);
    assert.strictEqual(json.meta.formatVersion, 5);
    assert.ok(json.targets.some(t => t.name === '開始按鈕' && t.component && !t.blocks));

    const report = await edit.roundtrip(json, defs);
    assert.ok(report.ok, report.lines.join('\n'));
    const text = dump(json, {defs});
    assert.match(text, /^component "cmp/m);
    assert.match(text, /prop outputs \[\{"id":"clicked"/);
    assert.match(text, /twcomp_whenPropChanged PROP:"文字"/);
    assert.match(text, /twcomp_emit count=\(.*\) text=\(.*\) PORT:"clicked"/);
    assert.match(text, /prop component "cmp/);
    const problems = await check(json, {defs});
    assert.deepStrictEqual(problems.filter(p => p.level === 'error'), []);
    assert.match(query.refs(json, 'clicked'), /元件「開始按鈕」[\s\S]*發出/);

    // It runs after going through the text: the component starts, is clicked, and the outside hears it
    const rebuilt = build(syntax.parse(text), {defs}).json;
    const vm2 = makeVM();
    await vm2.loadProject(rebuilt);
    vm2.greenFlag();
    for (let i = 0; i < 3; i++) vm2.runtime._step();
    const instance = vm2.runtime.targets.find(t => t.getName() === '開始按鈕');
    vm2.runtime.startHats('event_whenthisspriteclicked', null, instance);
    for (let i = 0; i < 3; i++) vm2.runtime._step();
    const DataPath = require('../data-refs').DataPath;
    const stage = vm2.runtime.getTargetForStage();
    const get = name => DataPath.get(stage, null, DataPath.parse(name, 'global'));
    assert.strictEqual(Number(get('收到')), 1, 'the argument arrives');
    assert.strictEqual(get('文字內容'), '開始');
    assert.strictEqual(Number(get('任一')), 1, 'any instance');
    // A variable set inside the component is one of its root, not of the project
    assert.strictEqual(get('改變'), '');
    assert.strictEqual(Number(DataPath.get(instance, null, DataPath.parse('次數', 'global'))), 1);
    assert.strictEqual(get('目前文字'), '開始');
    // The editor's panel sets a property (a script outside can't: the block does nothing)
    vm2.runtime.components.setProp(instance, '文字', '按了');
    for (let i = 0; i < 3; i++) vm2.runtime._step();
    assert.strictEqual(DataPath.get(instance, null, DataPath.parse('改變', 'global')), '開始按鈕');
    vm2.stopAll();

    // A hat of an instance that isn't there, an output that isn't declared, an argument that isn't there
    const missing = JSON.parse(JSON.stringify(json));
    const hats = Object.values(missing.targets.find(t => t.name === '舞台控制').blocks)
        .filter(b => b.opcode === 'twcomp_whenOutput');
    hats[0].fields.SPRITE = ['不存在的按鈕', null];
    hats[1].fields.PORT = ['nothing', null];
    const errors = (await check(missing, {defs, vm: false})).filter(p => p.level === 'error');
    assert.ok(errors.some(p => /不存在/.test(p.message)), JSON.stringify(errors));
    const noOutput = JSON.parse(JSON.stringify(json));
    Object.values(noOutput.components)[0].outputs = [];
    const errors2 = (await check(noOutput, {defs, vm: false})).filter(p => p.level === 'error');
    assert.ok(errors2.some(p => /沒有輸出「clicked」/.test(p.message)), JSON.stringify(errors2));
    const noParam = JSON.parse(JSON.stringify(json));
    Object.values(noParam.components)[0].outputs[0].params.pop();
    const errors3 = (await check(noParam, {defs, vm: false})).filter(p => p.level === 'error');
    assert.ok(errors3.some(p => /沒有參數「text」/.test(p.message)), JSON.stringify(errors3));
});

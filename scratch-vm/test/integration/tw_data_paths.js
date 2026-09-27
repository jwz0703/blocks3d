// Data paths, the text block and clone ids (ROADMAP.md 4.12 and 4.13).
const {test} = require('tap');
require('../fixtures/tw_mock_blob');
const fs = require('fs');
const pathUtil = require('path');
const VirtualMachine = require('../../src/virtual-machine');
const DataPath = require('../../src/util/data-path');
const Cast = require('../../src/util/cast');
const makeTestStorage = require('../fixtures/make-test-storage');

const sb3Fixture = fs.readFileSync(pathUtil.join(__dirname, '..', 'fixtures', 'tw-save-project-sb3.sb3'));

const MODES = [false, true];
const modeName = compiled => (compiled ? 'compiled' : 'interpreted');

// A project with the 2D sprite "Sprite1" and the 3D sprite "Box"
const makeVM = async compiled => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());
    vm.setCompilerOptions({enabled: compiled});
    await vm.loadProject(sb3Fixture);
    await vm.addSprite3D({name: 'Box', models: [{name: 'cube', shape: 'cube'}]});
    // 向量 is in the extension library
    vm.extensionManager.loadExtensionIdSync('twvector');
    const find = name => vm.runtime.targets.find(t => t.isOriginal && t.getName() === name);
    const said = [];
    // As the bubble shows it
    vm.runtime.on('SAY', (target, type, text) => said.push(Cast.toString(text)));
    return {vm, sprite: find('Sprite1'), box: find('Box'), stage: vm.runtime.getTargetForStage(), said};
};

let nextId = 0;
/**
 * Add a script. A block is {opcode, inputs, fields, mutation, shadow}; an input is a number or string (in a shadow
 * of the given type) or another block.
 * @param {Target} target where the script goes
 * @param {Array<object>} stack blocks after the hat
 * @param {object} [hat] "when green flag clicked" by default
 * @returns {string} id of the hat
 */
const addScript = (target, stack, hat) => {
    const add = (block, parent) => {
        const id = `d${nextId++}`;
        const inputs = {};
        for (const [name, value] of Object.entries(block.inputs || {})) {
            if (value && typeof value === 'object') {
                const child = add(value, id);
                inputs[name] = {name, block: child, shadow: value.shadow ? child : null};
            } else {
                const shadowId = `d${nextId++}`;
                const isNumber = typeof value === 'number';
                target.blocks.createBlock({
                    id: shadowId,
                    opcode: isNumber ? 'math_number' : 'text',
                    parent: id,
                    next: null,
                    shadow: true,
                    topLevel: false,
                    inputs: {},
                    fields: isNumber ? {NUM: {name: 'NUM', value}} : {TEXT: {name: 'TEXT', value}}
                });
                inputs[name] = {name, block: shadowId, shadow: shadowId};
            }
        }
        const fields = {};
        for (const [name, value] of Object.entries(block.fields || {})) {
            fields[name] = value && typeof value === 'object' ? Object.assign({name}, value) : {name, value};
        }
        target.blocks.createBlock({
            id,
            opcode: block.opcode,
            parent,
            next: null,
            shadow: !!block.shadow,
            topLevel: !parent,
            inputs,
            fields,
            mutation: block.mutation
        });
        return id;
    };
    let previous = add(hat || {opcode: 'event_whenflagclicked'}, null);
    const top = previous;
    for (const block of stack) {
        const id = add(block, previous);
        target.blocks.getBlock(previous).next = id;
        previous = id;
    }
    return top;
};

/**
 * Put blocks inside a C block
 * @param {Target} target where the C block is
 * @param {string} parentId the C block
 * @param {Array<object>} stack blocks to put in it
 */
const addSubstack = (target, parentId, stack) => {
    const first = addScript(target, stack.slice(1), stack[0]);
    const block = target.blocks.getBlock(first);
    block.topLevel = false;
    block.parent = parentId;
    target.blocks.getBlock(parentId).inputs.SUBSTACK = {name: 'SUBSTACK', block: first, shadow: null};
};

const data = (op, inputs) => ({opcode: `twdata_${op}`, inputs});
const cloneVar = (op, inputs) => ({opcode: `twclonevars_${op}`, inputs});
const localVar = (op, inputs) => ({opcode: `twlocalvars_${op}`, inputs});
const say = message => ({opcode: 'looks_say', inputs: {MESSAGE: message}});

const run = (vm, frames = 5) => {
    vm.greenFlag();
    for (let i = 0; i < frames; i++) vm.runtime._step();
};

const variableValue = (target, name) => {
    const variable = DataPath.findVariable(target, name);
    return variable ? variable.value : void 0;
};

test('parsing paths', t => {
    const parse = (text, scope) => {
        const parsed = DataPath.parse(text, scope);
        return parsed && {scope: parsed.scope, steps: parsed.steps};
    };
    t.same(parse('score'), {scope: 'global', steps: [{key: 'score'}]}, 'global without a scope');
    t.same(parse('enemies[1].x'), {scope: 'global', steps: [{key: 'enemies'}, {index: 1}, {key: 'x'}]});
    t.same(parse('hp', 'self'), {scope: 'self', steps: [{key: 'hp'}]}, 'the block gives the scope');
    t.same(parse('i', 'local'), {scope: 'local', steps: [{key: 'i'}]});
    t.same(parse('self.敵人[2]'), {scope: 'self', steps: [{key: '敵人'}, {index: 2}]}, 'another scope');
    t.same(parse('["a.b"].c'), {scope: 'global', steps: [{key: 'a.b'}, {key: 'c'}]});
    t.same(parse('my var'), {scope: 'global', steps: [{key: 'my var'}]}, 'spaces inside names');
    t.same(parse('self'), {scope: 'self', steps: []});
    t.equal(parse(''), null);
    t.equal(parse('a[0]'), null, 'items start at 1');
    t.equal(parse('[1]'), null, 'the first step is a name');
    t.equal(parse('a[1'), null);
    t.equal(DataPath.variablePath(null, 'x.y'), '["x.y"]');
    t.equal(DataPath.variablePath(null, 'self'), '["self"]', 'names of scopes are quoted');
    t.equal(DataPath.variablePath(null, 'hp'), 'hp');
    t.equal(DataPath.variablePath('self', 'hp'), 'self.hp');
    t.same(DataPath.parseRelative('x[2].y'), [{key: 'x'}, {index: 2}, {key: 'y'}]);
    t.end();
});

for (const compiled of MODES) {
    test(`setting JSON objects directly (${modeName(compiled)})`, async t => {
        const {vm, sprite, stage, said} = await makeVM(compiled);
        const sample = '{"a":"嗨","b":""}';
        addScript(sprite, [
            data('setObject', {PATH: 'object', TEXT: sample}),
            say(data('get', {PATH: 'object.a'})),
            say(data('exists', {PATH: 'object.b'})),
            data('setObject', {PATH: 'self.list', TEXT: '[]'}),
            data('addItem', {PATH: 'self.list', ITEM: 'a'}),
            data('setObject', {PATH: 'local.object', TEXT: sample}),
            say(data('get', {PATH: 'local.object.a'})),
            data('setObject', {PATH: 'nested.object', TEXT: sample}),
            data('setObject', {PATH: 'copy', TEXT: data('get', {PATH: 'object'})}),
            data('set', {PATH: 'copy.a', VALUE: 'changed'}),
            data('set', {PATH: 'text', VALUE: sample}),
            ...['{bad', '123', 'true', 'null', '"text"'].map((text, i) =>
                data('setObject', {PATH: `invalid${i}`, TEXT: text}))
        ]);
        run(vm);
        t.same(said, ['嗨', 'true', '嗨']);
        t.same(variableValue(stage, 'object'), {a: '嗨', b: ''});
        t.same(variableValue(stage, 'nested'), {object: {a: '嗨', b: ''}});
        t.same(variableValue(sprite, 'list'), ['a']);
        t.equal(variableValue(stage, 'text'), sample, 'ordinary assignment preserves JSON text');
        for (let i = 0; i < 5; i++) t.equal(variableValue(stage, `invalid${i}`), '');
        t.end();
    });

    test(`reading and writing paths (${modeName(compiled)})`, async t => {
        const {vm, sprite, stage, said} = await makeVM(compiled);
        addScript(sprite, [
            data('set', {PATH: 'game.enemies[2].hp', VALUE: '5'}),
            cloneVar('setVariable', {NAME: 'hp', VALUE: '10'}),
            cloneVar('changeVariable', {NAME: 'hp', VALUE: 5}),
            data('change', {PATH: 'game.enemies[2].hp', VALUE: -1}),
            say(data('get', {PATH: 'game'})),
            say(data('get', {PATH: 'nothing.here'})),
            say(data('exists', {PATH: 'game.enemies[2]'})),
            say(data('exists', {PATH: 'game.enemies[3]'})),
            say(data('get', {PATH: 'not a path'})),
            data('set', {PATH: 'gone', VALUE: '1'}),
            data('delete', {PATH: 'gone'}),
            data('set', {PATH: 'obj.a', VALUE: '1'}),
            data('set', {PATH: 'obj.b', VALUE: '2'}),
            data('delete', {PATH: 'obj.a'})
        ]);
        run(vm);
        t.same(variableValue(stage, 'game'), {enemies: ['', {hp: 4}]}, 'objects and arrays made on the way');
        t.equal(Cast.toNumber(variableValue(sprite, 'hp')), 15, 'self is the sprite');
        t.notOk(DataPath.findVariable(stage, 'hp'), 'not on the stage');
        t.equal(said[0], '{"enemies":["",{"hp":4}]}', 'objects are shown as JSON');
        t.equal(said[1], '', 'missing paths are empty');
        t.equal(said[2], 'true');
        t.equal(said[3], 'false');
        t.equal(said[4], '', 'invalid paths are empty');
        t.notOk(DataPath.findVariable(stage, 'gone'), 'deleting a variable');
        t.same(variableValue(stage, 'obj'), {b: 2}, 'deleting a field');
        t.end();
    });

    test(`values are copied when stored (${modeName(compiled)})`, async t => {
        const {vm, sprite, stage} = await makeVM(compiled);
        addScript(sprite, [
            data('set', {PATH: 'a', VALUE: data('parseJSON', {TEXT: '{"x": 1, "list": [1, 2]}'})}),
            data('set', {PATH: 'b', VALUE: data('get', {PATH: 'a'})}),
            data('set', {PATH: 'b.x', VALUE: '9'}),
            data('addItem', {PATH: 'b.list', ITEM: '3'}),
            data('addItem', {PATH: 'items', ITEM: data('get', {PATH: 'a'})}),
            data('set', {PATH: 'a.x', VALUE: '2'})
        ]);
        run(vm);
        t.same(variableValue(stage, 'a'), {x: 2, list: [1, 2]}, 'a changed in place, b is a copy');
        t.same(variableValue(stage, 'b'), {x: 9, list: [1, 2, 3]});
        t.same(variableValue(stage, 'items'), [{x: 1, list: [1, 2]}], 'items are copied too');
        t.end();
    });

    test(`arrays and objects (${modeName(compiled)})`, async t => {
        const {vm, sprite, stage, said} = await makeVM(compiled);
        addScript(sprite, [
            data('addItem', {PATH: 'list', ITEM: 'a'}),
            data('addItem', {PATH: 'list', ITEM: 'b'}),
            data('addItem', {PATH: 'list', ITEM: 'c'}),
            data('insertItem', {PATH: 'list', INDEX: 1, ITEM: 'first'}),
            data('deleteItem', {PATH: 'list', INDEX: 'last'}),
            data('replaceItem', {PATH: 'list', INDEX: 2, ITEM: 'A'}),
            say(data('itemOf', {PATH: 'list', INDEX: 2})),
            say(data('indexOf', {PATH: 'list', ITEM: 'b'})),
            say(data('length', {PATH: 'list'})),
            say(data('contains', {PATH: 'list', ITEM: 'first'})),
            say(data('keys', {PATH: data('parseJSON', {TEXT: '{"x": 1, "y": 2}'})})),
            say(data('length', {PATH: data('emptyObject')})),
            say(data('itemOf', {PATH: data('get', {PATH: 'list'}), INDEX: 1})),
            say(data('listText', {PATH: 'list'})),
            data('set', {PATH: 'letters', VALUE: data('parseJSON', {TEXT: '["a", "b"]'})}),
            say(data('listText', {PATH: 'letters'})),
            data('clear', {PATH: 'letters'})
        ]);
        run(vm);
        t.same(variableValue(stage, 'list'), ['first', 'A', 'b']);
        t.same(said, ['A', '3', '3', 'true', '["x","y"]', '0', 'first', 'first A b', 'ab']);
        t.same(variableValue(stage, 'letters'), []);
        t.end();
    });

    test(`JSON (${modeName(compiled)})`, async t => {
        const {vm, sprite, said} = await makeVM(compiled);
        addScript(sprite, [
            say(data('parseJSON', {TEXT: '{not json'})),
            say(data('isJSON', {TEXT: '{not json'})),
            say(data('isJSON', {TEXT: '[1, 2]'})),
            say(data('getFrom', {VALUE: data('parseJSON', {TEXT: '{"a": [{"b": "deep"}]}'}), PATH: 'a[1].b'})),
            say({opcode: 'twdata_stringify',
                inputs: {VALUE: data('parseJSON', {TEXT: '{"a": 1}'})},
                fields: {STYLE: 'pretty'}}),
            say(data('getFrom', {VALUE: '{"typed": "json"}', PATH: 'typed'}))
        ]);
        run(vm);
        t.same(said, ['', 'false', 'true', 'deep', '{\n  "a": 1\n}', 'json']);
        t.end();
    });

    test(`built-in properties of self (${modeName(compiled)})`, async t => {
        const {vm, sprite, box, said} = await makeVM(compiled);
        addScript(sprite, [
            cloneVar('setVariable', {NAME: 'x', VALUE: '50'}),
            cloneVar('setVariable', {NAME: 'position.y', VALUE: '20'}),
            cloneVar('changeVariable', {NAME: 'direction', VALUE: 10}),
            say(cloneVar('getVariable', {NAME: 'name'})),
            say(cloneVar('getVariable', {NAME: 'position'})),
            cloneVar('setVariable', {NAME: 'name', VALUE: 'renamed'})
        ]);
        addScript(box, [
            cloneVar('setVariable', {NAME: 'position', VALUE: {opcode: 'twvector_vector', inputs: {X: 1, Y: 2, Z: 3}}}),
            cloneVar('setVariable', {NAME: 'rotation.y', VALUE: '90'}),
            cloneVar('setVariable', {NAME: 'scale', VALUE: '{"x": 2}'}),
            say(cloneVar('getVariable', {NAME: 'z'}))
        ]);
        run(vm);
        t.equal(sprite.x, 50, 'setting x moves the sprite');
        t.equal(sprite.y, 20, 'paths into built-ins');
        t.equal(sprite.direction, 100);
        t.equal(sprite.getName(), 'Sprite1', 'name is read only');
        t.same([box.x, box.y, box.z], [1, 2, 3]);
        t.equal(box.rotationY, 90);
        t.same([box.scaleX, box.scaleY, box.scaleZ], [2, 1, 1], 'missing parts stay the same');
        t.ok(said.includes('Sprite1'));
        t.ok(said.includes('{"x":50,"y":20,"z":0}'));
        t.ok(said.includes('3'));
        t.end();
    });

    test(`local variables of custom blocks (${modeName(compiled)})`, async t => {
        const {vm, sprite, stage} = await makeVM(compiled);
        // count (n): set local.i to n; if n > 0 then count (n - 1); add local.i to global.log
        const proccode = 'count %s';
        const mutation = {
            tagName: 'mutation',
            children: [],
            proccode,
            argumentids: '["arg"]',
            argumentnames: '["n"]',
            argumentdefaults: '[""]',
            warp: 'false'
        };
        const argument = {opcode: 'argument_reporter_string_number', fields: {VALUE: 'n'}};
        const definition = addScript(sprite, [
            localVar('setVariable', {NAME: 'i', VALUE: argument})
        ], {
            opcode: 'procedures_definition',
            inputs: {
                custom_block: {
                    opcode: 'procedures_prototype',
                    shadow: true,
                    mutation,
                    inputs: {arg: {opcode: 'argument_reporter_string_number', shadow: true, fields: {VALUE: 'n'}}}
                }
            }
        });
        let last = sprite.blocks.getBlock(sprite.blocks.getBlock(definition).next);
        // if n > 0 then count (n - 1)
        const ifBlock = addScript(sprite, [], {
            opcode: 'control_if',
            inputs: {CONDITION: {opcode: 'operator_gt', inputs: {OPERAND1: argument, OPERAND2: '0'}}}
        });
        sprite.blocks.getBlock(ifBlock).topLevel = false;
        sprite.blocks.getBlock(ifBlock).parent = last.id;
        last.next = ifBlock;
        addSubstack(sprite, ifBlock, [{
            opcode: 'procedures_call',
            mutation: {tagName: 'mutation', children: [], proccode, argumentids: '["arg"]', warp: 'false'},
            inputs: {arg: {opcode: 'operator_subtract', inputs: {NUM1: argument, NUM2: 1}}}
        }]);
        last = sprite.blocks.getBlock(ifBlock);
        const add = addScript(sprite, [], data('addItem', {PATH: 'log', ITEM: localVar('getVariable', {NAME: 'i'})}));
        sprite.blocks.getBlock(add).topLevel = false;
        sprite.blocks.getBlock(add).parent = last.id;
        last.next = add;

        addScript(sprite, [
            localVar('setVariable', {NAME: 'i', VALUE: 'script'}),
            {
                opcode: 'procedures_call',
                mutation: {tagName: 'mutation', children: [], proccode, argumentids: '["arg"]', warp: 'false'},
                inputs: {arg: 3}
            },
            data('addItem', {PATH: 'log', ITEM: localVar('getVariable', {NAME: 'i'})}),
            data('set', {PATH: 'scope', VALUE: {opcode: 'twlocalvars_local'}})
        ]);
        sprite.blocks.resetCache();
        run(vm, 10);
        t.same(variableValue(stage, 'log').map(Cast.toString), ['0', '1', '2', '3', 'script'],
            'every call has its own locals, and so has the script');
        t.same(variableValue(stage, 'scope'), {i: 'script'}, 'local as a value');
        t.end();
    });

    test(`clones copy self and release it (${modeName(compiled)})`, async t => {
        const {vm, sprite} = await makeVM(compiled);
        addScript(sprite, [
            cloneVar('setVariable', {NAME: 'stats', VALUE: data('parseJSON', {TEXT: '{"hp": 1}'})}),
            {
                opcode: 'control_create_clone_of',
                inputs: {CLONE_OPTION: {
                    opcode: 'control_create_clone_of_menu',
                    shadow: true,
                    fields: {CLONE_OPTION: '_myself_'}
                }}
            }
        ]);
        addScript(sprite, [
            cloneVar('changeVariable', {NAME: 'stats.hp', VALUE: 10}),
            cloneVar('setVariable', {NAME: 'onlyClone', VALUE: 'yes'})
        ], {opcode: 'control_start_as_clone'});
        run(vm);
        const clone = sprite.sprite.clones.find(c => !c.isOriginal);
        t.ok(clone, 'made a clone');
        t.same(variableValue(sprite, 'stats'), {hp: 1}, 'the original is unchanged');
        t.same(variableValue(clone, 'stats'), {hp: 11}, 'the clone has its own copy');
        t.equal(variableValue(clone, 'onlyClone'), 'yes');
        t.notOk(DataPath.findVariable(sprite, 'onlyClone'), 'variables made by clones stay on the clone');
        vm.stopAll();
        t.notOk(vm.runtime.targets.includes(clone), 'released with the clone');
        t.end();
    });

    test(`3D sprites give and take positions as objects (${modeName(compiled)})`, async t => {
        const {vm, sprite, box, said} = await makeVM(compiled);
        box.setXYZ(1, 2, 3);
        addScript(sprite, [
            say(data('getFrom', {
                VALUE: {opcode: 'sensing3d_vectorof',
                    inputs: {
                        SPRITE: {opcode: 'sensing3d_menu_vectorTarget', shadow: true, fields: {vectorTarget: 'Box'}}
                    },
                    fields: {VECTOR: 'position'}},
                PATH: 'z'
            }))
        ]);
        addScript(box, [
            {opcode: 'motion3d_gotoposition',
                inputs: {
                    POSITION: {opcode: 'twvector_add',
                        inputs: {
                            A: cloneVar('getVariable', {NAME: 'position'}),
                            B: '{"x": 10}'
                        }}
                },
                fields: {}}
        ]);
        run(vm);
        t.equal(said[0], '3', '(Box 的位置) has x, y and z');
        t.same([box.x, box.y, box.z], [11, 2, 3], 'move to a position object');
        t.end();
    });

    test(`the text block (${modeName(compiled)})`, async t => {
        const {vm, sprite, said} = await makeVM(compiled);
        const text = value => ({opcode: 'data_text', fields: {TEXT: value}});
        addScript(sprite, [
            cloneVar('setVariable', {NAME: 'hp', VALUE: '7'}),
            localVar('setVariable', {NAME: 'who', VALUE: 'me'}),
            say(text('line 1\nline 2')),
            // eslint-disable-next-line no-template-curly-in-string
            say(text('hp: ${self.hp}, ${local.who}, ${missing}, ${a[0]} $5')),
            // eslint-disable-next-line no-template-curly-in-string
            say(text('${self.position}'))
        ]);
        run(vm);
        t.equal(said[0], 'line 1\nline 2', 'line breaks');
        // eslint-disable-next-line no-template-curly-in-string
        t.equal(said[1], 'hp: 7, me, , ${a[0]} $5', 'paths are filled in, other text stays');
        t.equal(said[2], `{"x":${sprite.x},"y":${sprite.y},"z":0}`);
        t.end();
    });

    test(`clone ids (${modeName(compiled)})`, async t => {
        const {vm, sprite, stage} = await makeVM(compiled);
        const createClone = id => ({opcode: 'control_create_clone_of',
            inputs: Object.assign({
                CLONE_OPTION: {opcode: 'control_create_clone_of_menu', shadow: true, fields: {CLONE_OPTION: '_myself_'}}
            }, typeof id === 'undefined' ? {} : {ID: id})});
        // Run on the stage, so that the clones don't run them too
        const clones = (op, inputs) => ({opcode: `twclonevars_${op}`,
            inputs: Object.assign({
                SPRITE: {opcode: 'twclonevars_menu_sprite', shadow: true, fields: {sprite: 'Sprite1'}}
            }, inputs)});
        addScript(sprite, [
            createClone(), // old block without an id: 1
            createClone(''), // 2
            createClone('boss'),
            createClone('boss'),
            createClone(7)
        ]);
        // when I start as a clone (id): add id to global.ids; set self.hp to 100
        addScript(sprite, [
            data('addItem', {PATH: 'ids', ITEM: {opcode: 'control_start_as_clone_id', shadow: true}}),
            cloneVar('setVariable', {NAME: 'hp', VALUE: '100'})
        ], {opcode: 'control_start_as_clone', inputs: {ID: {opcode: 'control_start_as_clone_id', shadow: true}}});
        run(vm, 3);
        t.same(variableValue(stage, 'ids'), [1, 2, 'boss', 'boss', 7], 'ids, numbered when empty');
        const byId = id => sprite.sprite.clones.filter(c => !c.isOriginal && c.cloneId === id);
        t.equal(byId('boss').length, 2, 'ids can repeat');

        // Reading and changing clones by id, then deleting them
        const stack = [
            data('set', {PATH: 'bossHp', VALUE: clones('getOfClone', {ID: 'boss', NAME: 'hp'})}),
            clones('setOfClone', {ID: 7, NAME: 'hp', VALUE: '1'}),
            data('set', {PATH: 'sevenHp', VALUE: clones('getOfClone', {ID: '7', NAME: 'self.hp'})}),
            data('set', {PATH: 'bossExists', VALUE: clones('cloneExists', {ID: 'boss'})}),
            clones('deleteClones', {ID: 'boss'}),
            data('set', {PATH: 'bossGone', VALUE: clones('cloneExists', {ID: 'boss'})})
        ];
        addScript(stage, stack, {opcode: 'event_whenbroadcastreceived',
            fields: {BROADCAST_OPTION: {value: 'go', id: 'go-id', variableType: 'broadcast_msg'}}});
        stage.createVariable('go-id', 'go', 'broadcast_msg');
        vm.runtime.startHats('event_whenbroadcastreceived', {BROADCAST_OPTION: 'go'});
        for (let i = 0; i < 3; i++) vm.runtime._step();
        t.equal(Cast.toNumber(variableValue(stage, 'bossHp')), 100);
        t.equal(Cast.toNumber(variableValue(stage, 'sevenHp')), 1, 'numbers and number text are the same id');
        t.equal(variableValue(stage, 'bossExists'), true);
        t.equal(variableValue(stage, 'bossGone'), false, 'deleted every clone with the id');
        t.equal(byId('boss').length, 0);
        t.equal(byId(1).length, 1, 'other clones stay');
        t.equal(DataPath.get(sprite, null, 'self.id'), 0, 'originals have id 0');
        t.equal(DataPath.get(byId(2)[0], null, 'self.id'), 2);

        // Numbers start again when the clones are gone
        vm.stopAll();
        stage.variables = {};
        run(vm, 3);
        t.same(variableValue(stage, 'ids'), [1, 2, 'boss', 'boss', 7]);
        t.end();
    });
}

// A project.json made by older versions: Scratch's variable and list blocks, and the 變數, 分身變數 and 區域變數
// blocks of the old extensions
const oldProject = format => {
    const text = value => [1, [10, value]];
    return {
        meta: format === '3dsb' ? {semver: '3.0.0', format: '3dsb', formatVersion: 2} : {semver: '3.0.0'},
        extensions: ['twvars', 'twclonevars', 'twlocalvars'],
        targets: [
            {
                isStage: true,
                name: 'Stage',
                variables: {v1: ['score', 5], v2: ['same', 'var']},
                lists: {l1: ['same', ['a', 'b']], l2: ['letters', ['x', 'y']]},
                broadcasts: {},
                blocks: {},
                comments: {},
                currentCostume: 0,
                costumes: [{name: 'backdrop1',
                    dataFormat: 'svg',
                    assetId: 'cd21514d0531fdffb22204e0ec5ed84a',
                    md5ext: 'cd21514d0531fdffb22204e0ec5ed84a.svg',
                    rotationCenterX: 240,
                    rotationCenterY: 180}],
                sounds: [],
                volume: 100,
                layerOrder: 0
            },
            {
                isStage: false,
                name: 'Sprite1',
                variables: {v3: ['x', 'my x'], v4: ['mine', 1]},
                lists: {},
                broadcasts: {},
                blocks: {
                    hat: {opcode: 'event_whenflagclicked',
                        next: 'b1',
                        parent: null,
                        inputs: {},
                        fields: {},
                        shadow: false,
                        topLevel: true,
                        x: 0,
                        y: 0},
                    b1: {opcode: 'data_changevariableby',
                        next: 'b2',
                        parent: 'hat',
                        inputs: {VALUE: [1, [4, '1']]},
                        fields: {VARIABLE: ['score', 'v1']},
                        shadow: false,
                        topLevel: false},
                    b2: {opcode: 'data_addtolist',
                        next: 'b3',
                        parent: 'b1',
                        inputs: {ITEM: text('c')},
                        fields: {LIST: ['same', 'l1']},
                        shadow: false,
                        topLevel: false},
                    b3: {opcode: 'twvars_setVariable',
                        next: 'b4',
                        parent: 'b2',
                        inputs: {NAME: text('fromTwVars'), VALUE: text('tw')},
                        fields: {},
                        shadow: false,
                        topLevel: false},
                    b4: {opcode: 'twclonevars_changeVariable',
                        next: 'b5',
                        parent: 'b3',
                        inputs: {NAME: text('mine'), VALUE: [1, [4, '2']]},
                        fields: {},
                        shadow: false,
                        topLevel: false},
                    b5: {opcode: 'twlocalvars_setVariable',
                        next: 'b6',
                        parent: 'b4',
                        inputs: {NAME: text('tmp'), VALUE: text('local value')},
                        fields: {},
                        shadow: false,
                        topLevel: false},
                    b6: {opcode: 'twvars_setVariable',
                        next: 'b7',
                        parent: 'b5',
                        inputs: {NAME: text('copied'), VALUE: [3, 'r1', [10, '']]},
                        fields: {},
                        shadow: false,
                        topLevel: false},
                    r1: {opcode: 'twlocalvars_getVariable',
                        next: null,
                        parent: 'b6',
                        inputs: {NAME: text('tmp')},
                        fields: {},
                        shadow: false,
                        topLevel: false},
                    b7: {opcode: 'data_setvariableto',
                        next: 'b8',
                        parent: 'b6',
                        inputs: {VALUE: [3, 'r2', [10, '']]},
                        fields: {VARIABLE: ['x', 'v3']},
                        shadow: false,
                        topLevel: false},
                    r2: {opcode: 'data_listcontents',
                        next: null,
                        parent: 'b7',
                        inputs: {},
                        fields: {LIST: ['letters', 'l2']},
                        shadow: false,
                        topLevel: false},
                    b8: {opcode: 'twvars_addToList',
                        next: 'b9',
                        parent: 'b7',
                        inputs: {NAME: text('same'), ITEM: text('d')},
                        fields: {},
                        shadow: false,
                        topLevel: false},
                    b9: {opcode: 'twclonevars_addToList',
                        next: null,
                        parent: 'b8',
                        inputs: {NAME: text('inventory'), ITEM: text('sword')},
                        fields: {},
                        shadow: false,
                        topLevel: false}
                },
                comments: {},
                currentCostume: 0,
                costumes: [{name: 'costume1',
                    dataFormat: 'svg',
                    assetId: 'cd21514d0531fdffb22204e0ec5ed84a',
                    md5ext: 'cd21514d0531fdffb22204e0ec5ed84a.svg',
                    rotationCenterX: 0,
                    rotationCenterY: 0}],
                sounds: [],
                volume: 100,
                layerOrder: 1,
                visible: true,
                x: 0,
                y: 0,
                size: 100,
                direction: 90,
                draggable: false,
                rotationStyle: 'all around',
                kind: '2d'
            }
        ],
        monitors: []
    };
};

for (const format of ['sb3', '3dsb']) {
    for (const compiled of MODES) {
        test(`converting variable blocks of old .${format} projects (${modeName(compiled)})`, async t => {
            const vm = new VirtualMachine();
            vm.attachStorage(makeTestStorage());
            vm.setCompilerOptions({enabled: compiled});
            await vm.loadProject(JSON.stringify(oldProject(format)));
            const stage = vm.runtime.getTargetForStage();
            const sprite = vm.runtime.targets.find(target => target.getName() === 'Sprite1');

            const opcodes = Object.values(sprite.blocks._blocks).map(block => block.opcode);
            t.notOk(opcodes.some(opcode => /^(data_|twvars_|twclonevars_addToList)/.test(opcode)),
                'no old blocks left');
            const names = Object.values(sprite.blocks._blocks)
                .filter(block => block.inputs.PATH ||
                    (block.inputs.NAME && /^twclonevars_|^twlocalvars_/.test(block.opcode)))
                .map(block => `${block.opcode.split('_')[0]}:${
                    sprite.blocks.getBlock((block.inputs.PATH || block.inputs.NAME).shadow).fields.TEXT.value}`);
            t.same(names.sort(), [
                'twdata:copied', 'twdata:fromTwVars', 'twdata:letters', 'twdata:same 清單', 'twdata:same 清單',
                'twdata:score', 'twlocalvars:tmp', 'twlocalvars:tmp', 'twclonevars:mine', 'twclonevars:x 變數',
                'twdata:self.inventory'
            ].sort(), 'global variables are 資料 blocks, sprite variables 分身變數 blocks');
            t.equal(DataPath.findVariable(stage, 'same 清單').value.length, 2,
                'a list with the name of a variable is renamed');
            t.ok(DataPath.findVariable(sprite, 'x 變數'), 'sprite variables named like built-ins are renamed');
            t.notOk(vm.extensionManager.isExtensionLoaded('twvars'), 'old extensions are not loaded');

            run(vm);
            t.equal(Cast.toNumber(variableValue(stage, 'score')), 6);
            t.same(variableValue(stage, 'same 清單'), ['a', 'b', 'c', 'd'], '清單 blocks follow the renamed list');
            t.same(variableValue(stage, 'same'), 'var', 'the variable with the name is not touched');
            t.equal(variableValue(stage, 'fromTwVars'), 'tw');
            t.equal(Cast.toNumber(variableValue(sprite, 'mine')), 3);
            t.equal(variableValue(stage, 'copied'), 'local value');
            t.equal(variableValue(sprite, 'x 變數'), 'xy', 'old list reporters join the items like Scratch');
            t.equal(sprite.x, 0, 'the sprite did not move');
            t.same(variableValue(sprite, 'inventory'), ['sword']);

            // Saved projects keep the path blocks, and load the same
            const saved = JSON.parse(vm.toJSON());
            t.notOk(saved.extensions.includes('twvars'));
            const vm2 = new VirtualMachine();
            vm2.attachStorage(makeTestStorage());
            await vm2.loadProject(JSON.stringify(saved));
            const sprite2 = vm2.runtime.targets.find(target => target.getName() === 'Sprite1');
            const texts = target => Object.values(target.blocks._blocks)
                .map(block => block.opcode + (block.fields.TEXT ? `:${block.fields.TEXT.value}` : ''))
                .sort();
            t.same(texts(sprite2), texts(sprite), 'loading again changes nothing');
            t.end();
        });
    }
}

test('old clone blocks get their id inputs', async t => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());
    const json = oldProject('sb3');
    json.targets[1].blocks = {
        hat: {opcode: 'control_start_as_clone',
            next: 'c',
            parent: null,
            inputs: {},
            fields: {},
            shadow: false,
            topLevel: true,
            x: 0,
            y: 0},
        c: {opcode: 'control_create_clone_of',
            next: null,
            parent: 'hat',
            inputs: {CLONE_OPTION: [1, 'm']},
            fields: {},
            shadow: false,
            topLevel: false},
        m: {opcode: 'control_create_clone_of_menu',
            next: null,
            parent: 'c',
            inputs: {},
            fields: {CLONE_OPTION: ['_myself_', null]},
            shadow: true,
            topLevel: false}
    };
    await vm.loadProject(JSON.stringify(json));
    const sprite = vm.runtime.targets.find(target => target.getName() === 'Sprite1');
    const blocks = Object.values(sprite.blocks._blocks);
    const hat = blocks.find(block => block.opcode === 'control_start_as_clone');
    const create = blocks.find(block => block.opcode === 'control_create_clone_of');
    t.equal(sprite.blocks.getBlock(hat.inputs.ID.shadow).opcode, 'control_start_as_clone_id');
    t.equal(sprite.blocks.getBlock(create.inputs.ID.shadow).fields.TEXT.value, '');
    t.end();
});

test('new projects keep their names when loaded again', async t => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());
    const json = oldProject('3dsb');
    json.meta.formatVersion = 3;
    json.targets[1].variables = {};
    json.targets[1].blocks = {
        hat: {opcode: 'event_whenflagclicked',
            next: 'b',
            parent: null,
            inputs: {},
            fields: {},
            shadow: false,
            topLevel: true,
            x: 0,
            y: 0},
        b: {opcode: 'twclonevars_setVariable',
            next: null,
            parent: 'hat',
            inputs: {NAME: [1, [10, 'x']], VALUE: [1, [10, '50']]},
            fields: {},
            shadow: false,
            topLevel: false}
    };
    await vm.loadProject(JSON.stringify(json));
    run(vm);
    const sprite = vm.runtime.targets.find(target => target.getName() === 'Sprite1');
    t.equal(sprite.x, 50, '設定分身變數 x moves the sprite');
    t.notOk(DataPath.findVariable(sprite, 'x 變數'));
    t.end();
});

test('clicking path reporters compiles and shows their value', async t => {
    const {vm, sprite} = await makeVM(true);
    const errors = [];
    vm.on('COMPILE_ERROR', (target, error) => errors.push(error));
    const reports = [];
    // Only the sprite being edited shows reports
    vm.setEditingTarget(sprite.id);
    vm.runtime.on('VISUAL_REPORT', report => reports.push(report.value));
    DataPath.set(sprite, null, DataPath.parse('hp', 'self'), 5);
    for (const opcode of ['twclonevars_self', 'twdata_global', 'twlocalvars_local']) {
        const id = addScript(sprite, [], {opcode});
        vm.runtime.toggleScript(id, {target: sprite, stackClick: true});
        vm.runtime._step();
    }
    const get = addScript(sprite, [], {opcode: 'twclonevars_getVariable', inputs: {NAME: 'hp'}});
    vm.runtime.toggleScript(get, {target: sprite, stackClick: true});
    vm.runtime._step();
    t.same(errors, [], 'no compile errors');
    t.equal(reports.length, 4);
    t.equal(Cast.toString(reports[3]), '5');
    t.end();
});

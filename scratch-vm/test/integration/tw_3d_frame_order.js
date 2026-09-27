// The order of things in a frame: per-frame hats, "broadcast and wait" within a frame, and calling custom blocks of
// other sprites (ROADMAP.md 6.6).
const {test} = require('tap');
require('../fixtures/tw_mock_blob');
const fs = require('fs');
const pathUtil = require('path');
const VirtualMachine = require('../../src/virtual-machine');
const Runtime = require('../../src/engine/runtime');
const makeTestStorage = require('../fixtures/make-test-storage');
const {addScript} = require('../fixtures/tw-3d-scripts');

const sb3Fixture = fs.readFileSync(pathUtil.join(__dirname, '..', 'fixtures', 'tw-save-project-sb3.sb3'));

/**
 * @param {boolean} compiled false to use the interpreter
 * @returns {Promise<object>} a VM with the 2D sprite "Sprite1", the 3D sprite "Box" and a global variable "log"
 */
const makeVM = async compiled => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());
    await vm.loadProject(sb3Fixture);
    if (compiled === false) vm.setCompilerOptions({enabled: false});
    await vm.addSprite3D({name: 'Box', models: [{name: 'cube', shape: 'cube'}]});
    const find = name => vm.runtime.targets.find(t => t.getName() === name);
    const stage = vm.runtime.getTargetForStage();
    const log = stage.lookupOrCreateVariable('log', 'log');
    log.value = '';
    return {vm, stage, log, sprite: find('Sprite1'), box: find('Box')};
};

// Blocks that add text to the global variable "log"
const append = text => ({
    opcode: 'data_setvariableto',
    fields: {VARIABLE: {value: 'log', id: 'log'}},
    inputs: {VALUE: {
        opcode: 'operator_join',
        inputs: {
            STRING1: {opcode: 'data_variable', fields: {VARIABLE: {value: 'log', id: 'log'}}},
            STRING2: text
        }
    }}
});
const everyFrame = phase => ({opcode: 'control_whenframe', fields: {PHASE: phase}});
const forever = stack => ({opcode: 'control_forever', inputs: {SUBSTACK: stack}});

const step = (vm, frames) => {
    for (let i = 0; i < frames; i++) vm.runtime._step();
};

for (const compiled of [true, false]) {
    const mode = compiled ? 'compiled' : 'interpreted';

    test(`${mode}: update, other scripts, physics, after update`, async t => {
        const {vm, log, box} = await makeVM(compiled);
        vm.runtime.on(Runtime.PHYSICS_STEP, () => {
            log.value += 'P';
        });
        addScript(box, [append('L')], everyFrame('lateupdate'));
        // Moving a 3D sprite asks for a redraw, so the loop runs once per frame
        addScript(box, [forever([
            append('N'),
            {opcode: 'motion3d_changeaxis', fields: {AXIS: 'y'}, inputs: {VALUE: 1}}
        ])]);
        addScript(box, [append('U')], everyFrame('update'));
        vm.greenFlag();
        log.value = '';
        step(vm, 3);
        t.equal(log.value, 'UNPL'.repeat(3), 'the same order in every frame');
        t.end();
    });

    test(`${mode}: moves in update are seen in after update of the same frame`, async t => {
        const {vm, log, box} = await makeVM(compiled);
        addScript(box, [{opcode: 'motion3d_changeaxis', fields: {AXIS: 'x'}, inputs: {VALUE: 1}}],
            everyFrame('update'));
        addScript(box, [{
            opcode: 'data_setvariableto',
            fields: {VARIABLE: {value: 'log', id: 'log'}},
            inputs: {VALUE: {opcode: 'motion3d_xposition'}}
        }], everyFrame('lateupdate'));
        vm.greenFlag();
        step(vm, 1);
        t.equal(log.value, 1);
        step(vm, 4);
        t.equal(log.value, 5, 'once per frame');
        t.end();
    });

    test(`${mode}: per-frame scripts only run between the green flag and stopping`, async t => {
        const {vm, log, box} = await makeVM(compiled);
        addScript(box, [append('U')], everyFrame('update'));
        step(vm, 2);
        t.equal(log.value, '', 'not while editing');
        vm.greenFlag();
        step(vm, 2);
        t.equal(log.value, 'UU');
        t.ok(vm.runtime.isGameRunning(), 'the game runs even though every script finished');
        vm.stopAll();
        step(vm, 2);
        t.equal(log.value, 'UU', 'stopped');
        t.notOk(vm.runtime.isGameRunning());
        t.end();
    });

    test(`${mode}: a script still waiting skips its hat, and doesn't hold up others`, async t => {
        const {vm, log, box, sprite} = await makeVM(compiled);
        addScript(box, [append('W'), {opcode: 'control_wait', inputs: {DURATION: 10}}], everyFrame('update'));
        addScript(sprite, [append('U')], everyFrame('update'));
        vm.greenFlag();
        step(vm, 3);
        t.equal(log.value, 'WUUU', 'not restarted while waiting');
        const threads = vm.runtime.threads.filter(thread => thread.framePhase === 'update');
        t.equal(threads.length, 1, 'only the waiting script is left');
        t.end();
    });

    test(`${mode}: clones run their own per-frame scripts`, async t => {
        const {vm, log, box} = await makeVM(compiled);
        addScript(box, [append('C')], everyFrame('update'));
        vm.greenFlag();
        vm.runtime.addTarget(box.makeClone());
        vm.runtime.addTarget(box.makeClone());
        step(vm, 1);
        t.equal(log.value, 'CCC');
        t.end();
    });

    test(`${mode}: broadcast and wait chains finish in one frame`, async t => {
        const {vm, stage, log, sprite, box} = await makeVM(compiled);
        stage.createVariable('a', 'a', 'broadcast_msg');
        stage.createVariable('b', 'b', 'broadcast_msg');
        const broadcastAndWait = name => ({
            opcode: 'event_broadcastandwait',
            inputs: {BROADCAST_INPUT: {
                opcode: 'event_broadcast_menu',
                shadow: true,
                fields: {BROADCAST_OPTION: {value: name, id: name, variableType: 'broadcast_msg'}}
            }}
        });
        addScript(sprite, [append('1'), broadcastAndWait('a'), append('2'), broadcastAndWait('b'), append('3')]);
        // Moving asks for a redraw, which used to end the frame after each link of the chain
        addScript(box, [{opcode: 'motion3d_changeaxis', fields: {AXIS: 'x'}, inputs: {VALUE: 1}}, append('a')],
            {opcode: 'event_whenbroadcastreceived', fields: {BROADCAST_OPTION: {value: 'a', id: 'a'}}});
        addScript(box, [{opcode: 'motion3d_changeaxis', fields: {AXIS: 'x'}, inputs: {VALUE: 1}}, append('b')],
            {opcode: 'event_whenbroadcastreceived', fields: {BROADCAST_OPTION: {value: 'b', id: 'b'}}});
        vm.greenFlag();
        step(vm, 1);
        t.equal(log.value, '1a2b3', 'all in the first frame');
        t.end();
    });

    test(`${mode}: waiting for broadcast scripts that wait still takes frames`, async t => {
        const {vm, stage, log, sprite, box} = await makeVM(compiled);
        stage.createVariable('a', 'a', 'broadcast_msg');
        addScript(sprite, [
            {
                opcode: 'event_broadcastandwait',
                inputs: {BROADCAST_INPUT: {
                    opcode: 'event_broadcast_menu',
                    shadow: true,
                    fields: {BROADCAST_OPTION: {value: 'a', id: 'a', variableType: 'broadcast_msg'}}
                }}
            },
            append('done')
        ]);
        addScript(box, [{opcode: 'control_wait', inputs: {DURATION: 0.05}}, append('a')],
            {opcode: 'event_whenbroadcastreceived', fields: {BROADCAST_OPTION: {value: 'a', id: 'a'}}});
        vm.greenFlag();
        step(vm, 1);
        t.equal(log.value, '', 'nothing yet');
        await new Promise(resolve => setTimeout(resolve, 80));
        step(vm, 3);
        t.equal(log.value, 'adone');
        t.end();
    });
}

// Custom blocks of other sprites

/**
 * Give a target a custom block.
 * @param {Target} target the sprite that gets it
 * @param {string} proccode e.g. 'jump %s'
 * @param {string[]} names names of the arguments
 * @param {object[]} body blocks of the definition, see addScript
 * @param {object} [options] {warp, prototypeId, argumentIds}
 * @returns {{prototypeId: string, argumentIds: string[]}} ids that calling blocks use
 */
const addProcedure = (target, proccode, names, body, options = {}) => {
    const prototypeId = options.prototypeId || `proto_${proccode}_${target.getName()}`;
    const argumentIds = options.argumentIds || names.map(name => `arg_${name}`);
    const inputs = {};
    names.forEach((name, index) => {
        inputs[argumentIds[index]] = {
            opcode: 'argument_reporter_string_number',
            shadow: true,
            fields: {VALUE: name}
        };
    });
    addScript(target, body, {
        opcode: 'procedures_definition',
        inputs: {
            custom_block: {
                id: prototypeId,
                opcode: 'procedures_prototype',
                shadow: true,
                inputs,
                mutation: {
                    proccode,
                    argumentids: JSON.stringify(argumentIds),
                    argumentnames: JSON.stringify(names),
                    argumentdefaults: JSON.stringify(names.map(() => '')),
                    warp: options.warp ? 'true' : 'false'
                }
            }
        }
    });
    return {prototypeId, argumentIds};
};

const argument = name => ({opcode: 'argument_reporter_string_number', fields: {VALUE: name}});

/**
 * A block that calls a custom block of another sprite.
 * @param {string} opcode procedures_callsprite, procedures_callsprite_each, procedures_callsprite_id or
 * procedures_callsprite_reporter
 * @param {string} sprite name of the sprite to call
 * @param {string} proccode the custom block's proccode
 * @param {{prototypeId: string, argumentIds: string[]}} procedure from addProcedure
 * @param {Array} values argument values
 * @param {object} [inputs] more inputs, e.g. ID
 * @returns {object} the block, see addScript
 */
const callBlock = (opcode, sprite, proccode, procedure, values, inputs) => {
    const allInputs = Object.assign({}, inputs);
    procedure.argumentIds.forEach((id, index) => {
        allInputs[id] = values[index];
    });
    return {
        opcode,
        fields: {SPRITE: sprite},
        inputs: allInputs,
        mutation: {
            proccode,
            prototypeid: procedure.prototypeId,
            argumentids: JSON.stringify(procedure.argumentIds),
            argumentnames: '[]'
        }
    };
};

for (const compiled of [true, false]) {
    const mode = compiled ? 'compiled' : 'interpreted';

    test(`${mode}: calling another sprite runs right away, as that sprite`, async t => {
        const {vm, log, sprite, box} = await makeVM(compiled);
        const jump = addProcedure(box, 'jump %s', ['height'], [
            {opcode: 'motion3d_setaxis', fields: {AXIS: 'y'}, inputs: {VALUE: argument('height')}},
            append('J')
        ]);
        addScript(sprite, [
            append('1'),
            callBlock('procedures_callsprite', 'Box', 'jump %s', jump, [7]),
            append('2')
        ]);
        sprite.setXY(0, 0);
        vm.greenFlag();
        step(vm, 1);
        t.equal(log.value, '1J2', 'in order, without waiting for another script');
        t.equal(box.y, 7, 'moves the sprite that was called');
        t.same([sprite.x, sprite.y], [0, 0], 'not the caller');
        t.end();
    });

    test(`${mode}: the stage runs the game loop by calling sprites in the update phase`, async t => {
        const {vm, stage, log, box, sprite} = await makeVM(compiled);
        const step1 = addProcedure(box, 'think', [], [append('B')]);
        const step2 = addProcedure(sprite, 'think', [], [append('S')]);
        addScript(stage, [
            callBlock('procedures_callsprite', 'Sprite1', 'think', step2, []),
            callBlock('procedures_callsprite', 'Box', 'think', step1, [])
        ], everyFrame('update'));
        vm.greenFlag();
        step(vm, 2);
        t.equal(log.value, 'SBSB', 'in the order of the calls, every frame');
        t.end();
    });

    test(`${mode}: calling each clone, or clones by id`, async t => {
        const {vm, log, sprite, box} = await makeVM(compiled);
        const hello = addProcedure(box, 'hello %s', ['text'], [append(argument('text'))]);
        addScript(sprite, [
            callBlock('procedures_callsprite_each', 'Box', 'hello %s', hello, ['x']),
            callBlock('procedures_callsprite_id', 'Box', 'hello %s', hello, ['y'], {ID: 'b'}),
            callBlock('procedures_callsprite_id', 'Box', 'hello %s', hello, ['z'], {ID: 'nobody'})
        ]);
        // The green flag deletes clones
        vm.greenFlag();
        const first = box.makeClone();
        first.cloneId = 'a';
        vm.runtime.addTarget(first);
        const second = box.makeClone();
        second.cloneId = 'b';
        vm.runtime.addTarget(second);
        step(vm, 1);
        t.equal(log.value, 'xxxy', 'the sprite and both clones, then the clone with id b');
        t.end();
    });

    test(`${mode}: reporters get what the custom block returns`, async t => {
        const {vm, log, sprite, box} = await makeVM(compiled);
        box.setXYZ(0, 0, 4);
        const depth = addProcedure(box, 'depth plus %s', ['n'], [{
            opcode: 'procedures_return',
            inputs: {VALUE: {
                opcode: 'operator_add',
                inputs: {NUM1: {opcode: 'motion3d_zposition'}, NUM2: argument('n')}
            }}
        }]);
        addScript(sprite, [{
            opcode: 'data_setvariableto',
            fields: {VARIABLE: {value: 'log', id: 'log'}},
            inputs: {VALUE: callBlock('procedures_callsprite_reporter', 'Box', 'depth plus %s', depth, [3])}
        }]);
        vm.greenFlag();
        step(vm, 1);
        t.equal(log.value, 7);
        t.end();
    });

    test(`${mode}: renamed custom blocks still work; missing ones do nothing`, async t => {
        const {vm, log, sprite, box} = await makeVM(compiled);
        const hop = addProcedure(box, 'hop', [], [append('H')]);
        addScript(sprite, [
            callBlock('procedures_callsprite', 'Box', 'hop', hop, []),
            callBlock('procedures_callsprite', 'Box', 'fly', {prototypeId: 'nope', argumentIds: []}, []),
            callBlock('procedures_callsprite', 'Nobody', 'hop', hop, []),
            append('.')
        ]);
        // Renaming changes the prototype's proccode; its id stays
        box.blocks.getBlock(hop.prototypeId).mutation.proccode = 'hop around';
        box.blocks.resetCache();
        vm.greenFlag();
        step(vm, 1);
        t.equal(log.value, 'H.');
        t.end();
    });

    test(`${mode}: waiting in the called custom block makes the caller wait`, async t => {
        const {vm, log, sprite, box} = await makeVM(compiled);
        const slow = addProcedure(box, 'slow', [], [
            append('a'),
            {opcode: 'control_wait', inputs: {DURATION: 0.05}},
            append('b')
        ]);
        addScript(sprite, [callBlock('procedures_callsprite', 'Box', 'slow', slow, []), append('c')]);
        vm.greenFlag();
        step(vm, 2);
        t.equal(log.value, 'a', 'still waiting');
        await new Promise(resolve => setTimeout(resolve, 80));
        step(vm, 2);
        t.equal(log.value, 'abc');
        t.end();
    });
}

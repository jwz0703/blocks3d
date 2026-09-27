const path = require('path');
const test = require('tap').test;
const makeTestStorage = require('../fixtures/make-test-storage');
const readFileToBuffer = require('../fixtures/readProjectFile').readFileToBuffer;
const VirtualMachine = require('../../src/index');
const Variable = require('../../src/engine/variable');
const StringUtil = require('../../src/util/string-util');

const projectUri = path.resolve(__dirname, '../fixtures/variable_characters.sb2');
const project = readFileToBuffer(projectUri);

test('importing sb2 project with special chars in variable names', t => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());

    // Evaluate playground data and exit
    vm.on('playgroundData', e => {
        const threads = JSON.parse(e.threads);
        // All monitors should create threads that finish during the step and
        // are revoved from runtime.threads.
        t.equal(threads.length, 0);

        // we care that the last step updated the right number of monitors
        // we don't care whether the last step ran other threads or not
        const lastStepUpdatedMonitorThreads = vm.runtime._lastStepDoneThreads.filter(thread => thread.updateMonitor);
        t.equal(lastStepUpdatedMonitorThreads.length, 3);

        t.equal(vm.runtime.targets.length, 3);

        const stage = vm.runtime.targets[0];
        const cat = vm.runtime.targets[1];
        const bananas = vm.runtime.targets[2];

        const abVarId = Object.keys(stage.variables).filter(k => stage.variables[k].name === 'a&b')[0];
        const abVar = stage.variables[abVarId];
        const abMonitor = vm.runtime._monitorState.get(abVarId);
        // Check for unsafe characters, replaceUnsafeChars should just result in the original string
        // (e.g. there was nothing to replace)
        // Check that the variable ID does not have any unsafe characters
        t.equal(StringUtil.replaceUnsafeChars(abVarId), abVarId);
        // Check that the monitor record ID does not have any unsafe characters
        t.equal(StringUtil.replaceUnsafeChars(abMonitor.id), abMonitor.id);

        // Check that the variable still has the correct info
        t.equal(StringUtil.replaceUnsafeChars(abVar.id), abVar.id);
        t.equal(abVar.id, abVarId);
        t.equal(abVar.type, Variable.LIST_TYPE);
        t.equal(abVar.value[0], 'thing');
        t.equal(abVar.value[1], 'thing\'1');

        // Variable and list blocks become path blocks when loaded (ROADMAP.md 4.12): find them by path.
        // There should be 3, 2 on the stage, and one on the cat
        // (global variables are 資料 blocks, variables of sprites 分身變數 blocks)
        const pathsOf = target => Object.values(target.blocks._blocks)
            .filter(block => block.inputs.PATH || (block.inputs.NAME && block.opcode.startsWith('twclonevars_')))
            .map(block => target.blocks.getBlock((block.inputs.PATH || block.inputs.NAME).shadow).fields.TEXT.value);
        t.equal(pathsOf(stage).filter(p => p === 'a&b').length, 2);
        t.equal(pathsOf(cat).filter(p => p === 'a&b').length, 1);

        const fooVarId = Object.keys(stage.variables).filter(k => stage.variables[k].name === '"foo')[0];
        const fooVar = stage.variables[fooVarId];
        const fooMonitor = vm.runtime._monitorState.get(fooVarId);
        // Check for unsafe characters, replaceUnsafeChars should just result in the original string
        // (e.g. there was nothing to replace)
        // Check that the variable ID does not have any unsafe characters
        t.equal(StringUtil.replaceUnsafeChars(fooVarId), fooVarId);
        // Check that the monitor record ID does not have any unsafe characters
        t.equal(StringUtil.replaceUnsafeChars(fooMonitor.id), fooMonitor.id);

        // Check that the variable still has the correct info
        t.equal(StringUtil.replaceUnsafeChars(fooVar.id), fooVar.id);
        t.equal(fooVar.id, fooVarId);
        t.equal(fooVar.type, Variable.SCALAR_TYPE);
        t.equal(fooVar.value, 'foo');

        // There should be only two, one on the stage and one on bananas
        t.equal(pathsOf(stage).filter(p => p === '"foo').length, 1);
        t.equal(pathsOf(cat).filter(p => p === '"foo').length, 1);

        const ltPerfectVarId = Object.keys(bananas.variables).filter(k => bananas.variables[k].name === '< Perfect')[0];
        const ltPerfectVar = bananas.variables[ltPerfectVarId];
        const ltPerfectMonitor = vm.runtime._monitorState.get(ltPerfectVarId);
        // Check for unsafe characters, replaceUnsafeChars should just result in the original string
        // (e.g. there was nothing to replace)
        // Check that the variable ID does not have any unsafe characters
        t.equal(StringUtil.replaceUnsafeChars(ltPerfectVarId), ltPerfectVarId);
        // Check that the monitor record ID does not have any unsafe characters
        t.equal(StringUtil.replaceUnsafeChars(ltPerfectMonitor.id), ltPerfectMonitor.id);

        // Check that the variable still has the correct info
        t.equal(StringUtil.replaceUnsafeChars(ltPerfectVar.id), ltPerfectVar.id);
        t.equal(ltPerfectVar.id, ltPerfectVarId);
        t.equal(ltPerfectVar.type, Variable.SCALAR_TYPE);
        t.equal(ltPerfectVar.value, '> perfect');

        // There should be one
        t.equal(pathsOf(bananas).filter(p => p === '< Perfect').length, 1);

        vm.quit();
        t.end();
    });

    // Start VM, load project, and run
    t.doesNotThrow(() => {
        vm.start();
        vm.clear();
        vm.setCompatibilityMode(false);
        vm.setTurboMode(false);
        vm.loadProject(project).then(() => {
            vm.greenFlag();
            setTimeout(() => {
                vm.getPlaygroundData();
                vm.stopAll();
            }, 100);
        });
    });
});

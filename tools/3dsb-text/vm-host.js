/**
 * @fileoverview
 * A VM in Node for the tool: for the block definitions of its extensions and for checking projects.
 */
const {vmModule} = require('./paths');

const log = vmModule('src/util/log');
// What the VM logs goes here instead of the console
const messages = [];
for (const level of ['log', 'debug', 'info', 'warn', 'warning', 'error']) {
    log[level] = (...args) => {
        messages.push({level, text: args.map(arg => (arg instanceof Error ? arg.message : String(arg))).join(' ')});
    };
}

const VirtualMachine = vmModule('src/virtual-machine');
const {getBlockDefs} = require('./block-defs');

let defs = null;

/**
 * @returns {object} a new VM
 */
const makeVM = () => {
    const vm = new VirtualMachine();
    vm.runtime.setMaxListeners(0);
    return vm;
};

/**
 * @returns {object} every block definition (block-defs.js), with the extensions that the VM has built in
 */
const getDefs = () => {
    if (!defs) {
        const vm = makeVM();
        const manager = vm.extensionManager;
        for (const id of Object.keys(manager.builtinExtensions || {})) {
            if (manager.isExtensionLoaded(id)) continue;
            try {
                manager.loadExtensionIdSync(id);
            } catch (e) {
                // Hardware extensions etc. that can't run in Node
            }
        }
        defs = getBlockDefs(vm.runtime);
        // Blocks the VM runs that no definition describes still count as known
        for (const opcode of Object.keys(vm.runtime._primitives).concat(Object.keys(vm.runtime._hats))) {
            if (!defs[opcode]) defs[opcode] = {opcode, text: '', args: {}, source: 'vm', loose: true};
        }
    }
    return defs;
};

module.exports = {
    makeVM,
    getDefs,
    messages
};

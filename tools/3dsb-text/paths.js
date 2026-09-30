// Where the other packages of the repository are, so the tool can run with plain `node` from anywhere
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const VM = path.join(ROOT, 'scratch-vm');
const GUI = path.join(ROOT, 'scratch-gui');

module.exports = {
    ROOT,
    VM,
    GUI,
    SCRATCH_BLOCKS: path.join(GUI, 'node_modules', 'scratch-blocks'),
    // Modules of scratch-vm (e.g. vmRequire('src/virtual-machine')) and of its dependencies
    vmRequire: name => require(require.resolve(name, {paths: [VM]})),
    vmModule: name => require(path.join(VM, name))
};

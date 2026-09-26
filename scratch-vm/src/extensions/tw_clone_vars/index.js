const makeVariableBlocks = require('../tw_vars/make-variable-blocks');

// Per-sprite variables and lists; every clone gets its own copy. Shown in Control, after the clone blocks.
module.exports = makeVariableBlocks({
    id: 'twclonevars',
    name: '分身變數',
    variableWord: '分身變數',
    listWord: '分身清單',
    colors: ['#FFAB19', '#EC9C13', '#CF8B17'],
    perClone: true
});

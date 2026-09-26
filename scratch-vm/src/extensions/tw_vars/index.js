const makeVariableBlocks = require('./make-variable-blocks');

// Global variables and lists, stored on the stage. Takes the place of the Variables category.
module.exports = makeVariableBlocks({
    id: 'twvars',
    name: '變數',
    variableWord: '變數',
    listWord: '清單',
    colors: ['#FF8C1A', '#FF8000', '#DB6E00'],
    perClone: false
});

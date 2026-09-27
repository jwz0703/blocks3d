const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const {addPathMethods} = require('../tw_data/path-blocks');

/**
 * 區域變數: local variables of custom blocks. Every call of a custom block gets its own set, so recursion and
 * several scripts running the same custom block never share values. Outside of a custom block, each run of a script
 * gets its own set. Their names are paths like the ones of 資料 (see util/data-path.js).
 * Shown at the end of My Blocks. The compiler has its own implementation of these blocks (irgen/jsgen).
 */
class LocalVariableBlocks {
    constructor (runtime) {
        this.runtime = runtime;
    }

    getInfo () {
        const name = {NAME: {type: ArgumentType.STRING, defaultValue: 'i'}};
        const block = (opcode, blockType, text, args) => ({
            opcode, blockType, text, arguments: args || {}, disableMonitor: true
        });
        return {
            id: 'twlocalvars',
            name: '區域變數',
            color1: '#FF6680',
            color2: '#FF4D6A',
            color3: '#FF3355',
            blocks: [
                block('setVariable', BlockType.COMMAND, '設定區域變數 [NAME] 為 [VALUE]',
                    Object.assign({}, name, {VALUE: {type: ArgumentType.STRING, defaultValue: '0'}})),
                block('changeVariable', BlockType.COMMAND, '區域變數 [NAME] 改變 [VALUE]',
                    Object.assign({}, name, {VALUE: {type: ArgumentType.NUMBER, defaultValue: 1}})),
                block('getVariable', BlockType.REPORTER, '取得區域變數 [NAME]', name),
                block('variableExists', BlockType.BOOLEAN, '區域變數 [NAME] 存在？', name),
                block('deleteVariable', BlockType.COMMAND, '刪除區域變數 [NAME]', name),
                block('local', BlockType.REPORTER, '區域變數')
            ]
        };
    }
}

addPathMethods(LocalVariableBlocks, 'twlocalvars');

module.exports = LocalVariableBlocks;

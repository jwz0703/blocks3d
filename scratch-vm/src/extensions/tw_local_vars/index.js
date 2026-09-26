const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');

/**
 * Local variables for custom blocks. Every call of a custom block gets its own set, so recursion and
 * several scripts running the same custom block never share values. Outside of a custom block,
 * each run of a script gets its own set.
 * Shown at the end of My Blocks. The compiler has its own implementation of these blocks (irgen/jsgen).
 */

/** @type {WeakMap<object, Map<string, *>>} thread -> locals used outside of any custom block */
const scriptLocals = new WeakMap();

class LocalVariableBlocks {
    constructor (runtime) {
        this.runtime = runtime;
    }

    getInfo () {
        const name = {NAME: {type: ArgumentType.STRING, defaultValue: '我的變數'}};
        const block = (opcode, blockType, text, args) => ({
            opcode, blockType, text, arguments: args, disableMonitor: true
        });
        return {
            id: 'twlocalvars',
            name: '區域變數',
            color1: '#FF6680',
            color2: '#FF4D6A',
            color3: '#FF3355',
            blocks: [
                block('setVariable', BlockType.COMMAND, '區域變數 [NAME] 設為 [VALUE]',
                    Object.assign({}, name, {VALUE: {type: ArgumentType.STRING, defaultValue: '0'}})),
                block('changeVariable', BlockType.COMMAND, '區域變數 [NAME] 改變 [VALUE]',
                    Object.assign({}, name, {VALUE: {type: ArgumentType.NUMBER, defaultValue: 1}})),
                block('getVariable', BlockType.REPORTER, '取得區域變數 [NAME]', name),
                block('variableExists', BlockType.BOOLEAN, '區域變數 [NAME] 存在？', name)
            ]
        };
    }

    /**
     * Find the locals of the innermost custom block call, the same way parameters are looked up.
     * @param {object} util Block utility.
     * @returns {Map<string, *>} The locals.
     */
    static _scope (util) {
        const thread = util.thread;
        const frames = thread.stackFrames;
        for (let i = frames.length - 1; i >= 0; i--) {
            const frame = frames[i];
            if (frame.params !== null) {
                if (!frame.locals) frame.locals = new Map();
                return frame.locals;
            }
        }
        let locals = scriptLocals.get(thread);
        if (!locals) {
            locals = new Map();
            scriptLocals.set(thread, locals);
        }
        return locals;
    }

    setVariable (args, util) {
        LocalVariableBlocks._scope(util).set(Cast.toString(args.NAME), args.VALUE);
    }

    changeVariable (args, util) {
        const locals = LocalVariableBlocks._scope(util);
        const key = Cast.toString(args.NAME);
        const old = locals.has(key) ? locals.get(key) : 0;
        locals.set(key, Cast.toNumber(old) + Cast.toNumber(args.VALUE));
    }

    getVariable (args, util) {
        const locals = LocalVariableBlocks._scope(util);
        const key = Cast.toString(args.NAME);
        return locals.has(key) ? locals.get(key) : 0;
    }

    variableExists (args, util) {
        return LocalVariableBlocks._scope(util).has(Cast.toString(args.NAME));
    }
}

module.exports = LocalVariableBlocks;

const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const DataPath = require('../../util/data-path');
const {addPathMethods} = require('./path-blocks');

/**
 * 資料: global variables, lists and objects, all read and written with paths like `score` or `enemies[1].x`
 * (see util/data-path.js), stored on the stage. Replaces the Variables category and the old 變數 blocks. Variables of
 * sprites and clones are the 分身變數 blocks (tw_clone_vars), local variables of custom blocks the 區域變數 blocks
 * (tw_local_vars).
 *
 * The compiler has its own implementation of the path blocks (see path-blocks.js), since they need the local
 * variables of the generated function.
 */

const path = defaultValue => ({type: ArgumentType.STRING, defaultValue});
const text = defaultValue => ({type: ArgumentType.STRING, defaultValue});
const number = defaultValue => ({type: ArgumentType.NUMBER, defaultValue});

const block = (opcode, blockType, blockText, args, extra) => Object.assign({
    opcode,
    blockType,
    text: blockText,
    arguments: args || {},
    disableMonitor: true
}, extra);

class DataBlocks {
    constructor (runtime) {
        this.runtime = runtime;
    }

    getInfo () {
        return {
            id: 'twdata',
            name: '資料',
            color1: '#FF8C1A',
            color2: '#FF8000',
            color3: '#DB6E00',
            blocks: [
                // The text block: text with line breaks and ${path} in it. It has its own field, so it is a core
                // block (data_text) that lives in this category.
                {
                    blockType: BlockType.XML,
                    // eslint-disable-next-line no-template-curly-in-string
                    xml: '<block type="data_text"><field name="TEXT">分數: ${分數}</field></block>'
                },
                '---',
                block('get', BlockType.REPORTER, '取得 [PATH]', {PATH: path('分數')}),
                block('set', BlockType.COMMAND, '設定 [PATH] 為 [VALUE]', {
                    PATH: path('分數'),
                    VALUE: text('0')
                }),
                block('setObject', BlockType.COMMAND, '設定 [PATH] 為物件 [TEXT]', {
                    PATH: path('物件'),
                    TEXT: text('{"a":"嗨","b":""}')
                }),
                block('change', BlockType.COMMAND, '[PATH] 改變 [VALUE]', {
                    PATH: path('分數'),
                    VALUE: number(1)
                }),
                block('exists', BlockType.BOOLEAN, '[PATH] 存在？', {PATH: path('分數')}),
                block('delete', BlockType.COMMAND, '刪除 [PATH]', {PATH: path('分數')}),
                block('getFrom', BlockType.REPORTER, '從 [VALUE] 取得 [PATH]', {
                    VALUE: text(''),
                    PATH: path('x')
                }),
                block('global', BlockType.REPORTER, '全域變數'),
                '---',
                block('emptyArray', BlockType.REPORTER, '空陣列'),
                block('emptyObject', BlockType.REPORTER, '空物件'),
                block('addItem', BlockType.COMMAND, '[ITEM] 加入 [PATH]', {
                    ITEM: text('東西'),
                    PATH: path('清單')
                }),
                block('insertItem', BlockType.COMMAND, '在 [PATH] 的第 [INDEX] 項插入 [ITEM]', {
                    PATH: path('清單'),
                    INDEX: number(1),
                    ITEM: text('東西')
                }),
                block('deleteItem', BlockType.COMMAND, '刪除 [PATH] 的第 [INDEX] 項', {
                    PATH: path('清單'),
                    INDEX: number(1)
                }),
                block('replaceItem', BlockType.COMMAND, '把 [PATH] 的第 [INDEX] 項替換為 [ITEM]', {
                    PATH: path('清單'),
                    INDEX: number(1),
                    ITEM: text('東西')
                }),
                block('clear', BlockType.COMMAND, '清空 [PATH]', {PATH: path('清單')}),
                block('itemOf', BlockType.REPORTER, '[PATH] 的第 [INDEX] 項', {
                    PATH: path('清單'),
                    INDEX: number(1)
                }),
                block('indexOf', BlockType.REPORTER, '[ITEM] 在 [PATH] 中的位置', {
                    ITEM: text('東西'),
                    PATH: path('清單')
                }),
                block('length', BlockType.REPORTER, '[PATH] 的長度', {PATH: path('清單')}),
                block('contains', BlockType.BOOLEAN, '[PATH] 包含 [ITEM]？', {
                    PATH: path('清單'),
                    ITEM: text('東西')
                }),
                block('keys', BlockType.REPORTER, '[PATH] 的鍵', {PATH: path('物件')}),
                // Old list reporters: the items as text, the way Scratch joins them
                block('listText', BlockType.REPORTER, '[PATH] 的項目', {PATH: path('清單')}, {
                    hideFromPalette: true
                }),
                '---',
                block('parseJSON', BlockType.REPORTER, '解析 JSON [TEXT]', {TEXT: text('{"x": 1}')}),
                block('stringify', BlockType.REPORTER, '[VALUE] 轉成 JSON [STYLE]', {
                    VALUE: text(''),
                    STYLE: {type: ArgumentType.STRING, menu: 'jsonStyle', defaultValue: 'compact'}
                }),
                block('isJSON', BlockType.BOOLEAN, '[TEXT] 是有效的 JSON？', {TEXT: text('{"x": 1}')})
            ],
            menus: {
                jsonStyle: {
                    acceptReporters: false,
                    items: [{text: '單行', value: 'compact'}, {text: '格式化', value: 'pretty'}]
                }
            }
        };
    }

    getFrom (args) {
        return DataPath.getFrom(args.VALUE, args.PATH);
    }

    emptyArray () {
        return [];
    }

    emptyObject () {
        return {};
    }

    parseJSON (args) {
        return DataPath.parseJSON(args.TEXT);
    }

    stringify (args) {
        return DataPath.stringify(args.VALUE, args.STYLE === 'pretty');
    }

    isJSON (args) {
        return DataPath.isJSON(args.TEXT);
    }
}

addPathMethods(DataBlocks, 'twdata');

module.exports = DataBlocks;

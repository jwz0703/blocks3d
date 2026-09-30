const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');
const SkyBlocks = require('./sky-blocks');

/**
 * Blocks of the procedural sky: clouds and blur. Where the sun is belongs to 環境, since the sun light comes from
 * the same direction.
 */
class Scratch3SkyProceduralBlocks extends SkyBlocks {
    constructor (runtime) {
        super(runtime, ['procedural']);
    }

    getInfo () {
        return Object.assign({
            id: 'skyprocedural',
            name: '程序天空',
            blocks: [
                {
                    opcode: 'setclouds',
                    blockType: BlockType.COMMAND,
                    text: '雲量設為 [CLOUDS] %',
                    arguments: {CLOUDS: {type: ArgumentType.NUMBER, defaultValue: 35}}
                },
                {
                    opcode: 'changeclouds',
                    blockType: BlockType.COMMAND,
                    text: '雲量改變 [CLOUDS] %',
                    arguments: {CLOUDS: {type: ArgumentType.NUMBER, defaultValue: 10}}
                },
                {
                    opcode: 'clouds',
                    blockType: BlockType.REPORTER,
                    text: '雲量',
                    disableMonitor: true
                },
                '---',
                {
                    opcode: 'setblur',
                    blockType: BlockType.COMMAND,
                    text: '天空模糊設為 [BLUR] %',
                    arguments: {BLUR: {type: ArgumentType.NUMBER, defaultValue: 0}}
                }
            ]
        }, SkyBlocks.COLORS);
    }

    setclouds (args) {
        this._set({clouds: Cast.toNumber(args.CLOUDS)});
    }

    changeclouds (args) {
        const sky = this._sky();
        if (sky) this._set({clouds: sky.clouds + Cast.toNumber(args.CLOUDS)});
    }

    clouds () {
        const sky = this._sky();
        return sky ? sky.clouds : 0;
    }

    setblur (args) {
        this._set({blur: Cast.toNumber(args.BLUR)});
    }
}

module.exports = Scratch3SkyProceduralBlocks;

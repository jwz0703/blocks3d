const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');
const Color = require('../../util/color');
const SkyBlocks = require('./sky-blocks');

/**
 * Blocks of the one color and gradient skies.
 */
class Scratch3SkyColorBlocks extends SkyBlocks {
    constructor (runtime) {
        super(runtime, ['color', 'gradient']);
    }

    getInfo () {
        return Object.assign({
            id: 'skycolor',
            name: '純色 / 漸層天空',
            blocks: [
                {
                    opcode: 'setcolor',
                    blockType: BlockType.COMMAND,
                    text: '天空顏色設為 [COLOR]',
                    arguments: {COLOR: {type: ArgumentType.COLOR, defaultValue: '#87ceeb'}}
                },
                {
                    opcode: 'setgradient',
                    blockType: BlockType.COMMAND,
                    text: '漸層 [PART] 顏色設為 [COLOR]',
                    arguments: {
                        PART: {type: ArgumentType.STRING, menu: 'gradientPart', defaultValue: 'top'},
                        COLOR: {type: ArgumentType.COLOR, defaultValue: '#3f7fd6'}
                    }
                }
            ],
            menus: {
                gradientPart: {
                    acceptReporters: false,
                    items: [
                        {text: '上方', value: 'top'},
                        {text: '下方', value: 'bottom'}
                    ]
                }
            }
        }, SkyBlocks.COLORS);
    }

    /**
     * The color of a one color sky. A gradient sky becomes that color from top to bottom.
     * @param {object} args block arguments
     */
    setcolor (args) {
        const sky = this._sky();
        if (!sky) return;
        const color = Color.rgbToHex(Cast.toRgbColorObject(args.COLOR));
        this._set(sky.type === 'gradient' ? {top: color, bottom: color} : {color});
    }

    setgradient (args) {
        if (!['top', 'bottom'].includes(args.PART)) return;
        const sky = this._sky();
        if (!sky || sky.type !== 'gradient') return;
        this._set({[args.PART]: Color.rgbToHex(Cast.toRgbColorObject(args.COLOR))});
    }
}

module.exports = Scratch3SkyColorBlocks;

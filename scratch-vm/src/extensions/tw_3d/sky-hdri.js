const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');
const SkyBlocks = require('./sky-blocks');

/**
 * Blocks of the HDRI sky: turning and blurring the picture.
 */
class Scratch3SkyHDRIBlocks extends SkyBlocks {
    constructor (runtime) {
        super(runtime, ['hdri']);
    }

    getInfo () {
        return Object.assign({
            id: 'skyhdri',
            name: 'HDRI 天空',
            blocks: [
                {
                    opcode: 'setrotation',
                    blockType: BlockType.COMMAND,
                    text: '天空旋轉設為 [DEGREES] 度',
                    arguments: {DEGREES: {type: ArgumentType.ANGLE, defaultValue: 0}}
                },
                {
                    opcode: 'turn',
                    blockType: BlockType.COMMAND,
                    text: '天空旋轉 [DEGREES] 度',
                    arguments: {DEGREES: {type: ArgumentType.NUMBER, defaultValue: 15}}
                },
                {
                    opcode: 'rotation',
                    blockType: BlockType.REPORTER,
                    text: '天空旋轉角度',
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

    /**
     * @param {number} degrees any angle
     * @returns {number} the same angle from -180 to 180, like the Environment tab
     */
    _wrap (degrees) {
        const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;
        return wrapped === -180 ? 180 : wrapped;
    }

    setrotation (args) {
        this._set({rotation: this._wrap(Cast.toNumber(args.DEGREES))});
    }

    turn (args) {
        const sky = this._sky();
        if (sky) this._set({rotation: this._wrap(sky.rotation + Cast.toNumber(args.DEGREES))});
    }

    rotation () {
        const sky = this._sky();
        return sky ? sky.rotation : 0;
    }

    setblur (args) {
        this._set({blur: Cast.toNumber(args.BLUR)});
    }
}

module.exports = Scratch3SkyHDRIBlocks;

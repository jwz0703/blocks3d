const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');

/**
 * 3D sound of 3D sprites (ROADMAP.md 6.8): their sounds come from where they are, heard from the current camera.
 * Shown in Sound for 3D sprites. See engine/spatial-audio-effect.js.
 */
class Scratch3Sound3DBlocks {
    constructor (runtime) {
        this.runtime = runtime;
    }

    getInfo () {
        return {
            id: 'sound3d',
            name: '3D 音效',
            color1: '#CF63CF',
            color2: '#C94FC9',
            color3: '#BD42BD',
            blocks: [
                {
                    opcode: 'setspatial',
                    blockType: BlockType.COMMAND,
                    text: '3D 音效 [STATE]',
                    arguments: {
                        STATE: {type: ArgumentType.STRING, menu: 'state', defaultValue: 'on'}
                    }
                },
                {
                    opcode: 'setsounddistance',
                    blockType: BlockType.COMMAND,
                    text: '聲音在 [DISTANCE] 內最大聲',
                    arguments: {
                        DISTANCE: {type: ArgumentType.NUMBER, defaultValue: 5}
                    }
                }
            ],
            menus: {
                state: {
                    acceptReporters: false,
                    items: [
                        {text: '開啟', value: 'on'},
                        {text: '關閉', value: 'off'}
                    ]
                }
            }
        };
    }

    setspatial (args, util) {
        util.target.setSound3D({enabled: args.STATE !== 'off'});
    }

    setsounddistance (args, util) {
        util.target.setSound3D({distance: Cast.toNumber(args.DISTANCE)});
    }
}

module.exports = Scratch3Sound3DBlocks;

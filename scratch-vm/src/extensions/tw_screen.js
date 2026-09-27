const BlockType = require('../extension-support/block-type');
const ArgumentType = require('../extension-support/argument-type');

/**
 * The size of the screen (ROADMAP.md 7.5), for laying out a HUD when the stage follows the shape of the screen.
 * The size is in stage units (see engine/screen.js), the same as x and y of 2D sprites. Built in: the reporter is
 * shown in Sensing, the hat in Events.
 */
class Scratch3ScreenBlocks {
    constructor (runtime) {
        this.runtime = runtime;
    }

    getInfo () {
        return {
            id: 'screen',
            name: '螢幕',
            color1: '#5CB1D6',
            color2: '#47A8D1',
            color3: '#2E8EB8',
            blocks: [
                {
                    opcode: 'whenresized',
                    blockType: BlockType.HAT,
                    text: '當螢幕大小改變',
                    isEdgeActivated: false,
                    color1: '#FFBF00',
                    color2: '#E6AC00',
                    color3: '#CC9900'
                },
                {
                    opcode: 'size',
                    blockType: BlockType.REPORTER,
                    text: '螢幕 [SIDE]',
                    arguments: {
                        SIDE: {
                            type: ArgumentType.STRING,
                            menu: 'side',
                            defaultValue: 'width'
                        }
                    }
                }
            ],
            menus: {
                side: {
                    acceptReporters: false,
                    items: [
                        {text: '寬度', value: 'width'},
                        {text: '高度', value: 'height'}
                    ]
                }
            }
        };
    }

    // Started by Runtime.setStageSize
    whenresized () {
        return true;
    }

    size (args) {
        return args.SIDE === 'height' ? this.runtime.stageHeight : this.runtime.stageWidth;
    }
}

module.exports = Scratch3ScreenBlocks;

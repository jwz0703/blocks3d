const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');
const Color = require('../../util/color');
const Environment = require('../../engine/scene-3d-environment');

/**
 * Environment blocks: sky, sun, lighting, fog and exposure. They change the environment of the current backdrop
 * (see engine/scene-3d-environment.js); switching backdrops switches environments.
 */
class Scratch3Environment3DBlocks {
    constructor (runtime) {
        this.runtime = runtime;
    }

    getInfo () {
        const number = defaultValue => ({type: ArgumentType.NUMBER, defaultValue});
        const onOff = {type: ArgumentType.STRING, menu: 'onOff', defaultValue: 'on'};
        return {
            id: 'environment3d',
            name: '環境',
            color1: '#4CBF56',
            color2: '#45AC4E',
            color3: '#389442',
            blocks: [
                {
                    opcode: 'setskytype',
                    blockType: BlockType.COMMAND,
                    text: '天空設為 [TYPE]',
                    arguments: {
                        TYPE: {type: ArgumentType.STRING, menu: 'skyType', defaultValue: 'procedural'}
                    }
                },
                {
                    opcode: 'setskycolor',
                    blockType: BlockType.COMMAND,
                    text: '天空 [PART] 顏色設為 [COLOR]',
                    arguments: {
                        PART: {type: ArgumentType.STRING, menu: 'skyPart', defaultValue: 'color'},
                        COLOR: {type: ArgumentType.COLOR, defaultValue: '#87ceeb'}
                    }
                },
                {
                    opcode: 'setclouds',
                    blockType: BlockType.COMMAND,
                    text: '雲量設為 [CLOUDS] %',
                    arguments: {CLOUDS: number(35)}
                },
                '---',
                {
                    opcode: 'setsun',
                    blockType: BlockType.COMMAND,
                    text: '太陽位置設為 高度 [ELEVATION] 度 方位 [AZIMUTH] 度',
                    arguments: {ELEVATION: number(40), AZIMUTH: number(35)}
                },
                {
                    opcode: 'sun',
                    blockType: BlockType.REPORTER,
                    text: '太陽的 [ANGLE]',
                    disableMonitor: true,
                    arguments: {
                        ANGLE: {type: ArgumentType.STRING, menu: 'sunAngle', defaultValue: 'elevation'}
                    }
                },
                {
                    opcode: 'setsunintensity',
                    blockType: BlockType.COMMAND,
                    text: '陽光強度設為 [VALUE]',
                    arguments: {VALUE: number(2)}
                },
                {
                    opcode: 'setshadows',
                    blockType: BlockType.COMMAND,
                    text: '陰影 [STATE]',
                    arguments: {STATE: onOff}
                },
                '---',
                {
                    opcode: 'setlighting',
                    blockType: BlockType.COMMAND,
                    text: '環境照明強度設為 [VALUE]',
                    arguments: {VALUE: number(1)}
                },
                {
                    opcode: 'setambient',
                    blockType: BlockType.COMMAND,
                    text: '環境光強度設為 [VALUE]',
                    arguments: {VALUE: number(0.2)}
                },
                {
                    opcode: 'setexposure',
                    blockType: BlockType.COMMAND,
                    text: '曝光設為 [VALUE]',
                    arguments: {VALUE: number(1)}
                },
                '---',
                {
                    opcode: 'setfog',
                    blockType: BlockType.COMMAND,
                    text: '霧 [STATE]',
                    arguments: {STATE: onOff}
                },
                {
                    opcode: 'setfogdistance',
                    blockType: BlockType.COMMAND,
                    text: '霧的距離設為 [NEAR] 到 [FAR]',
                    arguments: {NEAR: number(20), FAR: number(150)}
                },
                '---',
                {
                    opcode: 'setlayervisible',
                    blockType: BlockType.COMMAND,
                    text: '[VISIBLE] 3D 畫面',
                    arguments: {VISIBLE: {type: ArgumentType.STRING, menu: 'visible', defaultValue: 'show'}}
                }
            ],
            menus: {
                skyType: {
                    acceptReporters: true,
                    items: [
                        {text: '純色', value: 'color'},
                        {text: '漸層', value: 'gradient'},
                        {text: '程序天空', value: 'procedural'},
                        {text: 'HDRI', value: 'hdri'},
                        {text: '2D 背景', value: '2d'}
                    ]
                },
                skyPart: {
                    acceptReporters: false,
                    items: [
                        {text: '純色', value: 'color'},
                        {text: '漸層上方', value: 'top'},
                        {text: '漸層下方', value: 'bottom'}
                    ]
                },
                sunAngle: {
                    acceptReporters: false,
                    items: [
                        {text: '高度', value: 'elevation'},
                        {text: '方位', value: 'azimuth'}
                    ]
                },
                visible: {
                    acceptReporters: false,
                    items: [
                        {text: '顯示', value: 'show'},
                        {text: '隱藏', value: 'hide'}
                    ]
                },
                onOff: {
                    acceptReporters: false,
                    items: [
                        {text: '開啟', value: 'on'},
                        {text: '關閉', value: 'off'}
                    ]
                }
            }
        };
    }

    /**
     * @param {object} changes partial environment
     */
    _set (changes) {
        this.runtime.scene3D.setEnvironment(changes);
    }

    setskytype (args) {
        const type = Cast.toString(args.TYPE).toLowerCase();
        if (Environment.SKY_TYPES.includes(type)) this._set({sky: {type}});
    }

    setskycolor (args) {
        if (!['color', 'top', 'bottom'].includes(args.PART)) return;
        this._set({sky: {[args.PART]: Color.rgbToHex(Cast.toRgbColorObject(args.COLOR))}});
    }

    setclouds (args) {
        this._set({sky: {clouds: Cast.toNumber(args.CLOUDS)}});
    }

    setsun (args) {
        const direction = Environment.sunFromAngles(Cast.toNumber(args.ELEVATION), Cast.toNumber(args.AZIMUTH));
        this._set({sun: direction});
    }

    sun (args) {
        const angles = Environment.sunToAngles(this.runtime.scene3D.getEnvironment().sun);
        return args.ANGLE === 'azimuth' ? angles.azimuth : angles.elevation;
    }

    setsunintensity (args) {
        this._set({sun: {intensity: Cast.toNumber(args.VALUE)}});
    }

    setshadows (args) {
        this._set({sun: {shadows: args.STATE !== 'off'}});
    }

    setlighting (args) {
        this._set({lighting: {intensity: Cast.toNumber(args.VALUE)}});
    }

    setambient (args) {
        this._set({ambient: {intensity: Cast.toNumber(args.VALUE)}});
    }

    setexposure (args) {
        this._set({exposure: Cast.toNumber(args.VALUE)});
    }

    setfog (args) {
        this._set({fog: {enabled: args.STATE !== 'off'}});
    }

    setfogdistance (args) {
        this._set({fog: {near: Cast.toNumber(args.NEAR), far: Cast.toNumber(args.FAR)}});
    }

    /**
     * Show or hide everything 3D, leaving the 2D sprites
     * @param {object} args block arguments
     */
    setlayervisible (args) {
        if (!this.runtime.scene3D.ensure()) return;
        this.runtime.scene3D.setLayerVisible(args.VISIBLE !== 'hide');
    }
}

module.exports = Scratch3Environment3DBlocks;

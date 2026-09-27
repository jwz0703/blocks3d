const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');
const Color = require('../../util/color');

/**
 * @param {string} opcode a 2D say or think block
 * @param {boolean} timed true if it has a seconds input
 * @returns {object} the block in the palette, like in the 2D Looks category
 */
const speechBlock = (opcode, timed) => {
    const message = '<value name="MESSAGE"><shadow type="text"><field name="TEXT">Hello!</field></shadow></value>';
    const secs = timed ?
        '<value name="SECS"><shadow type="math_number"><field name="NUM">2</field></shadow></value>' :
        '';
    return {blockType: BlockType.XML, xml: `<block type="${opcode}">${message}${secs}</block>`};
};

/**
 * Looks blocks of 3D sprites. They replace the 2D Looks category in the palette of 3D sprites.
 */
class Scratch3Looks3DBlocks {
    constructor (runtime) {
        this.runtime = runtime;
    }

    getInfo () {
        return {
            id: 'looks3d',
            name: '3D 外觀',
            color1: '#9966FF',
            color2: '#855CD6',
            color3: '#774DCB',
            blocks: [
                // Speech bubbles sit on top of where the sprite is drawn, see Target3D.getBoundsForBubble()
                speechBlock('looks_sayforsecs', true),
                speechBlock('looks_say', false),
                speechBlock('looks_thinkforsecs', true),
                speechBlock('looks_think', false),
                '---',
                {
                    opcode: 'switchmodelto',
                    blockType: BlockType.COMMAND,
                    text: '模型換成 [MODEL]',
                    arguments: {
                        MODEL: {type: ArgumentType.STRING, menu: 'model', defaultValue: ''}
                    }
                },
                {
                    opcode: 'nextmodel',
                    blockType: BlockType.COMMAND,
                    text: '下一個模型'
                },
                '---',
                {
                    opcode: 'setcolor',
                    blockType: BlockType.COMMAND,
                    text: '顏色設為 [COLOR]',
                    arguments: {
                        COLOR: {type: ArgumentType.COLOR, defaultValue: '#4c97ff'}
                    }
                },
                {
                    opcode: 'setopacity',
                    blockType: BlockType.COMMAND,
                    text: '不透明度設為 [OPACITY] %',
                    arguments: {
                        OPACITY: {type: ArgumentType.NUMBER, defaultValue: 100}
                    }
                },
                {
                    opcode: 'changeopacity',
                    blockType: BlockType.COMMAND,
                    text: '不透明度改變 [OPACITY]',
                    arguments: {
                        OPACITY: {type: ArgumentType.NUMBER, defaultValue: -10}
                    }
                },
                '---',
                {
                    opcode: 'setscale',
                    blockType: BlockType.COMMAND,
                    text: '縮放設為 [SCALE]',
                    arguments: {
                        SCALE: {type: ArgumentType.NUMBER, defaultValue: 1}
                    }
                },
                {
                    opcode: 'setscalexyz',
                    blockType: BlockType.COMMAND,
                    text: '縮放設為 x:[X] y:[Y] z:[Z]',
                    arguments: {
                        X: {type: ArgumentType.NUMBER, defaultValue: 1},
                        Y: {type: ArgumentType.NUMBER, defaultValue: 1},
                        Z: {type: ArgumentType.NUMBER, defaultValue: 1}
                    }
                },
                {
                    opcode: 'changescale',
                    blockType: BlockType.COMMAND,
                    text: '縮放改變 [SCALE] 倍',
                    arguments: {
                        SCALE: {type: ArgumentType.NUMBER, defaultValue: 1.1}
                    }
                },
                '---',
                // The 2D show and hide blocks work for 3D sprites too
                {blockType: BlockType.XML, xml: '<block type="looks_show"/>'},
                {blockType: BlockType.XML, xml: '<block type="looks_hide"/>'},
                '---',
                // Animations of GLTF models (ROADMAP.md 6.4), see Scene3D.playAnimation
                {
                    opcode: 'playanimation',
                    blockType: BlockType.COMMAND,
                    text: '播放動畫 [ANIMATION] [LOOP]',
                    arguments: {
                        ANIMATION: {type: ArgumentType.STRING, menu: 'animation', defaultValue: ''},
                        LOOP: {type: ArgumentType.STRING, menu: 'loop', defaultValue: 'loop'}
                    }
                },
                {
                    opcode: 'playanimationuntildone',
                    blockType: BlockType.COMMAND,
                    text: '播放動畫 [ANIMATION] 直到結束',
                    arguments: {
                        ANIMATION: {type: ArgumentType.STRING, menu: 'animation', defaultValue: ''}
                    }
                },
                {
                    opcode: 'stopanimation',
                    blockType: BlockType.COMMAND,
                    text: '停止動畫'
                },
                {
                    opcode: 'setanimationspeed',
                    blockType: BlockType.COMMAND,
                    text: '動畫速度設為 [SPEED] 倍',
                    arguments: {
                        SPEED: {type: ArgumentType.NUMBER, defaultValue: 1}
                    }
                },
                {
                    opcode: 'animationname',
                    blockType: BlockType.REPORTER,
                    text: '播放中的動畫',
                    disableMonitor: true
                },
                {
                    opcode: 'animationplaying',
                    blockType: BlockType.BOOLEAN,
                    text: '動畫播放中？'
                },
                '---',
                {
                    opcode: 'model',
                    blockType: BlockType.REPORTER,
                    text: '模型 [NUMBER_NAME]',
                    disableMonitor: true,
                    arguments: {
                        NUMBER_NAME: {type: ArgumentType.STRING, menu: 'numberName', defaultValue: 'number'}
                    }
                },
                {
                    opcode: 'scale',
                    blockType: BlockType.REPORTER,
                    text: '縮放',
                    disableMonitor: true
                },
                {
                    opcode: 'opacity',
                    blockType: BlockType.REPORTER,
                    text: '不透明度',
                    disableMonitor: true
                }
            ],
            menus: {
                model: {
                    acceptReporters: true,
                    items: '_getModelMenu'
                },
                animation: {
                    acceptReporters: true,
                    items: '_getAnimationMenu'
                },
                loop: {
                    acceptReporters: false,
                    items: [
                        {text: '重複播放', value: 'loop'},
                        {text: '播放一次', value: 'once'}
                    ]
                },
                numberName: {
                    acceptReporters: false,
                    items: [
                        {text: '編號', value: 'number'},
                        {text: '名稱', value: 'name'}
                    ]
                }
            }
        };
    }

    _getModelMenu () {
        const target = this.runtime.getEditingTarget();
        const models = target && target.is3D ? target.getModels() : [];
        if (models.length === 0) return [{text: '', value: ''}];
        return models.map(model => ({text: model.name, value: model.name}));
    }

    _getAnimationMenu () {
        const target = this.runtime.getEditingTarget();
        const clips = target && target.is3D ? this.runtime.scene3D.getAnimationClips(target) : [];
        if (!clips || clips.length === 0) return [{text: '（模型沒有動畫）', value: ''}];
        return clips.map(clip => ({text: clip.name, value: clip.name}));
    }

    playanimation (args, util) {
        this.runtime.scene3D.playAnimation(util.target, Cast.toString(args.ANIMATION), args.LOOP !== 'once');
    }

    playanimationuntildone (args, util) {
        const target = util.target;
        const frame = util.stackFrame;
        if (!frame.animation) {
            this.runtime.scene3D.playAnimation(target, Cast.toString(args.ANIMATION), false);
            frame.animation = target.animation;
        }
        // Until it ends, or something else plays or stops the animation
        if (target.animation === frame.animation && frame.animation.playing) {
            util.yield();
        } else {
            frame.animation = null;
        }
    }

    stopanimation (args, util) {
        this.runtime.scene3D.stopAnimation(util.target);
    }

    setanimationspeed (args, util) {
        util.target.animationSpeed = Cast.toNumber(args.SPEED);
    }

    animationname (args, util) {
        const animation = util.target.animation;
        return animation && animation.playing ? animation.name : '';
    }

    animationplaying (args, util) {
        const animation = util.target.animation;
        return !!animation && animation.playing;
    }

    /**
     * Like costumes: a name picks that model, a number picks by position (from 1), and "next" / "previous" too.
     * @param {Target3D} target
     * @param {*} value name or number
     */
    _switchModel (target, value) {
        const models = target.getModels();
        if (typeof value === 'number') {
            target.setModel(value - 1);
            return;
        }
        const name = Cast.toString(value);
        const index = models.findIndex(model => model.name === name);
        if (index !== -1) {
            target.setModel(index);
        } else if (name === 'next model' || name === '下一個模型') {
            target.setModel(target.currentModel + 1);
        } else if (name === 'previous model' || name === '上一個模型') {
            target.setModel(target.currentModel - 1);
        } else if (!(isNaN(value) || Cast.isWhiteSpace(value))) {
            target.setModel(Cast.toNumber(value) - 1);
        }
    }

    switchmodelto (args, util) {
        this._switchModel(util.target, args.MODEL);
    }

    nextmodel (args, util) {
        util.target.setModel(util.target.currentModel + 1);
    }

    setcolor (args, util) {
        const rgb = Cast.toRgbColorObject(args.COLOR);
        util.target.setMaterial({color: Color.rgbToHex(rgb)});
    }

    _setOpacity (target, percent) {
        target.setMaterial({opacity: Math.max(0, Math.min(100, percent)) / 100});
    }

    setopacity (args, util) {
        this._setOpacity(util.target, Cast.toNumber(args.OPACITY));
    }

    changeopacity (args, util) {
        this._setOpacity(util.target, (util.target.material.opacity * 100) + Cast.toNumber(args.OPACITY));
    }

    setscale (args, util) {
        const scale = Cast.toNumber(args.SCALE);
        util.target.setScale(scale, scale, scale);
    }

    setscalexyz (args, util) {
        util.target.setScale(Cast.toNumber(args.X), Cast.toNumber(args.Y), Cast.toNumber(args.Z));
    }

    changescale (args, util) {
        const target = util.target;
        const factor = Cast.toNumber(args.SCALE);
        target.setScale(target.scaleX * factor, target.scaleY * factor, target.scaleZ * factor);
    }

    model (args, util) {
        const target = util.target;
        if (args.NUMBER_NAME === 'name') {
            const model = target.getCurrentModel();
            return model ? model.name : '';
        }
        return target.currentModel + 1;
    }

    scale (args, util) {
        // The average, so that it is the scale of sprites that are scaled evenly
        const target = util.target;
        return (target.scaleX + target.scaleY + target.scaleZ) / 3;
    }

    opacity (args, util) {
        return Math.round(util.target.material.opacity * 1000) / 10;
    }
}

module.exports = Scratch3Looks3DBlocks;

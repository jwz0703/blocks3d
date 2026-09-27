const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');
const {CAMERA, ANY, MOUSE, get3DSpriteItems, get3DSprite, resolvePoint, distance3D} = require('./common');
const DataPath = require('../../util/data-path');

/**
 * Sensing blocks of 3D sprites. The palette of 3D sprites shows them at the top of Sensing, in place of the 2D
 * touching and distance blocks. The screen position blocks are in the palette of every sprite, so that 2D sprites
 * can follow 3D sprites, e.g. for a HUD (see block-support.js).
 */
class Scratch3Sensing3DBlocks {
    constructor (runtime) {
        this.runtime = runtime;
    }

    getInfo () {
        return {
            id: 'sensing3d',
            name: '3D 偵測',
            color1: '#5CB1D6',
            color2: '#47A8D1',
            color3: '#2E8EB8',
            blocks: [
                {
                    opcode: 'touching',
                    blockType: BlockType.BOOLEAN,
                    text: '碰到 [TARGET]？',
                    arguments: {
                        TARGET: {type: ArgumentType.STRING, menu: 'touchTarget', defaultValue: ANY}
                    }
                },
                {
                    opcode: 'distanceto',
                    blockType: BlockType.REPORTER,
                    text: '與 [TARGET] 的距離',
                    arguments: {
                        TARGET: {type: ArgumentType.STRING, menu: 'distanceTarget', defaultValue: CAMERA}
                    }
                },
                {
                    opcode: 'vectorof',
                    blockType: BlockType.REPORTER,
                    text: '[SPRITE] 的 [VECTOR]',
                    disableMonitor: true,
                    arguments: {
                        SPRITE: {type: ArgumentType.STRING, menu: 'vectorTarget', defaultValue: '_myself_'},
                        VECTOR: {type: ArgumentType.STRING, menu: 'vector', defaultValue: 'position'}
                    }
                },
                '---',
                {
                    opcode: 'screenposition',
                    blockType: BlockType.REPORTER,
                    text: '[SPRITE] 的螢幕 [AXIS]',
                    disableMonitor: true,
                    arguments: {
                        SPRITE: {type: ArgumentType.STRING, menu: 'sprite3D', defaultValue: ''},
                        AXIS: {type: ArgumentType.STRING, menu: 'screenAxis', defaultValue: 'x'}
                    }
                },
                {
                    opcode: 'onscreen',
                    blockType: BlockType.BOOLEAN,
                    text: '[SPRITE] 在畫面內？',
                    arguments: {
                        SPRITE: {type: ArgumentType.STRING, menu: 'sprite3D', defaultValue: ''}
                    }
                }
            ],
            menus: {
                touchTarget: {
                    acceptReporters: true,
                    items: '_getTouchTargetMenu'
                },
                distanceTarget: {
                    acceptReporters: true,
                    items: '_getDistanceTargetMenu'
                },
                sprite3D: {
                    acceptReporters: true,
                    items: '_getSpriteMenu'
                },
                vectorTarget: {
                    acceptReporters: true,
                    items: '_getVectorTargetMenu'
                },
                vector: {
                    acceptReporters: false,
                    items: [
                        {text: '位置', value: 'position'},
                        {text: '旋轉', value: 'rotation'},
                        {text: '縮放', value: 'scale'},
                        {text: '世界位置', value: 'worldposition'},
                        {text: '世界旋轉', value: 'worldrotation'}
                    ]
                },
                screenAxis: {
                    acceptReporters: false,
                    items: ['x', 'y']
                }
            }
        };
    }

    _getTouchTargetMenu () {
        return [
            {text: '任何 3D 角色', value: ANY},
            {text: '滑鼠', value: MOUSE},
            ...get3DSpriteItems(this.runtime, this.runtime.getEditingTarget())
        ];
    }

    _getDistanceTargetMenu () {
        return [
            {text: '目前的相機', value: CAMERA},
            {text: '滑鼠', value: MOUSE},
            ...get3DSpriteItems(this.runtime, this.runtime.getEditingTarget(), true)
        ];
    }

    _getSpriteMenu () {
        const items = get3DSpriteItems(this.runtime);
        return items.length ? items : [{text: '', value: ''}];
    }

    _getVectorTargetMenu () {
        return [
            {text: '自己', value: '_myself_'},
            {text: '目前的相機', value: CAMERA},
            ...get3DSpriteItems(this.runtime, this.runtime.getEditingTarget(), true)
        ];
    }

    /**
     * @param {object} args SPRITE: '_myself_', CAMERA or a 3D or camera sprite's name; VECTOR: position, rotation
     * or scale
     * @param {object} util
     * @returns {{x: number, y: number, z: number}|string} that vector (rotation in degrees: x pitch, y yaw, z roll);
     * '' if there is no such 3D sprite
     */
    vectorof (args, util) {
        const name = Cast.toString(args.SPRITE);
        let target;
        if (name === '_myself_') target = util.target;
        else if (name === CAMERA) target = this.runtime.scene3D.getActiveCamera();
        else target = get3DSprite(this.runtime, name);
        if (name === CAMERA && !target) {
            // The default camera
            const camera = this.runtime.scene3D.getCameraState();
            if (args.VECTOR === 'position' || args.VECTOR === 'worldposition') {
                return DataPath.vectorOf(camera.x, camera.y, camera.z);
            }
            if (args.VECTOR === 'rotation' || args.VECTOR === 'worldrotation') {
                return DataPath.vectorOf(camera.pitch || 0, camera.yaw || 0, camera.roll || 0);
            }
            return DataPath.vectorOf(1, 1, 1);
        }
        if (!target || !target.is3D) return '';
        // Where a sprite attached to another one is in the world (ROADMAP.md 6.3)
        if (args.VECTOR === 'worldposition' || args.VECTOR === 'worldrotation') {
            const pose = target.getWorldPose();
            return args.VECTOR === 'worldposition' ?
                DataPath.vectorOf(pose.x, pose.y, pose.z) :
                DataPath.vectorOf(pose.pitch, pose.yaw, pose.roll);
        }
        if (!['position', 'rotation', 'scale'].includes(args.VECTOR)) return '';
        if (args.VECTOR === 'scale' && target.isCamera) return DataPath.vectorOf(1, 1, 1);
        return DataPath.BUILTINS[args.VECTOR].get(target);
    }

    touching (args, util) {
        const name = Cast.toString(args.TARGET);
        // A 2D sprite's name finds no 3D sprite, so it is never touched. The mouse needs no physics.
        if (name === MOUSE) return util.target.isTouchingObject(name);
        return this.runtime.scene3D.physics.whenReady(() => util.target.isTouchingObject(name), false);
    }

    distanceto (args, util) {
        return distance3D(util.target, resolvePoint(this.runtime, args.TARGET));
    }

    /**
     * @param {*} name
     * @returns {?{x: number, y: number, onScreen: boolean}} where that 3D sprite is drawn on the stage
     */
    _project (name) {
        const sprite = get3DSprite(this.runtime, name);
        // Cameras aren't drawn anywhere
        return sprite && !sprite.isCamera ? this.runtime.scene3D.projectTarget(sprite) : null;
    }

    screenposition (args) {
        const point = this._project(args.SPRITE);
        if (!point) return 0;
        const value = args.AXIS === 'y' ? point.y : point.x;
        // Like the 2D mouse x
        return Math.round(value * 1000) / 1000;
    }

    onscreen (args) {
        const point = this._project(args.SPRITE);
        return !!point && point.onScreen;
    }
}

module.exports = Scratch3Sensing3DBlocks;

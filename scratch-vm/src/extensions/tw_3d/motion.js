const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');
const {CAMERA, MOUSE, get3DSpriteItems, get3DSprite, resolvePoint, glide3D} = require('./common');
const DataPath = require('../../util/data-path');

// Which rotation field each look angle is. Rotation is applied yaw, then pitch, then roll.
const ANGLE_FIELDS = {
    yaw: 'rotationY',
    pitch: 'rotationX',
    roll: 'rotationZ'
};

const REPORTERS = {
    xposition: 'x',
    yposition: 'y',
    zposition: 'z',
    yaw: 'rotationY',
    pitch: 'rotationX',
    roll: 'rotationZ'
};

/**
 * Motion blocks of 3D sprites. They replace the 2D Motion category in the palette of 3D sprites.
 */
class Scratch3Motion3DBlocks {
    constructor (runtime) {
        this.runtime = runtime;
        // Monitors of the reporters belong to the sprite, like the 2D x position monitor
        for (const opcode of Object.keys(REPORTERS)) {
            runtime.monitorBlockInfo[`motion3d_${opcode}`] = {
                isSpriteSpecific: true,
                getId: targetId => `${targetId}_motion3d_${opcode}`
            };
        }
    }

    getInfo () {
        const number = defaultValue => ({type: ArgumentType.NUMBER, defaultValue});
        return {
            id: 'motion3d',
            name: '3D 動作',
            color1: '#4C97FF',
            color2: '#4280D7',
            color3: '#3373CC',
            blocks: [
                {
                    opcode: 'moveforward',
                    blockType: BlockType.COMMAND,
                    text: '往前移動 [STEPS]',
                    arguments: {STEPS: number(0.1)}
                },
                {
                    opcode: 'movelevel',
                    blockType: BlockType.COMMAND,
                    text: '往 [DIRECTION] 平移 [STEPS]',
                    arguments: {
                        DIRECTION: {type: ArgumentType.STRING, menu: 'direction', defaultValue: 'forward'},
                        STEPS: number(0.1)
                    }
                },
                {
                    opcode: 'turn',
                    blockType: BlockType.COMMAND,
                    text: '轉動 [ANGLE] [DEGREES] 度',
                    arguments: {
                        ANGLE: {type: ArgumentType.STRING, menu: 'angle', defaultValue: 'yaw'},
                        DEGREES: number(15)
                    }
                },
                {
                    opcode: 'setangle',
                    blockType: BlockType.COMMAND,
                    text: '[ANGLE] 設為 [DEGREES] 度',
                    arguments: {
                        ANGLE: {type: ArgumentType.STRING, menu: 'angle', defaultValue: 'yaw'},
                        DEGREES: number(0)
                    }
                },
                '---',
                {
                    opcode: 'gotoxyz',
                    blockType: BlockType.COMMAND,
                    text: '移到 x:[X] y:[Y] z:[Z]',
                    arguments: {X: number(0), Y: number(0), Z: number(0)}
                },
                {
                    opcode: 'glidexyz',
                    blockType: BlockType.COMMAND,
                    text: '滑行 [SECS] 秒到 x:[X] y:[Y] z:[Z]',
                    arguments: {SECS: number(1), X: number(0), Y: number(0), Z: number(0)}
                },
                // The 2D go to and glide to blocks: random position, the mouse (where it points on the ground) and
                // 3D sprites, see replacements.js
                {
                    blockType: BlockType.XML,
                    xml: '<block type="motion_goto"><value name="TO"><shadow type="motion_goto_menu"/></value></block>'
                },
                {
                    blockType: BlockType.XML,
                    xml: '<block type="motion_glideto"><value name="SECS"><shadow type="math_number">' +
                        '<field name="NUM">1</field></shadow></value><value name="TO">' +
                        '<shadow type="motion_glideto_menu"/></value></block>'
                },
                // Positions as objects {x, y, z}, e.g. from "[sprite] 的 [位置]" or the 資料 vector blocks
                {
                    opcode: 'gotoposition',
                    blockType: BlockType.COMMAND,
                    text: '移到位置 [POSITION]',
                    arguments: {POSITION: {type: ArgumentType.STRING, defaultValue: '{"x": 0, "y": 0, "z": 0}'}}
                },
                {
                    opcode: 'glidetoposition',
                    blockType: BlockType.COMMAND,
                    text: '滑行 [SECS] 秒到位置 [POSITION]',
                    arguments: {
                        SECS: number(1),
                        POSITION: {type: ArgumentType.STRING, defaultValue: '{"x": 0, "y": 0, "z": 0}'}
                    }
                },
                {
                    opcode: 'changeaxis',
                    blockType: BlockType.COMMAND,
                    text: '[AXIS] 改變 [VALUE]',
                    arguments: {
                        AXIS: {type: ArgumentType.STRING, menu: 'axis', defaultValue: 'x'},
                        VALUE: number(0.1)
                    }
                },
                {
                    opcode: 'setaxis',
                    blockType: BlockType.COMMAND,
                    text: '[AXIS] 設為 [VALUE]',
                    arguments: {
                        AXIS: {type: ArgumentType.STRING, menu: 'axis', defaultValue: 'x'},
                        VALUE: number(0)
                    }
                },
                '---',
                {
                    opcode: 'facesprite',
                    blockType: BlockType.COMMAND,
                    text: '面向 [TARGET]',
                    arguments: {
                        TARGET: {type: ArgumentType.STRING, menu: 'faceTarget', defaultValue: CAMERA}
                    }
                },
                {
                    opcode: 'facexyz',
                    blockType: BlockType.COMMAND,
                    text: '面向 x:[X] y:[Y] z:[Z]',
                    arguments: {X: number(0), Y: number(0), Z: number(0)}
                },
                {
                    opcode: 'faceposition',
                    blockType: BlockType.COMMAND,
                    text: '面向位置 [POSITION]',
                    arguments: {POSITION: {type: ArgumentType.STRING, defaultValue: '{"x": 0, "y": 0, "z": 0}'}}
                },
                '---',
                // Attaching to other 3D sprites (ROADMAP.md 6.3): x, y, z and the angles are then relative to the
                // parent, and the world blocks tell where the sprite is in the world
                {
                    opcode: 'attachto',
                    blockType: BlockType.COMMAND,
                    text: '附著到 [TARGET]',
                    arguments: {
                        TARGET: {type: ArgumentType.STRING, menu: 'attachTarget', defaultValue: ''}
                    }
                },
                {
                    opcode: 'detach',
                    blockType: BlockType.COMMAND,
                    text: '取消附著'
                },
                {
                    opcode: 'parent',
                    blockType: BlockType.REPORTER,
                    text: '附著的角色'
                },
                {
                    opcode: 'worldcoordinate',
                    blockType: BlockType.REPORTER,
                    text: '世界 [COORDINATE]',
                    disableMonitor: true,
                    arguments: {
                        COORDINATE: {type: ArgumentType.STRING, menu: 'coordinate', defaultValue: 'x'}
                    }
                },
                {
                    opcode: 'gotoworldxyz',
                    blockType: BlockType.COMMAND,
                    text: '移到世界 x:[X] y:[Y] z:[Z]',
                    arguments: {X: number(0), Y: number(0), Z: number(0)}
                },
                '---',
                {opcode: 'xposition', blockType: BlockType.REPORTER, text: 'x 座標'},
                {opcode: 'yposition', blockType: BlockType.REPORTER, text: 'y 座標'},
                {opcode: 'zposition', blockType: BlockType.REPORTER, text: 'z 座標'},
                {opcode: 'yaw', blockType: BlockType.REPORTER, text: 'yaw'},
                {opcode: 'pitch', blockType: BlockType.REPORTER, text: 'pitch'},
                {opcode: 'roll', blockType: BlockType.REPORTER, text: 'roll'}
            ],
            menus: {
                axis: {
                    acceptReporters: false,
                    items: ['x', 'y', 'z']
                },
                angle: {
                    acceptReporters: false,
                    items: [
                        {text: 'yaw（左右）', value: 'yaw'},
                        {text: 'pitch（上下）', value: 'pitch'},
                        {text: 'roll（翻滾）', value: 'roll'}
                    ]
                },
                direction: {
                    acceptReporters: true,
                    items: [
                        {text: '前', value: 'forward'},
                        {text: '後', value: 'back'},
                        {text: '左', value: 'left'},
                        {text: '右', value: 'right'},
                        {text: '上', value: 'up'},
                        {text: '下', value: 'down'}
                    ]
                },
                faceTarget: {
                    acceptReporters: true,
                    items: '_getFaceTargetMenu'
                },
                attachTarget: {
                    acceptReporters: true,
                    items: '_getAttachTargetMenu'
                },
                coordinate: {
                    acceptReporters: false,
                    items: ['x', 'y', 'z', 'yaw', 'pitch', 'roll']
                }
            }
        };
    }

    _getFaceTargetMenu () {
        return [
            {text: '目前的相機', value: CAMERA},
            {text: '滑鼠', value: MOUSE},
            ...get3DSpriteItems(this.runtime, this.runtime.getEditingTarget(), true)
        ];
    }

    _getAttachTargetMenu () {
        const items = get3DSpriteItems(this.runtime, this.runtime.getEditingTarget(), true);
        return items.length ? items : [{text: '（沒有其他 3D 角色）', value: ''}];
    }

    attachto (args, util) {
        const parent = get3DSprite(this.runtime, args.TARGET);
        // A clone of the sprite doesn't attach to itself
        if (parent && parent.sprite !== util.target.sprite) util.target.setParent3D(parent);
    }

    detach (args, util) {
        util.target.setParent3D(null);
    }

    parent (args, util) {
        const parent = util.target.parent3D;
        return parent ? parent.getName() : '';
    }

    worldcoordinate (args, util) {
        const pose = util.target.getWorldPose();
        const value = pose[args.COORDINATE];
        if (typeof value !== 'number') return 0;
        const rounded = Math.round(value * 1e6) / 1e6;
        return Math.abs(value - rounded) < 1e-9 ? rounded : value;
    }

    gotoworldxyz (args, util) {
        util.target.setWorldPosition(Cast.toNumber(args.X), Cast.toNumber(args.Y), Cast.toNumber(args.Z));
    }

    moveforward (args, util) {
        util.target.moveForward(Cast.toNumber(args.STEPS));
    }

    movelevel (args, util) {
        util.target.moveLevel(args.DIRECTION, Cast.toNumber(args.STEPS));
    }

    _setAngle (target, angle, degrees) {
        const field = ANGLE_FIELDS[angle];
        if (!field) return;
        const rotation = {rotationX: target.rotationX, rotationY: target.rotationY, rotationZ: target.rotationZ};
        rotation[field] = degrees;
        target.setRotation(rotation.rotationX, rotation.rotationY, rotation.rotationZ);
    }

    turn (args, util) {
        const target = util.target;
        const field = ANGLE_FIELDS[args.ANGLE];
        if (!field) return;
        this._setAngle(target, args.ANGLE, target[field] + Cast.toNumber(args.DEGREES));
    }

    setangle (args, util) {
        this._setAngle(util.target, args.ANGLE, Cast.toNumber(args.DEGREES));
    }

    gotoxyz (args, util) {
        util.target.setXYZ(Cast.toNumber(args.X), Cast.toNumber(args.Y), Cast.toNumber(args.Z));
    }

    glidexyz (args, util) {
        glide3D(util, Cast.toNumber(args.SECS), () => ({
            x: Cast.toNumber(args.X),
            y: Cast.toNumber(args.Y),
            z: Cast.toNumber(args.Z)
        }));
    }

    /**
     * @param {Target3D} target
     * @param {*} position object with x, y and z (or JSON of one); missing parts stay where the sprite is
     * @returns {{x: number, y: number, z: number}} point
     */
    _position (target, position) {
        return DataPath.toVector(position, {x: target.x, y: target.y, z: target.z});
    }

    gotoposition (args, util) {
        const point = this._position(util.target, args.POSITION);
        util.target.setXYZ(point.x, point.y, point.z);
    }

    glidetoposition (args, util) {
        glide3D(util, Cast.toNumber(args.SECS), () => this._position(util.target, args.POSITION));
    }

    faceposition (args, util) {
        const point = this._position(util.target, args.POSITION);
        util.target.lookAt(point.x, point.y, point.z);
    }

    _setAxis (target, axis, value) {
        if (axis === 'x') target.setXYZ(value, target.y, target.z);
        else if (axis === 'y') target.setXYZ(target.x, value, target.z);
        else if (axis === 'z') target.setXYZ(target.x, target.y, value);
    }

    changeaxis (args, util) {
        const target = util.target;
        if (!['x', 'y', 'z'].includes(args.AXIS)) return;
        this._setAxis(target, args.AXIS, target[args.AXIS] + Cast.toNumber(args.VALUE));
    }

    setaxis (args, util) {
        this._setAxis(util.target, args.AXIS, Cast.toNumber(args.VALUE));
    }

    facesprite (args, util) {
        const point = resolvePoint(this.runtime, args.TARGET);
        if (point) util.target.lookAt(point.x, point.y, point.z);
    }

    facexyz (args, util) {
        util.target.lookAt(Cast.toNumber(args.X), Cast.toNumber(args.Y), Cast.toNumber(args.Z));
    }

    _report (util, field) {
        const target = util.target;
        // Like the 2D x position: hide floating point error such as 0.30000000000000004 after adding 0.1s
        const value = target[field];
        const rounded = Math.round(value * 1e6) / 1e6;
        return Math.abs(value - rounded) < 1e-9 ? rounded : value;
    }

    xposition (args, util) {
        return this._report(util, 'x');
    }

    yposition (args, util) {
        return this._report(util, 'y');
    }

    zposition (args, util) {
        return this._report(util, 'z');
    }

    yaw (args, util) {
        return this._report(util, 'rotationY');
    }

    pitch (args, util) {
        return this._report(util, 'rotationX');
    }

    roll (args, util) {
        return this._report(util, 'rotationZ');
    }
}

module.exports = Scratch3Motion3DBlocks;

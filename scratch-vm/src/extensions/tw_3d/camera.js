const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');
const uid = require('../../util/uid');
const CameraFollow = require('../../engine/scene-3d-follow');
const {getCameraItems, get3DSprite, get3DSpriteItems} = require('./common');

const NEXT = '_next_';
const MYSELF = '_myself_';

/**
 * Add a "green flag → mouse look → WASD/QE every frame" script to a camera or 3D sprite, unless it already uses the
 * mouse look block. A camera flies around; a 3D sprite walks, with the current camera following it in first person.
 * @param {Runtime} runtime
 * @param {Target} target the sprite being edited
 */
const addMouseLookExample = (runtime, target) => {
    if (!target.is3D) return;
    const existing = target.blocks._blocks;
    if (Object.values(existing).some(block => block.opcode === 'camera3d_enablemouselook')) return;

    const blocks = [];
    const add = (opcode, extra) => {
        const block = Object.assign({
            id: uid(),
            opcode,
            inputs: {},
            fields: {},
            next: null,
            parent: null,
            shadow: false,
            topLevel: false
        }, extra);
        blocks.push(block);
        return block;
    };
    const shadow = (opcode, field, value) => add(opcode, {
        shadow: true,
        fields: field ? {[field]: {name: field, value}} : {}
    });
    const input = (parent, name, block, obscured = null) => {
        parent.inputs[name] = {name, block: block.id, shadow: block.shadow ? block.id : obscured && obscured.id};
        block.parent = parent.id;
        if (obscured) obscured.parent = parent.id;
    };
    const chain = list => {
        for (let i = 1; i < list.length; i++) {
            list[i - 1].next = list[i].id;
            list[i].parent = list[i - 1].id;
        }
    };

    let x = 0;
    for (const id of target.blocks.getScripts()) {
        x = Math.max(x, (existing[id].x || 0) + 450);
    }

    const stack = [add('event_whenflagclicked', {topLevel: true, x, y: 0})];
    if (!target.isCamera) {
        const follow = add('camera3d_followfirstperson');
        input(follow, 'TARGET', shadow('camera3d_menu_followTarget', 'followTarget', MYSELF));
        stack.push(follow);
    }
    const enable = add('camera3d_enablemouselook');
    input(enable, 'SENS', shadow('math_number', 'NUM', '1'));
    const loop = add('control_foreachframe');
    input(loop, 'DT', shadow('control_foreachframe_deltatime'));
    stack.push(enable, loop);
    chain(stack);

    const ifs = [
        ['w', 'forward'],
        ['s', 'back'],
        ['a', 'left'],
        ['d', 'right'],
        ['q', 'up'],
        ['e', 'down']
    ].map(([key, direction]) => {
        const ifBlock = add('control_if');
        const pressed = add('sensing_keypressed');
        input(pressed, 'KEY_OPTION', shadow('sensing_keyoptions', 'KEY_OPTION', key));
        input(ifBlock, 'CONDITION', pressed);
        const move = add('motion3d_movelevel');
        input(move, 'DIRECTION', shadow('motion3d_menu_direction', 'direction', direction));
        const multiply = add('operator_multiply');
        input(multiply, 'NUM1', shadow('math_number', 'NUM', '5'));
        input(multiply, 'NUM2', add('control_foreachframe_deltatime'), shadow('math_number', 'NUM', ''));
        input(move, 'STEPS', multiply, shadow('math_number', 'NUM', '0.1'));
        input(ifBlock, 'SUBSTACK', move);
        return ifBlock;
    });
    chain(ifs);
    input(loop, 'SUBSTACK', ifs[0]);

    for (const block of blocks) {
        target.blocks.createBlock(block);
    }
    // Let the click finish before the editor reloads the workspace
    setTimeout(() => runtime.emit('BLOCKS_NEED_UPDATE'));
};

/**
 * Camera blocks. Every target can switch cameras, make a camera follow a 3D sprite and turn mouse look on; camera
 * sprites also change their field of view (see block-support.js). Camera sprites move with the 3D motion blocks.
 *
 * The follow blocks work on the camera sprite that runs them, or on the current camera when another target does.
 */
class Scratch3Camera3DBlocks {
    constructor (runtime) {
        this.runtime = runtime;
        runtime.monitorBlockInfo.camera3d_fov = {
            isSpriteSpecific: true,
            getId: targetId => `${targetId}_camera3d_fov`
        };
    }

    getInfo () {
        return {
            id: 'camera3d',
            name: '相機',
            color1: '#0FBDB4',
            color2: '#0DA59E',
            color3: '#0B8E88',
            blocks: [
                {
                    opcode: 'switchcamera',
                    blockType: BlockType.COMMAND,
                    text: '切換相機到 [CAMERA]',
                    arguments: {
                        CAMERA: {type: ArgumentType.STRING, menu: 'camera', defaultValue: ''}
                    }
                },
                {
                    opcode: 'whencameraswitchesto',
                    blockType: BlockType.HAT,
                    isEdgeActivated: false,
                    text: '當相機切換到 [CAMERA]',
                    arguments: {
                        CAMERA: {type: ArgumentType.STRING, menu: 'cameraField', defaultValue: ''}
                    }
                },
                {
                    opcode: 'currentcamera',
                    blockType: BlockType.REPORTER,
                    text: '目前的相機',
                    disableMonitor: true
                },
                '---',
                {
                    opcode: 'setfov',
                    blockType: BlockType.COMMAND,
                    text: '視野設為 [FOV] 度',
                    arguments: {FOV: {type: ArgumentType.NUMBER, defaultValue: 60}}
                },
                {
                    opcode: 'changefov',
                    blockType: BlockType.COMMAND,
                    text: '視野改變 [FOV] 度',
                    arguments: {FOV: {type: ArgumentType.NUMBER, defaultValue: 10}}
                },
                {
                    opcode: 'fov',
                    blockType: BlockType.REPORTER,
                    text: '視野'
                },
                '---',
                {
                    opcode: 'followthirdperson',
                    blockType: BlockType.COMMAND,
                    text: '第三人稱跟隨 [TARGET] 距離 [DISTANCE]',
                    arguments: {
                        TARGET: {type: ArgumentType.STRING, menu: 'followTarget', defaultValue: MYSELF},
                        DISTANCE: {type: ArgumentType.NUMBER, defaultValue: 5}
                    }
                },
                {
                    opcode: 'followfirstperson',
                    blockType: BlockType.COMMAND,
                    text: '第一人稱跟隨 [TARGET]',
                    arguments: {
                        TARGET: {type: ArgumentType.STRING, menu: 'followTarget', defaultValue: MYSELF}
                    }
                },
                {
                    opcode: 'setfollowoffset',
                    blockType: BlockType.COMMAND,
                    text: '跟隨偏移設為 x:[X] y:[Y] z:[Z]',
                    arguments: {
                        X: {type: ArgumentType.NUMBER, defaultValue: 0},
                        Y: {type: ArgumentType.NUMBER, defaultValue: 1},
                        Z: {type: ArgumentType.NUMBER, defaultValue: 0}
                    }
                },
                {
                    opcode: 'setfollowangles',
                    blockType: BlockType.COMMAND,
                    text: '跟隨角度設為 yaw:[YAW] pitch:[PITCH]',
                    arguments: {
                        YAW: {type: ArgumentType.NUMBER, defaultValue: 0},
                        PITCH: {type: ArgumentType.NUMBER, defaultValue: -20}
                    }
                },
                {
                    opcode: 'changefollowangles',
                    blockType: BlockType.COMMAND,
                    text: '跟隨角度改變 yaw:[YAW] pitch:[PITCH]',
                    arguments: {
                        YAW: {type: ArgumentType.NUMBER, defaultValue: 15},
                        PITCH: {type: ArgumentType.NUMBER, defaultValue: 0}
                    }
                },
                {
                    opcode: 'setfollowsmoothing',
                    blockType: BlockType.COMMAND,
                    text: '跟隨平滑時間設為 [SECS] 秒',
                    arguments: {
                        SECS: {type: ArgumentType.NUMBER, defaultValue: 0.2}
                    }
                },
                {
                    opcode: 'stopfollowing',
                    blockType: BlockType.COMMAND,
                    text: '停止跟隨'
                },
                {
                    opcode: 'following',
                    blockType: BlockType.REPORTER,
                    text: '跟隨中的角色',
                    disableMonitor: true
                },
                '---',
                {
                    opcode: 'enablemouselook',
                    blockType: BlockType.COMMAND,
                    text: '啟用滑鼠視角 靈敏度 [SENS]',
                    arguments: {SENS: {type: ArgumentType.NUMBER, defaultValue: 1}}
                },
                {
                    opcode: 'disablemouselook',
                    blockType: BlockType.COMMAND,
                    text: '停用滑鼠視角'
                },
                {
                    opcode: 'mouselocked',
                    blockType: BlockType.BOOLEAN,
                    text: '滑鼠已鎖定？'
                }
            ],
            menus: {
                camera: {
                    acceptReporters: true,
                    items: '_getCameraMenu'
                },
                cameraField: {
                    acceptReporters: false,
                    items: '_getCameraFieldMenu'
                },
                followTarget: {
                    acceptReporters: true,
                    items: '_getFollowTargetMenu'
                }
            }
        };
    }

    _getCameraMenu () {
        return [...getCameraItems(this.runtime), {text: '下一台相機', value: NEXT}];
    }

    _getCameraFieldMenu () {
        const items = getCameraItems(this.runtime);
        return items.length ? items : [{text: '', value: ''}];
    }

    _getFollowTargetMenu () {
        return [{text: '我自己', value: MYSELF}, ...get3DSpriteItems(this.runtime)];
    }

    /**
     * @param {*} name a camera sprite's name, or NEXT
     * @returns {?CameraTarget} that camera sprite
     */
    _resolveCamera (name) {
        const scene3D = this.runtime.scene3D;
        const cameras = scene3D.getCameras();
        if (name === NEXT) {
            if (cameras.length === 0) return null;
            const index = cameras.indexOf(scene3D.getActiveCamera());
            return cameras[(index + 1) % cameras.length];
        }
        name = Cast.toString(name);
        return cameras.find(camera => camera.getName() === name) || null;
    }

    switchcamera (args) {
        const camera = this._resolveCamera(args.CAMERA);
        const scene3D = this.runtime.scene3D;
        if (!camera || camera === scene3D.getActiveCamera()) return;
        scene3D.setActiveCamera(camera);
        this.runtime.startHats('camera3d_whencameraswitchesto', {CAMERA: camera.getName()});
    }

    /**
     * Started by switchcamera with the camera's name, see runtime.startHats
     * @returns {boolean} true: the scripts always run
     */
    whencameraswitchesto () {
        return true;
    }

    currentcamera () {
        const camera = this.runtime.scene3D.getActiveCamera();
        return camera ? camera.getName() : '';
    }

    setfov (args, util) {
        util.target.setFov(Cast.toNumber(args.FOV));
    }

    changefov (args, util) {
        util.target.setFov(util.target.fov + Cast.toNumber(args.FOV));
    }

    fov (args, util) {
        return util.target.fov;
    }

    /**
     * @param {object} util block utility
     * @returns {?CameraTarget} the camera the follow blocks change: the camera sprite running them, or else the
     * current camera (null for the default camera)
     */
    _followCamera (util) {
        return util.target.isCamera ? util.target : this.runtime.scene3D.getActiveCamera();
    }

    /**
     * @param {*} name a 3D sprite's name, or MYSELF
     * @param {object} util block utility
     * @returns {?Target3D} that 3D sprite (not a camera), or the 3D sprite or clone running the block
     */
    _resolveFollowTarget (name, util) {
        const target = name === MYSELF ? util.target : get3DSprite(this.runtime, name);
        return target && target.is3D && !target.isCamera ? target : null;
    }

    _startFollowing (args, util, mode, distance) {
        const target = this._resolveFollowTarget(args.TARGET, util);
        if (!target) return;
        const follow = this.runtime.scene3D.follow;
        const camera = this._followCamera(util);
        follow.start(camera, target, mode, distance);
        // Right away, so that blocks after this one see where the camera is
        follow.update(0);
    }

    followthirdperson (args, util) {
        this._startFollowing(args, util, CameraFollow.THIRD_PERSON, Cast.toNumber(args.DISTANCE));
    }

    followfirstperson (args, util) {
        this._startFollowing(args, util, CameraFollow.FIRST_PERSON);
    }

    setfollowoffset (args, util) {
        this.runtime.scene3D.follow.setOffset(this._followCamera(util), {
            x: Cast.toNumber(args.X),
            y: Cast.toNumber(args.Y),
            z: Cast.toNumber(args.Z)
        });
    }

    setfollowangles (args, util) {
        this.runtime.scene3D.follow.setAngles(this._followCamera(util), Cast.toNumber(args.YAW),
            Cast.toNumber(args.PITCH));
    }

    changefollowangles (args, util) {
        this.runtime.scene3D.follow.changeAngles(this._followCamera(util), Cast.toNumber(args.YAW),
            Cast.toNumber(args.PITCH));
    }

    setfollowsmoothing (args, util) {
        this.runtime.scene3D.follow.setSmoothing(this._followCamera(util), Cast.toNumber(args.SECS));
    }

    stopfollowing (args, util) {
        this.runtime.scene3D.follow.stop(this._followCamera(util));
    }

    following (args, util) {
        const state = this.runtime.scene3D.follow.get(this._followCamera(util));
        return state ? state.target.getName() : '';
    }

    enablemouselook (args, util) {
        // Clicking the block in the palette also adds a WASD example script
        if (util.thread.stackClick && !util.target.blocks.getBlock(util.thread.topBlock)) {
            addMouseLookExample(this.runtime, util.target);
        }
        if (!this.runtime.scene3D.ensure()) return;
        this.runtime.scene3D.setPointerLock(true, Cast.toNumber(args.SENS));
    }

    disablemouselook () {
        this.runtime.scene3D.setPointerLock(false);
    }

    mouselocked () {
        return this.runtime.scene3D.isPointerLocked();
    }
}

module.exports = Scratch3Camera3DBlocks;

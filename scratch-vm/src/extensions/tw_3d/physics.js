const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');
const DataPath = require('../../util/data-path');
const {CAMERA, ANY, MOUSE, get3DSpriteItems, get3DSprite} = require('./common');

const MYSELF = '_myself_';

// What "[property] set to" can set
const MATERIAL_PROPERTIES = ['mass', 'bounce', 'friction', 'linearDamping', 'angularDamping'];

const round6 = n => Math.round(n * 1e6) / 1e6;

// How far rays go when a block doesn't say
const DEFAULT_RAY_LENGTH = 100;

/**
 * @param {?object} hit from Physics3D.raycast
 * @returns {object} what the raycast blocks report: {hit, sprite, distance, x, y, z}
 */
const hitResult = hit => (hit ? {
    hit: true,
    sprite: hit.target.getName(),
    distance: Math.round(hit.distance * 1e6) / 1e6,
    x: Math.round(hit.point.x * 1e6) / 1e6,
    y: Math.round(hit.point.y * 1e6) / 1e6,
    z: Math.round(hit.point.z * 1e6) / 1e6
} : {hit: false, sprite: '', distance: 0, x: 0, y: 0, z: 0});

/**
 * Collision and physics blocks of 3D sprites (ROADMAP.md 6.1 and 6.7), with Rapier (see engine/scene-3d-physics.js).
 * Raycasts, gravity and showing colliders work for every target; the rest only for 3D sprites (see block-support.js).
 */
class Scratch3Physics3DBlocks {
    constructor (runtime) {
        this.runtime = runtime;
    }

    get physics () {
        return this.runtime.scene3D.physics;
    }

    getInfo () {
        const number = defaultValue => ({type: ArgumentType.NUMBER, defaultValue});
        return {
            id: 'physics3d',
            name: '物理',
            color1: '#2BB673',
            color2: '#23A064',
            color3: '#1C8A55',
            blocks: [
                {
                    opcode: 'setbody',
                    blockType: BlockType.COMMAND,
                    text: '剛體類型設為 [BODY]',
                    arguments: {
                        BODY: {type: ArgumentType.STRING, menu: 'body', defaultValue: 'dynamic'}
                    }
                },
                {
                    opcode: 'setshape',
                    blockType: BlockType.COMMAND,
                    text: '碰撞形狀設為 [SHAPE]',
                    arguments: {
                        SHAPE: {type: ArgumentType.STRING, menu: 'shape', defaultValue: 'box'}
                    }
                },
                {
                    opcode: 'setmaterial',
                    blockType: BlockType.COMMAND,
                    text: '[PROPERTY] 設為 [VALUE]',
                    arguments: {
                        PROPERTY: {type: ArgumentType.STRING, menu: 'material', defaultValue: 'mass'},
                        VALUE: number(1)
                    }
                },
                {
                    opcode: 'setcollide',
                    blockType: BlockType.COMMAND,
                    text: '參與碰撞 [ON]',
                    arguments: {
                        ON: {type: ArgumentType.STRING, menu: 'onOff', defaultValue: 'off'}
                    }
                },
                {
                    opcode: 'setcollidehidden',
                    blockType: BlockType.COMMAND,
                    text: '隱藏時也能碰撞 [ON]',
                    arguments: {
                        ON: {type: ArgumentType.STRING, menu: 'onOff', defaultValue: 'on'}
                    }
                },
                {
                    opcode: 'setgroup',
                    blockType: BlockType.COMMAND,
                    text: '碰撞群組設為 [GROUP]',
                    arguments: {GROUP: number(2)}
                },
                {
                    opcode: 'setgroupscollide',
                    blockType: BlockType.COMMAND,
                    text: '群組 [A] 和群組 [B] [COLLIDE] 互相碰撞',
                    arguments: {
                        A: number(1),
                        B: number(2),
                        COLLIDE: {type: ArgumentType.STRING, menu: 'collide', defaultValue: 'no'}
                    }
                },
                {
                    opcode: 'setrotationlock',
                    blockType: BlockType.COMMAND,
                    text: '[LOCK] 旋轉',
                    arguments: {
                        LOCK: {type: ArgumentType.STRING, menu: 'lock', defaultValue: 'lock'}
                    }
                },
                '---',
                {
                    opcode: 'applyforce',
                    blockType: BlockType.COMMAND,
                    text: '施力 x:[X] y:[Y] z:[Z]',
                    arguments: {X: number(0), Y: number(10), Z: number(0)}
                },
                {
                    opcode: 'applyimpulse',
                    blockType: BlockType.COMMAND,
                    text: '施加衝量 x:[X] y:[Y] z:[Z]',
                    arguments: {X: number(0), Y: number(5), Z: number(0)}
                },
                {
                    opcode: 'setvelocity',
                    blockType: BlockType.COMMAND,
                    text: '速度設為 x:[X] y:[Y] z:[Z]',
                    arguments: {X: number(0), Y: number(0), Z: number(0)}
                },
                {
                    opcode: 'velocity',
                    blockType: BlockType.REPORTER,
                    text: '速度 [AXIS]',
                    disableMonitor: true,
                    arguments: {
                        AXIS: {type: ArgumentType.STRING, menu: 'axis', defaultValue: 'y'}
                    }
                },
                {
                    opcode: 'applytorque',
                    blockType: BlockType.COMMAND,
                    text: '施加扭力 x:[X] y:[Y] z:[Z]',
                    arguments: {X: number(0), Y: number(1), Z: number(0)}
                },
                {
                    opcode: 'applytorqueimpulse',
                    blockType: BlockType.COMMAND,
                    text: '施加扭力衝量 x:[X] y:[Y] z:[Z]',
                    arguments: {X: number(0), Y: number(1), Z: number(0)}
                },
                {
                    opcode: 'setangularvelocity',
                    blockType: BlockType.COMMAND,
                    text: '角速度設為 x:[X] y:[Y] z:[Z] 度/秒',
                    arguments: {X: number(0), Y: number(90), Z: number(0)}
                },
                {
                    opcode: 'angularvelocity',
                    blockType: BlockType.REPORTER,
                    text: '角速度 [AXIS]',
                    disableMonitor: true,
                    arguments: {
                        AXIS: {type: ArgumentType.STRING, menu: 'axis', defaultValue: 'y'}
                    }
                },
                '---',
                {
                    opcode: 'whencollisionstart',
                    blockType: BlockType.EVENT,
                    text: '當碰撞到 [TARGET]',
                    isEdgeActivated: false,
                    arguments: {
                        TARGET: {type: ArgumentType.STRING, menu: 'collisionTarget', defaultValue: ANY}
                    }
                },
                {
                    opcode: 'whencollisionend',
                    blockType: BlockType.EVENT,
                    text: '當離開 [TARGET]',
                    isEdgeActivated: false,
                    arguments: {
                        TARGET: {type: ArgumentType.STRING, menu: 'collisionTarget', defaultValue: ANY}
                    }
                },
                {
                    opcode: 'collision',
                    blockType: BlockType.REPORTER,
                    text: '碰撞的 [INFO]',
                    disableMonitor: true,
                    arguments: {
                        INFO: {type: ArgumentType.STRING, menu: 'collisionInfo', defaultValue: 'speed'}
                    }
                },
                '---',
                {
                    opcode: 'raycast',
                    blockType: BlockType.REPORTER,
                    text: '從 [FROM] 往前的射線 最遠 [LENGTH]',
                    disableMonitor: true,
                    arguments: {
                        FROM: {type: ArgumentType.STRING, menu: 'rayFrom', defaultValue: MYSELF},
                        LENGTH: number(DEFAULT_RAY_LENGTH)
                    }
                },
                {
                    opcode: 'raycastfrom',
                    blockType: BlockType.REPORTER,
                    text: '從位置 [ORIGIN] 往 [DIRECTION] 的射線 最遠 [LENGTH]',
                    disableMonitor: true,
                    arguments: {
                        ORIGIN: {type: ArgumentType.STRING, defaultValue: '{"x": 0, "y": 5, "z": 0}'},
                        DIRECTION: {type: ArgumentType.STRING, defaultValue: '{"x": 0, "y": -1, "z": 0}'},
                        LENGTH: number(DEFAULT_RAY_LENGTH)
                    }
                },
                '---',
                {
                    opcode: 'setgravity',
                    blockType: BlockType.COMMAND,
                    text: '重力設為 x:[X] y:[Y] z:[Z]',
                    arguments: {X: number(0), Y: number(-9.81), Z: number(0)}
                },
                {
                    opcode: 'gravity',
                    blockType: BlockType.REPORTER,
                    text: '重力 [AXIS]',
                    disableMonitor: true,
                    arguments: {
                        AXIS: {type: ArgumentType.STRING, menu: 'axis', defaultValue: 'y'}
                    }
                },
                '---',
                {
                    opcode: 'showcolliders',
                    blockType: BlockType.COMMAND,
                    text: '[SHOW] 碰撞形狀',
                    arguments: {
                        SHOW: {type: ArgumentType.STRING, menu: 'show', defaultValue: 'show'}
                    }
                }
            ],
            menus: {
                body: {
                    acceptReporters: true,
                    items: [
                        {text: '運動學（跟著積木移動）', value: 'kinematic'},
                        {text: '動態（受重力和力影響）', value: 'dynamic'},
                        {text: '靜態（不會動）', value: 'static'}
                    ]
                },
                shape: {
                    acceptReporters: true,
                    items: [
                        {text: '包圍盒', value: 'box'},
                        {text: '包圍球', value: 'sphere'},
                        {text: '膠囊', value: 'capsule'},
                        {text: '圓柱', value: 'cylinder'},
                        {text: '凸包', value: 'hull'},
                        {text: '網格（精確）', value: 'mesh'}
                    ]
                },
                material: {
                    acceptReporters: false,
                    items: [
                        {text: '質量', value: 'mass'},
                        {text: '彈性', value: 'bounce'},
                        {text: '摩擦力', value: 'friction'},
                        {text: '移動阻尼', value: 'linearDamping'},
                        {text: '轉動阻尼', value: 'angularDamping'}
                    ]
                },
                onOff: {
                    acceptReporters: false,
                    items: [
                        {text: '開', value: 'on'},
                        {text: '關', value: 'off'}
                    ]
                },
                collide: {
                    acceptReporters: false,
                    items: [
                        {text: '會', value: 'yes'},
                        {text: '不會', value: 'no'}
                    ]
                },
                collisionInfo: {
                    acceptReporters: false,
                    items: [
                        {text: '撞擊速度', value: 'speed'},
                        {text: '衝量', value: 'impulse'},
                        {text: '位置 x', value: 'x'},
                        {text: '位置 y', value: 'y'},
                        {text: '位置 z', value: 'z'},
                        {text: '對象', value: 'sprite'},
                        {text: '對象的分身 id', value: 'id'}
                    ]
                },
                show: {
                    acceptReporters: false,
                    items: [
                        {text: '顯示', value: 'show'},
                        {text: '隱藏', value: 'hide'}
                    ]
                },
                lock: {
                    acceptReporters: false,
                    items: [
                        {text: '鎖定', value: 'lock'},
                        {text: '解除鎖定', value: 'unlock'}
                    ]
                },
                axis: {
                    acceptReporters: false,
                    items: ['x', 'y', 'z']
                },
                collisionTarget: {
                    acceptReporters: false,
                    items: '_getCollisionTargetMenu'
                },
                rayFrom: {
                    acceptReporters: true,
                    items: '_getRayFromMenu'
                }
            }
        };
    }

    _getCollisionTargetMenu () {
        return [
            {text: '任何 3D 物件', value: ANY},
            ...get3DSpriteItems(this.runtime)
        ];
    }

    _getRayFromMenu () {
        return [
            {text: '我自己', value: MYSELF},
            {text: '目前的相機', value: CAMERA},
            {text: '滑鼠', value: MOUSE},
            ...get3DSpriteItems(this.runtime, this.runtime.getEditingTarget(), true)
        ];
    }

    setbody (args, util) {
        this.physics.setSettings(util.target, {body: Cast.toString(args.BODY)});
    }

    setshape (args, util) {
        this.physics.setSettings(util.target, {shape: Cast.toString(args.SHAPE)});
    }

    setmaterial (args, util) {
        if (!MATERIAL_PROPERTIES.includes(args.PROPERTY)) return;
        this.physics.setSettings(util.target, {[args.PROPERTY]: Cast.toNumber(args.VALUE)});
    }

    showcolliders (args) {
        this.runtime.scene3D.colliderView.setShown(args.SHOW === 'show');
    }

    setcollide (args, util) {
        this.physics.setSettings(util.target, {collide: args.ON !== 'off'});
    }

    setcollidehidden (args, util) {
        this.physics.setSettings(util.target, {collideHidden: args.ON === 'on'});
    }

    setgroup (args, util) {
        this.physics.setSettings(util.target, {group: Cast.toNumber(args.GROUP)});
    }

    setgroupscollide (args) {
        this.physics.setGroupsCollide(Cast.toNumber(args.A), Cast.toNumber(args.B), args.COLLIDE !== 'no');
    }

    setrotationlock (args, util) {
        this.physics.setSettings(util.target, {lockRotation: args.LOCK === 'lock'});
    }

    _vector (args) {
        return {x: Cast.toNumber(args.X), y: Cast.toNumber(args.Y), z: Cast.toNumber(args.Z)};
    }

    applyforce (args, util) {
        const force = this._vector(args);
        return this.physics.whenReady(() => this.physics.applyForce(util.target, force));
    }

    applyimpulse (args, util) {
        const impulse = this._vector(args);
        return this.physics.whenReady(() => this.physics.applyImpulse(util.target, impulse));
    }

    setvelocity (args, util) {
        const velocity = this._vector(args);
        return this.physics.whenReady(() => this.physics.setVelocity(util.target, velocity));
    }

    velocity (args, util) {
        if (!['x', 'y', 'z'].includes(args.AXIS)) return 0;
        const value = this.physics.getVelocity(util.target)[args.AXIS];
        return Math.round(value * 1e6) / 1e6;
    }

    applytorque (args, util) {
        const torque = this._vector(args);
        return this.physics.whenReady(() => this.physics.applyTorque(util.target, torque));
    }

    applytorqueimpulse (args, util) {
        const impulse = this._vector(args);
        return this.physics.whenReady(() => this.physics.applyTorqueImpulse(util.target, impulse));
    }

    setangularvelocity (args, util) {
        const velocity = this._vector(args);
        return this.physics.whenReady(() => this.physics.setAngularVelocity(util.target, velocity));
    }

    angularvelocity (args, util) {
        if (!['x', 'y', 'z'].includes(args.AXIS)) return 0;
        return round6(this.physics.getAngularVelocity(util.target)[args.AXIS]);
    }

    /**
     * In a "when collided" script: the collision that started it. Elsewhere: the sprite's last collision.
     * @param {object} args INFO: speed, impulse, x, y, z, sprite or id
     * @param {object} util
     * @returns {number|string} that about the collision; 0 or '' if there was none
     */
    collision (args, util) {
        const collision = (util.thread && util.thread.collision3D) || util.target.lastCollision3D;
        if (args.INFO === 'sprite') return collision ? collision.other.getName() : '';
        if (!collision) return 0;
        switch (args.INFO) {
        case 'speed': return round6(collision.speed);
        case 'impulse': return round6(collision.impulse);
        case 'x': case 'y': case 'z': return round6(collision.point[args.INFO]);
        case 'id': {
            const other = collision.other;
            return other.isOriginal || other.cloneId === void 0 ? 0 : other.cloneId;
        }
        }
        return 0;
    }

    /**
     * Started by Physics3D.step with the other sprite's name, see runtime.startHats
     * @returns {boolean} true: the scripts always run
     */
    whencollisionstart () {
        return true;
    }

    whencollisionend () {
        return true;
    }

    /**
     * @param {*} from MYSELF, CAMERA, MOUSE or a 3D sprite's name
     * @param {Target} self the target running the block
     * @returns {?{origin: object, direction: object, exclude: ?Target3D}} where the ray starts and which way it goes
     */
    _ray (from, self) {
        const scene3D = this.runtime.scene3D;
        from = Cast.toString(from);
        if (from === MOUSE) {
            const ray = scene3D.getMouseRay();
            return ray && {origin: ray.origin, direction: ray.direction, exclude: null};
        }
        let target = null;
        if (from === MYSELF) target = self;
        else if (from !== CAMERA) target = get3DSprite(this.runtime, from);
        if (from === CAMERA || (target && target.isCamera && target === scene3D.getActiveCamera())) {
            const camera = scene3D.getCameraState();
            const yaw = camera.yaw * Math.PI / 180;
            const pitch = camera.pitch * Math.PI / 180;
            return {
                origin: {x: camera.x, y: camera.y, z: camera.z},
                direction: {
                    x: -Math.sin(yaw) * Math.cos(pitch),
                    y: Math.sin(pitch),
                    z: -Math.cos(yaw) * Math.cos(pitch)
                },
                exclude: null
            };
        }
        if (!target || !target.is3D) return null;
        const pose = target.getWorldPose();
        const yaw = pose.yaw * Math.PI / 180;
        const pitch = pose.pitch * Math.PI / 180;
        return {
            origin: {x: pose.x, y: pose.y, z: pose.z},
            direction: {
                x: -Math.sin(yaw) * Math.cos(pitch),
                y: Math.sin(pitch),
                z: -Math.cos(yaw) * Math.cos(pitch)
            },
            // A ray that starts inside its sprite doesn't hit it
            exclude: target
        };
    }

    raycast (args, util) {
        const length = Cast.toNumber(args.LENGTH);
        return this.physics.whenReady(() => {
            const ray = this._ray(args.FROM, util.target);
            if (!ray) return hitResult(null);
            return hitResult(this.physics.raycast(ray.origin, ray.direction, length, ray.exclude));
        }, hitResult(null));
    }

    raycastfrom (args) {
        const origin = DataPath.toVector(args.ORIGIN, {x: 0, y: 0, z: 0});
        const direction = DataPath.toVector(args.DIRECTION, {x: 0, y: -1, z: 0});
        const length = Cast.toNumber(args.LENGTH);
        return this.physics.whenReady(() => hitResult(this.physics.raycast(origin, direction, length, null)),
            hitResult(null));
    }

    setgravity (args) {
        this.physics.setGravity(this._vector(args));
    }

    gravity (args) {
        if (!['x', 'y', 'z'].includes(args.AXIS)) return 0;
        return this.physics.gravity[args.AXIS];
    }
}

module.exports = Scratch3Physics3DBlocks;

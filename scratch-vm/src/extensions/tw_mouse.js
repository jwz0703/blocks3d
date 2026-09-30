const ArgumentType = require('../extension-support/argument-type');
const BlockType = require('../extension-support/block-type');
const Cast = require('../util/cast');
const {get3DSpriteItems} = require('./tw_3d/common');

// Skip menu of "sprite under the mouse": sprites that the mouse goes through (the value is from before mouse modes)
const UNCLICKABLE = '_unclickable_';

// What "set cursor" can show, as CSS cursors
const CURSORS = [
    {text: '預設', value: 'default'},
    {text: '手指', value: 'pointer'},
    {text: '抓取', value: 'grab'},
    {text: '抓住', value: 'grabbing'},
    {text: '十字', value: 'crosshair'},
    {text: '移動', value: 'move'},
    {text: '文字', value: 'text'},
    {text: '不能', value: 'not-allowed'},
    {text: '隱藏', value: 'none'}
];
const CURSOR_VALUES = CURSORS.map(item => item.value);

const EVENT_COLORS = {color1: '#FFBF00', color2: '#E6AC00', color3: '#CC9900'};

const round = value => Math.round(value * 1e6) / 1e6;

/**
 * @param {?object} hit from Scene3D.pickHit
 * @returns {object} what "sprite under the mouse" reports: {hit, sprite, id, distance, x, y, z}, like the raycast
 * blocks of physics3d, and the clone id (0 for originals)
 */
const hitResult = hit => (hit ? {
    hit: true,
    sprite: hit.target.getName(),
    id: hit.target.isOriginal || hit.target.cloneId === void 0 ? 0 : hit.target.cloneId,
    distance: round(hit.distance),
    x: round(hit.point.x),
    y: round(hit.point.y),
    z: round(hit.point.z)
} : {hit: false, sprite: '', id: 0, distance: 0, x: 0, y: 0, z: 0});

/**
 * @param {*} value what the skip input of "sprite under the mouse" got
 * @returns {Array<string>} names in it: an array of names, one name, or UNCLICKABLE
 */
const namesToSkip = value => {
    if (typeof value === 'string' && value.trim().startsWith('[')) {
        try {
            value = JSON.parse(value);
        } catch (e) {
            // Just a name
        }
    }
    if (Array.isArray(value)) return value.map(name => Cast.toString(name));
    const name = Cast.toString(value);
    return name ? [name] : [];
};

/**
 * The mouse beyond what Scratch has (ROADMAP.md 9, 輸入與點擊): the wheel (and pinching a trackpad), taps that
 * don't count drags as clicks, sprites that the mouse goes through (RenderedTarget.mouseMode), what 3D sprite the
 * mouse points at, and the cursor.
 * Built in: the hats are shown in Events, the other blocks in Sensing.
 */
class Scratch3MouseBlocks {
    constructor (runtime) {
        this.runtime = runtime;
    }

    getInfo () {
        return {
            id: 'twmouse',
            name: '滑鼠',
            color1: '#5CB1D6',
            color2: '#47A8D1',
            color3: '#2E8EB8',
            blocks: [
                Object.assign({
                    // Started by io/mouseWheel.js
                    opcode: 'whenwheel',
                    blockType: BlockType.HAT,
                    text: '當滑鼠滾輪 [DIRECTION]',
                    isEdgeActivated: false,
                    arguments: {
                        DIRECTION: {type: ArgumentType.STRING, menu: 'direction', defaultValue: 'ANY'}
                    }
                }, EVENT_COLORS),
                Object.assign({
                    // Started by io/mouse.js, like the ones below
                    opcode: 'whentapped',
                    blockType: BlockType.HAT,
                    text: '當這個角色被點一下',
                    isEdgeActivated: false
                }, EVENT_COLORS),
                Object.assign({
                    opcode: 'whenstagetapped',
                    blockType: BlockType.HAT,
                    text: '當舞台被點一下',
                    isEdgeActivated: false
                }, EVENT_COLORS),
                {
                    opcode: 'wheel',
                    blockType: BlockType.REPORTER,
                    text: '滑鼠滾輪變化量'
                },
                {
                    opcode: 'pointed',
                    blockType: BlockType.REPORTER,
                    text: '滑鼠指到的 3D 角色 略過 [SKIP]',
                    disableMonitor: true,
                    arguments: {
                        SKIP: {type: ArgumentType.STRING, menu: 'skip', defaultValue: ''}
                    }
                },
                {
                    opcode: 'setmousemode',
                    blockType: BlockType.COMMAND,
                    text: '讓滑鼠 [MODE] 這個角色',
                    arguments: {
                        MODE: {type: ArgumentType.STRING, menu: 'mouseMode', defaultValue: 'pass'}
                    }
                },
                {
                    // Before mouse modes; still runs in old projects, but isn't in the palette
                    opcode: 'setclickable',
                    blockType: BlockType.COMMAND,
                    text: '將可以被點擊設為 [CLICKABLE]',
                    hideFromPalette: true,
                    arguments: {
                        CLICKABLE: {type: ArgumentType.STRING, menu: 'onOff', defaultValue: 'off'}
                    }
                },
                {
                    opcode: 'setcursor',
                    blockType: BlockType.COMMAND,
                    text: '將游標設為 [CURSOR]',
                    arguments: {
                        CURSOR: {type: ArgumentType.STRING, menu: 'cursor', defaultValue: 'pointer'}
                    }
                }
            ],
            menus: {
                // Upper case: startHats compares hat fields in upper case
                direction: {
                    acceptReporters: false,
                    items: [
                        {text: '滾動', value: 'ANY'},
                        {text: '往上滾', value: 'UP'},
                        {text: '往下滾', value: 'DOWN'}
                    ]
                },
                skip: {
                    acceptReporters: true,
                    items: '_getSkipMenu'
                },
                mouseMode: {
                    acceptReporters: false,
                    items: [
                        {text: '自動判斷', value: 'auto'},
                        {text: '穿過', value: 'pass'},
                        {text: '停在', value: 'block'}
                    ]
                },
                onOff: {
                    acceptReporters: false,
                    items: [
                        {text: '開', value: 'on'},
                        {text: '關', value: 'off'}
                    ]
                },
                cursor: {
                    acceptReporters: true,
                    items: CURSORS
                }
            }
        };
    }

    _getSkipMenu () {
        return [
            {text: '無', value: ''},
            {text: '滑鼠會穿過的角色', value: UNCLICKABLE},
            ...get3DSpriteItems(this.runtime)
        ];
    }

    whenwheel () {
        return true;
    }

    whentapped () {
        return true;
    }

    whenstagetapped () {
        return true;
    }

    wheel () {
        return this.runtime.ioDevices.mouseWheel.getDelta();
    }

    /**
     * The first 3D sprite that the ray from the camera through the mouse hits, even one that the mouse goes through
     * (e.g. to find a point on the ground), unless it is skipped.
     * @param {object} args SKIP: '', UNCLICKABLE (sprites the mouse goes through), a sprite's name or an array of
     * names
     * @returns {object} see hitResult
     */
    pointed (args) {
        const names = namesToSkip(args.SKIP);
        const skipUnclickable = names.includes(UNCLICKABLE);
        const skip = target => (skipUnclickable && !target.blocksMouse()) || names.includes(target.getName());
        const mouse = this.runtime.ioDevices.mouse;
        return hitResult(this.runtime.scene3D.pickHit(mouse.getScratchX(), mouse.getScratchY(), skip));
    }

    setmousemode (args, util) {
        util.target.setMouseMode(args.MODE);
    }

    setclickable (args, util) {
        util.target.setClickable(args.CLICKABLE !== 'off');
    }

    setcursor (args) {
        const cursor = Cast.toString(args.CURSOR);
        if (CURSOR_VALUES.includes(cursor)) this.runtime.setCursor(cursor);
    }
}

module.exports = Scratch3MouseBlocks;

const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');

/**
 * 虛擬搖桿 (ROADMAP.md 7.3): joysticks and buttons on the screen of phones and tablets, read with reporters.
 * An extension from the extension library, not built in.
 *
 * The same project works with a keyboard: a joystick that no finger is on reads its keys instead (the left one
 * WASD and the arrow keys), and a button reads its key. The other way around, a joystick or button can also press
 * keys, so that projects written for the keyboard work on a phone without changes, or turn the camera like mouse
 * look.
 *
 * A control shows itself on touch screens once a block uses it, unless blocks show or hide it. Everything goes back
 * to that when the project stops.
 */

// Pushed less than this doesn't count, so that a resting thumb doesn't move anything
const DEAD_ZONE = 0.12;
// "推向" is true beyond this
const PUSH_THRESHOLD = 0.5;
// Degrees per second that a joystick fully pushed turns the camera
const LOOK_SPEED = 150;

const STICKS = ['left', 'right'];
const BUTTONS = ['a', 'b'];

// What a joystick also does: the keys it presses for up, down, left and right, or turning the camera
const STICK_ACTIONS = {
    wasd: ['w', 's', 'a', 'd'],
    arrows: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'],
    look: null,
    none: null
};
const DEFAULT_STICK_ACTIONS = {left: 'wasd', right: 'none'};
const DEFAULT_BUTTON_KEYS = {a: 'space', b: ''};

// Keys a joystick reads when no finger is on it, as Scratch key names: up, down, left, right
const STICK_KEYS = {
    left: [['w', 'up arrow'], ['s', 'down arrow'], ['a', 'left arrow'], ['d', 'right arrow']],
    right: [[], [], [], []]
};

/**
 * @param {string} key a Scratch key name ("space", "a") or a key of keyboard events ("ArrowUp")
 * @returns {string} the key as keyboard events name it, which Keyboard.postData takes
 */
const toEventKey = key => {
    switch (key) {
    case 'space': return ' ';
    case 'up arrow': return 'ArrowUp';
    case 'down arrow': return 'ArrowDown';
    case 'left arrow': return 'ArrowLeft';
    case 'right arrow': return 'ArrowRight';
    case 'enter': return 'Enter';
    case 'shift': return 'Shift';
    default: return key;
    }
};

/**
 * @param {number} x
 * @param {number} y
 * @returns {{x: number, y: number}} the stick without the dead zone, still reaching 1 at the edge
 */
const applyDeadZone = (x, y) => {
    const length = Math.hypot(x, y);
    if (length <= DEAD_ZONE) return {x: 0, y: 0};
    const scale = Math.min(1, (length - DEAD_ZONE) / (1 - DEAD_ZONE)) / length;
    return {x: x * scale, y: y * scale};
};

const round = value => Math.round(value * 1000) / 1000;

const makeState = () => ({
    sticks: {
        left: {x: 0, y: 0, touched: false, mode: 'auto', used: false, action: DEFAULT_STICK_ACTIONS.left},
        right: {x: 0, y: 0, touched: false, mode: 'auto', used: false, action: DEFAULT_STICK_ACTIONS.right}
    },
    buttons: {
        a: {pressed: false, mode: 'auto', used: false, key: DEFAULT_BUTTON_KEYS.a},
        b: {pressed: false, mode: 'auto', used: false, key: DEFAULT_BUTTON_KEYS.b}
    }
});

class JoystickBlocks {
    constructor (runtime) {
        this.runtime = runtime;
        this.state = makeState();
        /** @type {Set<string>} keys (as keyboard events name them) that the controls hold down */
        this._pressedKeys = new Set();
        /** True once the screen was touched, or if the device has a touch screen */
        this.touchScreen = typeof window !== 'undefined' && (
            (typeof window.matchMedia === 'function' && window.matchMedia('(any-pointer: coarse)').matches) ||
            (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)
        );
        this._overlay = null;
        this._touchCanvas = null;
        this._onTouch = this._onTouch.bind(this);

        runtime.on('BEFORE_EXECUTE', () => this._frame());
        runtime.on('PROJECT_STOP_ALL', () => this._reset());
        runtime.on('RUNTIME_DISPOSED', () => this._reset());
    }

    getInfo () {
        const stick = {type: ArgumentType.STRING, menu: 'stick', defaultValue: 'left'};
        const button = {type: ArgumentType.STRING, menu: 'button', defaultValue: 'a'};
        return {
            id: 'joystick',
            name: '虛擬搖桿',
            color1: '#FF6680',
            color2: '#FF4D6A',
            color3: '#E63D5A',
            blocks: [
                {
                    opcode: 'stickValue',
                    blockType: BlockType.REPORTER,
                    text: '搖桿 [STICK] 的 [PART]',
                    arguments: {
                        STICK: stick,
                        PART: {type: ArgumentType.STRING, menu: 'part', defaultValue: 'x'}
                    }
                },
                {
                    opcode: 'isPushed',
                    blockType: BlockType.BOOLEAN,
                    text: '搖桿 [STICK] 推向 [DIRECTION]？',
                    arguments: {
                        STICK: stick,
                        DIRECTION: {type: ArgumentType.STRING, menu: 'direction', defaultValue: 'up'}
                    }
                },
                {
                    opcode: 'isButtonPressed',
                    blockType: BlockType.BOOLEAN,
                    text: '按鈕 [BUTTON] 被按住？',
                    arguments: {BUTTON: button}
                },
                {
                    opcode: 'whenButtonPressed',
                    blockType: BlockType.HAT,
                    text: '當按鈕 [BUTTON] 被按下',
                    isEdgeActivated: true,
                    arguments: {BUTTON: button}
                },
                '---',
                {
                    opcode: 'setStickAction',
                    blockType: BlockType.COMMAND,
                    text: '搖桿 [STICK] 也控制 [ACTION]',
                    arguments: {
                        STICK: stick,
                        ACTION: {type: ArgumentType.STRING, menu: 'action', defaultValue: 'wasd'}
                    }
                },
                {
                    opcode: 'setButtonKey',
                    blockType: BlockType.COMMAND,
                    text: '按鈕 [BUTTON] 也按下 [KEY]',
                    arguments: {
                        BUTTON: button,
                        KEY: {type: ArgumentType.STRING, menu: 'key', defaultValue: 'space'}
                    }
                },
                {
                    opcode: 'setShown',
                    blockType: BlockType.COMMAND,
                    text: '觸控控制項 [CONTROL] [MODE]',
                    arguments: {
                        CONTROL: {type: ArgumentType.STRING, menu: 'control', defaultValue: 'left'},
                        MODE: {type: ArgumentType.STRING, menu: 'mode', defaultValue: 'always'}
                    }
                },
                {
                    opcode: 'isTouchScreen',
                    blockType: BlockType.BOOLEAN,
                    text: '觸控螢幕？'
                }
            ],
            menus: {
                stick: {
                    acceptReporters: false,
                    items: [
                        {text: '左', value: 'left'},
                        {text: '右', value: 'right'}
                    ]
                },
                button: {
                    acceptReporters: false,
                    items: ['A', 'B'].map(name => ({text: name, value: name.toLowerCase()}))
                },
                part: {
                    acceptReporters: false,
                    items: [
                        {text: 'x', value: 'x'},
                        {text: 'y', value: 'y'},
                        {text: '方向', value: 'direction'},
                        {text: '力道', value: 'distance'}
                    ]
                },
                direction: {
                    acceptReporters: false,
                    items: [
                        {text: '上', value: 'up'},
                        {text: '下', value: 'down'},
                        {text: '左', value: 'left'},
                        {text: '右', value: 'right'},
                        {text: '任何方向', value: 'any'}
                    ]
                },
                action: {
                    acceptReporters: false,
                    items: [
                        {text: 'WASD 鍵', value: 'wasd'},
                        {text: '方向鍵', value: 'arrows'},
                        {text: '視角', value: 'look'},
                        {text: '不控制', value: 'none'}
                    ]
                },
                key: {
                    acceptReporters: true,
                    items: [
                        {text: '空白鍵', value: 'space'},
                        {text: 'enter', value: 'enter'},
                        {text: 'shift', value: 'shift'},
                        'z', 'x', 'c', 'e', 'f', 'q',
                        {text: '不按', value: ''}
                    ]
                },
                control: {
                    acceptReporters: false,
                    items: [
                        {text: '左搖桿', value: 'left'},
                        {text: '右搖桿', value: 'right'},
                        {text: '按鈕 A', value: 'a'},
                        {text: '按鈕 B', value: 'b'},
                        {text: '全部', value: 'all'}
                    ]
                },
                mode: {
                    acceptReporters: false,
                    items: [
                        {text: '永遠顯示', value: 'always'},
                        {text: '隱藏', value: 'hidden'},
                        {text: '只在觸控螢幕顯示', value: 'auto'}
                    ]
                }
            }
        };
    }

    // Blocks

    stickValue (args) {
        const {x, y} = this._readStick(args.STICK);
        switch (args.PART) {
        case 'x': return round(x);
        case 'y': return round(y);
        // Like the direction of sprites: 0 is up, 90 is right
        case 'direction': return x === 0 && y === 0 ? 0 : round(Math.atan2(x, y) * 180 / Math.PI);
        case 'distance': return round(Math.min(1, Math.hypot(x, y)));
        }
        return 0;
    }

    isPushed (args) {
        const {x, y} = this._readStick(args.STICK);
        switch (args.DIRECTION) {
        case 'up': return y >= PUSH_THRESHOLD;
        case 'down': return y <= -PUSH_THRESHOLD;
        case 'left': return x <= -PUSH_THRESHOLD;
        case 'right': return x >= PUSH_THRESHOLD;
        case 'any': return Math.hypot(x, y) >= PUSH_THRESHOLD;
        }
        return false;
    }

    isButtonPressed (args) {
        return this._readButton(args.BUTTON);
    }

    whenButtonPressed (args) {
        return this._readButton(args.BUTTON);
    }

    setStickAction (args) {
        const stick = this._stick(args.STICK);
        if (!stick || !Object.prototype.hasOwnProperty.call(STICK_ACTIONS, args.ACTION)) return;
        stick.used = true;
        if (stick.action === args.ACTION) return;
        this._releaseKeys();
        stick.action = args.ACTION;
    }

    setButtonKey (args) {
        const button = this._button(args.BUTTON);
        if (!button) return;
        button.used = true;
        const key = Cast.toString(args.KEY);
        if (button.key === key) return;
        this._releaseKeys();
        button.key = key;
    }

    setShown (args) {
        const mode = ['always', 'hidden', 'auto'].includes(args.MODE) ? args.MODE : 'auto';
        const names = args.CONTROL === 'all' ? [...STICKS, ...BUTTONS] : [args.CONTROL];
        for (const name of names) {
            const control = this._stick(name) || this._button(name);
            if (!control) continue;
            control.mode = mode;
            control.used = true;
        }
    }

    isTouchScreen () {
        return !!this.touchScreen;
    }

    // State

    _stick (name) {
        return STICKS.includes(name) ? this.state.sticks[name] : null;
    }

    _button (name) {
        return BUTTONS.includes(name) ? this.state.buttons[name] : null;
    }

    /**
     * @param {string} name 'left' or 'right'
     * @returns {{x: number, y: number}} how far the joystick is pushed, from its finger or else from its keys
     */
    _readStick (name) {
        const stick = this._stick(name);
        if (!stick) return {x: 0, y: 0};
        stick.used = true;
        if (stick.touched) return applyDeadZone(stick.x, stick.y);
        const keyboard = this.runtime.ioDevices.keyboard;
        const [up, down, left, right] = STICK_KEYS[name].map(keys => keys.some(key => keyboard.getKeyIsDown(key)));
        const x = (right ? 1 : 0) - (left ? 1 : 0);
        const y = (up ? 1 : 0) - (down ? 1 : 0);
        // Diagonals are as far as straight directions
        const length = Math.hypot(x, y) || 1;
        return {x: x / length, y: y / length};
    }

    _readButton (name) {
        const button = this._button(name);
        if (!button) return false;
        button.used = true;
        if (button.pressed) return true;
        return !!button.key && this.runtime.ioDevices.keyboard.getKeyIsDown(button.key);
    }

    /**
     * A finger moved a joystick on the screen (or a test did).
     * @param {string} name 'left' or 'right'
     * @param {number} x -1 to 1
     * @param {number} y -1 to 1, up is positive
     * @param {boolean} touched false when the finger let go
     */
    setStick (name, x, y, touched) {
        const stick = this._stick(name);
        if (!stick) return;
        stick.x = touched ? x : 0;
        stick.y = touched ? y : 0;
        stick.touched = touched;
        this.touchScreen = true;
        this._updateKeys();
    }

    /**
     * @param {string} name 'a' or 'b'
     * @param {boolean} pressed
     */
    setButton (name, pressed) {
        const button = this._button(name);
        if (!button) return;
        button.pressed = pressed;
        this.touchScreen = true;
        this._updateKeys();
    }

    /**
     * Press and release the keys that the controls press, see setStickAction and setButtonKey.
     */
    _updateKeys () {
        const wanted = new Set();
        for (const name of STICKS) {
            const stick = this.state.sticks[name];
            const keys = STICK_ACTIONS[stick.action];
            if (!keys || !stick.touched) continue;
            const {x, y} = applyDeadZone(stick.x, stick.y);
            if (y >= PUSH_THRESHOLD) wanted.add(keys[0]);
            if (y <= -PUSH_THRESHOLD) wanted.add(keys[1]);
            if (x <= -PUSH_THRESHOLD) wanted.add(keys[2]);
            if (x >= PUSH_THRESHOLD) wanted.add(keys[3]);
        }
        for (const name of BUTTONS) {
            const button = this.state.buttons[name];
            if (button.pressed && button.key) wanted.add(toEventKey(button.key));
        }
        const keyboard = this.runtime.ioDevices.keyboard;
        for (const key of this._pressedKeys) {
            if (!wanted.has(key)) {
                this._pressedKeys.delete(key);
                keyboard.postData({key, isDown: false});
            }
        }
        for (const key of wanted) {
            if (!this._pressedKeys.has(key)) {
                this._pressedKeys.add(key);
                keyboard.postData({key, isDown: true});
            }
        }
    }

    _releaseKeys () {
        const keyboard = this.runtime.ioDevices.keyboard;
        for (const key of this._pressedKeys) keyboard.postData({key, isDown: false});
        this._pressedKeys.clear();
    }

    _reset () {
        if (this._overlay) this._overlay.releaseAll();
        this._releaseKeys();
        this.state = makeState();
    }

    /**
     * @param {object} control a joystick or button
     * @returns {boolean} true if it is on the screen
     */
    _isShown (control) {
        if (control.mode === 'always') return true;
        if (control.mode === 'hidden') return false;
        return control.used && !!this.touchScreen;
    }

    /**
     * Every frame, before scripts run: turn the camera with joysticks that do that, and show the controls.
     */
    _frame () {
        const runtime = this.runtime;
        if (!runtime.paused) {
            const dt = runtime.frameDelta;
            for (const name of STICKS) {
                const stick = this.state.sticks[name];
                if (stick.action !== 'look' || !stick.touched || !runtime.scene3D) continue;
                const {x, y} = applyDeadZone(stick.x, stick.y);
                if (x !== 0 || y !== 0) runtime.scene3D.look(-x * LOOK_SPEED * dt, y * LOOK_SPEED * dt);
            }
        }
        this._updateOverlay();
    }

    _updateOverlay () {
        const shown = {};
        for (const name of STICKS) shown[name] = this._isShown(this.state.sticks[name]);
        for (const name of BUTTONS) shown[name] = this._isShown(this.state.buttons[name]);
        if (!this._overlay) {
            if (!Object.values(shown).some(Boolean)) {
                this._listenForTouch();
                return;
            }
            const renderer = this.runtime.renderer;
            if (!renderer || !renderer.canvas || typeof document === 'undefined') return;
            const JoystickOverlay = require('./overlay');
            this._overlay = new JoystickOverlay(renderer.canvas, {
                onStick: (name, x, y, touched) => this.setStick(name, x, y, touched),
                onButton: (name, pressed) => this.setButton(name, pressed)
            });
        }
        this._overlay.update(shown);
    }

    /**
     * Notice touch screens that don't say they are one, from the first touch on the stage.
     */
    _listenForTouch () {
        if (this.touchScreen || this._touchCanvas) return;
        const renderer = this.runtime.renderer;
        if (!renderer || !renderer.canvas || typeof renderer.canvas.addEventListener !== 'function') return;
        this._touchCanvas = renderer.canvas;
        this._touchCanvas.addEventListener('pointerdown', this._onTouch);
    }

    _onTouch (e) {
        if (e.pointerType !== 'touch') return;
        this.touchScreen = true;
        this._touchCanvas.removeEventListener('pointerdown', this._onTouch);
    }
}

module.exports = JoystickBlocks;

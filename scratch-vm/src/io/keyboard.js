const Cast = require('../util/cast');

/**
 * Names used internally for keys used in scratch, also known as "scratch keys".
 * @enum {string}
 */
const KEY_NAME = {
    SPACE: 'space',
    LEFT: 'left arrow',
    UP: 'up arrow',
    RIGHT: 'right arrow',
    DOWN: 'down arrow',
    ENTER: 'enter',
    // tw: extra keys
    BACKSPACE: 'backspace',
    DELETE: 'delete',
    SHIFT: 'shift',
    CAPS_LOCK: 'caps lock',
    SCROLL_LOCK: 'scroll lock',
    CONTROL: 'control',
    ESCAPE: 'escape',
    INSERT: 'insert',
    HOME: 'home',
    END: 'end',
    PAGE_UP: 'page up',
    PAGE_DOWN: 'page down'
};

/**
 * A set of the names of Scratch keys.
 * @type {Set<string>}
 */
const KEY_NAME_SET = new Set(Object.values(KEY_NAME));

class Keyboard {
    constructor (runtime) {
        /**
         * List of currently pressed scratch keys.
         * A scratch key is:
         * A key you can press on a keyboard, excluding modifier keys.
         * An uppercase string of length one;
         *     except for special key names for arrow keys and space (e.g. 'left arrow').
         * Can be a non-english unicode letter like: æ ø ש נ 手 廿.
         * @type{Array.<string>}
         */
        this._keysPressed = [];
        /**
         * Reference to the owning Runtime.
         * Can be used, for example, to activate hats.
         * @type{!Runtime}
         */
        this.runtime = runtime;
        // tw: track last pressed key
        this.lastKeyPressed = '';
        this._numeralKeyCodesToStringKey = new Map();
        /**
         * Set of Scratch keys used by the project.
         */
        this._usedKeys = new Set();
        /**
         * Keys that went down / up since the last frame started, each with the serial number of that
         * event. Recorded from events rather than by comparing states, so a tap shorter than one
         * frame is not lost.
         * @type {Map<string, number>}
         */
        this._pendingDown = new Map();
        this._pendingUp = new Map();
        /**
         * Keys that went down / up just before the current frame, with their event serial numbers.
         * @type {Map<string, number>}
         */
        this._justDown = new Map();
        this._justUp = new Map();
        this._eventSerial = 0;
        /**
         * Time (Date.now()) each currently held key went down.
         * @type {Map<string, number>}
         */
        this._downSince = new Map();
        /**
         * Time (Date.now()) the current frame started.
         */
        this._frameTime = Date.now();
    }

    /**
     * Called by the runtime at the start of every frame: the key events since the last frame
     * become this frame's "just pressed" / "just released" keys.
     */
    stepFrame () {
        const justDown = this._justDown;
        const justUp = this._justUp;
        justDown.clear();
        justUp.clear();
        this._justDown = this._pendingDown;
        this._justUp = this._pendingUp;
        this._pendingDown = justDown;
        this._pendingUp = justUp;
        this._frameTime = Date.now();
    }

    _markDown (scratchKey) {
        this._pendingDown.set(scratchKey, ++this._eventSerial);
        this._downSince.set(scratchKey, Date.now());
    }

    _markUp (scratchKey) {
        this._pendingUp.set(scratchKey, ++this._eventSerial);
        this._downSince.delete(scratchKey);
    }

    /**
     * Report a key event from this frame at most once per block per thread, so a loop that runs
     * many times in one frame (or without screen refresh) sees each press only once.
     * @param {Map<string, number>} events this frame's key events
     * @param {string} kind 'd' or 'u'
     * @param {Any} keyArg key argument
     * @param {?Thread} thread thread asking
     * @param {?string} blockId block asking
     * @returns {boolean} true if there is an event this block has not reported yet
     */
    _takeEvent (events, kind, keyArg, thread, blockId) {
        let serial = 0;
        let scratchKey;
        if (keyArg === 'any') {
            scratchKey = 'any';
            for (const s of events.values()) {
                if (s > serial) serial = s;
            }
        } else {
            scratchKey = this._keyArgToScratchKey(keyArg);
            this._usedKeys.add(scratchKey);
            serial = events.get(scratchKey) || 0;
        }
        if (serial === 0) return false;
        if (!thread || !blockId) return true;
        if (!thread.keyEventsSeen) thread.keyEventsSeen = new Map();
        const seenKey = `${kind}\0${blockId}\0${scratchKey}`;
        if (thread.keyEventsSeen.get(seenKey) === serial) return false;
        thread.keyEventsSeen.set(seenKey, serial);
        return true;
    }

    /**
     * Convert from a keyboard event key name to a Scratch key name.
     * @param  {string} keyString the input key string.
     * @return {string} the corresponding Scratch key, or an empty string.
     */
    _keyStringToScratchKey (keyString) {
        keyString = Cast.toString(keyString);
        // Convert space and arrow keys to their Scratch key names.
        switch (keyString) {
        case ' ': return KEY_NAME.SPACE;
        case 'ArrowLeft':
        case 'Left': return KEY_NAME.LEFT;
        case 'ArrowUp':
        case 'Up': return KEY_NAME.UP;
        case 'Right':
        case 'ArrowRight': return KEY_NAME.RIGHT;
        case 'Down':
        case 'ArrowDown': return KEY_NAME.DOWN;
        case 'Enter': return KEY_NAME.ENTER;
        // tw: extra keys
        case 'Backspace': return KEY_NAME.BACKSPACE;
        case 'Delete': return KEY_NAME.DELETE;
        case 'Shift': return KEY_NAME.SHIFT;
        case 'CapsLock': return KEY_NAME.CAPS_LOCK;
        case 'ScrollLock': return KEY_NAME.SCROLL_LOCK;
        case 'Control': return KEY_NAME.CONTROL;
        case 'Escape': return KEY_NAME.ESCAPE;
        case 'Insert': return KEY_NAME.INSERT;
        case 'Home': return KEY_NAME.HOME;
        case 'End': return KEY_NAME.END;
        case 'PageUp': return KEY_NAME.PAGE_UP;
        case 'PageDown': return KEY_NAME.PAGE_DOWN;
        }
        // Ignore modifier keys
        if (keyString.length > 1) {
            return '';
        }
        // tw: toUpperCase() happens later. We need to track key case.
        return keyString;
    }

    /**
     * Convert from a block argument to a Scratch key name.
     * @param  {string} keyArg the input arg.
     * @return {string} the corresponding Scratch key.
     */
    _keyArgToScratchKey (keyArg) {
        // If a number was dropped in, try to convert from ASCII to Scratch key.
        if (typeof keyArg === 'number') {
            // Check for the ASCII range containing numbers, some punctuation,
            // and uppercase letters.
            if (keyArg >= 48 && keyArg <= 90) {
                return String.fromCharCode(keyArg);
            }
            switch (keyArg) {
            case 32: return KEY_NAME.SPACE;
            case 37: return KEY_NAME.LEFT;
            case 38: return KEY_NAME.UP;
            case 39: return KEY_NAME.RIGHT;
            case 40: return KEY_NAME.DOWN;
            }
        }

        keyArg = Cast.toString(keyArg);

        // If the arg matches a special key name, return it.
        // No special keys have a name that is only 1 character long, so we can avoid the lookup
        // entirely in the most common case.
        if (keyArg.length > 1 && KEY_NAME_SET.has(keyArg)) {
            return keyArg;
        }

        // Use only the first character.
        if (keyArg.length > 1) {
            keyArg = keyArg[0];
        }

        // Check for the space character.
        if (keyArg === ' ') {
            return KEY_NAME.SPACE;
        }
        // tw: support Scratch 2 hacked blocks
        // There are more hacked blocks but most of them get mangled by Scratch 2 -> Scratch 3 conversion
        if (keyArg === '\r') {
            // this probably belongs upstream
            return KEY_NAME.ENTER;
        }
        if (keyArg === '\u001b') {
            return KEY_NAME.ESCAPE;
        }

        return keyArg.toUpperCase();
    }

    /**
     * Keyboard DOM event handler.
     * @param  {object} data Data from DOM event.
     */
    postData (data) {
        if (!data.key) return;
        // tw: convert single letter keys to uppercase because of changes in _keyStringToScratchKey
        const scratchKeyCased = this._keyStringToScratchKey(data.key);
        const scratchKey = scratchKeyCased.length === 1 ? scratchKeyCased.toUpperCase() : scratchKeyCased;
        if (scratchKey === '') return;
        const index = this._keysPressed.indexOf(scratchKey);
        if (data.isDown) {
            // tw: track last pressed key
            this.lastKeyPressed = scratchKeyCased;
            this.runtime.emit('KEY_PRESSED', scratchKey);
            // If not already present, add to the list.
            // (Key repeat sends more key downs while held; those are not a new press.)
            if (index < 0) {
                this._keysPressed.push(scratchKey);
                this._markDown(scratchKey);
            }
        } else if (index > -1) {
            // If already present, remove from the list.
            this._keysPressed.splice(index, 1);
            this._markUp(scratchKey);
        }
        // Fix for https://github.com/LLK/scratch-vm/issues/2271
        if (Object.prototype.hasOwnProperty.call(data, 'keyCode')) {
            const keyCode = data.keyCode;
            if (this._numeralKeyCodesToStringKey.has(keyCode)) {
                const lastKeyOfSameCode = this._numeralKeyCodesToStringKey.get(keyCode);
                if (lastKeyOfSameCode !== scratchKey) {
                    const indexToUnpress = this._keysPressed.indexOf(lastKeyOfSameCode);
                    if (indexToUnpress !== -1) {
                        this._keysPressed.splice(indexToUnpress, 1);
                        this._markUp(lastKeyOfSameCode);
                    }
                }
            }
            this._numeralKeyCodesToStringKey.set(keyCode, scratchKey);
        }
    }

    /**
     * Get key down state for a specified key.
     * @param  {Any} keyArg key argument.
     * @return {boolean} Is the specified key down?
     */
    getKeyIsDown (keyArg) {
        if (keyArg === 'any') {
            return this._keysPressed.length > 0;
        }
        const scratchKey = this._keyArgToScratchKey(keyArg);
        this._usedKeys.add(scratchKey);
        return this._keysPressed.indexOf(scratchKey) > -1;
    }

    /**
     * @param  {Any} keyArg key argument.
     * @param  {?Thread} thread thread asking, so each block reports a press only once
     * @param  {?string} blockId block asking
     * @return {boolean} Did the specified key go down just before this frame?
     */
    getKeyJustPressed (keyArg, thread, blockId) {
        return this._takeEvent(this._justDown, 'd', keyArg, thread, blockId);
    }

    /**
     * @param  {Any} keyArg key argument.
     * @param  {?Thread} thread thread asking, so each block reports a release only once
     * @param  {?string} blockId block asking
     * @return {boolean} Did the specified key go up just before this frame?
     */
    getKeyJustReleased (keyArg, thread, blockId) {
        return this._takeEvent(this._justUp, 'u', keyArg, thread, blockId);
    }

    /**
     * @param  {Any} keyArg key argument.
     * @return {number} Seconds the specified key has been held at the start of this frame, or 0.
     * For "any", the longest held key.
     */
    getKeyHeldSeconds (keyArg) {
        let since = Infinity;
        if (keyArg === 'any') {
            for (const time of this._downSince.values()) {
                if (time < since) since = time;
            }
        } else {
            const scratchKey = this._keyArgToScratchKey(keyArg);
            this._usedKeys.add(scratchKey);
            if (this._downSince.has(scratchKey)) since = this._downSince.get(scratchKey);
        }
        if (since === Infinity) return 0;
        return Math.max(0, this._frameTime - since) / 1000;
    }

    // tw: expose last pressed key
    getLastKeyPressed () {
        return this.lastKeyPressed;
    }

    /**
     * @param {string} scratchKey Scratch key
     * @returns {boolean} true if the project has used this key
     */
    hasUsedKey (scratchKey) {
        return this._usedKeys.has(scratchKey);
    }
}

module.exports = Keyboard;

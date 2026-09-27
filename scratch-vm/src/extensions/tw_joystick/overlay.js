/**
 * @fileoverview
 * The on-screen joysticks and buttons of the joystick extension, as DOM elements over the stage canvas. Sized in
 * CSS pixels so that they fit a thumb whatever the stage size is. Touches on them don't reach the stage (no clicks
 * on sprites, no touch look), and each control follows its own finger, so a thumb on each side works.
 */

const MARGIN = 20;
const GAP = 14;
// Size of a joystick on a big screen; smaller on small ones
const STICK_SIZE = 128;
const BUTTON_SIZE = 64;

const STYLE = {
    base: 'position:absolute;box-sizing:border-box;border-radius:50%;border:2px solid rgba(255,255,255,0.7);' +
        'background:rgba(255,255,255,0.18);box-shadow:0 0 0 1px rgba(0,0,0,0.2);touch-action:none;' +
        'pointer-events:auto;user-select:none;-webkit-user-select:none;display:none;',
    knob: 'position:absolute;box-sizing:border-box;border-radius:50%;background:rgba(255,255,255,0.8);' +
        'box-shadow:0 1px 4px rgba(0,0,0,0.35);pointer-events:none;transform:translate(-50%,-50%);',
    button: 'position:absolute;box-sizing:border-box;border-radius:50%;border:2px solid rgba(255,255,255,0.7);' +
        'background:rgba(255,255,255,0.18);box-shadow:0 0 0 1px rgba(0,0,0,0.2);color:#fff;' +
        'font:bold 22px Helvetica,Arial,sans-serif;display:none;align-items:center;justify-content:center;' +
        'text-shadow:0 1px 2px rgba(0,0,0,0.5);touch-action:none;pointer-events:auto;user-select:none;' +
        '-webkit-user-select:none;'
};

// Events that the stage (GUI or player) listens to on the canvas or the document
const STOPPED_EVENTS = [
    'pointerdown', 'pointermove', 'pointerup', 'pointercancel',
    'mousedown', 'mousemove', 'mouseup', 'touchstart', 'touchmove', 'touchend', 'touchcancel',
    'wheel', 'contextmenu', 'click', 'dblclick'
];

class JoystickOverlay {
    /**
     * @param {HTMLCanvasElement} canvas the stage canvas
     * @param {object} callbacks
     * @param {function(string, number, number, boolean)} callbacks.onStick stick name, x and y from -1 to 1 (y up),
     * and whether a finger is on it
     * @param {function(string, boolean)} callbacks.onButton button name and whether it is pressed
     */
    constructor (canvas, callbacks) {
        this.canvas = canvas;
        this.callbacks = callbacks;
        this.root = document.createElement('div');
        this.root.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible;' +
            'pointer-events:none;z-index:10;';
        for (const type of STOPPED_EVENTS) {
            this.root.addEventListener(type, e => {
                e.stopPropagation();
                if (type.startsWith('touch') || type === 'contextmenu') e.preventDefault();
            }, {passive: false});
        }
        this.sticks = {
            left: this._makeStick('left'),
            right: this._makeStick('right')
        };
        this.buttons = {
            a: this._makeButton('a', 'A'),
            b: this._makeButton('b', 'B')
        };
        this._layoutKey = '';
    }

    _makeStick (name) {
        const base = document.createElement('div');
        base.style.cssText = STYLE.base;
        const knob = document.createElement('div');
        knob.style.cssText = STYLE.knob;
        base.appendChild(knob);
        this.root.appendChild(base);
        const stick = {base, knob, pointerId: null, size: STICK_SIZE, shown: false};
        const update = e => {
            const rect = base.getBoundingClientRect();
            const radius = rect.width / 2;
            let x = (e.clientX - (rect.left + radius)) / radius;
            let y = -(e.clientY - (rect.top + radius)) / radius;
            const length = Math.hypot(x, y);
            if (length > 1) {
                x /= length;
                y /= length;
            }
            this._placeKnob(stick, x, y);
            this.callbacks.onStick(name, x, y, true);
        };
        base.addEventListener('pointerdown', e => {
            if (stick.pointerId !== null) return;
            stick.pointerId = e.pointerId;
            if (base.setPointerCapture) base.setPointerCapture(e.pointerId);
            update(e);
        });
        base.addEventListener('pointermove', e => {
            if (e.pointerId === stick.pointerId) update(e);
        });
        const release = e => {
            if (e.pointerId !== stick.pointerId) return;
            this._releaseStick(name);
        };
        base.addEventListener('pointerup', release);
        base.addEventListener('pointercancel', release);
        base.addEventListener('lostpointercapture', release);
        return stick;
    }

    _releaseStick (name) {
        const stick = this.sticks[name];
        stick.pointerId = null;
        this._placeKnob(stick, 0, 0);
        this.callbacks.onStick(name, 0, 0, false);
    }

    _placeKnob (stick, x, y) {
        const radius = stick.size / 2;
        const knobSize = stick.size * 0.42;
        stick.knob.style.width = stick.knob.style.height = `${knobSize}px`;
        // Percentage positions use the base's inner box, keeping its border out of the center calculation.
        stick.knob.style.left = `calc(50% + ${x * radius * 0.6}px)`;
        stick.knob.style.top = `calc(50% + ${-y * radius * 0.6}px)`;
    }

    _makeButton (name, label) {
        const element = document.createElement('div');
        element.style.cssText = STYLE.button;
        element.textContent = label;
        this.root.appendChild(element);
        const button = {element, pointerId: null, shown: false};
        element.addEventListener('pointerdown', e => {
            if (button.pointerId !== null) return;
            button.pointerId = e.pointerId;
            if (element.setPointerCapture) element.setPointerCapture(e.pointerId);
            element.style.background = 'rgba(255,255,255,0.55)';
            this.callbacks.onButton(name, true);
        });
        const release = e => {
            if (e.pointerId !== button.pointerId) return;
            this._releaseButton(name);
        };
        element.addEventListener('pointerup', release);
        element.addEventListener('pointercancel', release);
        element.addEventListener('lostpointercapture', release);
        return button;
    }

    _releaseButton (name) {
        const button = this.buttons[name];
        button.pointerId = null;
        button.element.style.background = 'rgba(255,255,255,0.18)';
        this.callbacks.onButton(name, false);
    }

    /**
     * Let go of every control, e.g. when the project stops.
     */
    releaseAll () {
        for (const name of Object.keys(this.sticks)) {
            if (this.sticks[name].pointerId !== null) this._releaseStick(name);
        }
        for (const name of Object.keys(this.buttons)) {
            if (this.buttons[name].pointerId !== null) this._releaseButton(name);
        }
    }

    /**
     * Show the controls that should be shown, where they belong over the canvas. Called every frame.
     * @param {object.<string, boolean>} shown by control name (left, right, a, b)
     */
    update (shown) {
        const anyShown = Object.values(shown).some(Boolean);
        const parent = this.canvas.parentElement;
        if (!anyShown || !parent) {
            if (this.root.parentElement) {
                this.releaseAll();
                this.root.remove();
            }
            return;
        }
        // The GUI moves the canvas into another element e.g. for fullscreen
        if (this.root.parentElement !== parent) {
            if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
            parent.appendChild(this.root);
            this._layoutKey = '';
        }
        const canvasRect = this.canvas.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect();
        const left = canvasRect.left - parentRect.left - parent.clientLeft + parent.scrollLeft;
        const top = canvasRect.top - parentRect.top - parent.clientTop + parent.scrollTop;
        const width = canvasRect.width;
        const height = canvasRect.height;
        const key = [left, top, width, height, shown.left, shown.right, shown.a, shown.b].join(',');
        if (key === this._layoutKey) return;
        this._layoutKey = key;
        const root = this.root.style;
        root.left = `${left}px`;
        root.top = `${top}px`;
        root.width = `${width}px`;
        root.height = `${height}px`;
        this._layout(width, height, shown);
    }

    _layout (width, height, shown) {
        const small = Math.min(width, height);
        const stickSize = Math.max(72, Math.min(STICK_SIZE, small * 0.34));
        const buttonSize = Math.max(44, Math.min(BUTTON_SIZE, small * 0.17));
        const margin = Math.min(MARGIN, small * 0.05);
        const placeStick = (stick, visible, fromLeft) => {
            stick.shown = visible;
            stick.size = stickSize;
            const style = stick.base.style;
            style.display = visible ? 'block' : 'none';
            if (!visible) {
                if (stick.pointerId !== null) this._releaseStick(stick === this.sticks.left ? 'left' : 'right');
                return;
            }
            style.width = style.height = `${stickSize}px`;
            style.left = fromLeft ? `${margin}px` : `${width - margin - stickSize}px`;
            style.top = `${height - margin - stickSize}px`;
            this._placeKnob(stick, 0, 0);
        };
        placeStick(this.sticks.left, shown.left, true);
        placeStick(this.sticks.right, shown.right, false);

        // Buttons at the bottom right, or above the right joystick
        const bottom = shown.right ? margin + stickSize + GAP : margin;
        const placeButton = (name, index) => {
            const button = this.buttons[name];
            const visible = shown[name];
            button.shown = visible;
            const style = button.element.style;
            style.display = visible ? 'flex' : 'none';
            if (!visible) {
                if (button.pointerId !== null) this._releaseButton(name);
                return;
            }
            style.width = style.height = `${buttonSize}px`;
            style.fontSize = `${Math.round(buttonSize * 0.36)}px`;
            // A at the corner, B up and to the left of it, like a game controller
            style.left = `${width - margin - buttonSize - (index * (buttonSize + GAP))}px`;
            style.top = `${height - bottom - buttonSize - (index * buttonSize * 0.6)}px`;
        };
        let index = 0;
        for (const name of ['a', 'b']) {
            placeButton(name, shown[name] ? index : 0);
            if (shown[name]) index++;
        }
    }

    dispose () {
        this.releaseAll();
        this.root.remove();
    }
}

module.exports = JoystickOverlay;

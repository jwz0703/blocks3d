// Wheel amounts are in notches of a mouse wheel: browsers report one notch as about 100 pixels, or 3 lines
const PIXELS_PER_NOTCH = 100;
const LINES_PER_NOTCH = 3;
// A page (deltaMode 2) scrolls this many notches
const NOTCHES_PER_PAGE = 3;
// Pinching a trackpad (the wheel with ctrl held) reports much smaller amounts than scrolling
const PINCH_SCALE = 10;

class MouseWheel {
    constructor (runtime) {
        /**
         * Reference to the owning Runtime.
         * @type{!Runtime}
         */
        this.runtime = runtime;
        /** How far the wheel turned since the last frame, in notches, up (or pinching out) positive */
        this._pending = 0;
        /** How far it turned before this frame (the "wheel" reporter) */
        this._delta = 0;
    }

    /**
     * @param {object} data Data from DOM event.
     * @returns {number} how far the wheel turned, in notches, up (away from you, or pinching out) positive
     */
    static notches (data) {
        let delta = Number(data.deltaY) || 0;
        if (data.deltaMode === 1) delta /= LINES_PER_NOTCH;
        else if (data.deltaMode === 2) delta *= NOTCHES_PER_PAGE;
        else delta /= PIXELS_PER_NOTCH;
        if (data.ctrlKey) delta *= PINCH_SCALE;
        return -delta;
    }

    /**
     * Mouse wheel DOM event handler.
     * @param  {object} data Data from DOM event.
     */
    postData (data) {
        const matchFields = {};
        if (data.deltaY < 0) {
            matchFields.KEY_OPTION = 'up arrow';
        } else if (data.deltaY > 0) {
            matchFields.KEY_OPTION = 'down arrow';
        } else {
            return;
        }

        this.runtime.startHats('event_whenkeypressed', matchFields);

        // Blocks3D: the wheel blocks (twmouse). While the 3D editor's camera is in use the wheel zooms that instead.
        const editor = this.runtime.scene3D && this.runtime.scene3D.editor;
        if (editor && editor.active) return;
        const notches = MouseWheel.notches(data);
        this._pending += notches;
        this.runtime.startHats('twmouse_whenwheel', {DIRECTION: notches > 0 ? 'UP' : 'DOWN'});
        this.runtime.startHats('twmouse_whenwheel', {DIRECTION: 'ANY'});
    }

    /**
     * Called at the start of every frame: the wheel movement since the last frame becomes this frame's.
     */
    stepFrame () {
        this._delta = this._pending;
        this._pending = 0;
    }

    /**
     * @returns {number} how far the wheel turned before this frame, in notches, up (or pinching out) positive
     */
    getDelta () {
        return Math.round(this._delta * 1000) / 1000;
    }
}

module.exports = MouseWheel;

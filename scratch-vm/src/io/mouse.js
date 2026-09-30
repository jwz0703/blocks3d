const MathUtil = require('../util/math-util');

const roundToThreeDecimals = number => Math.round(number * 1000) / 1000;

// A press is a tap ("when this sprite is tapped") if it is let go this soon, having moved at most this far in
// pixels of the page, so that dragging the view doesn't click what it started on
const TAP_TIME = 600;
const TAP_DISTANCE = 6;

class Mouse {
    constructor (runtime) {
        this._clientX = 0;
        this._clientY = 0;
        this._scratchX = 0;
        this._scratchY = 0;
        this._buttons = new Set();
        this.usesRightClickDown = false;
        this._isDown = false;
        /**
         * The press that may become a tap: where and when it started, and what it pressed
         * @type {?{x: number, y: number, time: number, target: Target}}
         */
        this._tap = null;
        /**
         * What the left button pressed, while it is down: the stage if it wasn't a sprite that takes the mouse.
         * Orbiting cameras don't turn when dragging from buttons (see scene-3d-follow.js).
         * @type {?Target}
         */
        this._pressTarget = null;
        /** Counts presses of the left button, so that a new press can be told from the last one */
        this._pressCount = 0;
        /**
         * Reference to the owning Runtime.
         * Can be used, for example, to activate hats.
         * @type{!Runtime}
         */
        this.runtime = runtime;
    }

    /**
     * Activate "event_whenthisspriteclicked" hats.
     * @param  {Target} target to trigger hats on.
     * @private
     */
    _activateClickHats (target) {
        // Activate both "this sprite clicked" and "stage clicked"
        // They were separated into two opcodes for labeling,
        // but should act the same way.
        // Intentionally not checking isStage to make it work when sharing blocks.
        // @todo the blocks should be converted from one to another when shared
        this.runtime.startHats('event_whenthisspriteclicked',
            null, target);
        this.runtime.startHats('event_whenstageclicked',
            null, target);
    }

    /**
     * Activate the tap hats (twmouse): a short press that didn't drag.
     * @param {Target} target that was pressed
     * @private
     */
    _activateTapHats (target) {
        this.runtime.startHats('twmouse_whentapped', null, target);
        this.runtime.startHats('twmouse_whenstagetapped', null, target);
    }

    /**
     * @param {number} x X position to be sent to the renderer.
     * @param {number} y Y position to be sent to the renderer.
     * @returns {number} the drawable at that location, leaving out the 2D sprites that can't be clicked
     * @private
     */
    _pickDrawable (x, y) {
        const renderer = this.runtime.renderer;
        const skipped = new Set();
        for (const target of this.runtime.targets) {
            if (!target.isStage && !target.is3D && !target.blocksMouse()) skipped.add(target.drawableID);
        }
        if (skipped.size === 0) return renderer.pick(x, y);
        // Given candidates, the renderer doesn't leave out the drawables that are never picked (like the pen layer)
        const candidates = renderer._drawList.filter(id => !skipped.has(id) && renderer._allDrawables[id].interactive);
        return renderer.pick(x, y, void 0, void 0, candidates);
    }

    /**
     * Find a target by XY location
     * @param  {number} x X position to be sent to the renderer.
     * @param  {number} y Y position to be sent to the renderer.
     * @return {Target} the target at that location
     * @private
     */
    _pickTarget (x, y) {
        if (this.runtime.renderer) {
            const drawableID = this._pickDrawable(x, y);
            for (let i = 0; i < this.runtime.targets.length; i++) {
                const target = this.runtime.targets[i];
                if (Object.prototype.hasOwnProperty.call(target, 'drawableID') &&
                    target.drawableID === drawableID && !target.isStage) {
                    return target;
                }
            }
        }
        // 2D sprites are drawn on top of the 3D scene, so a 3D sprite gets the click if no 2D sprite does
        const scene3D = this.runtime.scene3D;
        const target3D = scene3D && scene3D.pickTarget(this._scratchX, this._scratchY);
        if (target3D) return target3D;
        // Return the stage if no target was found
        return this.runtime.getTargetForStage();
    }

    /**
     * Mouse DOM event handler.
     * @param  {object} data Data from DOM event.
     */
    postData (data) {
        // Moving too far makes the press a drag, not a tap
        if (this._tap && typeof data.x === 'number' && typeof data.y === 'number' &&
            Math.hypot(data.x - this._tap.x, data.y - this._tap.y) > TAP_DISTANCE) {
            this._tap = null;
        }
        if (typeof data.x === 'number') {
            this._clientX = data.x;
            this._scratchX = MathUtil.clamp(
                this.runtime.stageWidth * ((data.x / data.canvasWidth) - 0.5),
                -(this.runtime.stageWidth / 2),
                (this.runtime.stageWidth / 2)
            );
        }
        if (typeof data.y === 'number') {
            this._clientY = data.y;
            this._scratchY = MathUtil.clamp(
                -this.runtime.stageHeight * ((data.y / data.canvasHeight) - 0.5),
                -(this.runtime.stageHeight / 2),
                (this.runtime.stageHeight / 2)
            );
        }
        if (typeof data.isDown !== 'undefined') {
            // If no button specified, default to left button for compatibility
            const button = typeof data.button === 'undefined' ? 0 : data.button;
            if (data.isDown) {
                this._buttons.add(button);
            } else {
                this._buttons.delete(button);
            }

            const previousDownState = this._isDown;
            this._isDown = data.isDown;

            // Do not trigger if down state has not changed
            if (previousDownState === this._isDown) return;

            const tap = this._tap;
            this._tap = null;
            this._pressTarget = null;

            // Never trigger click hats at the end of a drag
            if (data.wasDragged) return;

            // Do not activate click hats for clicks outside canvas bounds
            if (!(data.x > 0 && data.x < data.canvasWidth &&
                data.y > 0 && data.y < data.canvasHeight)) return;

            const isNewMouseDown = !previousDownState && this._isDown;
            const isNewMouseUp = previousDownState && !this._isDown;

            // A tap is let go where it was pressed: it is on what it pressed
            if (isNewMouseUp && tap && Date.now() - tap.time <= TAP_TIME &&
                this.runtime.targets.includes(tap.target)) {
                this._activateTapHats(tap.target);
            }

            // target will not exist if project is still loading
            const target = this._pickTarget(data.x, data.y);
            if (target) {
                if (isNewMouseDown && button === 0) {
                    this._tap = {x: data.x, y: data.y, time: Date.now(), target};
                    this._pressTarget = target;
                    this._pressCount++;
                }

                // Draggable targets start click hats on mouse up.
                // Non-draggable targets start click hats on mouse down.
                if (target.draggable && isNewMouseUp) {
                    this._activateClickHats(target);
                } else if (!target.draggable && isNewMouseDown) {
                    this._activateClickHats(target);
                }
            }
        }
    }

    /**
     * Get the X position of the mouse in client coordinates.
     * @return {number} Non-clamped X position of the mouse cursor.
     */
    getClientX () {
        return this._clientX;
    }

    /**
     * Get the Y position of the mouse in client coordinates.
     * @return {number} Non-clamped Y position of the mouse cursor.
     */
    getClientY () {
        return this._clientY;
    }

    /**
     * Get the X position of the mouse in scratch coordinates.
     * @return {number} Clamped and integer rounded X position of the mouse cursor.
     */
    getScratchX () {
        if (this.runtime.runtimeOptions.miscLimits) {
            return Math.round(this._scratchX);
        }
        return roundToThreeDecimals(this._scratchX);
    }

    /**
     * Get the Y position of the mouse in scratch coordinates.
     * @return {number} Clamped and integer rounded Y position of the mouse cursor.
     */
    getScratchY () {
        if (this.runtime.runtimeOptions.miscLimits) {
            return Math.round(this._scratchY);
        }
        return roundToThreeDecimals(this._scratchY);
    }

    /**
     * @returns {?Target} what the left button pressed, while it is still down (the stage for nothing)
     */
    getPressTarget () {
        return this._isDown ? this._pressTarget : null;
    }

    /**
     * @returns {number} a number that changes with every press of the left button
     */
    getPressCount () {
        return this._pressCount;
    }

    /**
     * Get the down state of the mouse.
     * @return {boolean} Is the mouse down?
     */
    getIsDown () {
        return this._isDown;
    }

    /**
     * tw: Get the down state of a specific button of the mouse.
     * @param {number} button The ID of the button. 0 = left, 1 = middle, 2 = right
     * @return {boolean} Is the mouse button down?
     */
    getButtonIsDown (button) {
        if (button === 2) {
            this.usesRightClickDown = true;
        }
        return this._buttons.has(button);
    }
}

module.exports = Mouse;

const BlockType = require('../../extension-support/block-type');

/**
 * Hats for the mouse moving onto and off sprites (ROADMAP.md 6.2), for 2D and 3D sprites alike. 3D sprites are
 * under the mouse when the ray from the camera through the mouse hits them first (Scene3D.pickTarget). Shown in
 * Events.
 */
class Scratch3Events3DBlocks {
    constructor (runtime) {
        this.runtime = runtime;
        /** @type {WeakMap<Target, {frame: number, over: boolean, before: boolean}>} */
        this._hover = new WeakMap();
        /** @type {?{frame: number, x: number, y: number, target: ?Target3D}} see _pickedThisFrame */
        this._pick = null;
    }

    getInfo () {
        return {
            id: 'event3d',
            name: '事件',
            color1: '#FFBF00',
            color2: '#E6AC00',
            color3: '#CC9900',
            blocks: [
                {
                    opcode: 'whenmouseenter',
                    blockType: BlockType.HAT,
                    text: '當滑鼠移到這個角色上',
                    isEdgeActivated: true
                },
                {
                    opcode: 'whenmouseleave',
                    blockType: BlockType.HAT,
                    text: '當滑鼠離開這個角色',
                    isEdgeActivated: true
                }
            ]
        };
    }

    /**
     * @param {Target} target
     * @returns {boolean} true if the mouse is over the sprite (and not over something in front of it)
     */
    _isMouseOver (target) {
        if (target.isStage) return false;
        if (target.is3D) return this._pickedThisFrame() === target;
        return target.isTouchingObject('_mouse_');
    }

    /**
     * @returns {?Target3D} the 3D sprite under the mouse in this frame. Picked once per frame for every sprite with
     * these hats: a pick casts a ray against every model, which costs milliseconds in a big scene, and a project
     * with many clones would otherwise pick once per clone.
     */
    _pickedThisFrame () {
        const mouse = this.runtime.ioDevices.mouse;
        const x = mouse.getScratchX();
        const y = mouse.getScratchY();
        const cache = this._pick;
        if (cache && cache.frame === this.runtime.frameCount && cache.x === x && cache.y === y) return cache.target;
        const target = this.runtime.scene3D.pickTarget(x, y);
        this._pick = {frame: this.runtime.frameCount, x, y, target};
        return target;
    }

    /**
     * @param {Target} target
     * @returns {{over: boolean, before: boolean}} whether the mouse is over the sprite in this frame, and was in the
     * frame before. Worked out once per frame for both hats.
     */
    _hoverState (target) {
        let state = this._hover.get(target);
        if (!state) {
            state = {frame: -1, over: false, before: false};
            this._hover.set(target, state);
        }
        if (state.frame !== this.runtime.frameCount) {
            state.frame = this.runtime.frameCount;
            state.before = state.over;
            state.over = this._isMouseOver(target);
        }
        return state;
    }

    whenmouseenter (args, util) {
        return this._hoverState(util.target).over;
    }

    whenmouseleave (args, util) {
        // Only right after leaving, so that it doesn't run at the start while the mouse is somewhere else
        const state = this._hoverState(util.target);
        return state.before && !state.over;
    }
}

module.exports = Scratch3Events3DBlocks;

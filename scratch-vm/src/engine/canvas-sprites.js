// Keeps track of canvas sprites (sprites/canvas-target.js): uploads the ones that were drawn on once per frame,
// and finds the canvas that pen blocks draw on.

const Cast = require('../util/cast');

class CanvasSprites {
    /**
     * @param {Runtime} runtime
     */
    constructor (runtime) {
        this.runtime = runtime;
        /** @type {Set<CanvasTarget>} every canvas sprite and clone */
        this.targets = new Set();
        /** @type {Set<CanvasTarget>} drawn on since the last frame */
        this._dirty = new Set();

        runtime.on('AFTER_EXECUTE', () => this.uploadDirty());
        runtime.on('STAGE_SIZE_CHANGED', () => {
            for (const target of this.targets) target.resizeCanvas();
        });
    }

    add (target) {
        this.targets.add(target);
        this.runtime.emit('CANVAS_SPRITE_ADDED', target);
    }

    remove (target) {
        this.targets.delete(target);
        this._dirty.delete(target);
        this.runtime.emit('CANVAS_SPRITE_REMOVED', target);
    }

    markDirty (target) {
        this._dirty.add(target);
        this.runtime.requestRedraw();
    }

    /**
     * Upload every canvas that was drawn on, and tell the 3D scene, whose materials might use them as textures.
     */
    uploadDirty () {
        if (this._dirty.size === 0) return;
        const drawn = Array.from(this._dirty);
        this._dirty.clear();
        for (const target of drawn) {
            if (target.upload()) this.runtime.emit('CANVAS_SPRITE_DRAWN', target);
        }
    }

    /**
     * @returns {CanvasTarget[]} the original canvas sprites, in sprite order
     */
    getOriginals () {
        return this.runtime.targets.filter(target => target.isOriginal && target.isCanvas);
    }

    /**
     * @param {*} name sprite name
     * @returns {?CanvasTarget} the original canvas sprite with that name
     */
    getByName (name) {
        const target = this.runtime.getSpriteTargetByName(Cast.toString(name));
        return target && target.isCanvas ? target : null;
    }

    /**
     * @returns {?CanvasTarget} where pen blocks draw unless told otherwise: the first canvas sprite
     */
    getDefault () {
        return this.getOriginals()[0] || null;
    }
}

module.exports = CanvasSprites;

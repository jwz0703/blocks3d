// Undo for what is changed about sprites outside of scripts in the editor: dragging 2D and 3D sprites on the stage,
// the 3D gizmo and G / R / S transforms, and the sprite info panel. Like Blender, Ctrl + Z / Ctrl + Shift + Z (or
// Ctrl + Y) undo and redo while the pointer is over the stage; elsewhere they are left to the blocks.

// Edits kept for undo
const MAX_UNDO = 100;
// Changes of the same sprite and fields closer together than this are one edit, e.g. turning a direction dial
const MERGE_TIME = 1000;

/**
 * @param {EventTarget} element
 * @returns {boolean} true if Ctrl + Z in this element undoes typing instead
 */
const isEditable = element => !!element && (
    element.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
);

/**
 * @param {Target} target a sprite
 * @returns {object} where the sprite is, which way it points, how big it is and whether it is shown
 */
const snapshot = target => {
    if (target.is3D) {
        return {
            x: target.x,
            y: target.y,
            z: target.z,
            rotationX: target.rotationX,
            rotationY: target.rotationY,
            rotationZ: target.rotationZ,
            scaleX: target.scaleX,
            scaleY: target.scaleY,
            scaleZ: target.scaleZ,
            visible: target.visible
        };
    }
    return {
        x: target.x,
        y: target.y,
        direction: target.direction,
        size: target.size,
        visible: target.visible
    };
};

/**
 * @param {object} a from snapshot()
 * @param {object} b from snapshot()
 * @returns {string[]} the fields that differ
 */
const changedKeys = (a, b) => Object.keys(a).filter(key => a[key] !== b[key]);

class StageUndo {
    /**
     * @param {Runtime} runtime
     */
    constructor (runtime) {
        this.runtime = runtime;
        this.enabled = false;
        /**
         * Edits, oldest first: {targetId, before, after, keys, time} with snapshot()s of a sprite, or {camera: true,
         * before, after} with camera states of the default camera
         */
        this._undoStack = [];
        this._redoStack = [];
        this._hover = false;

        this._onKeyDown = this._onKeyDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);

        // Edits of the previous project can't be undone in this one
        this.runtime.on('PROJECT_LOADED', () => this.clear());
    }

    static snapshot (target) {
        return snapshot(target);
    }

    /**
     * The GUI turns this on in the editor; the player never does.
     * @param {boolean} enabled
     */
    setEnabled (enabled) {
        enabled = !!enabled;
        if (this.enabled === enabled || typeof document === 'undefined') return;
        this.enabled = enabled;
        if (enabled) {
            // Capturing, and added before the 3D editor's own listener, so that the blocks don't also undo
            document.addEventListener('keydown', this._onKeyDown, true);
            window.addEventListener('pointermove', this._onPointerMove);
        } else {
            document.removeEventListener('keydown', this._onKeyDown, true);
            window.removeEventListener('pointermove', this._onPointerMove);
        }
    }

    clear () {
        this._undoStack = [];
        this._redoStack = [];
    }

    /**
     * Remember a change of a sprite, so that Ctrl + Z can undo it.
     * @param {Target} target
     * @param {object} before the sprite's snapshot() before the change
     * @param {boolean} [merge] true to merge with the previous edit if it changed the same fields of the same sprite
     * a moment ago
     */
    record (target, before, merge) {
        if (!target || target.isStage) return;
        const after = snapshot(target);
        const keys = changedKeys(before, after);
        if (!keys.length) return;
        const now = Date.now();
        const last = this._undoStack[this._undoStack.length - 1];
        if (merge && last && !this._redoStack.length && last.merge && last.targetId === target.id &&
            now - last.time < MERGE_TIME && keys.every(key => last.keys.includes(key))) {
            last.after = after;
            last.time = now;
            return;
        }
        this._push({targetId: target.id, before, after, keys, time: now, merge: !!merge});
    }

    /**
     * Remember a change of the default camera, which isn't a sprite.
     * @param {object} before camera state from Scene3D.getCameraState()
     * @param {object} after
     */
    recordCamera (before, after) {
        this._push({camera: true, before, after});
    }

    _push (entry) {
        this._undoStack.push(entry);
        if (this._undoStack.length > MAX_UNDO) this._undoStack.shift();
        this._redoStack = [];
    }

    /**
     * Put back the state from before (undo) or after (redo) the last edit that still applies.
     * @param {boolean} redo
     * @returns {boolean} true if something was undone or redone
     */
    _step (redo) {
        const from = redo ? this._redoStack : this._undoStack;
        const to = redo ? this._undoStack : this._redoStack;
        const scene3D = this.runtime.scene3D;
        while (from.length) {
            const entry = from.pop();
            const state = redo ? entry.after : entry.before;
            if (entry.camera) {
                // Once there is a camera sprite, this would move it instead
                if (scene3D.getActiveCamera()) continue;
                scene3D.setCameraState(state);
            } else {
                const target = this.runtime.getTargetById(entry.targetId);
                // Deleted since
                if (!target) continue;
                target.postSpriteInfo(Object.assign({force: true}, state));
                this.runtime.requestTargetsUpdate(target);
                // Like Blender, show what changed
                if (target !== this.runtime.getEditingTarget()) {
                    this.runtime.emit('SCENE3D_PICK_TARGET', target.id);
                }
            }
            // Merging only continues an edit that is still the last one
            entry.merge = false;
            to.push(entry);
            scene3D.markDirty();
            this.runtime.emitProjectChanged();
            return true;
        }
        return false;
    }

    undo () {
        return this._step(false);
    }

    redo () {
        return this._step(true);
    }

    _onPointerMove (event) {
        const renderer = this.runtime.renderer;
        if (!renderer) return;
        const rect = renderer.canvas.getBoundingClientRect();
        this._hover = event.clientX >= rect.left && event.clientX < rect.right &&
            event.clientY >= rect.top && event.clientY < rect.bottom;
    }

    _onKeyDown (event) {
        if (!(event.ctrlKey || event.metaKey) || event.altKey || !this._hover || isEditable(event.target)) return;
        const redo = event.code === 'KeyY' || (event.code === 'KeyZ' && event.shiftKey);
        if (event.code !== 'KeyZ' && !redo) return;
        const editor = this.runtime.scene3D.editor;
        // Ctrl + Z during a G / R / S transform cancels it, which the 3D editor does
        if (editor._modal) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        // Scripts move sprites while the project runs
        if (editor.isBusy() || this.runtime.isGameRunning()) return;
        this._step(redo);
    }
}

module.exports = StageUndo;

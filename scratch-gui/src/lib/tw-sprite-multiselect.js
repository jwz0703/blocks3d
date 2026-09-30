/**
 * Sprites picked with shift-click in the sprite list, to make one component of them (ROADMAP.md 階段 10).
 * Clicking without shift clears it.
 */
const selected = new Set();
const listeners = new Set();

const changed = () => {
    for (const listener of listeners) listener();
};

const multiSelect = {
    /**
     * @param {string} id a sprite
     */
    toggle (id) {
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
        changed();
    },
    clear () {
        if (selected.size === 0) return;
        selected.clear();
        changed();
    },
    /**
     * @param {string} id a sprite
     * @returns {boolean} true if it is picked
     */
    has (id) {
        return selected.has(id);
    },
    /**
     * @returns {Array<string>} the picked sprites
     */
    ids () {
        return Array.from(selected);
    },
    /**
     * @param {function} listener called when what is picked changes
     * @returns {function} stops listening
     */
    listen (listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }
};

export default multiSelect;

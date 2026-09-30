// Shared by the block extensions of the kinds of sky (sky-procedural.js, sky-color.js, sky-hdri.js). Their blocks
// change the sky of the current backdrop, and only when it is of their kind: switching backdrops is how a project
// switches kinds of sky.

// Every kind of sky uses the colors of the environment category
const COLORS = {
    color1: '#4CBF56',
    color2: '#45AC4E',
    color3: '#389442'
};

class SkyBlocks {
    /**
     * @param {Runtime} runtime the runtime
     * @param {string[]} types the kinds of sky that the blocks change
     */
    constructor (runtime, types) {
        this.runtime = runtime;
        this.types = types;
    }

    /**
     * @returns {?object} the sky of the current backdrop if it is of the kind, otherwise null
     */
    _sky () {
        const sky = this.runtime.scene3D.getEnvironment().sky;
        return this.types.includes(sky.type) ? sky : null;
    }

    /**
     * Change the sky of the current backdrop if it is of the kind.
     * @param {object} changes partial sky, e.g. {clouds: 80}
     */
    _set (changes) {
        if (this._sky()) this.runtime.scene3D.setEnvironment({sky: changes});
    }
}

SkyBlocks.COLORS = COLORS;

module.exports = SkyBlocks;

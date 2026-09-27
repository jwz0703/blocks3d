// What 2D blocks do on 3D sprites when block-support.js says REPLACE. Each gets the block's arguments, the block
// utility and the block's own 2D function.

const Cast = require('../../util/cast');
const {MOUSE, RANDOM, resolvePoint, get3DSprite, distance3D, glide3D} = require('./common');

/**
 * @param {Target3D} target
 * @returns {number} the size a 3D sprite shows as, in percent: its average scale
 */
const getSize = target => ((target.scaleX + target.scaleY + target.scaleZ) / 3) * 100;

/**
 * Scale evenly so that the average scale becomes size / 100, keeping the proportions.
 * @param {Target3D} target
 * @param {number} size percent
 */
const setSize = (target, size) => {
    const scale = Math.max(0, size) / 100;
    const current = getSize(target) / 100;
    if (current === 0) {
        target.setScale(scale, scale, scale);
        return;
    }
    const factor = scale / current;
    target.setScale(target.scaleX * factor, target.scaleY * factor, target.scaleZ * factor);
};

/**
 * @param {Runtime} runtime
 * @param {*} name menu value of a 2D go to / glide to / point towards block
 * @returns {?{x: number, y: number, z: number}} the 3D point in the world it means; 2D sprites have none
 */
const resolveMenu = (runtime, name) => {
    if (name === MOUSE || name === RANDOM) return resolvePoint(runtime, name);
    const sprite = get3DSprite(runtime, name);
    return sprite ? sprite.getWorldPosition() : null;
};

const makeReplacements = runtime => ({
    motion_goto (args, util) {
        const point = resolveMenu(runtime, args.TO);
        if (point) util.target.setWorldPosition(point.x, point.y, point.z);
    },

    motion_glideto (args, util) {
        glide3D(util, Cast.toNumber(args.SECS), () => resolveMenu(runtime, args.TO));
    },

    motion_pointtowards (args, util) {
        const target = util.target;
        if (args.TOWARDS === RANDOM) {
            target.setRotation(target.rotationX, (Math.random() * 360) - 180, target.rotationZ);
            return;
        }
        const point = resolveMenu(runtime, args.TOWARDS);
        if (point) target.lookAt(point.x, point.y, point.z);
    },

    looks_setsizeto (args, util) {
        setSize(util.target, Cast.toNumber(args.SIZE));
    },

    looks_changesizeby (args, util) {
        setSize(util.target, getSize(util.target) + Cast.toNumber(args.CHANGE));
    },

    looks_size (args, util) {
        return Math.round(getSize(util.target));
    },

    sensing_touchingobject (args, util) {
        if (args.TOUCHINGOBJECTMENU === MOUSE) return util.target.isTouchingObject(MOUSE);
        // Waits for Rapier the first time
        return runtime.scene3D.physics.whenReady(() => util.target.isTouchingObject(args.TOUCHINGOBJECTMENU),
            false);
    },

    sensing_distanceto (args, util) {
        return distance3D(util.target, resolveMenu(runtime, args.DISTANCETOMENU));
    }
});

module.exports = {
    makeReplacements,
    getSize
};

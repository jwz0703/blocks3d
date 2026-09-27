// Shared by the 3D motion, looks and sensing blocks, and by the 3D versions of 2D blocks (replacements.js).

const Cast = require('../../util/cast');
const Timer = require('../../util/timer');

const CAMERA = '_camera_';
const ANY = '_any_';
const MOUSE = '_mouse_';
const RANDOM = '_random_';

// What 3D blocks give when they point at something that isn't a 3D sprite, like 2D blocks do for missing sprites
const INVALID_DISTANCE = 10000;

/**
 * @param {Runtime} runtime
 * @param {?Target} [exclude] a target to leave out, usually the editing target
 * @param {boolean} [withCameras] true to list camera sprites too, e.g. to face or measure the distance to them
 * @returns {Array<{text: string, value: string}>} menu items of 3D sprites by name
 */
const get3DSpriteItems = (runtime, exclude, withCameras) => runtime.targets
    .filter(target => target.isOriginal && target.is3D && (withCameras || !target.isCamera) &&
        (!exclude || target.sprite !== exclude.sprite))
    .map(target => {
        const name = target.getName();
        return {text: name, value: name};
    });

/**
 * @param {Runtime} runtime
 * @returns {Array<{text: string, value: string}>} menu items of camera sprites by name
 */
const getCameraItems = runtime => runtime.scene3D.getCameras().map(target => {
    const name = target.getName();
    return {text: name, value: name};
});

/**
 * @param {Runtime} runtime
 * @param {string} name sprite name
 * @returns {?Target3D} the original 3D sprite with that name
 */
const get3DSprite = (runtime, name) => {
    const target = runtime.getSpriteTargetByName(Cast.toString(name));
    return target && target.is3D ? target : null;
};

/**
 * @param {Runtime} runtime
 * @returns {{x: number, y: number, z: number}} where the current camera is
 */
const getCameraPosition = runtime => runtime.scene3D.getCameraState();

/**
 * @param {Runtime} runtime
 * @param {*} name a 3D or camera sprite's name, or CAMERA (the current camera), MOUSE (where it points on the
 * ground) or RANDOM (a random point on the ground that the camera sees)
 * @returns {?{x: number, y: number, z: number}} that point in the world, or null if there is none, e.g. a 2D
 * sprite's name
 */
const resolvePoint = (runtime, name) => {
    if (name === CAMERA) return getCameraPosition(runtime);
    if (name === MOUSE) return runtime.scene3D.mouseToGround();
    if (name === RANDOM) return runtime.scene3D.randomGroundPoint();
    const sprite = get3DSprite(runtime, name);
    return sprite ? sprite.getWorldPosition() : null;
};

/**
 * @param {Target3D} target
 * @param {?{x: number, y: number, z: number}} point
 * @returns {number} distance, or INVALID_DISTANCE if there is no point
 */
const distance3D = (target, point) => {
    if (!point) return INVALID_DISTANCE;
    const position = target.getWorldPosition();
    const dx = point.x - position.x;
    const dy = point.y - position.y;
    const dz = point.z - position.z;
    return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
};

/**
 * Glide a 3D sprite to a point, over several frames like the 2D glide block.
 * @param {object} util block utility
 * @param {number} seconds
 * @param {function(): ?{x: number, y: number, z: number}} getEnd where to go in the world, only asked for on the
 * first frame; null to not move at all
 */
const glide3D = (util, seconds, getEnd) => {
    const frame = util.stackFrame;
    const target = util.target;
    if (frame.timer) {
        const elapsed = frame.timer.timeElapsed();
        if (elapsed < frame.duration * 1000) {
            const t = elapsed / (frame.duration * 1000);
            target.setXYZ(
                frame.start.x + (t * (frame.end.x - frame.start.x)),
                frame.start.y + (t * (frame.end.y - frame.start.y)),
                frame.start.z + (t * (frame.end.z - frame.start.z))
            );
            util.yield();
        } else {
            target.setXYZ(frame.end.x, frame.end.y, frame.end.z);
        }
        return;
    }
    const worldEnd = getEnd();
    if (!worldEnd) return;
    // Sprites attached to others glide relative to them
    const end = target.worldToLocal(worldEnd.x, worldEnd.y, worldEnd.z);
    frame.timer = new Timer();
    frame.timer.start();
    frame.duration = seconds;
    frame.start = {x: target.x, y: target.y, z: target.z};
    frame.end = {x: end.x, y: end.y, z: end.z};
    if (frame.duration <= 0) {
        target.setXYZ(end.x, end.y, end.z);
        return;
    }
    util.yield();
};

module.exports = {
    CAMERA,
    ANY,
    MOUSE,
    RANDOM,
    INVALID_DISTANCE,
    get3DSpriteItems,
    getCameraItems,
    get3DSprite,
    getCameraPosition,
    resolvePoint,
    distance3D,
    glide3D
};

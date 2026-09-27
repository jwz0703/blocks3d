// Cameras that follow 3D sprites (ROADMAP.md, stage 6.5): third person (behind the sprite, looking at it) and first
// person (at the sprite's eyes, looking where it faces), with optional smoothing. Only math: three.js isn't needed.

const THIRD_PERSON = 'third';
const FIRST_PERSON = 'first';

// Degrees; a bit less than 90 so that the camera never looks straight up or down
const MAX_PITCH = 89.9;
const DEFAULT_DISTANCE = 5;
// Angles when none were set: third person looks down on the sprite a little, first person looks where it faces
const DEFAULT_ANGLES = {
    [THIRD_PERSON]: {yaw: 0, pitch: -20},
    [FIRST_PERSON]: {yaw: 0, pitch: 0}
};
// Longest frame the smoothing accounts for, so that the camera doesn't jump after the tab was in the background
const MAX_DELTA = 0.25;

const finite = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const clampPitch = pitch => Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));

const DEG = Math.PI / 180;

/**
 * @param {number} yaw degrees
 * @param {number} pitch degrees
 * @returns {{x: number, y: number, z: number}} the direction a camera or 3D sprite with these angles faces, see
 * Target3D.getForward
 */
const forward = (yaw, pitch) => ({
    x: -Math.sin(yaw * DEG) * Math.cos(pitch * DEG),
    y: Math.sin(pitch * DEG),
    z: -Math.cos(yaw * DEG) * Math.cos(pitch * DEG)
});

/**
 * @param {{x: number, y: number, z: number}} v
 * @param {number} yaw degrees
 * @returns {{x: number, y: number, z: number}} v turned around the y axis like a sprite with that yaw
 */
const rotateYaw = (v, yaw) => {
    const cos = Math.cos(yaw * DEG);
    const sin = Math.sin(yaw * DEG);
    return {x: (v.x * cos) + (v.z * sin), y: v.y, z: (-v.x * sin) + (v.z * cos)};
};

/**
 * @param {number} from degrees
 * @param {number} to degrees
 * @param {number} t 0 to 1
 * @returns {number} the angle t of the way from `from` to `to`, turning the short way
 */
const lerpAngle = (from, to, t) => {
    const delta = ((((to - from) % 360) + 540) % 360) - 180;
    return from + (delta * t);
};

class CameraFollow {
    /**
     * @param {Scene3D} scene3D
     */
    constructor (scene3D) {
        this.scene3D = scene3D;
        /**
         * Settings of each camera sprite, and of the default camera under null
         * @type {Map<?CameraTarget, object>}
         */
        this._cameras = new Map();
        this._lastTime = null;
    }

    static get THIRD_PERSON () {
        return THIRD_PERSON;
    }

    static get FIRST_PERSON () {
        return FIRST_PERSON;
    }

    /**
     * @param {?CameraTarget} camera a camera sprite, or null for the default camera
     * @returns {object} its follow settings, created if needed
     */
    _settings (camera) {
        let settings = this._cameras.get(camera);
        if (!settings) {
            settings = {
                mode: null,
                /** @type {?Target3D} */
                target: null,
                distance: DEFAULT_DISTANCE,
                offset: {x: 0, y: 1, z: 0},
                // null: the mode's default, see DEFAULT_ANGLES
                yaw: null,
                pitch: null,
                smoothing: 0,
                /** Smoothed pivot and angles, see update() */
                current: null
            };
            this._cameras.set(camera, settings);
        }
        return settings;
    }

    /**
     * @param {?CameraTarget} camera
     * @returns {?{mode: string, target: Target3D, distance: number, offset: object, yaw: number, pitch: number,
     * smoothing: number}} what the camera follows and how, or null if it follows nothing
     */
    get (camera) {
        const settings = this._cameras.get(camera);
        if (!settings || !settings.mode) return null;
        const angles = this._angles(settings);
        return {
            mode: settings.mode,
            target: settings.target,
            distance: settings.distance,
            offset: Object.assign({}, settings.offset),
            yaw: angles.yaw,
            pitch: angles.pitch,
            smoothing: settings.smoothing
        };
    }

    _angles (settings) {
        const defaults = DEFAULT_ANGLES[settings.mode] || DEFAULT_ANGLES[THIRD_PERSON];
        return {
            yaw: settings.yaw === null ? defaults.yaw : settings.yaw,
            pitch: settings.pitch === null ? defaults.pitch : settings.pitch
        };
    }

    /**
     * @param {?CameraTarget} camera
     * @returns {{x: number, y: number, z: number, yaw: number, pitch: number}} where the camera is
     */
    _cameraPose (camera) {
        if (camera) {
            const pose = camera.getWorldPose();
            return {x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, pitch: pose.pitch};
        }
        const state = this.scene3D.defaultCameraState;
        return {x: state.x, y: state.y, z: state.z, yaw: state.yaw, pitch: state.pitch};
    }

    /**
     * Start following a 3D sprite. The camera glides there if smoothing is on.
     * @param {?CameraTarget} camera a camera sprite, or null for the default camera
     * @param {Target3D} target the 3D sprite or clone to follow
     * @param {string} mode THIRD_PERSON or FIRST_PERSON
     * @param {number} [distance] how far behind the sprite (third person)
     */
    start (camera, target, mode, distance) {
        if (!target || !target.is3D || target.isCamera || ![THIRD_PERSON, FIRST_PERSON].includes(mode)) return;
        const settings = this._settings(camera);
        if (settings.mode && settings.mode !== mode) {
            // The other mode's angles would be wrong for this one
            settings.yaw = null;
            settings.pitch = null;
        }
        if (typeof distance !== 'undefined') settings.distance = Math.max(0, finite(distance, settings.distance));
        if (settings.mode !== mode || settings.target !== target) {
            // Smoothing starts from where the camera is now
            const pose = this._cameraPose(camera);
            const back = mode === THIRD_PERSON ? settings.distance : 0;
            const ahead = forward(pose.yaw, pose.pitch);
            settings.current = {
                x: pose.x + (ahead.x * back),
                y: pose.y + (ahead.y * back),
                z: pose.z + (ahead.z * back),
                yaw: pose.yaw,
                pitch: pose.pitch
            };
        }
        settings.mode = mode;
        settings.target = target;
    }

    /**
     * @param {?CameraTarget} camera
     */
    stop (camera) {
        const settings = this._cameras.get(camera);
        if (!settings) return;
        settings.mode = null;
        settings.target = null;
        settings.current = null;
    }

    /**
     * @param {?CameraTarget} camera
     * @param {{x: number, y: number, z: number}} offset where the camera looks at (third person) or is (first
     * person), from the sprite's position; turns with the sprite's yaw, so x is to the side and z to the back
     */
    setOffset (camera, offset) {
        const settings = this._settings(camera);
        settings.offset = {
            x: finite(offset.x, settings.offset.x),
            y: finite(offset.y, settings.offset.y),
            z: finite(offset.z, settings.offset.z)
        };
    }

    /**
     * @param {?CameraTarget} camera
     * @param {number} yaw degrees from behind the sprite (third person) or from where it faces (first person)
     * @param {number} pitch degrees; negative looks down
     */
    setAngles (camera, yaw, pitch) {
        const settings = this._settings(camera);
        const angles = this._angles(settings);
        settings.yaw = finite(yaw, angles.yaw);
        settings.pitch = clampPitch(finite(pitch, angles.pitch));
    }

    /**
     * @param {?CameraTarget} camera
     * @param {number} yaw degrees to add
     * @param {number} pitch degrees to add
     */
    changeAngles (camera, yaw, pitch) {
        const angles = this._angles(this._settings(camera));
        this.setAngles(camera, angles.yaw + finite(yaw, 0), angles.pitch + finite(pitch, 0));
    }

    /**
     * @param {?CameraTarget} camera
     * @param {number} seconds about how long the camera takes to catch up; 0 to not smooth
     */
    setSmoothing (camera, seconds) {
        const settings = this._settings(camera);
        settings.smoothing = Math.max(0, finite(seconds, 0));
    }

    /**
     * Mouse look turns a following camera around its sprite (third person), or turns the sprite and tilts the
     * camera (first person), instead of turning the camera itself.
     * @param {?CameraTarget} camera the current camera
     * @param {number} yaw degrees to turn
     * @param {number} pitch degrees to tilt
     * @returns {boolean} true if the camera follows something, so that mouse look shouldn't turn it
     */
    mouseLook (camera, yaw, pitch) {
        const settings = this._cameras.get(camera);
        if (!settings || !settings.mode || !this._isAlive(settings.target)) return false;
        if (settings.mode === FIRST_PERSON) {
            const target = settings.target;
            target.setRotation(target.rotationX, target.rotationY + yaw, target.rotationZ);
            this.changeAngles(camera, 0, pitch);
        } else {
            this.changeAngles(camera, yaw, pitch);
        }
        return true;
    }

    _isAlive (target) {
        return !!target && this.scene3D.targets.has(target);
    }

    /**
     * @param {Target3D} target a 3D sprite, clone or camera being deleted
     */
    forget (target) {
        this._cameras.delete(target);
        for (const settings of this._cameras.values()) {
            if (settings.target === target) {
                settings.mode = null;
                settings.target = null;
                settings.current = null;
            }
        }
    }

    reset () {
        this._cameras.clear();
        this._lastTime = null;
    }

    /**
     * Move the following cameras, once a frame.
     */
    tick () {
        const now = Date.now();
        const delta = this._lastTime === null ? 0 : (now - this._lastTime) / 1000;
        this._lastTime = now;
        // Following cameras stay where they are while the project is paused
        if (this.scene3D.runtime.paused) return;
        this.update(delta);
    }

    /**
     * @param {number} delta seconds since the last update
     */
    update (delta) {
        delta = Math.max(0, Math.min(MAX_DELTA, finite(delta, 0)));
        for (const [camera, settings] of this._cameras) {
            if (!settings.mode) continue;
            if (camera && !this.scene3D.targets.has(camera)) {
                this._cameras.delete(camera);
                continue;
            }
            if (!this._isAlive(settings.target)) {
                this.stop(camera);
                continue;
            }
            this._place(camera, settings, delta);
        }
    }

    _place (camera, settings, delta) {
        // Where the sprite is in the world, even if it is attached to another one
        const target = settings.target.getWorldPose();
        const angles = this._angles(settings);
        const offset = rotateYaw(settings.offset, target.yaw);
        const wanted = {
            x: target.x + offset.x,
            y: target.y + offset.y,
            z: target.z + offset.z,
            yaw: target.yaw + angles.yaw,
            pitch: clampPitch(angles.pitch + (settings.mode === FIRST_PERSON ? target.pitch : 0))
        };
        const current = settings.current;
        if (!current || settings.smoothing <= 0) {
            settings.current = wanted;
        } else {
            // Framerate independent: after `smoothing` seconds about 63% of the way is left behind
            const t = 1 - Math.exp(-delta / settings.smoothing);
            current.x += (wanted.x - current.x) * t;
            current.y += (wanted.y - current.y) * t;
            current.z += (wanted.z - current.z) * t;
            current.yaw = lerpAngle(current.yaw, wanted.yaw, t);
            current.pitch += (wanted.pitch - current.pitch) * t;
        }
        const pose = settings.current;
        let {x, y, z} = pose;
        if (settings.mode === THIRD_PERSON) {
            // Behind the pivot, looking at it
            const ahead = forward(pose.yaw, pose.pitch);
            x -= ahead.x * settings.distance;
            y -= ahead.y * settings.distance;
            z -= ahead.z * settings.distance;
        }
        const round = n => Math.round(n * 1e6) / 1e6;
        if (camera) {
            camera.setWorldPose({x: round(x),
                y: round(y),
                z: round(z),
                yaw: round(pose.yaw),
                pitch: round(pose.pitch),
                roll: 0});
        } else {
            this.scene3D.setDefaultCameraPose(round(x), round(y), round(z), round(pose.yaw), round(pose.pitch));
        }
    }
}

module.exports = CameraFollow;

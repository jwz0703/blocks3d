// Cameras that follow 3D sprites (ROADMAP.md, stage 6.5): third person (behind the sprite, looking at it) and first
// person (at the sprite's eyes, looking where it faces), with optional smoothing. Only math: three.js isn't needed.
//
// Orbiting (ROADMAP.md 9, 相機) is three.js's OrbitControls: the camera looks at a sprite or a point from a
// distance, dragging the stage turns it around, the wheel (or pinching) zooms, with damping, limits for the
// distance and the pitch, and turning by itself. The angles are world angles: it doesn't turn with the sprite.

const THIRD_PERSON = 'third';
const FIRST_PERSON = 'first';
const ORBIT = 'orbit';

// Degrees; a bit less than 90 so that the camera never looks straight up or down
const MAX_PITCH = 89.9;
const DEFAULT_DISTANCE = 5;
// Angles when none were set: third person looks down on the sprite a little, first person looks where it faces
const DEFAULT_ANGLES = {
    [THIRD_PERSON]: {yaw: 0, pitch: -20},
    [FIRST_PERSON]: {yaw: 0, pitch: 0},
    [ORBIT]: {yaw: 0, pitch: -20}
};
// Dragging the whole height of the stage turns the orbit this many degrees (like OrbitControls)
const ORBIT_DRAG_DEGREES = 360;
// One notch of the wheel zooms by e^0.15 (about 16%)
const ORBIT_ZOOM_PER_NOTCH = 0.15;
// Damping is what part of the rest of a drag a frame of 1/60 s uses, like OrbitControls' dampingFactor
const DAMPING_FPS = 60;
const DEFAULT_DAMPING = 0.1;
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

    static get ORBIT () {
        return ORBIT;
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
                current: null,
                /** Orbit: the point it looks at when it doesn't orbit a sprite */
                point: null,
                /** Orbit: dragging and the wheel turn and zoom it */
                controls: true,
                minDistance: 0,
                maxDistance: Infinity,
                minPitch: -MAX_PITCH,
                maxPitch: MAX_PITCH,
                damping: DEFAULT_DAMPING,
                /** Orbit: degrees of yaw a second it turns by itself */
                autoSpeed: 0,
                /** Orbit: what dragging turned that damping hasn't used yet, degrees */
                pending: {yaw: 0, pitch: 0},
                /** Orbit: where the drag was in the last frame, or null */
                drag: null
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
            point: settings.point ? Object.assign({}, settings.point) : null,
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
     * @param {object} settings
     * @param {number} pitch
     * @returns {number} the pitch within the limits of an orbit (and short of straight up or down)
     */
    _limitPitch (settings, pitch) {
        if (settings.mode !== ORBIT) return clampPitch(pitch);
        return clampPitch(Math.max(settings.minPitch, Math.min(settings.maxPitch, pitch)));
    }

    _limitDistance (settings, distance) {
        if (settings.mode !== ORBIT) return Math.max(0, distance);
        return Math.max(0, settings.minDistance, Math.min(settings.maxDistance, distance));
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
        if (!target || !target.is3D || target.isCamera || ![THIRD_PERSON, FIRST_PERSON, ORBIT].includes(mode)) return;
        this._start(camera, target, null, mode, distance);
    }

    /**
     * Orbit a 3D sprite or a point: see the comment at the top. Unless angles were set, it starts from the way the
     * camera looks now.
     * @param {?CameraTarget} camera a camera sprite, or null for the default camera
     * @param {?Target3D} target the 3D sprite to orbit, or null to orbit `point`
     * @param {?{x: number, y: number, z: number}} point
     * @param {number} [distance]
     */
    orbit (camera, target, point, distance) {
        if (target) {
            if (!target.is3D || target.isCamera) return;
            this._start(camera, target, null, ORBIT, distance);
        } else {
            this._start(camera, null, {
                x: finite(point && point.x, 0),
                y: finite(point && point.y, 0),
                z: finite(point && point.z, 0)
            }, ORBIT, distance);
        }
    }

    _start (camera, target, point, mode, distance) {
        const settings = this._settings(camera);
        if (mode === ORBIT && settings.mode !== ORBIT && settings.yaw === null) {
            // Orbiting starts from the way the camera looks now
            const pose = this._cameraPose(camera);
            settings.yaw = pose.yaw;
            settings.pitch = clampPitch(pose.pitch);
            settings.mode = null;
        }
        if (settings.mode && settings.mode !== mode) {
            // The other mode's angles would be wrong for this one
            settings.yaw = null;
            settings.pitch = null;
            if (mode === ORBIT) {
                const pose = this._cameraPose(camera);
                settings.yaw = pose.yaw;
                settings.pitch = clampPitch(pose.pitch);
            }
        }
        if (typeof distance !== 'undefined') settings.distance = Math.max(0, finite(distance, settings.distance));
        const samePoint = point && settings.point && ['x', 'y', 'z'].every(k => point[k] === settings.point[k]);
        if (settings.mode !== mode || settings.target !== target || (point && !samePoint)) {
            // Smoothing starts from where the camera is now
            const pose = this._cameraPose(camera);
            const back = mode === FIRST_PERSON ? 0 : settings.distance;
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
        settings.point = point;
    }

    /**
     * @param {?CameraTarget} camera
     */
    stop (camera) {
        const settings = this._cameras.get(camera);
        if (!settings) return;
        settings.mode = null;
        settings.target = null;
        settings.point = null;
        settings.current = null;
        settings.drag = null;
        settings.pending = {yaw: 0, pitch: 0};
    }

    /**
     * Orbit settings: some of controls, minDistance, maxDistance, minPitch, maxPitch, damping (0 to 1), autoSpeed
     * (degrees a second) and distance. They stay when the camera stops orbiting.
     * @param {?CameraTarget} camera
     * @param {object} changes
     */
    setOrbit (camera, changes) {
        const settings = this._settings(camera);
        if ('controls' in changes) {
            settings.controls = !!changes.controls;
            settings.drag = null;
        }
        if ('minDistance' in changes || 'maxDistance' in changes) {
            const min = Math.max(0, finite(changes.minDistance, settings.minDistance));
            const max = Math.max(0, finite(changes.maxDistance, settings.maxDistance));
            settings.minDistance = Math.min(min, max);
            settings.maxDistance = Math.max(min, max);
        }
        if ('minPitch' in changes || 'maxPitch' in changes) {
            const min = clampPitch(finite(changes.minPitch, settings.minPitch));
            const max = clampPitch(finite(changes.maxPitch, settings.maxPitch));
            settings.minPitch = Math.min(min, max);
            settings.maxPitch = Math.max(min, max);
        }
        if ('damping' in changes) settings.damping = Math.max(0, Math.min(1, finite(changes.damping, 0)));
        if ('autoSpeed' in changes) settings.autoSpeed = finite(changes.autoSpeed, 0);
        if ('distance' in changes) settings.distance = Math.max(0, finite(changes.distance, settings.distance));
        if (settings.mode === ORBIT) {
            settings.distance = this._limitDistance(settings, settings.distance);
            if (settings.pitch !== null) settings.pitch = this._limitPitch(settings, settings.pitch);
        }
    }

    /**
     * @param {?CameraTarget} camera
     * @returns {number} how far the camera is from what it follows or orbits
     */
    getDistance (camera) {
        const settings = this._cameras.get(camera);
        return settings ? settings.distance : DEFAULT_DISTANCE;
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
        settings.pitch = this._limitPitch(settings, finite(pitch, angles.pitch));
        // Setting the angles ends the rest of a drag
        settings.pending = {yaw: 0, pitch: 0};
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
        if (!settings || !settings.mode || !this._hasTarget(settings)) return false;
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

    // Following a sprite that is still there, or orbiting a point
    _hasTarget (settings) {
        return settings.mode === ORBIT && !settings.target ? !!settings.point : this._isAlive(settings.target);
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
                settings.drag = null;
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
        this.update(delta, true);
    }

    /**
     * @param {number} delta seconds since the last update
     * @param {boolean} [input] read dragging and the wheel for orbiting cameras (once a frame)
     */
    update (delta, input) {
        delta = Math.max(0, Math.min(MAX_DELTA, finite(delta, 0)));
        for (const [camera, settings] of this._cameras) {
            if (!settings.mode) continue;
            if (camera && !this.scene3D.targets.has(camera)) {
                this._cameras.delete(camera);
                continue;
            }
            if (!this._hasTarget(settings)) {
                this.stop(camera);
                continue;
            }
            if (settings.mode === ORBIT) this._orbit(camera, settings, delta, input);
            this._place(camera, settings, delta);
        }
    }

    /**
     * @param {?CameraTarget} camera
     * @returns {boolean} whether the stage shows this camera and the player can turn it
     */
    _getsInput (camera) {
        const scene3D = this.scene3D;
        if (scene3D.editor && scene3D.editor.active) return false;
        if (scene3D.isPointerLocked && scene3D.isPointerLocked()) return false;
        return (scene3D.activeCamera || null) === camera;
    }

    /**
     * @param {Target} target what the mouse pressed
     * @returns {boolean} whether dragging from it turns an orbiting camera: from the stage, and from 3D sprites
     * that only collide (like the ground), not from 2D sprites (the HUD) or 3D sprites that use the mouse
     */
    _pressTurnsOrbit (target) {
        if (target.isStage) return true;
        if (!target.is3D || target.mouseMode === 'block') return false;
        return !target.draggable && !(target.blocks && target.blocks.hasMouseScripts());
    }

    /**
     * Turn and zoom an orbiting camera: dragging, the wheel, turning by itself and damping.
     */
    _orbit (camera, settings, delta, input) {
        const runtime = this.scene3D.runtime;
        const angles = this._angles(settings);
        let yaw = angles.yaw;
        let pitch = angles.pitch;
        if (input && settings.controls && this._getsInput(camera)) {
            const mouse = runtime.ioDevices && runtime.ioDevices.mouse;
            // A drag that started on a button or a sprite with click scripts doesn't turn the camera
            if (mouse && mouse.getIsDown() && mouse.getPressTarget && mouse.getPressTarget() &&
                this._pressTurnsOrbit(mouse.getPressTarget())) {
                const x = mouse._scratchX;
                const y = mouse._scratchY;
                const press = mouse.getPressCount();
                // A new press (even one that started and ended between two frames) starts a new drag
                if (settings.drag && settings.drag.press === press) {
                    const scale = ORBIT_DRAG_DEGREES / Math.max(1, runtime.stageHeight);
                    settings.pending.yaw -= (x - settings.drag.x) * scale;
                    settings.pending.pitch += (y - settings.drag.y) * scale;
                }
                settings.drag = {x, y, press};
            } else {
                settings.drag = null;
            }
            const wheel = runtime.ioDevices && runtime.ioDevices.mouseWheel;
            const notches = wheel ? wheel.getDelta() : 0;
            if (notches) settings.distance *= Math.exp(-ORBIT_ZOOM_PER_NOTCH * notches);
        }
        // Damping uses a part of the drag every frame, the same whatever the framerate
        let part = 1;
        if (settings.damping > 0 && settings.damping < 1) {
            part = 1 - Math.pow(1 - settings.damping, delta * DAMPING_FPS);
        }
        yaw += (settings.pending.yaw * part) + (settings.autoSpeed * delta);
        pitch += settings.pending.pitch * part;
        settings.pending.yaw *= 1 - part;
        settings.pending.pitch *= 1 - part;
        if (Math.abs(settings.pending.yaw) < 1e-6) settings.pending.yaw = 0;
        if (Math.abs(settings.pending.pitch) < 1e-6) settings.pending.pitch = 0;
        settings.yaw = ((((yaw + 180) % 360) + 360) % 360) - 180;
        settings.pitch = this._limitPitch(settings, pitch);
        settings.distance = this._limitDistance(settings, settings.distance);
    }

    _place (camera, settings, delta) {
        const angles = this._angles(settings);
        let wanted;
        if (settings.mode === ORBIT) {
            // World angles; the offset doesn't turn with the sprite either
            const pivot = settings.target ? settings.target.getWorldPose() : settings.point;
            const offset = settings.target ? settings.offset : {x: 0, y: 0, z: 0};
            wanted = {
                x: pivot.x + offset.x,
                y: pivot.y + offset.y,
                z: pivot.z + offset.z,
                yaw: angles.yaw,
                pitch: angles.pitch
            };
        } else {
            // Where the sprite is in the world, even if it is attached to another one
            const target = settings.target.getWorldPose();
            const offset = rotateYaw(settings.offset, target.yaw);
            wanted = {
                x: target.x + offset.x,
                y: target.y + offset.y,
                z: target.z + offset.z,
                yaw: target.yaw + angles.yaw,
                pitch: clampPitch(angles.pitch + (settings.mode === FIRST_PERSON ? target.pitch : 0))
            };
        }
        const current = settings.current;
        if (settings.mode === ORBIT && current && settings.smoothing > 0) {
            // Only the point it looks at is smoothed: damping already smooths the angles
            const t = 1 - Math.exp(-delta / settings.smoothing);
            current.x += (wanted.x - current.x) * t;
            current.y += (wanted.y - current.y) * t;
            current.z += (wanted.z - current.z) * t;
            current.yaw = wanted.yaw;
            current.pitch = wanted.pitch;
        } else if (!current || settings.smoothing <= 0) {
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
        if (settings.mode === THIRD_PERSON || settings.mode === ORBIT) {
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

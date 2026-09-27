// Collision and physics of 3D sprites, with Rapier (ROADMAP.md 6.1 and 6.7).
//
// Rapier is the one collision world: every 3D sprite and clone has a collider, a box or a sphere around its model.
// Sprites without physics have kinematic bodies that go wherever blocks put them; dynamic bodies move by themselves
// (gravity, forces) and write their position back to their sprites; static bodies never move.
//
// "Touching" and raycasts test the same Rapier shapes one by one, at the positions sprites have right now: Rapier's
// own scene queries only see moves after the next step, and blocks expect to see a move right away.
//
// Rapier (a big WASM module) is only loaded once a project uses collision or physics blocks.

// How a sprite's body moves
const BODY_KINEMATIC = 'kinematic';
const BODY_DYNAMIC = 'dynamic';
const BODY_STATIC = 'static';
const BODY_TYPES = [BODY_KINEMATIC, BODY_DYNAMIC, BODY_STATIC];

// The shape of a sprite's collider
const SHAPE_BOX = 'box';
const SHAPE_SPHERE = 'sphere';
const COLLIDER_SHAPES = [SHAPE_BOX, SHAPE_SPHERE];

const DEFAULT_GRAVITY = Object.freeze({x: 0, y: -9.81, z: 0});

// Colliders are never thinner than this, so that planes still collide
const MIN_SIZE = 0.01;

// Frames longer than this are simulated as this long, so that nothing tunnels through walls after a hiccup
const MAX_STEP = 1 / 20;

/**
 * @returns {object} how a new 3D sprite collides
 */
const defaultSettings = () => ({
    body: BODY_KINEMATIC,
    shape: SHAPE_BOX,
    mass: 1,
    bounce: 0,
    friction: 0.5,
    lockRotation: false
});

/**
 * @param {*} settings from a project
 * @returns {object} complete, valid settings
 */
const sanitizeSettings = settings => {
    const result = defaultSettings();
    if (!settings || typeof settings !== 'object') return result;
    if (BODY_TYPES.includes(settings.body)) result.body = settings.body;
    if (COLLIDER_SHAPES.includes(settings.shape)) result.shape = settings.shape;
    const number = (value, fallback, min, max) => {
        const n = Number(value);
        return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
    };
    result.mass = number(settings.mass, result.mass, 0.001, 1e6);
    result.bounce = number(settings.bounce, result.bounce, 0, 1);
    result.friction = number(settings.friction, result.friction, 0, 10);
    result.lockRotation = !!settings.lockRotation;
    return result;
};

/**
 * @param {*} value
 * @param {{x: number, y: number, z: number}} fallback
 * @returns {{x: number, y: number, z: number}} valid vector
 */
const sanitizeVector = (value, fallback) => {
    const get = key => {
        const n = Number(value && value[key]);
        return Number.isFinite(n) ? n : fallback[key];
    };
    return {x: get('x'), y: get('y'), z: get('z')};
};

class Physics3D {
    /**
     * @param {Scene3D} scene3D
     */
    constructor (scene3D) {
        this.scene3D = scene3D;
        this.runtime = scene3D.runtime;

        /** The Rapier module once it is loaded */
        this.RAPIER = null;
        this._loading = null;
        this.world = null;
        this._eventQueue = null;

        /** Gravity of the project, in units per second squared */
        this.gravity = Object.assign({}, DEFAULT_GRAVITY);

        /**
         * Rigid body and collider of each 3D sprite and clone in the world
         * @type {Map<Target3D, object>}
         */
        this._bodies = new Map();
        /** @type {Map<number, Target3D>} sprite of each collider handle, for collision events */
        this._colliderTargets = new Map();

        /** True between the green flag and stopping: only then do bodies move by themselves */
        this.running = false;

        this.runtime.on('PROJECT_START', () => {
            this.running = true;
        });
        this.runtime.on('PROJECT_STOP_ALL', () => {
            this.running = false;
            // Nothing keeps moving after stopping
            for (const entry of this._bodies.values()) {
                if (entry.bodyType === BODY_DYNAMIC) {
                    entry.body.setLinvel({x: 0, y: 0, z: 0}, false);
                    entry.body.setAngvel({x: 0, y: 0, z: 0}, false);
                }
            }
        });
        this.runtime.on('PHYSICS_STEP', delta => this.step(delta));
    }

    static get BODY_TYPES () {
        return BODY_TYPES;
    }

    static get COLLIDER_SHAPES () {
        return COLLIDER_SHAPES;
    }

    static get DEFAULT_GRAVITY () {
        return DEFAULT_GRAVITY;
    }

    static defaultSettings () {
        return defaultSettings();
    }

    static sanitizeSettings (settings) {
        return sanitizeSettings(settings);
    }

    /**
     * @returns {boolean} true once Rapier is loaded
     */
    get ready () {
        return !!this.RAPIER;
    }

    /**
     * Load Rapier, if it isn't loaded yet.
     * @returns {Promise<boolean>} true once loaded, false if it can't be
     */
    load () {
        if (this.RAPIER) return Promise.resolve(true);
        if (!this._loading) {
            this._loading = import(/* webpackChunkName: "rapier" */ '@dimforge/rapier3d-compat')
                .then(module => {
                    const RAPIER = module.default || module;
                    // An object, since passing nothing is deprecated
                    return RAPIER.init({}).then(() => RAPIER);
                })
                .then(RAPIER => {
                    this.RAPIER = RAPIER;
                    this._createWorld();
                    return true;
                }, error => {
                    console.warn('3D: could not load physics', error);
                    this._loading = null;
                    return false;
                });
        }
        return this._loading;
    }

    /**
     * Run a function once Rapier is loaded: right away if it is, otherwise as a promise, which makes the block that
     * calls it wait.
     * @param {function(): *} fn
     * @param {*} [fallback] the result if Rapier can't be loaded
     * @returns {*|Promise<*>} what fn returns
     */
    whenReady (fn, fallback) {
        if (this.RAPIER) return fn();
        return this.load().then(loaded => (loaded ? fn() : fallback));
    }

    _createWorld () {
        const RAPIER = this.RAPIER;
        this.world = new RAPIER.World(this.gravity);
        this._eventQueue = new RAPIER.EventQueue(true);
    }

    /**
     * Forget every body, e.g. before loading another project. Gravity goes back to normal.
     */
    reset () {
        if (this.world) {
            this.world.free();
            this._eventQueue.free();
            this._createWorld();
        }
        this._bodies.clear();
        this._colliderTargets.clear();
        this.gravity = Object.assign({}, DEFAULT_GRAVITY);
        this.running = false;
    }

    /**
     * @param {{x: number, y: number, z: number}} gravity
     */
    setGravity (gravity) {
        this.gravity = sanitizeVector(gravity, this.gravity);
        if (this.world) this.world.gravity = Object.assign({}, this.gravity);
    }

    /**
     * @param {Target3D} target
     * @param {object} changes some of the settings, see defaultSettings()
     */
    setSettings (target, changes) {
        target.physics = sanitizeSettings(Object.assign({}, target.physics, changes));
        // Bodies that move by themselves need the world
        if (target.physics.body !== BODY_KINEMATIC) this.load();
        this.runtime.requestTargetsUpdate(target);
    }

    // Shapes

    /**
     * @param {Target3D} target
     * @returns {boolean} true if the sprite can collide: visible and not a camera
     */
    _collides (target) {
        return target.visible && !target.isCamera && this.scene3D.targets.has(target);
    }

    /**
     * @param {Target3D} target
     * @returns {?{shape: object, position: object, rotation: object, key: string}} the sprite's Rapier shape where the
     * sprite is in the world now, or null if Rapier isn't loaded or the sprite can't collide
     */
    getShape (target) {
        if (!this.RAPIER || !this._collides(target)) return null;
        const THREE = this.scene3D.THREE;
        const matrix = target.getWorldMatrix();
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        matrix.decompose(position, quaternion, scale);
        const bounds = this.scene3D.getModelBounds(target);
        const size = {
            x: Math.max(MIN_SIZE, Math.abs(bounds.size.x * scale.x)),
            y: Math.max(MIN_SIZE, Math.abs(bounds.size.y * scale.y)),
            z: Math.max(MIN_SIZE, Math.abs(bounds.size.z * scale.z))
        };
        // The model's center isn't always the sprite's origin
        const center = new THREE.Vector3(bounds.center.x * scale.x, bounds.center.y * scale.y,
            bounds.center.z * scale.z).applyQuaternion(quaternion);
        const round = n => Math.round(n * 1e5) / 1e5;
        let shape;
        let key;
        if (target.physics.shape === SHAPE_SPHERE) {
            const radius = Math.max(size.x, size.y, size.z) / 2;
            shape = new this.RAPIER.Ball(radius);
            key = `sphere ${round(radius)}`;
        } else {
            shape = new this.RAPIER.Cuboid(size.x / 2, size.y / 2, size.z / 2);
            key = `box ${round(size.x)} ${round(size.y)} ${round(size.z)}`;
        }
        return {
            shape,
            key,
            // Where the sprite's origin is, and how far its collider's center is from it
            origin: {x: position.x, y: position.y, z: position.z},
            offset: {x: bounds.center.x * scale.x, y: bounds.center.y * scale.y, z: bounds.center.z * scale.z},
            position: {x: position.x + center.x, y: position.y + center.y, z: position.z + center.z},
            rotation: {x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w}
        };
    }

    /**
     * @param {Target3D} a
     * @param {Target3D} b
     * @returns {boolean} true if their colliders touch
     */
    isTouching (a, b) {
        if (a === b) return false;
        const shapeA = this.getShape(a);
        const shapeB = shapeA && this.getShape(b);
        if (!shapeB) return false;
        return shapeA.shape.intersectsShape(shapeA.position, shapeA.rotation, shapeB.shape, shapeB.position,
            shapeB.rotation);
    }

    /**
     * Cast a ray against every 3D sprite.
     * @param {{x: number, y: number, z: number}} origin
     * @param {{x: number, y: number, z: number}} direction doesn't need to be normalized
     * @param {number} maxDistance
     * @param {?Target3D} [exclude] a sprite the ray ignores, usually the one it starts in
     * @returns {?{target: Target3D, distance: number, point: {x: number, y: number, z: number}}} the closest hit
     */
    raycast (origin, direction, maxDistance, exclude) {
        if (!this.RAPIER) return null;
        const length = Math.hypot(direction.x, direction.y, direction.z);
        if (!(length > 0) || !(maxDistance > 0)) return null;
        const dir = {x: direction.x / length, y: direction.y / length, z: direction.z / length};
        const ray = new this.RAPIER.Ray(origin, dir);
        let best = null;
        for (const target of this.scene3D.targets) {
            if (target === exclude) continue;
            const shape = this.getShape(target);
            if (!shape) continue;
            const distance = shape.shape.castRay(ray, shape.position, shape.rotation, maxDistance, true);
            if (distance !== null && distance >= 0 && distance <= maxDistance && (!best || distance < best.distance)) {
                best = {target, distance};
            }
        }
        if (!best) return null;
        best.point = {
            x: origin.x + (dir.x * best.distance),
            y: origin.y + (dir.y * best.distance),
            z: origin.z + (dir.z * best.distance)
        };
        return best;
    }

    // Bodies

    /**
     * @param {Target3D} target
     * @returns {string} changes whenever the sprite or a sprite it is attached to moves
     */
    _worldVersion (target) {
        let version = '';
        for (let current = target; current; current = current.parent3D) {
            version += `${current.transformVersion},${current.visible ? 1 : 0};`;
        }
        return version;
    }

    /**
     * Make or remove bodies so that every sprite that can collide has one that matches its settings and shape, and
     * move bodies that don't move by themselves to where their sprites are.
     */
    _sync () {
        const RAPIER = this.RAPIER;
        const world = this.world;
        for (const [target, entry] of this._bodies) {
            if (!this.scene3D.targets.has(target) || target.isCamera) this._removeBody(target, entry);
        }
        for (const target of this.scene3D.targets) {
            if (target.isCamera) continue;
            let entry = this._bodies.get(target);
            const settings = target.physics;
            const shape = this.getShape(target);
            if (!shape) {
                // Hidden sprites don't collide
                if (entry) entry.collider.setEnabled(false);
                continue;
            }
            const materialKey = `${settings.mass} ${settings.bounce} ${settings.friction}`;
            if (entry && (entry.bodyType !== settings.body || entry.shapeKey !== shape.key ||
                entry.materialKey !== materialKey)) {
                this._removeBody(target, entry);
                entry = null;
            }
            if (!entry) {
                let bodyDesc;
                if (settings.body === BODY_DYNAMIC) bodyDesc = RAPIER.RigidBodyDesc.dynamic();
                else if (settings.body === BODY_STATIC) bodyDesc = RAPIER.RigidBodyDesc.fixed();
                else bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
                bodyDesc.setTranslation(shape.origin.x, shape.origin.y, shape.origin.z).setRotation(shape.rotation);
                const body = world.createRigidBody(bodyDesc);
                const colliderDesc = (settings.shape === SHAPE_SPHERE ?
                    RAPIER.ColliderDesc.ball(shape.shape.radius) :
                    RAPIER.ColliderDesc.cuboid(shape.shape.halfExtents.x, shape.shape.halfExtents.y,
                        shape.shape.halfExtents.z))
                    .setTranslation(shape.offset.x, shape.offset.y, shape.offset.z)
                    .setMass(settings.mass)
                    .setRestitution(settings.bounce)
                    .setFriction(settings.friction)
                    .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
                    .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);
                const collider = world.createCollider(colliderDesc, body);
                entry = {
                    body,
                    collider,
                    bodyType: settings.body,
                    shapeKey: shape.key,
                    materialKey,
                    version: this._worldVersion(target),
                    lockRotation: null
                };
                this._bodies.set(target, entry);
                this._colliderTargets.set(collider.handle, target);
            }
            entry.collider.setEnabled(true);
            if (entry.lockRotation !== settings.lockRotation) {
                entry.lockRotation = settings.lockRotation;
                entry.body.lockRotations(settings.lockRotation, true);
            }
            const version = this._worldVersion(target);
            if (entry.version !== version) {
                // Blocks moved it (dynamic bodies keep their speed)
                entry.version = version;
                entry.body.setTranslation(shape.origin, true);
                entry.body.setRotation(shape.rotation, true);
            }
        }
    }

    _removeBody (target, entry) {
        this._colliderTargets.delete(entry.collider.handle);
        this.world.removeRigidBody(entry.body);
        this._bodies.delete(target);
    }

    /**
     * @param {Target3D} target
     * @returns {?object} the sprite's dynamic body, made now if needed; null if Rapier isn't loaded or the sprite
     * isn't dynamic
     */
    _dynamicBody (target) {
        if (!this.world || target.physics.body !== BODY_DYNAMIC) return null;
        let entry = this._bodies.get(target);
        if (!entry || entry.bodyType !== BODY_DYNAMIC) {
            this._sync();
            entry = this._bodies.get(target);
        }
        return entry && entry.bodyType === BODY_DYNAMIC ? entry.body : null;
    }

    /**
     * @param {Target3D} target
     * @param {{x: number, y: number, z: number}} force applied during the next step only
     */
    applyForce (target, force) {
        const body = this._dynamicBody(target);
        if (body) body.addForce(sanitizeVector(force, {x: 0, y: 0, z: 0}), true);
    }

    /**
     * @param {Target3D} target
     * @param {{x: number, y: number, z: number}} impulse a sudden push, e.g. a jump
     */
    applyImpulse (target, impulse) {
        const body = this._dynamicBody(target);
        if (body) body.applyImpulse(sanitizeVector(impulse, {x: 0, y: 0, z: 0}), true);
    }

    /**
     * @param {Target3D} target
     * @param {object} velocity some of {x, y, z}; the others stay the same
     */
    setVelocity (target, velocity) {
        const body = this._dynamicBody(target);
        if (body) body.setLinvel(sanitizeVector(velocity, body.linvel()), true);
    }

    /**
     * @param {Target3D} target
     * @returns {{x: number, y: number, z: number}} how fast the sprite moves, in units per second
     */
    getVelocity (target) {
        const body = this._dynamicBody(target);
        if (!body) return {x: 0, y: 0, z: 0};
        const velocity = body.linvel();
        return {x: velocity.x, y: velocity.y, z: velocity.z};
    }

    /**
     * @returns {boolean} true while the project runs and a dynamic body still moves (isn't asleep)
     */
    isMoving () {
        if (!this.world || !this.running) return false;
        for (const entry of this._bodies.values()) {
            if (entry.bodyType === BODY_DYNAMIC && !entry.body.isSleeping()) return true;
        }
        return false;
    }

    /**
     * Simulate one frame, between the scripts of the update and after update phases (see Runtime._step).
     * @param {number} delta seconds since the last frame
     */
    step (delta) {
        if (!this.world || !this.running || this.runtime.paused) return;
        this._sync();
        if (this._bodies.size === 0) return;
        this.world.timestep = Math.max(1 / 1000, Math.min(MAX_STEP, delta > 0 ? delta : 1 / 60));
        this.world.step(this._eventQueue);

        // Dynamic bodies move their sprites
        for (const [target, entry] of this._bodies) {
            if (entry.bodyType !== BODY_DYNAMIC) continue;
            // Forces only last one step, like blocks expect
            entry.body.resetForces(false);
            if (entry.body.isSleeping()) continue;
            const THREE = this.scene3D.THREE;
            const position = entry.body.translation();
            const rotation = new THREE.Euler().setFromQuaternion(
                new THREE.Quaternion().copy(entry.body.rotation()), 'YXZ');
            const round = n => Math.round(n * 1e6) / 1e6;
            target.setWorldPose({
                x: round(position.x),
                y: round(position.y),
                z: round(position.z),
                pitch: round(THREE.MathUtils.radToDeg(rotation.x)),
                yaw: round(THREE.MathUtils.radToDeg(rotation.y)),
                roll: round(THREE.MathUtils.radToDeg(rotation.z))
            });
            entry.version = this._worldVersion(target);
        }

        const events = [];
        this._eventQueue.drainCollisionEvents((handle1, handle2, started) => {
            const a = this._colliderTargets.get(handle1);
            const b = this._colliderTargets.get(handle2);
            if (a && b) events.push({a, b, started});
        });
        for (const {a, b, started} of events) {
            const opcode = started ? 'physics3d_whencollisionstart' : 'physics3d_whencollisionend';
            for (const [self, other] of [[a, b], [b, a]]) {
                if (!this.runtime.targets.includes(self)) continue;
                this.runtime.startHats(opcode, {TARGET: other.sprite.name}, self);
                this.runtime.startHats(opcode, {TARGET: '_any_'}, self);
            }
        }
    }
}

module.exports = Physics3D;

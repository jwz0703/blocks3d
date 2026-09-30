// Collision and physics of 3D sprites, with Rapier (ROADMAP.md 6.1 and 6.7).
//
// Rapier is the one collision world: every 3D sprite and clone has a collider, a box, sphere or capsule around its
// model, the convex hull of its model, or its model's triangles ("mesh").
// Sprites without physics have kinematic bodies that go wherever blocks put them; dynamic bodies move by themselves
// (gravity, forces) and write their position back to their sprites; static bodies never move.
//
// Mesh colliders are exact for sprites that don't move by themselves. Rapier can't simulate a triangle mesh as a
// dynamic body (it has no inside, so it sinks into what it lands on), so dynamic sprites get a convex decomposition
// of their model instead: convex pieces that together follow its shape, holes and dents included.
//
// "Touching" and raycasts test the same Rapier shapes one by one, at the positions sprites have right now: Rapier's
// own scene queries only see moves after the next step, and blocks expect to see a move right away.
//
// Rapier (a big WASM module) is only loaded once a project uses collision or physics blocks.
//
// Sprites can leave collision out altogether (decorations: leaves, dust), or collide while hidden (invisible walls).
// Each sprite is in one of 16 collision groups; the project says which groups collide with each other. Groups only
// change what bodies bump into and the collision hats: "touching" and raycasts still see every sprite that collides.

// How a sprite's body moves
const BODY_KINEMATIC = 'kinematic';
const BODY_DYNAMIC = 'dynamic';
const BODY_STATIC = 'static';
const BODY_TYPES = [BODY_KINEMATIC, BODY_DYNAMIC, BODY_STATIC];

// The shape of a sprite's collider
const SHAPE_BOX = 'box';
const SHAPE_SPHERE = 'sphere';
const SHAPE_CAPSULE = 'capsule';
const SHAPE_HULL = 'hull';
const SHAPE_MESH = 'mesh';
const SHAPE_CYLINDER = 'cylinder';
const COLLIDER_SHAPES = [SHAPE_BOX, SHAPE_SPHERE, SHAPE_CAPSULE, SHAPE_CYLINDER, SHAPE_HULL, SHAPE_MESH];

// Collision groups are numbered 1 to GROUP_COUNT (Rapier has 16 bits of groups)
const GROUP_COUNT = 16;
const ALL_GROUPS = (1 << GROUP_COUNT) - 1;

// Rapier shapes kept ready for queries and new colliders, by size; the least recently used go first
const MAX_CACHED_SHAPES = 256;

const DEG = Math.PI / 180;

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
    lockRotation: false,
    // Slowing down by itself, per second: 0 keeps moving, higher stops sooner
    linearDamping: 0,
    angularDamping: 0,
    // False: no collider at all, e.g. for decorations
    collide: true,
    // True: collides even while hidden, e.g. invisible walls
    collideHidden: false,
    group: 1
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
    result.linearDamping = number(settings.linearDamping, result.linearDamping, 0, 1000);
    result.angularDamping = number(settings.angularDamping, result.angularDamping, 0, 1000);
    if (typeof settings.collide === 'boolean') result.collide = settings.collide;
    result.collideHidden = !!settings.collideHidden;
    result.group = Math.round(number(settings.group, result.group, 1, GROUP_COUNT));
    return result;
};

/**
 * @returns {number[]} for each group (index 0 is group 1), the bits of the groups it collides with: all of them
 */
const defaultGroupMasks = () => new Array(GROUP_COUNT).fill(ALL_GROUPS);

/**
 * @param {*} masks from a project
 * @returns {number[]} valid, symmetric masks
 */
const sanitizeGroupMasks = masks => {
    const result = defaultGroupMasks();
    if (!Array.isArray(masks)) return result;
    for (let i = 0; i < GROUP_COUNT; i++) {
        const n = Number(masks[i]);
        if (Number.isInteger(n)) result[i] = n & ALL_GROUPS;
    }
    // Colliding goes both ways
    for (let i = 0; i < GROUP_COUNT; i++) {
        for (let j = 0; j < GROUP_COUNT; j++) {
            if (!(result[i] & (1 << j)) || !(result[j] & (1 << i))) {
                result[i] &= ~(1 << j);
                result[j] &= ~(1 << i);
            }
        }
    }
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
        /** Which collision groups collide with which, see sanitizeGroupMasks */
        this.groupMasks = defaultGroupMasks();

        /**
         * Rigid body and collider of each 3D sprite and clone in the world
         * @type {Map<Target3D, object>}
         */
        this._bodies = new Map();
        /** @type {Map<number, Target3D>} sprite of each collider handle, for collision events */
        this._colliderTargets = new Map();
        /** @type {Map<string, ?object>} Rapier shapes by kind and size, see _cachedShape */
        this._shapes = new Map();
        /**
         * Convex pieces of each model (by getModelGeometry's key) before scaling, for dynamic mesh colliders
         * @type {Map<string, ?Float32Array[]>}
         */
        this._decompositions = new Map();

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

    static get GROUP_COUNT () {
        return GROUP_COUNT;
    }

    static sanitizeGroupMasks (masks) {
        return sanitizeGroupMasks(masks);
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
        for (const shape of this._shapes.values()) {
            if (shape) shape.dispose();
        }
        this._shapes.clear();
        this._decompositions.clear();
        this.gravity = Object.assign({}, DEFAULT_GRAVITY);
        this.groupMasks = defaultGroupMasks();
        this.running = false;
    }

    /**
     * @param {*} masks which collision groups collide with which, from a project (see sanitizeGroupMasks)
     */
    setGroupMasks (masks) {
        this.groupMasks = sanitizeGroupMasks(masks);
    }

    /**
     * @param {number} a collision group, 1 to GROUP_COUNT
     * @param {number} b another one (or the same)
     * @param {boolean} collide whether bodies in them bump into each other
     */
    setGroupsCollide (a, b, collide) {
        a = Math.round(a);
        b = Math.round(b);
        if (!(a >= 1 && a <= GROUP_COUNT && b >= 1 && b <= GROUP_COUNT)) return;
        const masks = this.groupMasks.slice();
        if (collide) {
            masks[a - 1] |= 1 << (b - 1);
            masks[b - 1] |= 1 << (a - 1);
        } else {
            masks[a - 1] &= ~(1 << (b - 1));
            masks[b - 1] &= ~(1 << (a - 1));
        }
        this.groupMasks = masks;
    }

    /**
     * @param {number} a
     * @param {number} b
     * @returns {boolean} true if bodies in those collision groups bump into each other
     */
    groupsCollide (a, b) {
        const mask = this.groupMasks[Math.round(a) - 1];
        return mask !== void 0 && !!(mask & (1 << (Math.round(b) - 1)));
    }

    /**
     * @returns {boolean} true unless every group collides with every group, which projects don't need to save
     */
    hasGroupRules () {
        return this.groupMasks.some(mask => mask !== ALL_GROUPS);
    }

    /**
     * @param {object} settings of a sprite
     * @returns {number} Rapier's interaction groups: the group in the high 16 bits, what it collides with in the low
     */
    _interactionGroups (settings) {
        const group = settings.group - 1;
        return (((1 << group) << 16) | this.groupMasks[group]) >>> 0;
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
     * @returns {boolean} true if the sprite can collide: collision is on, it is visible (or collides while hidden),
     * and it isn't a camera
     */
    _collides (target) {
        const settings = target.physics;
        return !target.isCamera && settings.collide !== false && (target.visible || !!settings.collideHidden) &&
            this.scene3D.targets.has(target);
    }

    /**
     * @param {string} key what the shape is and how big
     * @param {function(): ?object} make makes the Rapier shape
     * @returns {?object} the shape, converted for Rapier only once: converting a mesh (and building its bounding
     * volume tree) costs far more than a query. Null if it can't be made, e.g. the hull of something flat.
     */
    _cachedShape (key, make) {
        let shape = this._shapes.get(key);
        if (shape !== void 0) {
            // Most recently used
            this._shapes.delete(key);
            this._shapes.set(key, shape);
            return shape;
        }
        shape = null;
        try {
            const made = make();
            const raw = made && made.intoRaw();
            if (raw) {
                // Queries and new colliders convert the shape and free the result, and colliders keep their own
                // copy, so every one of them can use this one
                const free = raw.free.bind(raw);
                raw.free = () => {};
                shape = Object.create(made);
                shape.intoRaw = () => raw;
                shape.dispose = free;
            }
        } catch (e) {
            shape = null;
        }
        this._shapes.set(key, shape);
        if (this._shapes.size > MAX_CACHED_SHAPES) {
            const [oldestKey, oldest] = this._shapes.entries().next().value;
            this._shapes.delete(oldestKey);
            if (oldest) oldest.dispose();
        }
        return shape;
    }

    /**
     * @param {string} type SHAPE_BOX, SHAPE_SPHERE, SHAPE_CAPSULE or SHAPE_CYLINDER
     * @param {{x: number, y: number, z: number}} size of the box around the sprite's model
     * @returns {{shape: ?object, key: string}} a shape around that box, centered on it
     */
    _basicShape (type, size) {
        const RAPIER = this.RAPIER;
        const round = n => Math.round(n * 1e5) / 1e5;
        let key;
        let make;
        if (type === SHAPE_SPHERE) {
            const radius = round(Math.max(size.x, size.y, size.z) / 2);
            key = `sphere ${radius}`;
            make = () => new RAPIER.Ball(radius);
        } else if (type === SHAPE_CAPSULE) {
            // Standing up, like a character
            const radius = round(Math.max(size.x, size.z) / 2);
            const halfHeight = round(Math.max(0, (size.y / 2) - radius));
            key = `capsule ${halfHeight} ${radius}`;
            make = () => new RAPIER.Capsule(halfHeight, radius);
        } else if (type === SHAPE_CYLINDER) {
            // Standing up, like a tree trunk
            const radius = round(Math.max(size.x, size.z) / 2);
            const halfHeight = round(size.y / 2);
            key = `cylinder ${halfHeight} ${radius}`;
            make = () => new RAPIER.Cylinder(halfHeight, radius);
        } else {
            const [x, y, z] = [size.x, size.y, size.z].map(n => round(n / 2));
            key = `box ${x} ${y} ${z}`;
            make = () => new RAPIER.Cuboid(x, y, z);
        }
        return {shape: this._cachedShape(key, make), key};
    }

    /**
     * @param {{key: string, vertices: Float32Array, indices: Uint32Array}} geometry from getModelGeometry
     * @returns {?Float32Array[]} the points of each convex piece of the model; null if it can't be decomposed
     */
    _decompose (geometry) {
        if (!this._decompositions.has(geometry.key)) {
            let pieces = null;
            try {
                const desc = this.RAPIER.ColliderDesc.convexDecomposition(geometry.vertices, geometry.indices);
                const compound = desc && desc.shape;
                if (compound && compound.shapes && compound.shapes.length > 0) {
                    const THREE = this.scene3D.THREE;
                    const point = new THREE.Vector3();
                    const rotation = new THREE.Quaternion();
                    pieces = compound.shapes.map((piece, i) => {
                        // Where the piece is in the compound, applied to its points
                        const position = compound.positions[i];
                        rotation.copy(compound.rotations[i]);
                        const points = new Float32Array(piece.vertices.length);
                        for (let j = 0; j < points.length; j += 3) {
                            point.set(piece.vertices[j], piece.vertices[j + 1], piece.vertices[j + 2])
                                .applyQuaternion(rotation)
                                .add(position);
                            points[j] = point.x;
                            points[j + 1] = point.y;
                            points[j + 2] = point.z;
                        }
                        return points;
                    });
                }
            } catch (e) {
                pieces = null;
            }
            this._decompositions.set(geometry.key, pieces);
        }
        return this._decompositions.get(geometry.key);
    }

    /**
     * @param {Target3D} target
     * @param {{x: number, y: number, z: number}} scale the sprite's scale in the world
     * @returns {?{shape: ?object, key: string}} the hull or mesh collider of the sprite's model, relative to the
     * sprite; null while its model loads
     */
    _meshShape (target, scale) {
        const RAPIER = this.RAPIER;
        const geometry = this.scene3D.getModelGeometry(target);
        if (!geometry) return null;
        const round = n => Math.round(n * 1e4) / 1e4;
        const sx = round(scale.x);
        const sy = round(scale.y);
        const sz = round(scale.z);
        const scaled = points => {
            const result = new Float32Array(points.length);
            for (let i = 0; i < points.length; i += 3) {
                result[i] = points[i] * sx;
                result[i + 1] = points[i + 1] * sy;
                result[i + 2] = points[i + 2] * sz;
            }
            return result;
        };
        const hull = points => new RAPIER.ConvexPolyhedron(scaled(points), null);
        const size = `${geometry.key} ${sx} ${sy} ${sz}`;
        let key;
        let make;
        if (target.physics.shape === SHAPE_MESH && target.physics.body !== BODY_DYNAMIC) {
            key = `mesh ${size}`;
            make = () => new RAPIER.TriMesh(scaled(geometry.vertices), geometry.indices);
        } else if (target.physics.shape === SHAPE_MESH && this._decompose(geometry)) {
            // Scaling keeps convex pieces convex, so the model is only decomposed once
            const pieces = this._decompose(geometry);
            key = `pieces ${size}`;
            make = () => new RAPIER.Compound(pieces.map(hull), pieces.map(() => ({x: 0, y: 0, z: 0})),
                pieces.map(() => ({x: 0, y: 0, z: 0, w: 1})));
        } else {
            key = `hull ${size}`;
            make = () => hull(geometry.vertices);
        }
        const shape = this._cachedShape(key, make);
        return shape ? {shape, key} : null;
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
        const type = target.physics.shape;
        let made = null;
        let offset = {x: 0, y: 0, z: 0};
        if (type === SHAPE_HULL || type === SHAPE_MESH) made = this._meshShape(target, scale);
        if (!made) {
            // Basic shapes, and hulls and meshes while their model loads or if it has no volume, are around the box
            // around the model, whose center isn't always the sprite's origin
            const bounds = this.scene3D.getModelBounds(target);
            const size = {
                x: Math.max(MIN_SIZE, Math.abs(bounds.size.x * scale.x)),
                y: Math.max(MIN_SIZE, Math.abs(bounds.size.y * scale.y)),
                z: Math.max(MIN_SIZE, Math.abs(bounds.size.z * scale.z))
            };
            const basic = [SHAPE_SPHERE, SHAPE_CAPSULE, SHAPE_CYLINDER].includes(type) ? type : SHAPE_BOX;
            made = this._basicShape(basic, size);
            offset = {x: bounds.center.x * scale.x, y: bounds.center.y * scale.y, z: bounds.center.z * scale.z};
        }
        if (!made.shape) return null;
        const center = new THREE.Vector3(offset.x, offset.y, offset.z).applyQuaternion(quaternion);
        return {
            shape: made.shape,
            key: made.key,
            // Where the sprite's origin is, and how far its collider's center is from it
            origin: {x: position.x, y: position.y, z: position.z},
            offset,
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
     * @param {?Target3D|function(Target3D): boolean} [exclude] a sprite the ray ignores, usually the one it starts
     * in; or a function that is true for the sprites that it ignores
     * @returns {?{target: Target3D, distance: number, point: {x: number, y: number, z: number}}} the closest hit
     */
    raycast (origin, direction, maxDistance, exclude) {
        if (!this.RAPIER) return null;
        const length = Math.hypot(direction.x, direction.y, direction.z);
        if (!(length > 0) || !(maxDistance > 0)) return null;
        const dir = {x: direction.x / length, y: direction.y / length, z: direction.z / length};
        const ray = new this.RAPIER.Ray(origin, dir);
        let best = null;
        const skip = typeof exclude === 'function' ? exclude : target => target === exclude;
        for (const target of this.scene3D.targets) {
            if (skip(target)) continue;
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
            if (entry && settings.collide === false) {
                // Leaving collision out removes the body, so that it doesn't wake up or push anything
                this._removeBody(target, entry);
                entry = null;
            }
            const shape = this.getShape(target);
            if (!shape) {
                // Hidden sprites don't collide
                if (entry) entry.collider.setEnabled(false);
                continue;
            }
            const materialKey = `${settings.mass} ${settings.bounce} ${settings.friction}`;
            if (entry && entry.materialKey !== materialKey && entry.bodyType === settings.body) {
                // In place, so that it keeps moving and turning
                entry.materialKey = materialKey;
                entry.collider.setMass(settings.mass);
                entry.collider.setRestitution(settings.bounce);
                entry.collider.setFriction(settings.friction);
            }
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
                const colliderDesc = new RAPIER.ColliderDesc(shape.shape)
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
                    lockRotation: null,
                    groups: null,
                    damping: null
                };
                this._bodies.set(target, entry);
                this._colliderTargets.set(collider.handle, target);
            }
            entry.collider.setEnabled(true);
            const groups = this._interactionGroups(settings);
            if (entry.groups !== groups) {
                entry.groups = groups;
                entry.collider.setCollisionGroups(groups);
            }
            const damping = `${settings.linearDamping} ${settings.angularDamping}`;
            if (entry.damping !== damping) {
                entry.damping = damping;
                entry.body.setLinearDamping(settings.linearDamping);
                entry.body.setAngularDamping(settings.angularDamping);
            }
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
     * @returns {{body: string, sleeping: boolean}} how the sprite's body moves, and whether a dynamic body fell asleep
     */
    getBodyState (target) {
        const entry = this._bodies.get(target);
        return {
            body: target.physics.body,
            sleeping: !!entry && entry.bodyType === BODY_DYNAMIC && this.running && entry.body.isSleeping()
        };
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
     * @param {object} velocity some of {x, y, z}, in degrees per second around the world's axes; the others stay
     * the same
     */
    setAngularVelocity (target, velocity) {
        const body = this._dynamicBody(target);
        if (!body) return;
        const current = body.angvel();
        const degrees = sanitizeVector(velocity, {x: current.x / DEG, y: current.y / DEG, z: current.z / DEG});
        body.setAngvel({x: degrees.x * DEG, y: degrees.y * DEG, z: degrees.z * DEG}, true);
    }

    /**
     * @param {Target3D} target
     * @returns {{x: number, y: number, z: number}} how fast the sprite turns around the world's axes, in degrees
     * per second
     */
    getAngularVelocity (target) {
        const body = this._dynamicBody(target);
        if (!body) return {x: 0, y: 0, z: 0};
        const velocity = body.angvel();
        return {x: velocity.x / DEG, y: velocity.y / DEG, z: velocity.z / DEG};
    }

    /**
     * @param {Target3D} target
     * @param {{x: number, y: number, z: number}} torque applied during the next step only, like a force
     */
    applyTorque (target, torque) {
        const body = this._dynamicBody(target);
        if (body) body.addTorque(sanitizeVector(torque, {x: 0, y: 0, z: 0}), true);
    }

    /**
     * @param {Target3D} target
     * @param {{x: number, y: number, z: number}} impulse a sudden twist, like an impulse
     */
    applyTorqueImpulse (target, impulse) {
        const body = this._dynamicBody(target);
        if (body) body.applyTorqueImpulse(sanitizeVector(impulse, {x: 0, y: 0, z: 0}), true);
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
     * @param {Target3D} a
     * @param {Target3D} b
     * @returns {{speed: number, impulse: number, point: {x: number, y: number, z: number}}} how hard two sprites
     * that just started or stopped touching hit each other: how fast they came together along the contact normal
     * (units per second), the impulse that pushed them apart, and where they touch (between them if they don't)
     */
    _collisionInfo (a, b) {
        const entryA = this._bodies.get(a);
        const entryB = this._bodies.get(b);
        const zero = {x: 0, y: 0, z: 0};
        const va = (entryA && entryA.velocityBefore) || zero;
        const vb = (entryB && entryB.velocityBefore) || zero;
        const relative = {x: va.x - vb.x, y: va.y - vb.y, z: va.z - vb.z};
        let normal = null;
        let point = null;
        let impulse = 0;
        if (entryA && entryB) {
            this.world.contactPair(entryA.collider, entryB.collider, manifold => {
                if (!normal) normal = manifold.normal();
                for (let i = 0; i < manifold.numContacts(); i++) impulse += manifold.contactImpulse(i);
                if (!point && manifold.numSolverContacts() > 0) point = manifold.solverContactPoint(0);
            });
        }
        let speed;
        if (normal) {
            speed = Math.abs((relative.x * normal.x) + (relative.y * normal.y) + (relative.z * normal.z));
        } else {
            speed = Math.hypot(relative.x, relative.y, relative.z);
        }
        if (!point) {
            const pa = a.getWorldPosition();
            const pb = b.getWorldPosition();
            point = {x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2, z: (pa.z + pb.z) / 2};
        }
        return {speed, impulse, point: {x: point.x, y: point.y, z: point.z}};
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
        // How fast bodies moved before they hit anything, for how hard they hit (see _collisionInfo)
        for (const entry of this._bodies.values()) {
            const velocity = entry.bodyType === BODY_DYNAMIC ? entry.body.linvel() : null;
            entry.velocityBefore = velocity ? {x: velocity.x, y: velocity.y, z: velocity.z} : {x: 0, y: 0, z: 0};
        }
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
            const info = this._collisionInfo(a, b);
            for (const [self, other] of [[a, b], [b, a]]) {
                if (!this.runtime.targets.includes(self)) continue;
                const collision = Object.assign({other}, info);
                self.lastCollision3D = collision;
                // The scripts that start read this collision, even if another one happens before they get to it
                const threads = [
                    ...(this.runtime.startHats(opcode, {TARGET: other.sprite.name}, self) || []),
                    ...(this.runtime.startHats(opcode, {TARGET: '_any_'}, self) || [])
                ];
                for (const thread of threads) thread.collision3D = collision;
            }
        }
    }
}

module.exports = Physics3D;

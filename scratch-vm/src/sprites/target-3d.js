const RenderedTarget = require('./rendered-target');
const StageLayering = require('../engine/stage-layering');
const Scene3D = require('../engine/scene-3d');
const Clone = require('../util/clone');
const StringUtil = require('../util/string-util');
const Cast = require('../util/cast');
const {getSize} = require('../extensions/tw_3d/replacements');
const Physics3D = require('../engine/scene-3d-physics');

const DEG = Math.PI / 180;

const finite = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

/**
 * Keep an angle in (-180, 180], like 2D directions.
 * @param {number} degrees angle
 * @returns {number} same angle
 */
const wrapAngle = degrees => {
    const wrapped = ((degrees % 360) + 360) % 360;
    return wrapped > 180 ? wrapped - 360 : wrapped;
};

/**
 * @param {object} material possibly partial or invalid material
 * @param {object} base complete material
 * @returns {object} complete material
 */
const mergeMaterial = (material, base) => {
    const result = Object.assign({}, base);
    if (!material || typeof material !== 'object') return result;
    if (typeof material.color === 'string' && /^#[0-9a-f]{6}$/i.test(material.color)) {
        result.color = material.color.toLowerCase();
    }
    if (typeof material.opacity !== 'undefined') {
        result.opacity = Math.max(0, Math.min(1, finite(material.opacity, result.opacity)));
    }
    if (typeof material.texture === 'string') result.texture = material.texture;
    return result;
};

/**
 * @param {object} model possibly invalid model
 * @returns {?object} {name, shape} or {name, file}, or null
 */
const sanitizeModel = model => {
    if (!model || typeof model !== 'object') return null;
    const name = typeof model.name === 'string' ? model.name : '';
    if (typeof model.file === 'string' && model.file) return {name: name || model.file, file: model.file};
    const shape = Scene3D.SHAPES.includes(model.shape) ? model.shape : 'cube';
    return {name: name || shape, shape};
};

/**
 * A 3D sprite or clone. Its object lives in the runtime's Scene3D.
 *
 * It is a RenderedTarget so that scripts, variables, sounds, clones and the editor's sprite list work the same as
 * for 2D sprites, but its 2D drawable is always hidden. x and y are 3D coordinates (y up) and z is depth.
 * Rotation is in degrees, applied yaw (y) first, then pitch (x), then roll (z).
 */
class Target3D extends RenderedTarget {
    constructor (sprite, runtime) {
        super(sprite, runtime);
        this.is3D = true;
        this.z = 0;
        this.rotationX = 0;
        this.rotationY = 0;
        this.rotationZ = 0;
        this.scaleX = 1;
        this.scaleY = 1;
        this.scaleZ = 1;
        /** Index in sprite.models */
        this.currentModel = 0;
        this.material = Scene3D.defaultMaterial();
        /** @type {?THREE.Group} set by Scene3D once three.js is running */
        this.object3D = null;
        /**
         * The 3D sprite or clone this one is attached to. Position, rotation and scale are then relative to it, like
         * three.js children; see getWorldPose() for where it is in the world.
         * @type {?Target3D}
         */
        this.parent3D = null;
        /** Changes whenever position, rotation, scale or visibility change, so that physics notices */
        this.transformVersion = 0;
        /** How the sprite collides, see Physics3D */
        this.physics = Physics3D.defaultSettings();
        /**
         * The GLTF animation the sprite plays or played last: {name, loop, time, playing}, see Scene3D.playAnimation
         * @type {?object}
         */
        this.animation = null;
        /** How fast animations play; negative plays them backwards */
        this.animationSpeed = 1;
        /**
         * 3D sound: whether the sprite's sounds come from where it is, and within what distance they play at full
         * volume (ROADMAP.md 6.8)
         */
        this.sound3D = {enabled: true, distance: 5};
    }

    get kind () {
        return '3d';
    }

    initDrawable (layerGroup) {
        super.initDrawable(layerGroup);
        this._hideDrawable();
        this.runtime.scene3D.addTarget(this);
    }

    _hideDrawable () {
        if (this.renderer && this.drawableID !== null) {
            this.renderer.updateDrawableVisible(this.drawableID, false);
            this.renderer.markDrawableAsNoninteractive(this.drawableID);
        }
    }

    _updateTransform () {
        this.transformVersion++;
        // The object is updated once per frame however often blocks move the sprite, and so is the speech bubble
        // (see Scene3D._updateBubbles)
        this.runtime.scene3D.markTransformDirty(this);
        this.runtime.requestTargetsUpdate(this);
    }

    // Attaching to other 3D sprites, and where the sprite is in the world

    /**
     * @returns {THREE.Matrix4} position, rotation and scale relative to the parent (or the world)
     */
    getLocalMatrix () {
        const THREE = this.runtime.scene3D.THREE;
        const rotation = new THREE.Euler(this.rotationX * DEG, this.rotationY * DEG, this.rotationZ * DEG, 'YXZ');
        return new THREE.Matrix4().compose(
            new THREE.Vector3(this.x, this.y, this.z),
            new THREE.Quaternion().setFromEuler(rotation),
            new THREE.Vector3(this.scaleX, this.scaleY, this.scaleZ)
        );
    }

    /**
     * @returns {THREE.Matrix4} position, rotation and scale in the world
     */
    getWorldMatrix () {
        const local = this.getLocalMatrix();
        return this.parent3D ? this.parent3D.getWorldMatrix().multiply(local) : local;
    }

    /**
     * @returns {{x: number, y: number, z: number}} where the sprite is in the world
     */
    getWorldPosition () {
        if (!this.parent3D) return {x: this.x, y: this.y, z: this.z};
        const e = this.getWorldMatrix().elements;
        return {x: e[12], y: e[13], z: e[14]};
    }

    /**
     * @param {THREE.Matrix4} matrix
     * @returns {object} {x, y, z, yaw, pitch, roll, scaleX, scaleY, scaleZ} of the matrix, angles in degrees
     */
    _decompose (matrix) {
        const THREE = this.runtime.scene3D.THREE;
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        matrix.decompose(position, quaternion, scale);
        const rotation = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ');
        const clean = n => Math.round(n * 1e9) / 1e9;
        return {
            x: clean(position.x),
            y: clean(position.y),
            z: clean(position.z),
            pitch: clean(rotation.x / DEG),
            yaw: clean(rotation.y / DEG),
            roll: clean(rotation.z / DEG),
            scaleX: clean(scale.x),
            scaleY: clean(scale.y),
            scaleZ: clean(scale.z)
        };
    }

    /**
     * @returns {{x: number, y: number, z: number, yaw: number, pitch: number, roll: number}} where the sprite is in
     * the world and which way it faces there, in degrees
     */
    getWorldPose () {
        if (!this.parent3D) {
            return {x: this.x, y: this.y, z: this.z, yaw: this.rotationY, pitch: this.rotationX, roll: this.rotationZ};
        }
        return this._decompose(this.getWorldMatrix());
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {{x: number, y: number, z: number}} the world point relative to the parent, where setXYZ puts it
     */
    worldToLocal (x, y, z) {
        if (!this.parent3D) return {x, y, z};
        const THREE = this.runtime.scene3D.THREE;
        const point = new THREE.Vector3(x, y, z).applyMatrix4(this.parent3D.getWorldMatrix().invert());
        return {x: point.x, y: point.y, z: point.z};
    }

    /**
     * Move to a point in the world.
     * @param {number} x
     * @param {number} y
     * @param {number} z
     */
    setWorldPosition (x, y, z) {
        const local = this.worldToLocal(finite(x, 0), finite(y, 0), finite(z, 0));
        this.setXYZ(local.x, local.y, local.z);
    }

    /**
     * Put the sprite somewhere in the world, facing some way there. Missing parts stay as they are in the world.
     * @param {object} pose some of {x, y, z, yaw, pitch, roll}, angles in degrees
     */
    setWorldPose (pose) {
        if (!this.parent3D) {
            const current = this.getWorldPose();
            const get = key => finite(pose[key], current[key]);
            this.setXYZ(get('x'), get('y'), get('z'));
            this.setRotation(get('pitch'), get('yaw'), get('roll'));
            return;
        }
        const THREE = this.runtime.scene3D.THREE;
        const current = this.getWorldPose();
        const get = key => finite(pose[key], current[key]);
        const world = new THREE.Matrix4().compose(
            new THREE.Vector3(get('x'), get('y'), get('z')),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(get('pitch') * DEG, get('yaw') * DEG,
                get('roll') * DEG, 'YXZ')),
            new THREE.Vector3(1, 1, 1)
        );
        const toParent = this.parent3D.getWorldMatrix().invert();
        const local = this._decompose(toParent.multiply(world));
        this.setXYZ(local.x, local.y, local.z);
        this.setRotation(local.pitch, local.yaw, local.roll);
    }

    /**
     * Attach to another 3D sprite (or clone), or detach with null. The sprite stays where it is in the world; from
     * then on it moves, turns and scales with its parent.
     * @param {?Target3D} parent
     * @returns {boolean} true if it worked; a sprite can't be attached to itself or to one attached to it
     */
    setParent3D (parent) {
        if (parent === this.parent3D) return true;
        if (parent) {
            if (!parent.is3D) return false;
            for (let ancestor = parent; ancestor; ancestor = ancestor.parent3D) {
                if (ancestor === this) return false;
            }
        }
        const world = this.getWorldMatrix();
        const toParent = parent ? parent.getWorldMatrix().invert() : null;
        const local = this._decompose(toParent ? toParent.multiply(world) : world);
        this.parent3D = parent || null;
        this.x = local.x;
        this.y = local.y;
        this.z = local.z;
        this.rotationX = wrapAngle(local.pitch);
        this.rotationY = wrapAngle(local.yaw);
        this.rotationZ = wrapAngle(local.roll);
        this.scaleX = local.scaleX;
        this.scaleY = local.scaleY;
        this.scaleZ = local.scaleZ;
        this.runtime.scene3D.updateTargetParent(this);
        this._updateTransform();
        if (this.onTargetMoved) this.onTargetMoved(this, this.x, this.y, true);
        return true;
    }

    /**
     * @returns {Target3D[]} the sprites and clones attached to this one
     */
    getChildren3D () {
        return Array.from(this.runtime.scene3D.targets).filter(target => target.parent3D === this);
    }

    /**
     * The value of the spatial3d sound effect (see engine/spatial-audio-effect.js), which scratch-audio reads from
     * the target when a sound plays.
     * @returns {?{x: number, y: number, z: number, distance: number}} where the sprite's sounds come from, or null
     * if they aren't 3D
     */
    get spatial3d () {
        if (!this.sound3D.enabled || this.isCamera) return null;
        const position = this.getWorldPosition();
        return {x: position.x, y: position.y, z: position.z, distance: this.sound3D.distance};
    }

    /**
     * @param {object} changes some of {enabled, distance}
     */
    setSound3D (changes) {
        const distance = Number(changes.distance);
        this.sound3D = {
            enabled: typeof changes.enabled === 'boolean' ? changes.enabled : this.sound3D.enabled,
            distance: Number.isFinite(distance) ? Math.max(0.01, distance) : this.sound3D.distance
        };
        const soundBank = this.sprite.soundBank;
        if (soundBank) soundBank.setEffects(this);
    }

    // How 2D blocks see a 3D sprite: where it is drawn on the stage

    /**
     * @returns {{x: number, y: number}} where the sprite appears on the 2D stage
     */
    getStagePosition () {
        const {x, y} = this.runtime.scene3D.projectTarget(this);
        return {x, y};
    }

    /**
     * @returns {{left: number, right: number, top: number, bottom: number}} rectangle around the sprite on the stage
     */
    getBounds () {
        return this.runtime.scene3D.getStageBounds(this);
    }

    /**
     * @returns {{left: number, right: number, top: number, bottom: number}} the top edge of getBounds(), so that
     * speech bubbles sit on top of the sprite
     */
    getBoundsForBubble () {
        const bounds = this.getBounds();
        return {left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.top};
    }

    /**
     * @param {string} property a property of the "[property] of [sprite]" block, see BlockSupport.ATTRIBUTES_3D
     * @returns {*} its value, or undefined if 3D sprites don't have it (then it is a variable name)
     */
    getAttribute (property) {
        switch (property) {
        case 'x position': return this.x;
        case 'y position': return this.y;
        case 'z position': return this.z;
        case 'yaw': return this.rotationY;
        case 'pitch': return this.rotationX;
        case 'roll': return this.rotationZ;
        case 'model #': return this.currentModel + 1;
        case 'model name': {
            const model = this.getCurrentModel();
            return model ? model.name : '';
        }
        case 'scale': return getSize(this) / 100;
        case 'opacity': return Math.round(this.material.opacity * 1000) / 10;
        case 'volume': return this.volume;
        }
    }

    // Touching only works between sprites of the same kind

    /**
     * @param {string} requestedObject '_mouse_', '_edge_', '_any_' (any 3D sprite) or a sprite name
     * @returns {boolean} true if touching
     */
    isTouchingObject (requestedObject) {
        if (requestedObject === '_mouse_') return this.runtime.scene3D.isMouseOver(this);
        if (requestedObject === '_edge_') return false;
        return this.isTouchingSprite(requestedObject);
    }

    /**
     * Uses the colliders of the sprites (Rapier shapes, see Physics3D). Until Rapier is loaded, which starts now,
     * nothing touches; the touching blocks wait for it instead.
     * @param {string} spriteName name of a 3D sprite, or '_any_' for any other 3D sprite or clone
     * @returns {boolean} true if touching the sprite or one of its clones
     */
    isTouchingSprite (spriteName) {
        const physics = this.runtime.scene3D.physics;
        if (!physics.ready) {
            physics.load();
            return false;
        }
        let others;
        if (spriteName === '_any_') {
            others = Array.from(this.runtime.scene3D.targets);
        } else {
            const sprite = this.runtime.getSpriteTargetByName(Cast.toString(spriteName));
            if (!sprite || !sprite.is3D) return false;
            others = sprite.sprite.clones;
        }
        for (const other of others) {
            if (other === this || other.dragging) continue;
            if (physics.isTouching(this, other)) return true;
        }
        return false;
    }

    isTouchingPoint () {
        return false;
    }

    isTouchingEdge () {
        return false;
    }

    isTouchingColor () {
        return false;
    }

    colorIsTouchingColor () {
        return false;
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {?boolean} force Force setting X/Y, in case of dragging
     */
    setXY (x, y, force) {
        if (this.dragging && !force) return;
        const oldX = this.x;
        const oldY = this.y;
        this.x = finite(x, this.x);
        this.y = finite(y, this.y);
        this._updateTransform();
        if (this.onTargetMoved) {
            this.onTargetMoved(this, oldX, oldY, force);
        }
    }

    setXYZ (x, y, z) {
        this.z = finite(z, this.z);
        this.setXY(x, y, true);
    }

    setZ (z) {
        this.z = finite(z, this.z);
        this._updateTransform();
    }

    setRotation (x, y, z) {
        this.rotationX = wrapAngle(finite(x, this.rotationX));
        this.rotationY = wrapAngle(finite(y, this.rotationY));
        this.rotationZ = wrapAngle(finite(z, this.rotationZ));
        this._updateTransform();
    }

    setScale (x, y, z) {
        this.scaleX = finite(x, this.scaleX);
        this.scaleY = finite(y, this.scaleY);
        this.scaleZ = finite(z, this.scaleZ);
        this._updateTransform();
    }

    /**
     * @returns {{x: number, y: number, z: number}} unit vector the sprite faces. At yaw 0 and pitch 0 that is -z,
     * like the camera: away from the default camera, into the screen. Positive yaw turns left (counterclockwise
     * seen from above) and positive pitch looks up, the same as the camera's.
     */
    getForward () {
        const yaw = this.rotationY * Math.PI / 180;
        const pitch = this.rotationX * Math.PI / 180;
        return {
            x: -Math.sin(yaw) * Math.cos(pitch),
            y: Math.sin(pitch),
            z: -Math.cos(yaw) * Math.cos(pitch)
        };
    }

    /**
     * @param {number} steps distance to move in the direction the sprite faces; negative moves back
     */
    moveForward (steps) {
        steps = finite(steps, 0);
        const forward = this.getForward();
        this.setXYZ(this.x + (forward.x * steps), this.y + (forward.y * steps), this.z + (forward.z * steps));
    }

    /**
     * Move level with the ground, like walking in a first-person game: only the yaw counts, so looking up or down
     * doesn't make the sprite fly or sink.
     * @param {string} direction 'forward', 'back', 'left', 'right', 'up' or 'down'
     * @param {number} steps distance to move; negative moves the other way
     */
    moveLevel (direction, steps) {
        steps = finite(steps, 0);
        const yaw = this.rotationY * Math.PI / 180;
        // Forward is -z at yaw 0, and right is +x
        const forwardX = -Math.sin(yaw);
        const forwardZ = -Math.cos(yaw);
        let dx = 0;
        let dy = 0;
        let dz = 0;
        switch (direction) {
        case 'forward': dx = forwardX; dz = forwardZ; break;
        case 'back': dx = -forwardX; dz = -forwardZ; break;
        case 'right': dx = -forwardZ; dz = forwardX; break;
        case 'left': dx = forwardZ; dz = -forwardX; break;
        case 'up': dy = 1; break;
        case 'down': dy = -1; break;
        default: return;
        }
        this.setXYZ(this.x + (dx * steps), this.y + (dy * steps), this.z + (dz * steps));
    }

    /**
     * Turn to face a point in the world, keeping the roll.
     * @param {number} x
     * @param {number} y
     * @param {number} z
     */
    lookAt (x, y, z) {
        // Angles are relative to the parent, so the point is too
        const point = this.worldToLocal(finite(x, this.x), finite(y, this.y), finite(z, this.z));
        const dx = point.x - this.x;
        const dy = point.y - this.y;
        const dz = point.z - this.z;
        if (dx === 0 && dy === 0 && dz === 0) return;
        // The inverse of getForward()
        const yaw = Math.atan2(-dx, -dz) * 180 / Math.PI;
        const pitch = Math.atan2(dy, Math.sqrt((dx * dx) + (dz * dz))) * 180 / Math.PI;
        this.setRotation(pitch, yaw, this.rotationZ);
    }

    setVisible (visible) {
        this.visible = !!visible;
        this._updateTransform();
    }

    /**
     * @returns {object[]} models shared by the sprite and its clones
     */
    getModels () {
        return this.sprite.models;
    }

    /**
     * @returns {?object} {name, shape} or {name, file}
     */
    getCurrentModel () {
        return this.sprite.models[this.currentModel] || null;
    }

    /**
     * @param {number} index index in the model list; wraps around like costumes
     */
    setModel (index) {
        const count = this.sprite.models.length;
        if (count === 0) return;
        index = Math.round(finite(index, 0));
        index = ((index % count) + count) % count;
        if (index === this.currentModel) return;
        this.currentModel = index;
        this.runtime.scene3D.updateTargetModel(this);
        this.runtime.requestTargetsUpdate(this);
    }

    /**
     * @param {string} name wanted name
     * @param {number} [exceptIndex] index of a model whose name doesn't count as used
     * @returns {string} name that no other model of the sprite has
     */
    _unusedModelName (name, exceptIndex) {
        const used = this.sprite.models
            .filter((model, index) => index !== exceptIndex)
            .map(model => model.name);
        return StringUtil.unusedName(name, used);
    }

    /**
     * @returns {Map<Target3D, ?object>} the model each copy of the sprite shows, see _modelsChanged
     */
    _currentModels () {
        return new Map(this.sprite.clones.map(clone => [clone, clone.getCurrentModel()]));
    }

    /**
     * After the model list changed, keep every copy of the sprite on the model it showed and rebuild its object.
     * @param {Map<Target3D, ?object>} before from _currentModels, taken before the change
     * @param {number} [fallback] index for copies whose model is gone
     */
    _modelsChanged (before, fallback) {
        const models = this.sprite.models;
        const count = models.length;
        for (const clone of this.sprite.clones) {
            let index = models.indexOf(before.get(clone));
            if (index === -1) index = typeof fallback === 'number' ? fallback : clone.currentModel;
            clone.currentModel = count ? Math.max(0, Math.min(count - 1, index)) : 0;
            clone._refreshModel();
        }
        this.runtime.requestTargetsUpdate(this);
    }

    /**
     * @param {object} model {name, shape} or {name, file}
     * @param {number} [index] where to insert it; the end by default
     * @returns {number} index of the new model, or -1 if it is invalid
     */
    addModel (model, index) {
        model = sanitizeModel(model);
        if (!model) return -1;
        const models = this.sprite.models;
        const before = this._currentModels();
        model.name = this._unusedModelName(model.name);
        if (typeof index !== 'number' || index < 0 || index > models.length) index = models.length;
        models.splice(index, 0, model);
        this._modelsChanged(before);
        return index;
    }

    /**
     * @param {number} index
     * @returns {?object} the deleted model, or null if there is none or it is the only one
     */
    deleteModel (index) {
        const models = this.sprite.models;
        if (models.length <= 1 || !models[index]) return null;
        const before = this._currentModels();
        const [deleted] = models.splice(index, 1);
        // Like costumes: copies that showed it show the one before it
        this._modelsChanged(before, index - 1);
        return deleted;
    }

    /**
     * @param {number} index
     * @param {string} name
     */
    renameModel (index, name) {
        const model = this.sprite.models[index];
        if (!model || typeof name !== 'string') return;
        model.name = this._unusedModelName(name, index);
        this.runtime.requestTargetsUpdate(this);
    }

    /**
     * @param {number} index
     * @returns {number} index of the copy, or -1
     */
    duplicateModel (index) {
        const model = this.sprite.models[index];
        if (!model) return -1;
        return this.addModel(Object.assign({}, model), index + 1);
    }

    /**
     * @param {number} from
     * @param {number} to
     * @returns {boolean} true if anything moved
     */
    reorderModel (from, to) {
        const models = this.sprite.models;
        const clamp = n => Math.max(0, Math.min(models.length - 1, n));
        from = clamp(from);
        to = clamp(to);
        if (from === to) return false;
        const before = this._currentModels();
        const [model] = models.splice(from, 1);
        models.splice(to, 0, model);
        this._modelsChanged(before);
        return true;
    }

    /**
     * Change what a model shows, keeping its name.
     * @param {number} index
     * @param {object} source {shape} or {file}
     */
    setModelSource (index, source) {
        const model = this.sprite.models[index];
        const sanitized = sanitizeModel(Object.assign({name: model ? model.name : ''}, source));
        if (!model || !sanitized) return;
        delete model.shape;
        delete model.file;
        Object.assign(model, sanitized, {name: model.name});
        this._modelsChanged(this._currentModels());
    }

    _refreshModel () {
        this.runtime.scene3D.updateTargetModel(this);
    }

    /**
     * @param {object} changes partial material, e.g. {color: '#ff0000'}
     */
    setMaterial (changes) {
        this.material = mergeMaterial(changes, this.material);
        this.runtime.scene3D.updateTargetModel(this);
        this.runtime.requestTargetsUpdate(this);
    }

    updateAllDrawableProperties () {
        super.updateAllDrawableProperties();
        this._hideDrawable();
        this.runtime.scene3D.updateTargetTransform(this);
    }

    /**
     * Copy the 3D state of another target.
     * @param {Target3D} other
     */
    _copy3DState (other) {
        this.z = other.z;
        this.rotationX = other.rotationX;
        this.rotationY = other.rotationY;
        this.rotationZ = other.rotationZ;
        this.scaleX = other.scaleX;
        this.scaleY = other.scaleY;
        this.scaleZ = other.scaleZ;
        this.currentModel = other.currentModel;
        this.material = Object.assign({}, other.material);
        this.physics = Object.assign({}, other.physics);
        this.animation = other.animation ? Object.assign({}, other.animation) : null;
        this.animationSpeed = other.animationSpeed;
        this.sound3D = Object.assign({}, other.sound3D);
    }

    /**
     * Clones share the sprite's geometry and, while their materials are the same, materials too.
     * @returns {?Target3D} New clone, or null at the clone limit.
     */
    makeClone () {
        if (!this.runtime.clonesAvailable() || this.isStage) {
            return null;
        }
        this.runtime.changeCloneCounter(1);
        const newClone = this.sprite.createClone();
        newClone.x = this.x;
        newClone.y = this.y;
        newClone.direction = this.direction;
        newClone.draggable = this.draggable;
        newClone.visible = this.visible;
        newClone.size = this.size;
        newClone.currentCostume = this.currentCostume;
        newClone.rotationStyle = this.rotationStyle;
        newClone.effects = Clone.simple(this.effects);
        newClone.variables = this.duplicateVariables();
        newClone._edgeActivatedHatValues = Clone.simple(this._edgeActivatedHatValues);
        newClone._copy3DState(this);
        // Attached to the same sprite, before its object is made
        newClone.parent3D = this.parent3D;
        newClone.initDrawable(StageLayering.SPRITE_LAYER);
        newClone.updateAllDrawableProperties();
        return newClone;
    }

    duplicate () {
        return super.duplicate().then(newTarget => {
            newTarget._copy3DState(this);
            // Next to the original instead of somewhere on the 2D stage
            newTarget.x = this.x + 1;
            newTarget.y = this.y;
            newTarget.updateAllDrawableProperties();
            newTarget._refreshModel();
            return newTarget;
        });
    }

    postSpriteInfo (data) {
        const has = key => Object.prototype.hasOwnProperty.call(data, key);
        super.postSpriteInfo(data);
        if (has('z')) this.setZ(data.z);
        if (has('rotationX') || has('rotationY') || has('rotationZ')) {
            this.setRotation(
                has('rotationX') ? data.rotationX : this.rotationX,
                has('rotationY') ? data.rotationY : this.rotationY,
                has('rotationZ') ? data.rotationZ : this.rotationZ
            );
        }
        if (has('scaleX') || has('scaleY') || has('scaleZ')) {
            this.setScale(
                has('scaleX') ? data.scaleX : this.scaleX,
                has('scaleY') ? data.scaleY : this.scaleY,
                has('scaleZ') ? data.scaleZ : this.scaleZ
            );
        }
        if (has('currentModel')) this.setModel(data.currentModel);
        if (has('material')) this.setMaterial(data.material);
    }

    toJSON () {
        const json = super.toJSON();
        json.kind = '3d';
        json.z = this.z;
        json.rotationX = this.rotationX;
        json.rotationY = this.rotationY;
        json.rotationZ = this.rotationZ;
        json.scaleX = this.scaleX;
        json.scaleY = this.scaleY;
        json.scaleZ = this.scaleZ;
        json.models = this.sprite.models.map(model => Object.assign({}, model));
        json.currentModel = this.currentModel;
        json.material = Object.assign({}, this.material);
        json.physics = Object.assign({}, this.physics);
        json.parent3D = this.parent3D ? this.parent3D.getName() : null;
        return json;
    }

    /**
     * @returns {object} the 3D fields of this target in a .3dsb project.json
     */
    serialize3D () {
        return {
            position: {x: this.x, y: this.y, z: this.z},
            rotation: {x: this.rotationX, y: this.rotationY, z: this.rotationZ},
            scale: {x: this.scaleX, y: this.scaleY, z: this.scaleZ},
            visible: this.visible,
            models: this.sprite.models.map(model => Object.assign({}, model)),
            currentModel: this.currentModel,
            material: Object.assign({}, this.material),
            physics: Object.assign({}, this.physics),
            sound3D: Object.assign({}, this.sound3D),
            // Clones aren't saved, so only attaching to sprites is
            parent: this.parent3D && this.parent3D.isOriginal ? this.parent3D.getName() : null
        };
    }

    /**
     * Load the 3D fields of a .3dsb target.
     * @param {object} object target from project.json
     */
    load3D (object) {
        const vector = (value, fallback) => ({
            x: finite(value && value.x, fallback),
            y: finite(value && value.y, fallback),
            z: finite(value && value.z, fallback)
        });
        const position = vector(object.position, 0);
        const rotation = vector(object.rotation, 0);
        const scale = vector(object.scale, 1);
        this.x = position.x;
        this.y = position.y;
        this.z = position.z;
        this.rotationX = wrapAngle(rotation.x);
        this.rotationY = wrapAngle(rotation.y);
        this.rotationZ = wrapAngle(rotation.z);
        this.scaleX = scale.x;
        this.scaleY = scale.y;
        this.scaleZ = scale.z;
        if (typeof object.visible === 'boolean') this.visible = object.visible;
        this.sprite.models = (Array.isArray(object.models) ? object.models : [])
            .map(sanitizeModel)
            .filter(model => model);
        const count = this.sprite.models.length;
        this.currentModel = count ? Math.max(0, Math.min(count - 1, Math.round(finite(object.currentModel, 0)))) : 0;
        this.material = mergeMaterial(object.material, Scene3D.defaultMaterial());
        this.physics = Physics3D.sanitizeSettings(object.physics);
        this.sound3D = {enabled: true, distance: 5};
        if (object.sound3D && typeof object.sound3D === 'object') this.setSound3D(object.sound3D);
        // Attached once every sprite of the project is loaded, see Scene3D.onProjectLoaded
        this._parentName = typeof object.parent === 'string' ? object.parent : null;
        this.runtime.scene3D.updateTargetTransform(this);
        this.runtime.scene3D.updateTargetModel(this);
    }

    dispose () {
        // What was attached to it stays where it is
        for (const child of this.getChildren3D()) child.setParent3D(null);
        this.parent3D = null;
        this.runtime.scene3D.removeTarget(this);
        super.dispose();
    }
}

Target3D.sanitizeModel = sanitizeModel;

module.exports = Target3D;

const RenderedTarget = require('./rendered-target');
const StageLayering = require('../engine/stage-layering');
const Scene3D = require('../engine/scene-3d');
const Clone = require('../util/clone');

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
        this.runtime.scene3D.updateTargetTransform(this);
        this.runtime.requestTargetsUpdate(this);
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
     * @param {object} model {name, shape} or {name, file}
     * @returns {number} index of the new model
     */
    addModel (model) {
        model = sanitizeModel(model);
        if (!model) return -1;
        this.sprite.models.push(model);
        if (this.sprite.models.length === 1) {
            this.currentModel = 0;
            for (const clone of this.sprite.clones) clone._refreshModel();
        }
        this.runtime.requestTargetsUpdate(this);
        return this.sprite.models.length - 1;
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
            material: Object.assign({}, this.material)
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
        this.runtime.scene3D.updateTargetTransform(this);
        this.runtime.scene3D.updateTargetModel(this);
    }

    dispose () {
        this.runtime.scene3D.removeTarget(this);
        super.dispose();
    }
}

Target3D.sanitizeModel = sanitizeModel;

module.exports = Target3D;

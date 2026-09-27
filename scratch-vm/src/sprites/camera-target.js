const Target3D = require('./target-3d');

const DEFAULT_FOV = 60;

/**
 * @param {*} value
 * @param {number} fallback
 * @returns {number} field of view in degrees, from 1 to 179
 */
const clampFov = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(1, Math.min(179, n)) : fallback;
};

/**
 * A camera sprite. It is a 3D sprite without a model: the 3D motion blocks move and turn it like any 3D sprite, and
 * the stage shows what the current camera (see Scene3D.getActiveCamera) sees. It faces the same way as 3D sprites,
 * -z at yaw 0 and pitch 0 (see "Directions" in ROADMAP.md).
 *
 * It has no scale, can't be shown or hidden, touches nothing and can't be cloned. In the editor its frustum is drawn
 * so that it can be picked and moved; the game view never shows it.
 */
class CameraTarget extends Target3D {
    constructor (sprite, runtime) {
        super(sprite, runtime);
        this.isCamera = true;
        /** Vertical field of view in degrees */
        this.fov = DEFAULT_FOV;
    }

    get kind () {
        return 'camera';
    }

    static get DEFAULT_FOV () {
        return DEFAULT_FOV;
    }

    /**
     * @param {number} fov vertical field of view in degrees, from 1 to 179
     */
    setFov (fov) {
        this.fov = clampFov(fov, this.fov);
        this.runtime.scene3D.updateTargetModel(this);
        this.runtime.requestTargetsUpdate(this);
    }

    getAttribute (property) {
        if (property === 'fov') return this.fov;
        if (['model #', 'model name', 'scale', 'opacity'].includes(property)) return;
        return super.getAttribute(property);
    }

    // Cameras have no size and are never hidden

    setScale () {}

    setVisible () {}

    setMaterial () {}

    setModel () {}

    isTouchingObject () {
        return false;
    }

    isTouchingSprite () {
        return false;
    }

    makeClone () {
        return null;
    }

    _copy3DState (other) {
        super._copy3DState(other);
        if (other.isCamera) this.fov = other.fov;
    }

    postSpriteInfo (data) {
        const has = key => Object.prototype.hasOwnProperty.call(data, key);
        // Scale, visibility, models and material don't apply
        const allowed = Object.assign({}, data);
        for (const key of ['scaleX', 'scaleY', 'scaleZ', 'visible', 'currentModel', 'material', 'size']) {
            delete allowed[key];
        }
        super.postSpriteInfo(allowed);
        if (has('fov')) this.setFov(data.fov);
        if (has('active') && data.active) this.runtime.scene3D.setActiveCamera(this);
    }

    toJSON () {
        const json = super.toJSON();
        json.kind = 'camera';
        json.fov = this.fov;
        json.active = this.runtime.scene3D.getActiveCamera() === this;
        delete json.models;
        delete json.material;
        return json;
    }

    serialize3D () {
        return {
            position: {x: this.x, y: this.y, z: this.z},
            rotation: {x: this.rotationX, y: this.rotationY, z: this.rotationZ},
            fov: this.fov
        };
    }

    load3D (object) {
        const unused = {scale: {x: 1, y: 1, z: 1}, visible: true, models: [], material: null};
        super.load3D(Object.assign({}, object, unused));
        this.visible = true;
        this.fov = clampFov(object.fov, DEFAULT_FOV);
        this.runtime.scene3D.updateTargetModel(this);
    }
}

module.exports = CameraTarget;

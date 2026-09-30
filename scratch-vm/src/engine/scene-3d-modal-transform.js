// Blender-style modal transforms for the 3D editor: press G (move), R (rotate) or S (scale) with the pointer over
// the stage and the selected sprite follows the mouse. X / Y / Z lock to an axis (again for the sprite's own axis,
// again to unlock), Shift + X / Y / Z lock to the plane without that axis, typing a number sets the exact amount,
// Ctrl snaps. Left click or Enter confirms; right click or Esc puts the sprite back. Rotating shows the rotation
// sphere (scene-3d-rotate-sphere.js).

const {AXIS_COLORS, RotateSphere} = require('./scene-3d-rotate-sphere');

const TYPES = {
    grab: {text: '移動', snap: 1},
    rotate: {text: '旋轉', snap: 5},
    scale: {text: '縮放', snap: 0.1}
};
const AXES = ['x', 'y', 'z'];
// Half the length of the constraint lines
const LINE_LENGTH = 1000;
// Pixels between the sprite's center and the pointer below which rotating and scaling aren't reliable
const MIN_RADIUS = 1;

const round = (value, step) => Math.round(value / step) * step;
const format = value => {
    const rounded = Math.round(value * 1000) / 1000;
    return Object.is(rounded, -0) ? '0' : String(rounded);
};

class ModalTransform {
    /**
     * @param {Editor3D} editor
     * @param {string} type 'grab', 'rotate' or 'scale'
     * @param {Target3D} target
     * @param {{x: number, y: number}} pointer client coordinates of the pointer
     */
    constructor (editor, type, target, pointer) {
        const THREE = editor.THREE;
        this.editor = editor;
        this.THREE = THREE;
        this.type = type;
        this.target = target;
        this.startPointer = {x: pointer.x, y: pointer.y};
        this.pointer = {x: pointer.x, y: pointer.y};
        this.snap = false;

        this.startPosition = new THREE.Vector3(target.x, target.y, target.z);
        this.startQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
            THREE.MathUtils.degToRad(target.rotationX),
            THREE.MathUtils.degToRad(target.rotationY),
            THREE.MathUtils.degToRad(target.rotationZ),
            'YXZ'
        ));
        this.startRotation = {x: target.rotationX, y: target.rotationY, z: target.rotationZ};
        this.startScale = new THREE.Vector3(target.scaleX, target.scaleY, target.scaleZ);

        /** @type {?string} 'x', 'y' or 'z' */
        this.axis = null;
        /** True to lock to the plane without this.axis instead of to the axis */
        this.plane = false;
        /** True to use the sprite's own axes instead of the world's */
        this.local = false;
        /** Typed number, as text */
        this.numeric = '';

        this._resetAngle();
        this._lines = null;
        /** @type {?RotateSphere} */
        this._sphere = null;
    }

    static get TYPES () {
        return TYPES;
    }

    get camera () {
        return this.editor.camera;
    }

    /**
     * Switch to another transform, like pressing R while moving in Blender. What was done so far stays.
     * @param {string} type
     */
    setType (type) {
        if (type === this.type) return;
        this.type = type;
        this.numeric = '';
        // Scaling can only follow the sprite's own axes
        if (type === 'scale' && this.axis) this.local = true;
        this._resetAngle();
        this.apply();
    }

    /**
     * @param {string} axis 'x', 'y' or 'z'
     * @param {boolean} plane true to lock to the plane without the axis
     */
    setConstraint (axis, plane) {
        if (this.axis !== axis || this.plane !== plane) {
            this.axis = axis;
            this.plane = plane;
            this.local = this.type === 'scale';
        } else if (this.local) {
            this.axis = null;
            this.plane = false;
            this.local = false;
        } else {
            this.local = true;
        }
        this._updateLines();
        this.apply();
    }

    /**
     * @param {string} key a key typed while transforming: a digit, '.', '-' or 'Backspace'
     * @returns {boolean} true if the key was used
     */
    input (key) {
        if (key === 'Backspace') {
            this.numeric = this.numeric.slice(0, -1);
        } else if (key === '-') {
            this.numeric = this.numeric.startsWith('-') ? this.numeric.slice(1) : `-${this.numeric}`;
        } else if (/^[0-9.]$/.test(key)) {
            if (key === '.' && this.numeric.includes('.')) return true;
            this.numeric += key;
        } else {
            return false;
        }
        this.apply();
        return true;
    }

    /**
     * @param {{x: number, y: number}} pointer client coordinates
     * @param {boolean} snap true while Ctrl is held
     */
    move (pointer, snap) {
        this._trackAngle(pointer);
        this.pointer = {x: pointer.x, y: pointer.y};
        this.snap = snap;
        this.apply();
    }

    /**
     * @returns {?number} the typed number, or null if nothing valid is typed
     */
    _numericValue () {
        const value = parseFloat(this.numeric);
        return Number.isFinite(value) ? value : null;
    }

    /**
     * @param {string} axis
     * @returns {THREE.Vector3} unit vector of the axis, in the world or the sprite's space
     */
    _axisVector (axis) {
        const vector = new this.THREE.Vector3();
        vector[axis] = 1;
        if (this.local) vector.applyQuaternion(this.startQuaternion);
        return vector;
    }

    /**
     * @param {{x: number, y: number}} pointer client coordinates
     * @returns {THREE.Ray} ray from the editor camera through the pointer
     */
    _ray (pointer) {
        const raycaster = new this.THREE.Raycaster();
        raycaster.setFromCamera(this.editor._pointer({clientX: pointer.x, clientY: pointer.y}).ndc, this.camera);
        return raycaster.ray;
    }

    /**
     * @returns {{x: number, y: number}} the sprite's starting position on the screen, in client coordinates
     */
    _screenCenter () {
        const ndc = this.startPosition.clone().project(this.camera);
        const rect = this.editor._canvas.getBoundingClientRect();
        return {
            x: rect.left + ((ndc.x + 1) / 2 * rect.width),
            y: rect.top + ((1 - ndc.y) / 2 * rect.height)
        };
    }

    _resetAngle () {
        const center = this._screenCenter();
        this._angle = 0;
        this._lastAngle = Math.atan2(this.pointer.y - center.y, this.pointer.x - center.x);
        /** Direction of the pointer from the sprite on the screen when rotating started, where the sweep starts */
        this._startAngle = this._lastAngle;
    }

    /**
     * Add up how far the pointer went around the sprite, so that rotating past half a turn keeps going.
     * @param {{x: number, y: number}} pointer
     */
    _trackAngle (pointer) {
        const center = this._screenCenter();
        if (Math.hypot(pointer.x - center.x, pointer.y - center.y) < MIN_RADIUS) return;
        const angle = Math.atan2(pointer.y - center.y, pointer.x - center.x);
        let delta = angle - this._lastAngle;
        if (delta > Math.PI) delta -= 2 * Math.PI;
        if (delta < -Math.PI) delta += 2 * Math.PI;
        this._angle += delta;
        this._lastAngle = angle;
    }

    apply () {
        if (this.type === 'grab') this._applyGrab();
        else if (this.type === 'rotate') this._applyRotate();
        else this._applyScale();
        this._updateSphere();
        this.editor._modalChanged();
    }

    _applyGrab () {
        const THREE = this.THREE;
        const numeric = this._numericValue();
        const delta = new THREE.Vector3();
        if (numeric !== null) {
            // Along the locked axis, or the first free one
            const axis = this.axis && !this.plane ? this.axis : AXES.find(a => a !== (this.plane && this.axis));
            delta.copy(this._axisVector(axis)).multiplyScalar(numeric);
        } else if (this.axis && !this.plane) {
            const direction = this._axisVector(this.axis);
            const start = this._closestOnLine(direction, this._ray(this.startPointer));
            const end = this._closestOnLine(direction, this._ray(this.pointer));
            if (start !== null && end !== null) {
                let distance = end - start;
                if (this.snap) distance = round(distance, TYPES.grab.snap);
                delta.copy(direction).multiplyScalar(distance);
            }
        } else {
            // In the plane without the locked axis, or else in the plane facing the camera
            const normal = this.axis ?
                this._axisVector(this.axis) :
                new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
            const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, this.startPosition);
            const start = this._ray(this.startPointer).intersectPlane(plane, new THREE.Vector3());
            const end = this._ray(this.pointer).intersectPlane(plane, new THREE.Vector3());
            if (start && end) {
                delta.subVectors(end, start);
                if (this.snap) {
                    delta.set(
                        round(delta.x, TYPES.grab.snap),
                        round(delta.y, TYPES.grab.snap),
                        round(delta.z, TYPES.grab.snap)
                    );
                }
            }
        }
        this.delta = delta;
        const position = this.startPosition.clone().add(delta);
        this.target.setXYZ(position.x, position.y, position.z);
    }

    /**
     * @param {THREE.Vector3} direction unit vector of a line through the start position
     * @param {THREE.Ray} ray
     * @returns {?number} distance along the line to the point closest to the ray, or null if they are parallel
     */
    _closestOnLine (direction, ray) {
        const w = this.startPosition.clone().sub(ray.origin);
        const b = direction.dot(ray.direction);
        const denominator = 1 - (b * b);
        if (denominator < 1e-6) return null;
        return ((b * ray.direction.dot(w)) - direction.dot(w)) / denominator;
    }

    _applyRotate () {
        const THREE = this.THREE;
        const toCamera = new THREE.Vector3(0, 0, 1).applyQuaternion(this.camera.quaternion);
        const axis = this.axis ? this._axisVector(this.axis) : toCamera;
        const numeric = this._numericValue();
        let angle;
        if (numeric === null) {
            // The screen's y points down, so turning the pointer clockwise on screen is a negative angle
            angle = -this._angle;
            // Turn the way the pointer goes, whichever way the axis points
            if (axis.dot(toCamera) < 0) angle = -angle;
            if (this.snap) angle = THREE.MathUtils.degToRad(round(THREE.MathUtils.radToDeg(angle), TYPES.rotate.snap));
        } else {
            angle = THREE.MathUtils.degToRad(numeric);
        }
        this.angle = THREE.MathUtils.radToDeg(angle);
        this._rotation = {axis, angle};
        const quaternion = new THREE.Quaternion().setFromAxisAngle(axis, angle)
            .multiply(this.startQuaternion);
        const euler = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ');
        const radToDeg = THREE.MathUtils.radToDeg;
        this.target.setRotation(radToDeg(euler.x), radToDeg(euler.y), radToDeg(euler.z));
    }

    _applyScale () {
        const numeric = this._numericValue();
        let factor;
        if (numeric === null) {
            const center = this._screenCenter();
            const start = Math.hypot(this.startPointer.x - center.x, this.startPointer.y - center.y);
            const end = Math.hypot(this.pointer.x - center.x, this.pointer.y - center.y);
            factor = start < MIN_RADIUS ? 1 : end / start;
            if (this.snap) factor = round(factor, TYPES.scale.snap);
        } else {
            factor = numeric;
        }
        this.factor = factor;
        const scale = this.startScale.clone();
        for (const axis of AXES) {
            const locked = this.axis === axis;
            if (this.axis === null || locked !== this.plane) scale[axis] *= factor;
        }
        this.target.setScale(scale.x, scale.y, scale.z);
    }

    /**
     * Show the rotation sphere while rotating.
     */
    _updateSphere () {
        if (this.type !== 'rotate') {
            this._removeSphere();
            return;
        }
        const THREE = this.THREE;
        if (!this._sphere) {
            this._sphere = new RotateSphere(THREE);
            const editorLayer = this.editor.scene3D.constructor.EDITOR_LAYER;
            this._sphere.group.traverse(object => object.layers.set(editorLayer));
            this.editor.scene3D.scene.add(this._sphere.group);
        }
        // Where the pointer was on the screen when rotating started, as a direction in the world
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
        const start = right.multiplyScalar(Math.cos(this._startAngle))
            .addScaledVector(up, -Math.sin(this._startAngle));
        this._sphere.update({
            camera: this.camera,
            center: this.startPosition,
            orientation: this.local ? this.startQuaternion : new THREE.Quaternion(),
            axis: this.axis,
            rotationAxis: this._rotation.axis,
            start,
            angle: this._rotation.angle
        });
    }

    _removeSphere () {
        if (!this._sphere) return;
        this._sphere.dispose();
        this._sphere = null;
    }

    /**
     * Show a line for each axis the transform is locked to.
     */
    _updateLines () {
        const THREE = this.THREE;
        this._removeLines();
        if (this.axis === null) return;
        const axes = this.plane ? AXES.filter(axis => axis !== this.axis) : [this.axis];
        const group = new THREE.Group();
        for (const axis of axes) {
            const direction = this._axisVector(axis);
            const geometry = new THREE.BufferGeometry().setFromPoints([
                this.startPosition.clone().addScaledVector(direction, -LINE_LENGTH),
                this.startPosition.clone().addScaledVector(direction, LINE_LENGTH)
            ]);
            const material = new THREE.LineBasicMaterial({color: AXIS_COLORS[axis], depthTest: false});
            const line = new THREE.Line(geometry, material);
            line.renderOrder = 2;
            group.add(line);
        }
        this._lines = group;
        this.editor.scene3D.scene.add(group);
    }

    _removeLines () {
        if (!this._lines) return;
        this._lines.removeFromParent();
        for (const line of this._lines.children) {
            line.geometry.dispose();
            line.material.dispose();
        }
        this._lines = null;
    }

    /**
     * Put the sprite back where it was.
     */
    cancel () {
        this.target.setXYZ(this.startPosition.x, this.startPosition.y, this.startPosition.z);
        this.target.setRotation(this.startRotation.x, this.startRotation.y, this.startRotation.z);
        this.target.setScale(this.startScale.x, this.startScale.y, this.startScale.z);
        this.dispose();
    }

    dispose () {
        this._removeLines();
        this._removeSphere();
    }

    /**
     * @returns {string} what the stage toolbar shows while transforming
     */
    describe () {
        const parts = [TYPES[this.type].text];
        if (this.axis) {
            const name = this.plane ?
                AXES.filter(axis => axis !== this.axis).join('')
                    .toUpperCase() :
                this.axis.toUpperCase();
            parts.push(`${name}${this.local ? '（區域）' : '（全域）'}`);
        }
        if (this.numeric) {
            parts.push(`[${this.numeric}]`);
        } else if (this.type === 'grab' && this.delta) {
            parts.push(`${format(this.delta.x)}, ${format(this.delta.y)}, ${format(this.delta.z)}`);
        } else if (this.type === 'rotate' && typeof this.angle === 'number') {
            parts.push(`${format(this.angle)}°`);
        } else if (this.type === 'scale' && typeof this.factor === 'number') {
            parts.push(`×${format(this.factor)}`);
        }
        return parts.join(' ');
    }
}

module.exports = ModalTransform;

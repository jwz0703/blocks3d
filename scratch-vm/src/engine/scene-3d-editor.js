// Editing 3D sprites on the stage, in the editor only: a free camera (orbit, pan, zoom) separate from the game
// camera, picking sprites (and the frustums of camera sprites) by clicking them, dragging them, a move / rotate /
// scale gizmo, Blender-style G / R / S transforms with the keyboard, and a grid with axes. Like Blender, numpad 0
// looks through the current camera and Ctrl + Alt + numpad 0 moves the current camera to the view. While the project
// runs (green flag until stop) the stage shows the game camera instead. What is changed here can be undone
// (StageUndo).

const ModalTransform = require('./scene-3d-modal-transform');
const {RADIUS, VIEW_RADIUS, gizmoScale, styleGizmo, RotationSweep} = require('./scene-3d-rotate-sphere');
const StageUndo = require('./stage-undo');

const MODES = ['translate', 'rotate', 'scale'];
// Key code: [gizmo mode, modal transform]
const MODE_KEYS = {
    KeyG: ['translate', 'grab'],
    KeyR: ['rotate', 'rotate'],
    KeyS: ['scale', 'scale']
};
const AXIS_KEYS = {KeyX: 'x', KeyY: 'y', KeyZ: 'z'};

// Radians per pixel when orbiting
const ORBIT_SPEED = 0.008;
// Zoom factor per pixel of wheel movement
const ZOOM_SPEED = 1.0015;
// Pinching a trackpad zooms faster than a wheel, per pixel
const PINCH_ZOOM_SPEED = 1.01;
const MIN_DISTANCE = 0.1;
const MAX_DISTANCE = 1000;
// Distance to the orbit center when the editor camera is placed where the game camera is
const DEFAULT_DISTANCE = 5;
// Pixels the pointer must move before a press on a sprite drags it
const DRAG_THRESHOLD = 3;
// How far above the game camera the editor camera starts, in radians around the orbit center,
// so that the grid isn't seen edge-on
const START_ELEVATION = 0.45;
// Camera sprites closer than this to the editor camera can't be picked: looking through one (e.g. after moving the
// view to it), every ray starts on its frustum lines, so every click grabbed it instead of orbiting
const MIN_CAMERA_PICK_DISTANCE = 0.5;

/**
 * @param {WheelEvent} event
 * @returns {boolean} true if the wheel event comes from scrolling with two fingers on a trackpad, not a mouse wheel
 */
const isTrackpadScroll = event => {
    if (event.deltaMode !== 0) return false;
    if (event.deltaX !== 0) return true;
    // Chrome and Safari: a trackpad reports wheelDeltaY as exactly -3 times deltaY, a mouse wheel doesn't
    if (typeof event.wheelDeltaY === 'number' && event.wheelDeltaY !== 0) {
        return event.wheelDeltaY === -3 * event.deltaY;
    }
    return !Number.isInteger(event.deltaY);
};

/**
 * @param {EventTarget} element
 * @returns {boolean} true if typing in this element must not switch gizmo modes
 */
const isEditable = element => !!element && (
    element.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
);

class Editor3D {
    /**
     * @param {Scene3D} scene3D the scene this edits
     */
    constructor (scene3D) {
        this.scene3D = scene3D;
        this.runtime = scene3D.runtime;

        /** The GUI turns this on in the editor; the player never does. */
        this.enabled = false;
        /** False while the game runs, or while the user looks through the game camera. */
        this.useEditorCamera = true;
        this.helpersVisible = true;
        /** Colliders seen by the editor camera (see ColliderView) */
        this.collidersVisible = false;
        /** The performance panel on the stage (ROADMAP.md 7.4) */
        this.statsVisible = false;
        /** One of MODES */
        this.mode = 'translate';

        /** @type {?THREE.PerspectiveCamera} */
        this.camera = null;
        this._orbitCenter = null;
        this._transform = null;
        /** @type {?RotationSweep} the angle turned so far while dragging the rotate gizmo */
        this._sweep = null;
        this._helpers = null;
        this._canvas = null;
        this._drag = null;
        /** @type {?ModalTransform} the G / R / S transform in progress */
        this._modal = null;
        /** Last pointer position in client coordinates, and whether it is over the stage */
        this._lastPointer = null;
        this._hover = false;
        this._eatContextMenu = false;
        /** Where the sprite was when the gizmo or a G / R / S transform started */
        this._gizmoStart = null;
        this._modalStart = null;

        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);
        this._onWheel = this._onWheel.bind(this);
        this._onGesture = this._onGesture.bind(this);
        this._gestureScale = 1;
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onContextMenu = this._onContextMenu.bind(this);
        this._onWindowPointerDown = this._onWindowPointerDown.bind(this);
        this._onWindowContextMenu = this._onWindowContextMenu.bind(this);

        /** True while the stage shows the game camera because the green flag was clicked */
        this._gameCameraForRun = false;

        this.runtime.on('PROJECT_START', () => {
            this.setUseEditorCamera(false);
            this._gameCameraForRun = true;
        });
        this.runtime.on('PROJECT_STOP_ALL', () => this.setUseEditorCamera(true));
        // Scripts often all finish (or there are none) without the stop sign being clicked. Without this, the stage
        // kept showing the game camera after the green flag went dark, and orbiting and dragging 3D sprites did
        // nothing until the stop sign was clicked.
        this.runtime.on('AFTER_EXECUTE', () => {
            if (this._gameCameraForRun && !this._isProjectRunning()) this.setUseEditorCamera(true);
        });
    }

    static get MODES () {
        return MODES;
    }

    get THREE () {
        return this.scene3D.THREE;
    }

    /**
     * @returns {boolean} true when the stage shows the editor camera and editing works
     */
    get active () {
        return this.enabled && this.useEditorCamera && !!this.camera;
    }

    /**
     * @returns {boolean} true while the pointer orbits, pans, drags a sprite or drags the gizmo, so that the stage
     * doesn't also start dragging a 2D sprite
     */
    isBusy () {
        return !!this._drag || !!this._modal || !!(this._transform && this._transform.dragging);
    }

    /**
     * @returns {object} what the GUI's stage toolbar shows
     */
    getState () {
        return {
            available: this.enabled && !!this.camera,
            useEditorCamera: this.useEditorCamera,
            helpersVisible: this.helpersVisible,
            collidersVisible: this.collidersVisible,
            statsVisible: this.statsVisible,
            mode: this.mode,
            modal: this._modal ? this._modal.describe() : null,
            // False when the stage shows the default camera, because the project has no camera sprite
            hasCamera: !!this.scene3D.getActiveCamera()
        };
    }

    /**
     * Called by the scene when the current camera changed, e.g. the last camera sprite was deleted.
     */
    cameraChanged () {
        if (this.camera) this.runtime.emit('SCENE3D_EDITOR_CHANGED', this.getState());
    }

    _changed () {
        this._updateVisibility();
        this.runtime.emit('SCENE3D_EDITOR_CHANGED', this.getState());
    }

    setEnabled (enabled) {
        enabled = !!enabled;
        if (this.enabled === enabled) return;
        this.enabled = enabled;
        this.runtime.stageUndo.setEnabled(enabled);
        if (!enabled) this.cancelModal();
        if (enabled) this.setup();
        this._changed();
    }

    /**
     * @returns {boolean} true while scripts run, like the green flag lights up (monitors don't count)
     */
    _isProjectRunning () {
        return this.runtime.isGameRunning();
    }

    setUseEditorCamera (useEditorCamera) {
        // Whoever switches the camera now decides, e.g. looking through the camera with numpad 0 stays after scripts
        // finish
        this._gameCameraForRun = false;
        useEditorCamera = !!useEditorCamera;
        if (this.useEditorCamera === useEditorCamera) return;
        this.useEditorCamera = useEditorCamera;
        this._drag = null;
        this.cancelModal();
        this._changed();
    }

    setHelpersVisible (visible) {
        this.helpersVisible = !!visible;
        this._changed();
    }

    setCollidersVisible (visible) {
        this.collidersVisible = !!visible;
        this._changed();
    }

    setStatsVisible (visible) {
        this.statsVisible = !!visible;
        this._changed();
    }

    /**
     * @param {string} mode 'translate', 'rotate' or 'scale'
     */
    setMode (mode) {
        if (!MODES.includes(mode)) return;
        this.mode = mode;
        if (this._transform) this._transform.setMode(mode);
        this._changed();
    }

    /**
     * Create the editor's objects once the scene exists and the editor is enabled.
     */
    setup () {
        const scene3D = this.scene3D;
        if (this.camera || !this.enabled || !scene3D.scene) return;
        const THREE = this.THREE;
        const canvas = this.runtime.renderer.canvas;
        this._canvas = canvas;

        this.camera = new THREE.PerspectiveCamera(60, scene3D.camera.aspect, 0.05, 2000);
        this.camera.rotation.order = 'YXZ';
        // Sees the frustums of camera sprites
        this.camera.layers.enable(scene3D.constructor.EDITOR_LAYER);
        this._orbitCenter = new THREE.Vector3();
        this.resetCamera(true);

        this._helpers = new THREE.Group();
        this._helpers.add(new THREE.GridHelper(20, 20, 0x888888, 0xcccccc));
        const axes = new THREE.AxesHelper(2);
        // Drawn over the grid, which is in the same plane
        axes.renderOrder = 1;
        axes.material.depthTest = false;
        this._helpers.add(axes);
        // Camera sprites draw their own frustum. The default camera isn't drawn: it isn't a sprite, so it couldn't be
        // picked or moved, and looked like a camera that wasn't deleted. The toolbar says when it is used instead.
        scene3D.scene.add(this._helpers);

        // Added before TransformControls connects its own listeners, so that 2D sprites can take the click first
        canvas.addEventListener('pointerdown', this._onPointerDown);
        canvas.addEventListener('wheel', this._onWheel, {passive: false});
        // Safari reports trackpad pinches as gesture events
        canvas.addEventListener('gesturestart', this._onGesture);
        canvas.addEventListener('gesturechange', this._onGesture);
        canvas.addEventListener('contextmenu', this._onContextMenu);
        window.addEventListener('pointermove', this._onPointerMove);
        window.addEventListener('pointerup', this._onPointerUp);
        // Capturing, so that keys typed during a transform don't reach the rest of the editor
        document.addEventListener('keydown', this._onKeyDown, true);
        // Clicks anywhere finish a transform
        window.addEventListener('pointerdown', this._onWindowPointerDown, true);
        window.addEventListener('contextmenu', this._onWindowContextMenu, true);

        const {TransformControls} = require('three/examples/jsm/controls/TransformControls.js');
        const transform = new TransformControls(this.camera, canvas);
        transform.setMode(this.mode);
        styleGizmo(transform, THREE);
        this._sweep = new RotationSweep(THREE);
        this._sweep.group.traverse(object => object.layers.set(scene3D.constructor.EDITOR_LAYER));
        scene3D.scene.add(this._sweep.group);
        transform.addEventListener('change', () => {
            this._updateSweep();
            scene3D.markDirty();
        });
        transform.addEventListener('objectChange', () => this._onObjectChange());
        transform.addEventListener('dragging-changed', event => {
            const object = transform.object;
            const target = object && object.userData.twTarget;
            if (event.value) {
                this._gizmoStart = target ? {target, state: StageUndo.snapshot(target)} : null;
                return;
            }
            this._sweep.hide();
            const start = this._gizmoStart;
            this._gizmoStart = null;
            if (start && start.target === target) this.runtime.stageUndo.record(target, start.state);
            this.runtime.emitProjectChanged();
        });
        this._transform = transform;
        // Only the editor camera sees the gizmo (attaching it to a sprite makes it visible again, even while the
        // stage shows the game camera), and its own picking must see that layer too
        const editorLayer = scene3D.constructor.EDITOR_LAYER;
        transform.getHelper().traverse(object => object.layers.set(editorLayer));
        transform.getRaycaster().layers.enableAll();
        scene3D.scene.add(transform.getHelper());

        this.select(this.runtime.getEditingTarget());
        this._changed();
    }

    /**
     * While the rotate gizmo is dragged around an axis or the view, show the angle turned so far.
     */
    _updateSweep () {
        const transform = this._transform;
        const axisName = transform.dragging && transform.mode === 'rotate' ? transform.axis : null;
        if (!['X', 'Y', 'Z', 'E'].includes(axisName)) {
            this._sweep.hide();
            return;
        }
        const THREE = this.THREE;
        let axis;
        if (axisName === 'E') {
            axis = transform.eye.clone();
        } else {
            axis = new THREE.Vector3();
            axis[axisName.toLowerCase()] = 1;
            if (transform.space === 'local') axis.applyQuaternion(transform.worldQuaternionStart);
        }
        const center = transform.worldPositionStart;
        const radius = (axisName === 'E' ? VIEW_RADIUS : RADIUS) * gizmoScale(this.camera, center) * transform.size;
        this._sweep.update(center, axis, transform.pointStart, transform.rotationAngle, radius);
    }

    /**
     * Put the editor camera where the game camera is.
     * @param {boolean} [fromAbove] true to look from a little higher, for a new or loaded project
     */
    resetCamera (fromAbove) {
        if (!this.camera) return;
        const game = this.scene3D.getGameCamera();
        this.camera.position.copy(game.position);
        this.camera.quaternion.copy(game.quaternion);
        this.camera.fov = game.fov;
        this.camera.updateProjectionMatrix();
        const forward = new this.THREE.Vector3(0, 0, -1).applyQuaternion(game.quaternion);
        this._orbitCenter.copy(game.position).addScaledVector(forward, DEFAULT_DISTANCE);
        if (fromAbove) this._orbit(0, START_ELEVATION / ORBIT_SPEED);
        this.scene3D.markDirty();
    }

    /**
     * Move the current camera (a camera sprite, or the default camera) to where the editor camera is, and look
     * through it, like Ctrl + Alt + numpad 0 in Blender.
     */
    alignCameraToView () {
        if (!this.camera) return;
        const cameraTarget = this.scene3D.getActiveCamera();
        const before = cameraTarget ? StageUndo.snapshot(cameraTarget) : this.scene3D.getCameraState();
        const view = this.camera.clone();
        // The camera keeps its own field of view
        view.fov = this.scene3D.getCameraState().fov;
        this.scene3D.commitGameCamera(view);
        if (cameraTarget) {
            this.runtime.stageUndo.record(cameraTarget, before);
        } else {
            this.runtime.stageUndo.recordCamera(before, this.scene3D.getCameraState());
        }
        this.runtime.emitProjectChanged();
        this.setUseEditorCamera(false);
    }

    /**
     * Point the editor camera at the selected sprite, keeping the viewing angle.
     */
    focusSelected () {
        const object = this._transform && this._transform.object;
        if (!object || !this.camera) return;
        const THREE = this.THREE;
        const box = new THREE.Box3().setFromObject(object);
        const empty = box.isEmpty();
        const center = empty ? object.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
        const radius = empty ? 1 : Math.max(0.5, box.getBoundingSphere(new THREE.Sphere()).radius);
        const offset = this.camera.position.clone().sub(this._orbitCenter);
        offset.setLength(radius * 3);
        this._orbitCenter.copy(center);
        this.camera.position.copy(center).add(offset);
        this.camera.lookAt(center);
        this.scene3D.markDirty();
    }

    /**
     * @param {number} aspect width / height of the stage
     */
    setAspect (aspect) {
        if (!this.camera) return;
        this.camera.aspect = aspect;
        this.camera.updateProjectionMatrix();
    }

    /**
     * Show the gizmo on a 3D sprite, or hide it.
     * @param {?Target} target the editing target
     */
    select (target) {
        if (!this._transform) return;
        if (this._modal && this._modal.target !== target) this.cancelModal();
        const object = target && target.is3D ? target.object3D : null;
        if (object) {
            this.scene3D.flushTransforms();
            this._transform.attach(object);
        } else {
            this._transform.detach();
        }
        this.scene3D.markDirty();
    }

    /**
     * @param {Target3D} target a sprite being deleted
     */
    forget (target) {
        if (this._transform && target.object3D && this._transform.object === target.object3D) {
            this._transform.detach();
        }
        if (this._drag && this._drag.target === target) this._drag = null;
        if (this._modal && this._modal.target === target) {
            this._modal.dispose();
            this._modal = null;
            this._changed();
        }
    }

    // Modal transforms

    /**
     * Start moving, rotating or scaling the selected sprite with the mouse, or switch the transform in progress.
     * @param {string} type 'grab', 'rotate' or 'scale'
     * @returns {boolean} true if a transform is in progress
     */
    startModal (type) {
        if (this._modal) {
            this._modal.setType(type);
            return true;
        }
        const object = this._transform && this._transform.object;
        const target = object && object.userData.twTarget;
        if (!this.active || !target || !this._lastPointer) return false;
        this._drag = null;
        this._modalStart = StageUndo.snapshot(target);
        this._modal = new ModalTransform(this, type, target, this._lastPointer);
        this._modal.apply();
        this._changed();
        return true;
    }

    confirmModal () {
        if (!this._modal) return;
        this.runtime.stageUndo.record(this._modal.target, this._modalStart);
        this._modal.dispose();
        this._modal = null;
        this._changed();
        this.runtime.emitProjectChanged();
    }

    cancelModal () {
        if (!this._modal) return;
        this._modal.cancel();
        this._modal = null;
        this._changed();
    }

    /**
     * Called by the transform in progress whenever it changes the sprite.
     */
    _modalChanged () {
        if (this._modal) this.runtime.emit('SCENE3D_EDITOR_CHANGED', this.getState());
    }

    /**
     * Alt + G / R / S: put the selected sprite back at the origin, unrotated, or at its normal size.
     * @param {string} type 'grab', 'rotate' or 'scale'
     */
    _resetTransform (type) {
        const object = this._transform && this._transform.object;
        const target = object && object.userData.twTarget;
        if (!target) return;
        const before = StageUndo.snapshot(target);
        if (type === 'grab') target.setXYZ(0, 0, 0);
        else if (type === 'rotate') target.setRotation(0, 0, 0);
        else target.setScale(1, 1, 1);
        this.runtime.stageUndo.record(target, before);
        this.runtime.emitProjectChanged();
    }

    _updateVisibility () {
        if (!this.camera) return;
        const active = this.active;
        this._helpers.visible = active && this.helpersVisible;
        // Like Blender, the gizmo hides during a keyboard transform
        this._transform.enabled = active && !this._modal;
        this._transform.getHelper().visible = active && !this._modal;
        this.scene3D.markDirty();
    }

    // Pointer input

    /**
     * @param {PointerEvent|WheelEvent} event
     * @returns {{x: number, y: number, ndc: THREE.Vector2, rect: DOMRect}} position on the stage
     */
    _pointer (event) {
        const rect = this._canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        return {
            x,
            y,
            rect,
            ndc: new this.THREE.Vector2(((x / rect.width) * 2) - 1, -((y / rect.height) * 2) + 1)
        };
    }

    /**
     * @param {THREE.Vector2} ndc position in normalized device coordinates
     * @returns {?{target: Target3D, point: THREE.Vector3}} the 3D sprite under the pointer, and where it was hit
     */
    _pick (ndc) {
        const THREE = this.THREE;
        this.scene3D.flushTransforms();
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(ndc, this.camera);
        // Camera frustums are lines on the editor layer
        raycaster.layers.enableAll();
        raycaster.params.Line.threshold = 0.08;
        const objects = [];
        for (const target of this.scene3D.targets) {
            if (!target.object3D || !target.visible) continue;
            if (target.isCamera &&
                target.object3D.getWorldPosition(new THREE.Vector3()).distanceTo(this.camera.position) <
                    MIN_CAMERA_PICK_DISTANCE) {
                continue;
            }
            objects.push(target.object3D);
        }
        for (const hit of raycaster.intersectObjects(objects, true)) {
            let object = hit.object;
            while (object && !object.userData.twTarget) object = object.parent;
            if (object) return {target: object.userData.twTarget, point: hit.point};
        }
        return null;
    }

    _onPointerDown (event) {
        if (!this.active) return;
        const transform = this._transform;
        const pointer = this._pointer(event);
        transform.enabled = true;
        // 2D sprites are drawn over the 3D scene, so they get the click
        if (this.runtime.renderer.pick(pointer.x, pointer.y) !== -1) {
            transform.enabled = false;
            return;
        }
        // A handle of the gizmo: TransformControls drags it with its own listener, which runs after this one
        if (transform.object && event.button === 0) {
            transform.pointerHover({x: pointer.ndc.x, y: pointer.ndc.y, button: 0});
            if (transform.axis !== null) return;
        }
        const hit = event.button === 0 ? this._pick(pointer.ndc) : null;
        if (hit) {
            const target = hit.target.isOriginal ?
                hit.target :
                hit.target.sprite.clones.find(clone => clone.isOriginal) || hit.target;
            if (target !== this.runtime.getEditingTarget()) {
                this.runtime.emit('SCENE3D_PICK_TARGET', target.id);
            }
            // Pressing on a sprite and moving drags it along the ground (or up and down with shift)
            const THREE = this.THREE;
            const normal = new THREE.Vector3(0, 1, 0);
            if (event.shiftKey) {
                // A vertical plane facing the camera
                normal.set(0, 0, 1).applyQuaternion(this.camera.quaternion);
                normal.y = 0;
                normal.normalize();
            }
            if (normal.lengthSq() === 0) normal.set(0, 0, 1);
            this._drag = {
                type: 'move',
                target,
                startX: event.clientX,
                startY: event.clientY,
                started: false,
                plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.point),
                offset: new THREE.Vector3(target.x, target.y, target.z).sub(hit.point),
                before: StageUndo.snapshot(target)
            };
            return;
        }
        this._drag = {
            type: event.button === 0 && !event.shiftKey ? 'orbit' : 'pan',
            lastX: event.clientX,
            lastY: event.clientY
        };
    }

    _onPointerMove (event) {
        this._lastPointer = {x: event.clientX, y: event.clientY};
        if (this._canvas) {
            const rect = this._canvas.getBoundingClientRect();
            this._hover = event.clientX >= rect.left && event.clientX < rect.right &&
                event.clientY >= rect.top && event.clientY < rect.bottom;
        }
        if (this._modal) {
            this._modal.move(this._lastPointer, event.ctrlKey || event.metaKey);
            return;
        }
        const drag = this._drag;
        if (!drag || !this.active) return;
        if (drag.type === 'move') {
            this._moveDrag(drag, event);
            return;
        }
        const dx = event.clientX - drag.lastX;
        const dy = event.clientY - drag.lastY;
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
        if (drag.type === 'orbit') {
            this._orbit(dx, dy);
        } else {
            this._pan(dx, dy);
        }
    }

    _moveDrag (drag, event) {
        if (!drag.started) {
            if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) return;
            drag.started = true;
        }
        const THREE = this.THREE;
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(this._pointer(event).ndc, this.camera);
        const point = raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3());
        if (!point) return;
        point.add(drag.offset);
        drag.target.setXYZ(point.x, point.y, point.z);
    }

    _onPointerUp () {
        const drag = this._drag;
        this._drag = null;
        if (drag && drag.type === 'move' && drag.started) {
            this.runtime.stageUndo.record(drag.target, drag.before);
            this.runtime.emitProjectChanged();
        }
    }

    _orbit (dx, dy) {
        const THREE = this.THREE;
        const offset = this.camera.position.clone().sub(this._orbitCenter);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        spherical.theta -= dx * ORBIT_SPEED;
        spherical.phi = Math.max(0.01, Math.min(Math.PI - 0.01, spherical.phi - (dy * ORBIT_SPEED)));
        offset.setFromSpherical(spherical);
        this.camera.position.copy(this._orbitCenter).add(offset);
        this.camera.lookAt(this._orbitCenter);
        this.scene3D.markDirty();
    }

    _pan (dx, dy) {
        const THREE = this.THREE;
        const camera = this.camera;
        const distance = camera.position.distanceTo(this._orbitCenter);
        const height = this._canvas.getBoundingClientRect().height || 1;
        // World units per pixel at the orbit center
        const scale = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / height;
        camera.updateMatrix();
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
        const move = right.multiplyScalar(-dx * scale).addScaledVector(up, dy * scale);
        camera.position.add(move);
        this._orbitCenter.add(move);
        this.scene3D.markDirty();
    }

    /**
     * Move the editor camera toward or away from the orbit center.
     * @param {number} factor the new distance divided by the old one
     */
    _zoom (factor) {
        const offset = this.camera.position.clone().sub(this._orbitCenter);
        const distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, offset.length() * factor));
        offset.setLength(distance);
        this.camera.position.copy(this._orbitCenter).add(offset);
        this.scene3D.markDirty();
    }

    _onWheel (event) {
        if (!this.active) return;
        event.preventDefault();
        if (event.ctrlKey) {
            // Pinching a trackpad (browsers report it as the wheel with ctrl held)
            this._lastPinchWheel = Date.now();
            this._zoom(Math.pow(PINCH_ZOOM_SPEED, event.deltaY));
        } else if (isTrackpadScroll(event)) {
            // Two fingers on a trackpad orbit like Blender, or pan with shift
            if (event.shiftKey) {
                this._pan(-event.deltaX, -event.deltaY);
            } else {
                this._orbit(-event.deltaX, -event.deltaY);
            }
        } else {
            this._zoom(Math.pow(ZOOM_SPEED, event.deltaY));
        }
    }

    _onGesture (event) {
        if (!this.active) return;
        // Without this Safari zooms the page
        event.preventDefault();
        if (event.type === 'gesturestart') {
            this._gestureScale = 1;
            return;
        }
        // Browsers that also report the pinch as the wheel already zoomed
        if (!(event.scale > 0) || Date.now() - (this._lastPinchWheel || 0) < 200) return;
        this._zoom(this._gestureScale / event.scale);
        this._gestureScale = event.scale;
    }

    _onContextMenu (event) {
        // Right drag pans
        if (this.active) event.preventDefault();
    }

    _onWindowPointerDown (event) {
        this._eatContextMenu = false;
        if (!this._modal) return;
        // Left click confirms, any other button cancels, and neither does anything else
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.button === 0) {
            this.confirmModal();
        } else {
            this._eatContextMenu = true;
            this.cancelModal();
        }
    }

    _onWindowContextMenu (event) {
        if (!this._modal && !this._eatContextMenu) return;
        this._eatContextMenu = false;
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    _onKeyDown (event) {
        if (this._modal) {
            this._onModalKeyDown(event);
            return;
        }
        // Numpad 0 also works while looking through the camera, to look through the editor camera again
        if (event.code === 'Numpad0' && this.enabled && this.camera && this._hover && !isEditable(event.target)) {
            event.preventDefault();
            if ((event.ctrlKey || event.metaKey) && event.altKey) {
                this.alignCameraToView();
            } else {
                this.setUseEditorCamera(!this.useEditorCamera);
            }
            return;
        }
        // Like Blender, keys act on the area under the pointer
        if (!this.active || !this._hover || event.ctrlKey || event.metaKey || isEditable(event.target)) return;
        const code = event.code;
        if (MODE_KEYS[code]) {
            const [mode, type] = MODE_KEYS[code];
            event.preventDefault();
            if (event.altKey) {
                this._resetTransform(type);
                return;
            }
            this.setMode(mode);
            if (this.startModal(type)) event.stopImmediatePropagation();
        } else if (code === 'KeyF' && !event.altKey) {
            this.focusSelected();
        }
    }

    _onModalKeyDown (event) {
        // Nothing else in the editor sees keys while transforming
        event.preventDefault();
        event.stopImmediatePropagation();
        const modal = this._modal;
        const code = event.code;
        if (code === 'Escape' || (code === 'KeyZ' && (event.ctrlKey || event.metaKey))) {
            this.cancelModal();
        } else if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') {
            this.confirmModal();
        } else if (AXIS_KEYS[code]) {
            modal.setConstraint(AXIS_KEYS[code], event.shiftKey);
        } else if (MODE_KEYS[code]) {
            const [mode, type] = MODE_KEYS[code];
            this.setMode(mode);
            this.startModal(type);
        } else if (code === 'ControlLeft' || code === 'ControlRight' || code === 'MetaLeft' ||
            code === 'MetaRight') {
            modal.move(modal.pointer, true);
        } else {
            modal.input(event.key === 'Backspace' ? 'Backspace' : event.key);
        }
    }

    /**
     * The gizmo changed the sprite's object: copy it back to the sprite.
     */
    _onObjectChange () {
        const object = this._transform.object;
        const target = object && object.userData.twTarget;
        if (!target) return;
        const radToDeg = this.THREE.MathUtils.radToDeg;
        target.setXYZ(object.position.x, object.position.y, object.position.z);
        target.setRotation(radToDeg(object.rotation.x), radToDeg(object.rotation.y), radToDeg(object.rotation.z));
        target.setScale(object.scale.x, object.scale.y, object.scale.z);
    }
}

module.exports = Editor3D;

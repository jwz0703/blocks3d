// How rotating a 3D sprite looks in the editor: a glass sphere with a glowing rim, three full rings for the X / Y / Z
// axes whose far halves fade, a thin ring facing the view, and a wedge that sweeps out the angle turned so far. The
// rotate gizmo (TransformControls) is restyled into it, and rotating with the R key shows the same sphere.

const AXES = ['x', 'y', 'z'];
const AXIS_COLORS = {x: 0xff3352, y: 0x8bdc00, z: 0x2890ff};
const SHELL_COLOR = 0x9cc8ff;
const VIEW_COLOR = 0xffffff;
const SWEEP_COLOR = 0xffd24a;
// Radius of the axis rings in gizmo units; TransformControls scales its handles so this stays the same on screen
const RADIUS = 0.5;
const VIEW_RADIUS = 0.75;
const RING_TUBE = 0.014;
// A wide, faint tube around each ring, like a glow
const HALO_TUBE = 0.045;
const HALO_ALPHA = 0.22;
const VIEW_TUBE = 0.006;
// How much of a ring shows on the far side of the sphere
const BACK_OPACITY = 0.18;
const SHELL_OPACITY = 0.4;
const SWEEP_OPACITY = 0.32;
// Radians per segment of the sweep
const SWEEP_STEP = Math.PI / 64;
// Degree marks around the ring being turned: a short one every 15°, a long one every 90°
const TICK_STEP = Math.PI / 12;
const TICK_OPACITY = 0.85;

/**
 * Like TransformControls: how much to scale the gizmo so that it looks the same size wherever it is.
 * @param {THREE.PerspectiveCamera} camera
 * @param {THREE.Vector3} position
 * @returns {number}
 */
const gizmoScale = (camera, position) => {
    const distance = position.distanceTo(camera.getWorldPosition(position.clone()));
    return distance * Math.min(1.9 * Math.tan(Math.PI * camera.fov / 360) / camera.zoom, 7) / 4;
};

/**
 * Shared vertex code: where this vertex is in view space, and where the center of the sphere (the object's origin) is
 */
const VIEW_VERTEX = `#include <project_vertex>
    vec4 twCenter = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    twView = mvPosition.xyz;
    twCenterView = twCenter.xyz;
    twScale = length(modelViewMatrix[0].xyz);`;
const VIEW_VARYINGS = `#include <common>
varying vec3 twView;
varying vec3 twCenterView;
varying float twScale;`;

/**
 * @param {typeof THREE} THREE
 * @param {object} options for THREE.MeshBasicMaterial
 * @param {string} key cache key of the shader
 * @param {string} alpha GLSL that changes diffuseColor.a
 * @returns {THREE.MeshBasicMaterial} a material drawn over everything, whose alpha the GLSL changes
 */
const makeMaterial = (THREE, options, key, alpha) => {
    const material = new THREE.MeshBasicMaterial(Object.assign({
        depthTest: false,
        depthWrite: false,
        fog: false,
        toneMapped: false,
        transparent: true
    }, options));
    material.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', VIEW_VARYINGS)
            .replace('#include <project_vertex>', VIEW_VERTEX);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', VIEW_VARYINGS)
            .replace('#include <opaque_fragment>', `${alpha}\n#include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => key;
    return material;
};

/**
 * @param {typeof THREE} THREE
 * @param {number} color
 * @returns {THREE.MeshBasicMaterial} for an axis ring: the half nearer the camera is solid, the far half faint
 */
const ringMaterial = (THREE, color) => makeMaterial(THREE, {color}, 'tw-rotate-ring', `
    float twFront = (twView.z - twCenterView.z) / (twScale * ${RADIUS.toFixed(3)});
    diffuseColor.a *= mix(${BACK_OPACITY.toFixed(3)}, 1.0, smoothstep(-0.4, 0.0, twFront));`);

/**
 * @param {typeof THREE} THREE
 * @param {number} color
 * @param {number} [opacity]
 * @returns {THREE.MeshBasicMaterial} for the glow around an axis ring: faint even when TransformControls highlights
 * it by setting the opacity to 1
 */
const haloMaterial = (THREE, color, opacity = 0.6) => makeMaterial(THREE, {color, opacity}, 'tw-rotate-halo', `
    float twFront = (twView.z - twCenterView.z) / (twScale * ${RADIUS.toFixed(3)});
    diffuseColor.a *= ${HALO_ALPHA.toFixed(3)} * smoothstep(-0.4, 0.0, twFront);`);

/**
 * @param {typeof THREE} THREE
 * @returns {THREE.MeshBasicMaterial} for the sphere: almost clear in the middle, glowing at the rim
 */
const shellMaterial = THREE => makeMaterial(THREE, {
    color: SHELL_COLOR,
    opacity: SHELL_OPACITY
}, 'tw-rotate-shell', `
    vec3 twNormal = normalize(twView - twCenterView);
    float twRim = 1.0 - abs(dot(twNormal, normalize(-twView)));
    diffuseColor.a *= 0.06 + (0.94 * pow(twRim, 2.5));`);

/**
 * @param {typeof THREE} THREE
 * @param {string} axis 'x', 'y' or 'z'
 * @returns {THREE.TorusGeometry} a full ring of RADIUS around the axis
 */
const ringGeometry = (THREE, axis, tube = RING_TUBE) => {
    const geometry = new THREE.TorusGeometry(RADIUS, tube, 6, 128);
    if (axis === 'x') geometry.rotateY(Math.PI / 2);
    else if (axis === 'y') geometry.rotateX(Math.PI / 2);
    return geometry;
};

const viewRingGeometry = THREE => new THREE.TorusGeometry(VIEW_RADIUS, VIEW_TUBE, 4, 128);
const shellGeometry = THREE => new THREE.SphereGeometry(RADIUS, 48, 32);

/**
 * @param {THREE.Mesh} mesh
 * @param {THREE.BufferGeometry} geometry
 * @param {THREE.Material} material
 */
const replaceMesh = (mesh, geometry, material) => {
    mesh.geometry.dispose();
    mesh.geometry = geometry;
    // TransformControls' materials are shared between handles, so the old one isn't disposed
    mesh.material = material;
};

/**
 * Turn the half rings of TransformControls' rotate gizmo into the sphere. Handles keep their names, so picking and
 * highlighting the axis under the pointer still work.
 * @param {TransformControls} transform
 * @param {typeof THREE} THREE
 */
const styleGizmo = (transform, THREE) => {
    const group = transform._gizmo.gizmo.rotate;
    for (const handle of [...group.children]) {
        const axis = handle.name.toLowerCase();
        if (AXES.includes(axis)) {
            replaceMesh(handle, ringGeometry(THREE, axis), ringMaterial(THREE, AXIS_COLORS[axis]));
            // Named like the ring, so that TransformControls turns it and highlights it with the ring
            const halo = new THREE.Mesh(ringGeometry(THREE, axis, HALO_TUBE), haloMaterial(THREE, AXIS_COLORS[axis]));
            halo.name = handle.name;
            halo.renderOrder = Number.MAX_SAFE_INTEGER - 1;
            group.add(halo);
        } else if (handle.name === 'XYZE') {
            // Dragging inside the sphere turns it like a trackball
            replaceMesh(handle, shellGeometry(THREE), shellMaterial(THREE));
            // Drawn first, so that the rings stay on top
            handle.renderOrder = Number.MAX_SAFE_INTEGER - 1;
        } else if (handle.name === 'E') {
            replaceMesh(handle, viewRingGeometry(THREE), makeMaterial(THREE, {
                color: VIEW_COLOR,
                opacity: 0.45
            }, 'tw-rotate-view', ''));
        }
    }
};

/**
 * The wedge that shows the angle turned so far, around the axis of the rotation.
 */
class RotationSweep {
    /**
     * @param {typeof THREE} THREE
     */
    constructor (THREE) {
        this.THREE = THREE;
        this.group = new THREE.Group();
        this.group.visible = false;
        this.group.renderOrder = Infinity;
        this._fill = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
            color: SWEEP_COLOR,
            opacity: SWEEP_OPACITY,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
            transparent: true
        }));
        this._edge = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
            color: SWEEP_COLOR,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
            transparent: true
        }));
        this._ticks = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
            color: SWEEP_COLOR,
            opacity: TICK_OPACITY,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
            transparent: true
        }));
        for (const object of this._objects) {
            object.renderOrder = Infinity;
            object.frustumCulled = false;
            this.group.add(object);
        }
    }

    get _objects () {
        return [this._fill, this._edge, this._ticks];
    }

    /**
     * @param {THREE.Vector3} center in world space
     * @param {THREE.Vector3} axis unit vector the sprite turns around, in world space
     * @param {THREE.Vector3} start direction (in the plane of the rotation) where the sweep starts
     * @param {number} angle radians around the axis, like THREE.Quaternion.setFromAxisAngle
     * @param {number} radius in world units
     */
    update (center, axis, start, angle, radius) {
        const THREE = this.THREE;
        const from = start.clone().projectOnPlane(axis);
        if (from.lengthSq() < 1e-8) {
            // The start is along the axis: any direction in the plane will do
            from.set(1, 0, 0).projectOnPlane(axis);
            if (from.lengthSq() < 1e-8) from.set(0, 1, 0).projectOnPlane(axis);
        }
        from.normalize().multiplyScalar(radius);
        const sweep = Math.max(-2 * Math.PI, Math.min(2 * Math.PI, angle));
        const segments = Math.max(1, Math.ceil(Math.abs(sweep) / SWEEP_STEP));
        const rim = [];
        const quaternion = new THREE.Quaternion();
        for (let i = 0; i <= segments; i++) {
            quaternion.setFromAxisAngle(axis, sweep * i / segments);
            rim.push(from.clone().applyQuaternion(quaternion));
        }

        const fill = [];
        for (let i = 0; i < segments; i++) {
            fill.push(0, 0, 0, rim[i].x, rim[i].y, rim[i].z, rim[i + 1].x, rim[i + 1].y, rim[i + 1].z);
        }
        this._setPositions(this._fill, fill);
        // Center → start, around the rim, → center
        const edge = [0, 0, 0];
        for (const point of rim) edge.push(point.x, point.y, point.z);
        edge.push(0, 0, 0);
        this._setPositions(this._edge, edge);

        const ticks = [];
        const direction = new THREE.Vector3();
        for (let i = 0; i < Math.round(2 * Math.PI / TICK_STEP); i++) {
            direction.copy(from).applyQuaternion(quaternion.setFromAxisAngle(axis, i * TICK_STEP));
            const inner = direction.clone().multiplyScalar(i % 6 === 0 ? 0.8 : 0.9);
            ticks.push(inner.x, inner.y, inner.z, direction.x, direction.y, direction.z);
        }
        this._setPositions(this._ticks, ticks);

        this.group.position.copy(center);
        this.group.visible = true;
    }

    _setPositions (object, positions) {
        object.geometry.dispose();
        object.geometry = new this.THREE.BufferGeometry();
        object.geometry.setAttribute('position', new this.THREE.Float32BufferAttribute(positions, 3));
    }

    hide () {
        this.group.visible = false;
    }

    dispose () {
        this.group.removeFromParent();
        for (const object of this._objects) {
            object.geometry.dispose();
            object.material.dispose();
        }
    }
}

/**
 * The sphere on its own, for rotating with the R key while the gizmo is hidden.
 */
class RotateSphere {
    /**
     * @param {typeof THREE} THREE
     */
    constructor (THREE) {
        this.THREE = THREE;
        this.group = new THREE.Group();
        /** Rings and shell: turned to the axes in use, scaled to stay the same size on screen */
        this._ball = new THREE.Group();
        this._shell = new THREE.Mesh(shellGeometry(THREE), shellMaterial(THREE));
        this._shell.renderOrder = Number.MAX_SAFE_INTEGER - 1;
        this._ball.add(this._shell);
        this._rings = {};
        this._halos = {};
        for (const axis of AXES) {
            const ring = new THREE.Mesh(ringGeometry(THREE, axis), ringMaterial(THREE, AXIS_COLORS[axis]));
            ring.renderOrder = Number.MAX_SAFE_INTEGER;
            this._rings[axis] = ring;
            const halo = new THREE.Mesh(ringGeometry(THREE, axis, HALO_TUBE), haloMaterial(THREE, AXIS_COLORS[axis]));
            halo.renderOrder = Number.MAX_SAFE_INTEGER - 1;
            this._halos[axis] = halo;
            this._ball.add(ring, halo);
        }
        this._view = new THREE.Mesh(viewRingGeometry(THREE), makeMaterial(THREE, {
            color: VIEW_COLOR,
            opacity: 0.45
        }, 'tw-rotate-view', ''));
        this._view.renderOrder = Number.MAX_SAFE_INTEGER;
        this.group.add(this._ball, this._view);
        this.sweep = new RotationSweep(THREE);
        this.group.add(this.sweep.group);
        for (const object of this._meshes) object.frustumCulled = false;
    }

    get _meshes () {
        return [this._shell, this._view, ...Object.values(this._rings), ...Object.values(this._halos)];
    }

    /**
     * @param {object} state
     * @param {THREE.PerspectiveCamera} state.camera the editor camera
     * @param {THREE.Vector3} state.center where the sprite is
     * @param {THREE.Quaternion} state.orientation how the rings are turned: the sprite's rotation, or none
     * @param {?string} state.axis the axis the rotation is locked to, or null to turn around the view
     * @param {THREE.Vector3} state.rotationAxis unit vector the sprite turns around
     * @param {THREE.Vector3} state.start direction where the rotation started
     * @param {number} state.angle radians turned so far
     */
    update ({camera, center, orientation, axis, rotationAxis, start, angle}) {
        const scale = gizmoScale(camera, center);
        this._ball.position.copy(center);
        this._ball.quaternion.copy(orientation);
        this._ball.scale.setScalar(scale);
        this._view.position.copy(center);
        this._view.quaternion.copy(camera.getWorldQuaternion(new this.THREE.Quaternion()));
        this._view.scale.setScalar(scale);
        // The ring being used stands out, the others step back
        for (const name of AXES) {
            const used = axis === name;
            this._rings[name].material.opacity = !axis || used ? 1 : 0.25;
            this._halos[name].material.opacity = used ? 1 : 0.4;
        }
        this._view.material.opacity = axis ? 0.2 : 0.9;
        const ringRadius = (axis ? RADIUS : VIEW_RADIUS) * scale;
        this.sweep.update(center, rotationAxis, start, angle, ringRadius);
    }

    dispose () {
        this.group.removeFromParent();
        this.sweep.dispose();
        for (const object of this._meshes) {
            object.geometry.dispose();
            object.material.dispose();
        }
    }
}

module.exports = {
    AXIS_COLORS,
    RADIUS,
    VIEW_RADIUS,
    gizmoScale,
    styleGizmo,
    RotationSweep,
    RotateSphere
};

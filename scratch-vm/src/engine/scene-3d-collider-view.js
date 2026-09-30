// Shows the collider of every 3D sprite as a see-through shape with its edges, to see what collision and physics
// actually use: the exact shapes of Physics3D, the pieces of convex decompositions included. The editor's toolbar
// shows them to the editor camera only (like the grid); a block shows them to every camera, in the player too.
//
// Colors say how a sprite's body moves: green for kinematic, blue for static, orange for dynamic; dynamic bodies that
// fell asleep fade. The pieces of a decomposition have different shades. The selected sprite's collider is brighter.

const COLORS = {
    kinematic: 0x3ddc84,
    static: 0x4c97ff,
    dynamic: 0xff8c1a
};
const FILL_OPACITY = 0.2;
const SELECTED_FILL_OPACITY = 0.35;
const LINE_OPACITY = 0.7;
const SLEEPING_FADE = 0.4;
// Edges between faces of a mesh or of a convex decomposition's pieces that turn less than this (degrees) aren't drawn,
// so that they aren't covered in lines. Every edge of a single convex hull is drawn: it has few faces, and without
// them round hulls had no lines at all.
const MESH_EDGE_ANGLE = 20;
const HULL_EDGE_ANGLE = 1;
// Segments of the circles that outline spheres and capsules
const CIRCLE_SEGMENTS = 48;

/**
 * @param {number[]} points line segments, as pairs of points, to add to
 * @param {function(number): number[]} at the point at an angle
 * @param {number} from angle
 * @param {number} to angle
 */
const addArc = (points, at, from, to) => {
    const steps = Math.max(1, Math.round(CIRCLE_SEGMENTS * Math.abs(to - from) / (Math.PI * 2)));
    for (let i = 0; i < steps; i++) {
        points.push(...at(from + ((to - from) * i / steps)), ...at(from + ((to - from) * (i + 1) / steps)));
    }
};

/**
 * @param {number} radius
 * @param {number} halfHeight 0 for a sphere
 * @returns {number[]} line segments that outline a sphere or a standing capsule, like Unity: a circle around each
 * axis, stretched into the capsule's outline
 */
const roundOutline = (radius, halfHeight) => {
    const points = [];
    // Around the y axis, at the top and bottom of the straight part
    for (const y of halfHeight > 0 ? [halfHeight, -halfHeight] : [0]) {
        addArc(points, a => [Math.cos(a) * radius, y, Math.sin(a) * radius], 0, Math.PI * 2);
    }
    // Around the x and z axes: two half circles, joined by straight lines
    for (const side of [[1, 0], [0, 1]]) {
        const at = y => a => [
            side[0] * Math.cos(a) * radius,
            y + (Math.sin(a) * radius),
            side[1] * Math.cos(a) * radius
        ];
        addArc(points, at(halfHeight), 0, Math.PI);
        addArc(points, at(-halfHeight), Math.PI, Math.PI * 2);
        if (halfHeight > 0) {
            for (const sign of [1, -1]) {
                points.push(sign * side[0] * radius, halfHeight, sign * side[1] * radius,
                    sign * side[0] * radius, -halfHeight, sign * side[1] * radius);
            }
        }
    }
    return points;
};
// Lightness steps between the pieces of a convex decomposition
const PIECE_SHADES = [0, -0.12, 0.1, -0.22, 0.18];

class ColliderView {
    /**
     * @param {Scene3D} scene3D
     */
    constructor (scene3D) {
        this.scene3D = scene3D;
        this.runtime = scene3D.runtime;
        /** Shown to every camera, by the block */
        this.shown = false;
        /** @type {?THREE.Group} */
        this._group = null;
        /** @type {Map<Target3D, {style: string, object: THREE.Object3D}>} what is drawn for each sprite */
        this._objects = new Map();
        /** @type {Map<string, THREE.BufferGeometry[][]>} [fill, edges] of each piece, by the collider's key */
        this._geometries = new Map();
        /** @type {Map<string, THREE.Material>} */
        this._materials = new Map();
    }

    /**
     * @param {boolean} shown true to show colliders to every camera
     */
    setShown (shown) {
        shown = !!shown;
        if (this.shown === shown) return;
        this.shown = shown;
        if (shown) this.scene3D.physics.load();
        this.scene3D.markDirty();
    }

    /**
     * @returns {boolean} true if the editor's toolbar shows colliders to the editor camera
     */
    get _shownInEditor () {
        const editor = this.scene3D.editor;
        return editor.enabled && editor.collidersVisible;
    }

    /**
     * Bring the shapes up to date. Called before every render of the scene.
     */
    update () {
        const scene3D = this.scene3D;
        const physics = scene3D.physics;
        const visible = this.shown || this._shownInEditor;
        if (!visible || !scene3D.scene) {
            if (this._group) this._group.visible = false;
            return;
        }
        if (!physics.ready) {
            physics.load().then(loaded => {
                if (loaded) scene3D.markDirty();
            });
            if (this._group) this._group.visible = false;
            return;
        }
        const THREE = scene3D.THREE;
        if (!this._group) {
            this._group = new THREE.Group();
            this._group.name = 'colliders';
            scene3D.scene.add(this._group);
        }
        const group = this._group;
        group.visible = true;
        // The editor camera sees both layers; every other camera only the default one
        const layer = this.shown ? 0 : scene3D.constructor.EDITOR_LAYER;
        const selected = scene3D.editor.enabled ? this.runtime.getEditingTarget() : null;

        const seen = new Set();
        const usedKeys = new Set();
        for (const target of scene3D.targets) {
            const shape = physics.getShape(target);
            if (!shape) continue;
            const state = physics.getBodyState(target);
            const isSelected = target === selected;
            const style = `${shape.key}|${state.body}|${state.sleeping}|${isSelected}|${layer}`;
            let entry = this._objects.get(target);
            if (!entry || entry.style !== style) {
                if (entry) group.remove(entry.object);
                const pieces = this._getGeometries(shape);
                entry = {style, object: this._makeObject(pieces, state, isSelected, layer)};
                this._objects.set(target, entry);
                group.add(entry.object);
            }
            entry.object.position.set(shape.position.x, shape.position.y, shape.position.z);
            entry.object.quaternion.set(shape.rotation.x, shape.rotation.y, shape.rotation.z, shape.rotation.w);
            seen.add(target);
            usedKeys.add(shape.key);
        }
        for (const [target, entry] of this._objects) {
            if (!seen.has(target)) {
                group.remove(entry.object);
                this._objects.delete(target);
            }
        }
        for (const [key, pieces] of this._geometries) {
            if (usedKeys.has(key)) continue;
            for (const piece of pieces) {
                for (const geometry of piece) geometry.dispose();
            }
            this._geometries.delete(key);
        }
    }

    /**
     * @param {{shape: object, key: string}} shape from Physics3D.getShape
     * @returns {THREE.BufferGeometry[][]} the [fill, edges] of each piece of the collider, around its center
     */
    _getGeometries (shape) {
        let pieces = this._geometries.get(shape.key);
        if (pieces) return pieces;
        const THREE = this.scene3D.THREE;
        const RAPIER = this.scene3D.physics.RAPIER;
        const collider = shape.shape;
        const fills = [];
        let edgeAngle = HULL_EDGE_ANGLE;
        let outline = null;
        const fromTriangles = (vertices, indices) => {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
            geometry.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
            return geometry;
        };
        // Rapier works out the triangles of a convex hull when the shape is converted
        const hull = raw => fromTriangles(raw.vertices(), raw.indices());
        switch (collider.type) {
        case RAPIER.ShapeType.Ball:
            fills.push(new THREE.SphereGeometry(collider.radius, 24, 12));
            outline = roundOutline(collider.radius, 0);
            break;
        case RAPIER.ShapeType.Capsule:
            fills.push(new THREE.CapsuleGeometry(collider.radius, collider.halfHeight * 2, 8, 24));
            outline = roundOutline(collider.radius, collider.halfHeight);
            break;
        case RAPIER.ShapeType.Cylinder:
            fills.push(new THREE.CylinderGeometry(collider.radius, collider.radius, collider.halfHeight * 2, 24));
            break;
        case RAPIER.ShapeType.Cuboid: {
            const size = collider.halfExtents;
            fills.push(new THREE.BoxGeometry(size.x * 2, size.y * 2, size.z * 2));
            break;
        }
        case RAPIER.ShapeType.TriMesh:
            fills.push(fromTriangles(collider.vertices, collider.indices));
            edgeAngle = MESH_EDGE_ANGLE;
            break;
        case RAPIER.ShapeType.ConvexPolyhedron:
            fills.push(hull(collider.intoRaw()));
            break;
        case RAPIER.ShapeType.Compound:
            edgeAngle = MESH_EDGE_ANGLE;
            // Physics3D places every piece at the compound's origin
            for (const piece of collider.shapes) {
                const raw = piece.intoRaw();
                try {
                    fills.push(hull(raw));
                } finally {
                    raw.free();
                }
            }
            break;
        }
        pieces = fills.map(fill => {
            let edges;
            if (outline) {
                edges = new THREE.BufferGeometry();
                edges.setAttribute('position', new THREE.Float32BufferAttribute(outline, 3));
            } else {
                edges = new THREE.EdgesGeometry(fill, edgeAngle);
            }
            return [fill, edges];
        });
        this._geometries.set(shape.key, pieces);
        return pieces;
    }

    /**
     * @param {THREE.BufferGeometry[][]} pieces from _getGeometries
     * @param {{body: string, sleeping: boolean}} state how the sprite's body moves
     * @param {boolean} selected
     * @param {number} layer
     * @returns {THREE.Object3D} the collider, to place where it is
     */
    _makeObject (pieces, state, selected, layer) {
        const THREE = this.scene3D.THREE;
        const object = new THREE.Group();
        pieces.forEach(([fill, edges], i) => {
            const shade = pieces.length > 1 ? PIECE_SHADES[i % PIECE_SHADES.length] : 0;
            const style = {body: state.body, sleeping: state.sleeping, selected, shade};
            const mesh = new THREE.Mesh(fill, this._getMaterial('fill', style));
            const lines = new THREE.LineSegments(edges, this._getMaterial('line', style));
            // Drawn over the sprite's own model, which is often in the very same place
            lines.renderOrder = 2;
            object.add(mesh, lines);
        });
        object.traverse(child => {
            child.layers.set(layer);
            // Clicks and "touching the mouse" go to the sprites, never to this
            child.raycast = () => {};
        });
        return object;
    }

    /**
     * @param {string} kind 'fill' or 'line'
     * @param {{body: string, sleeping: boolean, selected: boolean, shade: number}} style
     * @returns {THREE.Material} shared by every collider drawn the same way
     */
    _getMaterial (kind, style) {
        const key = `${kind}|${style.body}|${style.sleeping}|${style.selected}|${style.shade}`;
        let material = this._materials.get(key);
        if (material) return material;
        const THREE = this.scene3D.THREE;
        const color = new THREE.Color(COLORS[style.body] || COLORS.kinematic).offsetHSL(0, 0, style.shade);
        const fade = style.sleeping ? SLEEPING_FADE : 1;
        if (kind === 'fill') {
            material = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: (style.selected ? SELECTED_FILL_OPACITY : FILL_OPACITY) * fade,
                side: THREE.DoubleSide,
                depthWrite: false,
                // Pulled towards the camera, so that it doesn't flicker on the model it matches
                polygonOffset: true,
                polygonOffsetFactor: -1,
                polygonOffsetUnits: -4
            });
        } else {
            material = new THREE.LineBasicMaterial({
                color,
                transparent: true,
                opacity: (style.selected ? 1 : LINE_OPACITY) * fade,
                // Seen through everything, so that colliders inside other models can be found too
                depthTest: false,
                depthWrite: false
            });
        }
        material.toneMapped = false;
        this._materials.set(key, material);
        return material;
    }

    /**
     * Forget everything drawn, e.g. before loading another project. The block's setting goes back to hidden.
     */
    reset () {
        this.shown = false;
        if (this._group) this._group.clear();
        this._objects.clear();
        for (const pieces of this._geometries.values()) {
            for (const piece of pieces) {
                for (const geometry of piece) geometry.dispose();
            }
        }
        this._geometries.clear();
        for (const material of this._materials.values()) material.dispose();
        this._materials.clear();
    }
}

module.exports = ColliderView;

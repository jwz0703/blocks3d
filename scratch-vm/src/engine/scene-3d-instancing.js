/**
 * @fileoverview
 * Automatic instancing (ROADMAP.md 7.1): meshes that share a geometry and a material, like the clones of a sprite or
 * the copies of a model, are drawn with one InstancedMesh per geometry and material instead of one draw call each.
 *
 * It only happens while rendering: right before three.js draws the scene, the meshes that can be instanced are
 * hidden and their world matrices are copied into instanced meshes, and right after, they are shown again. So
 * nothing else (picking, bounding boxes, animations, the editor) knows about it.
 *
 * Each instance is also culled against the camera's frustum, since three.js can only cull an InstancedMesh as a
 * whole. Not while the sun casts shadows though: something outside the view can still cast a shadow into it.
 */

// Fewer copies than this are drawn as they are
const MIN_INSTANCES = 4;

// An instanced mesh that wasn't needed for this many renders is thrown away
const UNUSED_RENDERS = 120;

class Instancing {
    /**
     * @param {Scene3D} scene3D
     */
    constructor (scene3D) {
        this.scene3D = scene3D;
        /** Turned off to compare, or if something goes wrong */
        this.enabled = true;

        /** @type {Map<string, {mesh: THREE.InstancedMesh, unused: number}>} by geometry, material and shadows */
        this._pool = new Map();
        /** @type {THREE.Mesh[]} meshes hidden for the current render */
        this._hidden = [];

        /** What the last render did, for the performance panel (7.4) */
        this.stats = {
            batches: 0,
            instances: 0,
            culled: 0
        };

        this._frustum = null;
        this._sphere = null;
        this._matrix = null;
    }

    /**
     * @param {THREE.Object3D} mesh
     * @returns {boolean} true if the mesh can be drawn as an instance
     */
    _canInstance (mesh) {
        if (!mesh.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh || mesh.isBatchedMesh) return false;
        const material = mesh.material;
        // Instances aren't sorted back to front
        if (!material || Array.isArray(material) || material.transparent) return false;
        const geometry = mesh.geometry;
        if (!geometry || Object.keys(geometry.morphAttributes).length > 0) return false;
        // Only on the default layer; the editor's helpers are on another one
        return mesh.layers.mask === 1 && !mesh.onBeforeRender.length;
    }

    /**
     * @param {THREE.Object3D} root
     * @param {Map<string, THREE.Mesh[]>} groups meshes by key
     */
    _collect (root, groups) {
        root.traverseVisible(object => {
            if (!this._canInstance(object)) return;
            const key = `${object.geometry.id}/${object.material.id}/${object.castShadow}/${object.receiveShadow}`;
            let group = groups.get(key);
            if (!group) {
                group = [];
                groups.set(key, group);
            }
            group.push(object);
        });
    }

    /**
     * @param {string} key
     * @param {THREE.Mesh} example a mesh of the group
     * @param {number} count how many instances are needed
     * @returns {THREE.InstancedMesh} an instanced mesh with room for count instances, in the scene
     */
    _getInstancedMesh (key, example, count) {
        const THREE = this.scene3D.THREE;
        let entry = this._pool.get(key);
        if (entry && entry.mesh.instanceMatrix.count < count) {
            this._removeEntry(key, entry);
            entry = null;
        }
        if (!entry) {
            // Room to grow, so that adding clones one by one doesn't make a new one every time
            let capacity = 16;
            while (capacity < count) capacity *= 2;
            const mesh = new THREE.InstancedMesh(example.geometry, example.material, capacity);
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.castShadow = example.castShadow;
            mesh.receiveShadow = example.receiveShadow;
            // Culled per instance below, or not at all
            mesh.frustumCulled = false;
            mesh.matrixAutoUpdate = false;
            mesh.userData.twInstancing = true;
            this.scene3D.scene.add(mesh);
            entry = {mesh, unused: 0};
            this._pool.set(key, entry);
        }
        entry.unused = 0;
        entry.mesh.visible = true;
        return entry.mesh;
    }

    _removeEntry (key, entry) {
        entry.mesh.removeFromParent();
        // Geometry and material belong to the meshes that were instanced
        entry.mesh.dispose();
        this._pool.delete(key);
    }

    /**
     * Replace the meshes that can be instanced with instanced meshes. Call end() after rendering.
     * @param {THREE.Camera} camera the camera that the scene is rendered with
     */
    begin (camera) {
        const scene3D = this.scene3D;
        const stats = this.stats;
        stats.batches = 0;
        stats.instances = 0;
        stats.culled = 0;
        if (!this.enabled || !scene3D.scene) return;
        const THREE = scene3D.THREE;
        if (!this._frustum) {
            this._frustum = new THREE.Frustum();
            this._sphere = new THREE.Sphere();
            this._matrix = new THREE.Matrix4();
        }

        const groups = new Map();
        for (const target of scene3D.targets) {
            const group = target.object3D;
            if (group && group.userData.twModelObject && scene3D.isShownInScene(target)) {
                this._collect(group.userData.twModelObject, groups);
            }
        }
        for (const object of scene3D.objects.values()) {
            if (object.visible) this._collect(object, groups);
        }

        let used = false;
        for (const meshes of groups.values()) {
            if (meshes.length >= MIN_INSTANCES) {
                used = true;
                break;
            }
        }
        if (used) {
            scene3D.scene.updateMatrixWorld();
            camera.updateMatrixWorld();
            this._frustum.setFromProjectionMatrix(
                this._matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
            );
        }
        const cull = used && !scene3D.castsShadows();

        for (const [key, meshes] of groups) {
            if (meshes.length < MIN_INSTANCES) continue;
            const instanced = this._getInstancedMesh(key, meshes[0], meshes.length);
            const geometry = meshes[0].geometry;
            if (cull && !geometry.boundingSphere) geometry.computeBoundingSphere();
            let count = 0;
            for (const mesh of meshes) {
                mesh.visible = false;
                this._hidden.push(mesh);
                if (cull) {
                    this._sphere.copy(geometry.boundingSphere).applyMatrix4(mesh.matrixWorld);
                    if (!this._frustum.intersectsSphere(this._sphere)) {
                        stats.culled++;
                        continue;
                    }
                }
                instanced.setMatrixAt(count++, mesh.matrixWorld);
            }
            instanced.count = count;
            instanced.instanceMatrix.clearUpdateRanges();
            instanced.instanceMatrix.addUpdateRange(0, count * 16);
            instanced.instanceMatrix.needsUpdate = true;
            stats.batches++;
            stats.instances += count;
        }

        for (const [key, entry] of this._pool) {
            if (groups.has(key) && groups.get(key).length >= MIN_INSTANCES) continue;
            entry.mesh.visible = false;
            if (++entry.unused > UNUSED_RENDERS) this._removeEntry(key, entry);
        }
    }

    /**
     * Show the meshes that begin() hid.
     */
    end () {
        for (const mesh of this._hidden) mesh.visible = true;
        this._hidden.length = 0;
    }

    /**
     * Throw away every instanced mesh, e.g. before loading another project.
     */
    reset () {
        this.end();
        for (const [key, entry] of this._pool) this._removeEntry(key, entry);
    }
}

module.exports = Instancing;

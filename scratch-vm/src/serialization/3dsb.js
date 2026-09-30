/**
 * @fileoverview
 * The .3dsb project format of Blocks3D.
 *
 * A .3dsb file is a zip with project.json and the assets, like .sb3. project.json has the same blocks, variables,
 * sounds, monitors, fonts and files as .sb3 (they are read and written by sb3.js), plus:
 *
 * - meta.format: "3dsb" and meta.formatVersion (see MIGRATIONS)
 * - kind: "2d", "3d", "camera" or "canvas" on every target (canvas sprites are 2D sprites that show a canvas the
 *   pen and other code draw on, see sprites/canvas-target.js; like 3D and camera sprites they have no costumes of
 *   their own)
 * - on 3D sprites: position, rotation (degrees), scale, visible, models, currentModel and material,
 *   in place of costumes and the 2D position, size and direction; physics (body type, collider shape, mass, bounce,
 *   friction, rotation lock, damping, whether it collides (also while hidden) and its collision group, see
 *   engine/scene-3d-physics.js) and parent, the name of the sprite it is attached to
 * - on camera sprites: position, rotation and fov (see sprites/camera-target.js)
 * - on sprites: mouseMode 'pass' or 'block' (none: 'auto'), whether the mouse goes through them (see
 *   RenderedTarget.mouseMode). Older projects have clickable: false, which is 'pass'.
 * - on sprites: interface {events: [{name}], public: [prototype block ids]}, the events it sends and the custom
 *   blocks other sprites can call (see engine/sprite-interface.js)
 * - components: {id: {name, color, props, outputs, interface, root, members}}, the definitions of components
 *   (engine/components.js);
 *   root is the sprite they are made of (blocks, costumes, sounds, variables...). Their instances are in targets
 *   with `component` (the id) and `props` (the values that differ from the defaults), and only what is their own:
 *   name, position, size, layer, look, and the variables whose values differ from the ones of root.
 * - on the backdrops of the stage: environment (sky, lighting, sun, fog and tone mapping, see
 *   engine/scene-3d-environment.js). Backdrops without one show their 2D picture behind the 3D scene.
 * - on the stage: currentCamera, the name of the camera sprite that the stage shows (none: the default camera),
 *   gravity {x, y, z}, collisionGroups (for each of the 16 collision groups, the bits of the groups it collides
 *   with; none: every group collides with every group) and screen {mode, width, height, renderScale, shadows},
 *   how the stage fits the screen (see engine/screen.js; none: a fixed 480x360 stage)
 *
 * .sb3 projects can still be opened (all their sprites are 2D), but projects are only saved as .3dsb.
 */

const JSZip = require('@turbowarp/jszip');
const sb3 = require('./sb3');
const placeholder3D = require('../sprites/tw-3d-placeholder');
const placeholderCamera = require('../sprites/tw-camera-placeholder');
const placeholderCanvas = require('../sprites/tw-canvas-placeholder');
const Environment = require('../engine/scene-3d-environment');
const Screen = require('../engine/screen');
const SpriteInterface = require('../engine/sprite-interface');
const {normalizeComponent} = require('../engine/components');

// The costume that sprites of these kinds get when loaded, since they don't save any
const PLACEHOLDERS = {
    '3d': placeholder3D,
    'camera': placeholderCamera,
    'canvas': placeholderCanvas
};

const FORMAT = '3dsb';

const FORMAT_VERSION = 5;

/**
 * @param {object} options
 * @param {string} [options.name] sprite name
 * @param {{x: number, y: number, z: number}} [options.position]
 * @param {{x: number, y: number, z: number}} [options.rotation] degrees
 * @param {number} [options.fov] vertical field of view, degrees
 * @returns {object} a camera sprite as it appears in project.json
 */
const makeCameraJSON = (options = {}) => ({
    isStage: false,
    name: typeof options.name === 'string' && options.name ? options.name : '相機',
    kind: 'camera',
    variables: {},
    lists: {},
    broadcasts: {},
    blocks: {},
    comments: {},
    sounds: [],
    costumes: [],
    volume: 100,
    draggable: false,
    position: options.position || {x: 0, y: 0, z: 5},
    rotation: options.rotation || {x: 0, y: 0, z: 0},
    fov: typeof options.fov === 'number' ? options.fov : 60
});

/**
 * MIGRATIONS[N] turns a project.json with formatVersion N into formatVersion N + 1, in place.
 * When changing the format: increase FORMAT_VERSION and add the function for the previous version here.
 * @type {Object.<number, function(object): void>}
 */
const MIGRATIONS = {
    // The camera becomes a camera sprite, and the one environment of the project becomes the environment of every
    // backdrop
    1: json => {
        const targets = Array.isArray(json.targets) ? json.targets : [];
        const stage = targets.find(target => target && target.isStage);
        if (!stage) return;
        const old = stage.environment && typeof stage.environment === 'object' ? stage.environment : {};
        delete stage.environment;
        const environment = Environment.fromVersion1(old);
        for (const costume of Array.isArray(stage.costumes) ? stage.costumes : []) {
            costume.environment = JSON.parse(JSON.stringify(environment));
        }
        const camera = old.camera && typeof old.camera === 'object' ? old.camera : {};
        const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
        const names = targets.map(target => target && target.name);
        let name = '相機';
        for (let i = 2; names.includes(name); i++) name = `相機${i}`;
        const cameraJSON = makeCameraJSON({
            name,
            position: {x: number(camera.x, 0), y: number(camera.y, 0), z: number(camera.z, 5)},
            rotation: {x: number(camera.pitch, 0), y: number(camera.yaw, 0), z: 0},
            fov: number(camera.fov, 60)
        });
        cameraJSON.layerOrder = targets.length;
        targets.push(cameraJSON);
        stage.currentCamera = name;
    },
    // Variables became paths (ROADMAP.md 4.12). The blocks are converted once the targets are loaded, by
    // tw-data-upgrade.js, which needs to know that the project is older than this (see VirtualMachine.installTargets)
    2: () => {},
    // Components (ROADMAP.md 階段 10): `components`, and instances in `targets`. Older projects have none.
    3: () => {},
    // Components are their own coordinate systems, and their root is their interface: positions of members are
    // in the component, properties are variables of the root, and global broadcasts are gone (outputs took their
    // place). The components of older versions aren't converted; what only they had is dropped.
    4: json => {
        for (const component of Object.values(json.components && typeof json.components === 'object' ?
            json.components : {})) {
            delete component.globals;
        }
    }
};

// Properties of 2D sprites that 3D sprites don't use
const SPRITE_2D_PROPERTIES = ['x', 'y', 'size', 'direction', 'rotationStyle'];

/**
 * @param {unknown} json parsed project.json
 * @returns {boolean} true if it is a .3dsb project.json
 */
const is3dsb = json => !!(
    json &&
    typeof json === 'object' &&
    json.meta &&
    json.meta.format === FORMAT
);

/**
 * Bring a .3dsb project.json up to the current format version, in place.
 * @param {object} json parsed project.json
 * @returns {object} the same object
 */
const migrate = json => {
    let version = Number(json.meta.formatVersion);
    if (!Number.isInteger(version) || version < 1) version = 1;
    if (version > FORMAT_VERSION) {
        throw new Error(`This project needs a newer version of Blocks3D (format version ${version}).`);
    }
    while (version < FORMAT_VERSION) {
        MIGRATIONS[version](json);
        version++;
    }
    json.meta.formatVersion = FORMAT_VERSION;
    return json;
};

/**
 * @param {ArrayBuffer|ArrayBufferView} data
 * @returns {Uint8Array}
 */
const toBytes = data => (
    data instanceof ArrayBuffer ?
        new Uint8Array(data) :
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
);

const parseJSON = text => {
    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
};

/**
 * Find out whether some project data is a .3dsb project.
 * @param {string|ArrayBuffer|ArrayBufferView|object} input zip, project.json as text or bytes, or parsed
 * @returns {Promise<?{json: object, zip: ?JSZip}>} the project, or null if it isn't a .3dsb project
 */
const unpack = async input => {
    if (typeof input === 'string') {
        const json = parseJSON(input);
        return is3dsb(json) ? {json, zip: null} : null;
    }
    if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
        const bytes = toBytes(input);
        // "PK", the start of a zip
        if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
            let zip;
            try {
                zip = await JSZip.loadAsync(bytes);
            } catch (e) {
                return null;
            }
            const projectFile = zip.file(/^([^/]*\/)?project\.json$/)[0];
            if (!projectFile) return null;
            const json = parseJSON(await projectFile.async('string'));
            return is3dsb(json) ? {json, zip} : null;
        }
        // Only a JSON object can be a project, so don't decode other data (e.g. .sb files)
        if (bytes[0] !== 0x7b) return null;
        const json = parseJSON(new TextDecoder().decode(bytes));
        return is3dsb(json) ? {json, zip: null} : null;
    }
    if (input && typeof input === 'object') {
        return is3dsb(input) ? {json: input, zip: null} : null;
    }
    return null;
};

// What a target of a component keeps in project.json (the rest is in the definition's root)
const INSTANCE_KEYS = ['isStage', 'name', 'kind', 'x', 'y', 'size', 'direction', 'draggable', 'visible',
    'rotationStyle', 'currentCostume', 'layerOrder', 'volume', 'mouseMode', 'extensionStorage'];
// What a member of a component keeps besides its root (see engine/components.js)
const MEMBER_KEYS = ['x', 'y', 'size', 'direction', 'visible', 'currentCostume', 'rotationStyle', 'draggable'];
// What instances can't have of their own
const NOT_INSTANCE_KEYS = ['component', 'props', 'blocks', 'comments', 'costumes', 'sounds', 'broadcasts'];
// What the root of a definition keeps
const ROOT_KEYS = ['variables', 'lists', 'broadcasts', 'blocks', 'comments', 'costumes', 'sounds', 'currentCostume',
    'volume', 'kind'];

/**
 * Move the definitions of components out of their instances, into json.components.
 * @param {Runtime} runtime
 * @param {object} json project.json
 * @param {Array<Target>} originals the targets of json.targets, in order
 */
const serializeComponents = (runtime, json, originals, only) => {
    const definitions = runtime.components.definitions;
    if (definitions.size === 0) return;
    json.components = {};
    // Blocks of templates and members use extensions too
    const extensions = new Set(json.extensions || []);
    for (const sprite of definitions.values()) {
        // Only some of them (a component of its own, see serializeComponentFile)
        if (only && !only.has(sprite)) continue;
        const component = sprite.component;
        const index = originals.findIndex(target => target.sprite === sprite);
        let rootJSON;
        // A top-level instance, one inside another component, or the hidden one of a definition without instances
        const other = sprite.clones.find(target => target.isOriginal && !target.isPreview) ||
            sprite.componentTemplate;
        if (index >= 0) {
            rootJSON = json.targets[index];
        } else if (other) {
            rootJSON = sb3.serializeTarget(other.toJSON(), extensions);
        } else {
            continue;
        }
        // Properties are variables of the root, saved as the values of the instances that aren't the default
        const propNames = new Set(component.props.map(prop => prop.name));
        const withoutProps = variables => {
            const result = {};
            for (const [id, value] of Object.entries(variables || {})) {
                if (!propNames.has(value[0])) result[id] = value;
            }
            return result;
        };
        const root = {};
        for (const key of ROOT_KEYS) {
            if (Object.prototype.hasOwnProperty.call(rootJSON, key)) root[key] = rootJSON[key];
        }
        if (root.variables) root.variables = withoutProps(root.variables);
        root.kind = root.kind || '2d';
        const entry = {name: sprite.name, color: component.color, props: component.props, root};
        if (component.outputs && component.outputs.length) entry.outputs = component.outputs;
        const iface = SpriteInterface.serialize({sprite});
        if (iface) entry.interface = iface;
        // Members: sprites of the component (with their blocks, costumes...) and instances of other components
        const firstInstance = index >= 0 ? originals[index] : other;
        entry.members = [];
        for (const spec of component.members || []) {
            const member = {key: spec.key, kind: spec.kind, name: spec.name};
            for (const key of MEMBER_KEYS) {
                if (typeof spec[key] !== 'undefined') member[key] = spec[key];
            }
            if (spec.kind === 'component') {
                member.component = spec.componentId;
                member.props = Object.assign({}, spec.props);
            } else {
                const memberTarget = (firstInstance && firstInstance.componentMembers &&
                    firstInstance.componentMembers.get(spec.key)) || spec.template;
                if (!memberTarget) continue;
                const memberJSON = sb3.serializeTarget(memberTarget.toJSON(), extensions);
                member.root = {};
                for (const key of ROOT_KEYS) {
                    if (Object.prototype.hasOwnProperty.call(memberJSON, key)) member.root[key] = memberJSON[key];
                }
                member.root.kind = '2d';
                const memberInterface = SpriteInterface.serialize({sprite: spec.sprite});
                if (memberInterface) member.interface = memberInterface;
            }
            entry.members.push(member);
        }
        if (!entry.members.length) delete entry.members;
        json.components[component.id] = JSON.parse(JSON.stringify(entry));
        originals.forEach((target, i) => {
            if (target.sprite !== sprite) return;
            const targetJSON = json.targets[i];
            const instance = {};
            for (const key of INSTANCE_KEYS) {
                if (Object.prototype.hasOwnProperty.call(targetJSON, key)) instance[key] = targetJSON[key];
            }
            instance.component = component.id;
            if (target.componentProps && Object.keys(target.componentProps).length) {
                instance.props = Object.assign({}, target.componentProps);
            }
            // Variables and lists whose values differ from the ones of the root
            for (const key of ['variables', 'lists']) {
                const own = {};
                const all = key === 'variables' ? withoutProps(targetJSON[key]) : targetJSON[key] || {};
                for (const [id, value] of Object.entries(all)) {
                    const rootValue = root[key] && root[key][id];
                    if (!rootValue || JSON.stringify(rootValue[1]) !== JSON.stringify(value[1])) own[id] = value;
                }
                if (Object.keys(own).length) instance[key] = own;
            }
            json.targets[i] = instance;
        });
    }
    json.extensions = Array.from(extensions);
};

/**
 * Before sb3.js reads the project: every instance of a component becomes a whole sprite (its definition's root with
 * its own values), and definitions without instances get a hidden one. After, see mergeComponents.
 * @param {object} json project.json
 * @returns {Array<?object>} for every target of json.targets: {id, name, props, template} if it is one of these
 */
const expandComponents = json => {
    const components = json.components && typeof json.components === 'object' ? json.components : {};
    const marks = [];
    const used = new Set();
    json.targets = (json.targets || []).map(targetJSON => {
        const definition = targetJSON && components[targetJSON.component];
        if (!definition || !definition.root) {
            marks.push(null);
            return targetJSON;
        }
        used.add(targetJSON.component);
        const full = JSON.parse(JSON.stringify(definition.root));
        for (const key of Object.keys(targetJSON)) {
            if (key === 'variables' || key === 'lists') {
                full[key] = Object.assign({}, full[key], targetJSON[key]);
            } else if (!NOT_INSTANCE_KEYS.includes(key)) {
                // Instances can't have blocks, costumes or sounds of their own
                full[key] = targetJSON[key];
            }
        }
        marks.push({id: targetJSON.component, name: targetJSON.name, props: targetJSON.props || {}, template: false});
        return full;
    });
    // Sprites of members: hidden targets, which become the sprites of the members
    for (const [id, definition] of Object.entries(components)) {
        for (const member of Array.isArray(definition && definition.members) ? definition.members : []) {
            if (!member || member.kind === 'component' || !member.root) continue;
            const full = JSON.parse(JSON.stringify(member.root));
            Object.assign(full, {
                isStage: false,
                name: `\u0000${id}:${member.key}`,
                visible: false,
                x: 0,
                y: 0,
                size: 100,
                direction: 90,
                layerOrder: json.targets.length
            });
            json.targets.push(full);
            marks.push({id, name: full.name, props: {}, template: true, memberKey: member.key});
        }
    }
    for (const [id, definition] of Object.entries(components)) {
        if (used.has(id) || !definition || !definition.root) continue;
        const full = JSON.parse(JSON.stringify(definition.root));
        Object.assign(full, {
            isStage: false,
            name: `\u0000${id}`,
            visible: false,
            x: 0,
            y: 0,
            size: 100,
            direction: 90,
            layerOrder: json.targets.length
        });
        json.targets.push(full);
        marks.push({id, name: full.name, props: {}, template: true});
    }
    return marks;
};

/**
 * After sb3.js: the instances of a component share one sprite, the definition.
 * @param {object} json project.json
 * @param {Runtime} runtime
 * @param {object} result from sb3.deserialize; its targets are in the order of json.targets
 * @param {Array<?object>} marks from expandComponents
 */
const mergeComponents = (json, runtime, result, marks) => {
    const sprites = new Map();
    const firsts = new Map();
    const templates = [];
    const memberTargets = new Map();
    marks.forEach((mark, index) => {
        if (!mark) return;
        const target = result.targets[index];
        if (!target) return;
        if (mark.memberKey) {
            // The sprite of a member; kept hidden, for its blocks, costumes and variables
            memberTargets.set(`${mark.id}:${mark.memberKey}`, target);
            templates.push(target);
            return;
        }
        const definition = json.components[mark.id];
        let sprite = sprites.get(mark.id);
        if (sprite) {
            // Its own copy of the sprite goes
            const own = target.sprite;
            if (runtime.renderer) {
                for (const costume of own.costumes) {
                    if (typeof costume.skinId === 'number') runtime.renderer.destroySkin(costume.skinId);
                }
            }
            own.clones = [];
            own.dispose();
            target.sprite = sprite;
            target.blocks = sprite.blocks;
            target.comments = firsts.get(mark.id).comments;
            sprite.clones.push(target);
        } else {
            sprite = target.sprite;
            sprite.name = String(definition.name || mark.id);
            sprite.component = normalizeComponent(Object.assign({}, definition, {id: mark.id}));
            sprite.interface = SpriteInterface.normalize(definition.interface);
            sprites.set(mark.id, sprite);
            firsts.set(mark.id, target);
            runtime.components.definitions.set(mark.id, sprite);
        }
        if (mark.template) {
            templates.push(target);
        } else {
            target.instanceName = mark.name;
            target.componentProps = Object.assign({}, mark.props);
        }
    });
    for (const target of templates) {
        // Only kept for the variables of the definition
        const sprite = target.sprite;
        sprite.clones = sprite.clones.filter(t => t !== target);
        if (runtime.renderer && typeof target.drawableID === 'number') {
            runtime.renderer.destroyDrawable(target.drawableID, 'sprite');
            target.drawableID = null;
        }
        // A definition without instances keeps its hidden target (members' sprites are kept by their specs)
        if (sprite.component) sprite.componentTemplate = target;
        result.targets.splice(result.targets.indexOf(target), 1);
    }
    // The members of each component, then the member targets of every instance
    for (const [id, sprite] of sprites) {
        const definition = json.components[id];
        sprite.component.members = [];
        for (const member of Array.isArray(definition.members) ? definition.members : []) {
            if (!member || typeof member.key !== 'string') continue;
            const spec = {
                key: member.key,
                kind: member.kind === 'component' ? 'component' : 'sprite',
                name: String(member.name || '')
            };
            for (const key of MEMBER_KEYS) {
                if (typeof member[key] !== 'undefined') spec[key] = member[key];
            }
            if (spec.kind === 'component') {
                spec.componentId = member.component;
                spec.props = Object.assign({}, member.props);
            } else {
                const memberTarget = memberTargets.get(`${id}:${member.key}`);
                if (!memberTarget) continue;
                spec.sprite = memberTarget.sprite;
                spec.sprite.name = spec.name;
                spec.sprite.interface = SpriteInterface.normalize(member.interface);
                spec.variables = memberTarget.variables;
                spec.template = memberTarget;
            }
            sprite.component.members.push(spec);
        }
    }
    for (const target of result.targets.slice()) {
        if (!target.sprite || !target.sprite.component || target.componentOwner) continue;
        const members = runtime.components.buildMembers(target);
        result.targets.splice(result.targets.indexOf(target) + 1, 0, ...members);
    }
};

/**
 * @param {Runtime} runtime
 * @param {string=} targetId only serialize this sprite (for exporting a sprite)
 * @param {object=} options passed to sb3.serialize
 * @returns {object} project.json, or sprite.json if targetId is given
 */
const serialize = (runtime, targetId, options) => {
    const json = sb3.serialize(runtime, targetId, options);
    const originals = targetId ?
        [runtime.getTargetById(targetId)] :
        runtime.targets.filter(target => target.isOriginal && !target.componentOwner && !target.isPreview);
    const targetJSONs = targetId ? [json] : json.targets;

    targetJSONs.forEach((targetJSON, index) => {
        const target = originals[index];
        const iface = SpriteInterface.serialize(target);
        if (iface) targetJSON.interface = iface;
        if (target.isCanvas) {
            targetJSON.kind = 'canvas';
            if (!targetId) {
                delete targetJSON.costumes;
                delete targetJSON.currentCostume;
            }
            return;
        }
        if (!target.is3D) {
            targetJSON.kind = '2d';
            if (target.isStage) {
                // Backdrops without an environment show their 2D picture
                target.getCostumes().forEach((costume, costumeIndex) => {
                    const costumeJSON = targetJSON.costumes[costumeIndex];
                    if (costume.environment && costumeJSON) {
                        costumeJSON.environment = JSON.parse(JSON.stringify(costume.environment));
                    }
                });
                if (!targetId) {
                    const camera = runtime.scene3D.getActiveCamera();
                    if (camera) targetJSON.currentCamera = camera.getName();
                    targetJSON.gravity = Object.assign({}, runtime.scene3D.physics.gravity);
                    if (runtime.scene3D.physics.hasGroupRules()) {
                        targetJSON.collisionGroups = runtime.scene3D.physics.groupMasks.slice();
                    }
                    targetJSON.screen = runtime.getScreenSettings();
                }
            }
            return;
        }
        targetJSON.kind = target.kind;
        for (const property of SPRITE_2D_PROPERTIES) {
            delete targetJSON[property];
        }
        if (!targetId) {
            // Exported sprites keep the placeholder costume so that they are still valid sprites
            delete targetJSON.costumes;
            delete targetJSON.currentCostume;
        }
        Object.assign(targetJSON, target.serialize3D());
    });

    if (!targetId) serializeComponents(runtime, json, originals);

    if (targetId) {
        // Sprites have no meta, but loading them needs to know how old their blocks are
        json.formatVersion = FORMAT_VERSION;
    } else {
        json.meta.format = FORMAT;
        json.meta.formatVersion = FORMAT_VERSION;
    }
    return json;
};

/**
 * Give 3D and canvas sprites the placeholder costume that sb3.js and RenderedTarget expect.
 * @param {object[]} targetJSONs targets from project.json
 * @param {Runtime} runtime
 * @param {?JSZip} zip project zip
 * @returns {?JSZip} zip to load the project from
 */
const addPlaceholderCostumes = (targetJSONs, runtime, zip) => {
    const needed = new Set();
    for (const targetJSON of targetJSONs) {
        if (!Array.isArray(targetJSON.sounds)) targetJSON.sounds = [];
        const placeholder = PLACEHOLDERS[targetJSON.kind];
        if (!placeholder || targetJSON.isStage) continue;
        if (!Array.isArray(targetJSON.costumes) || targetJSON.costumes.length === 0) {
            targetJSON.costumes = [placeholder.makeCostumeJSON()];
            targetJSON.currentCostume = 0;
        }
        if (targetJSON.costumes.some(costume => costume.assetId === placeholder.MD5)) needed.add(placeholder);
    }
    for (const placeholder of needed) {
        if (zip) {
            zip.file(`${placeholder.MD5}.svg`, placeholder.SVG);
        } else if (runtime.storage) {
            // Without a zip (e.g. restore points), assets are loaded from storage
            const storage = runtime.storage;
            const data = new TextEncoder().encode(placeholder.SVG);
            // storage.cache() does the same but logs a deprecation warning
            if (storage.builtinHelper) {
                storage.builtinHelper._store(storage.AssetType.ImageVector, storage.DataFormat.SVG, data,
                    placeholder.MD5);
            } else {
                storage.cache(storage.AssetType.ImageVector, storage.DataFormat.SVG, data, placeholder.MD5);
            }
        } else {
            zip = new JSZip();
            zip.file(`${placeholder.MD5}.svg`, placeholder.SVG);
        }
    }
    return zip;
};

/**
 * @param {object} json .3dsb project.json, or a sprite.json with isSingleSprite
 * @param {Runtime} runtime
 * @param {?JSZip} zip zip with the assets
 * @param {boolean=} isSingleSprite true when adding a single sprite to the current project
 * @returns {Promise<{targets: Target[], extensions: object}>} see sb3.deserialize
 */
const deserialize = async (json, runtime, zip, isSingleSprite) => {
    if (!isSingleSprite) migrate(json);
    const marks = isSingleSprite ? [] : expandComponents(json);
    const targetJSONs = isSingleSprite ? [json] : (json.targets || []);
    zip = addPlaceholderCostumes(targetJSONs, runtime, zip);
    const result = await sb3.deserialize(json, runtime, zip, isSingleSprite);
    if (marks.some(Boolean)) mergeComponents(json, runtime, result, marks);
    const stageJSON = targetJSONs.find(targetJSON => targetJSON && targetJSON.isStage);
    const stage = result.targets.find(target => target && target.isStage);
    // Public interfaces of sprites
    for (const targetJSON of targetJSONs) {
        if (!targetJSON || targetJSON.isStage || !targetJSON.interface) continue;
        const target = isSingleSprite ? result.targets[0] :
            result.targets.find(t => t && !t.isStage && t.getName() === targetJSON.name);
        if (target && target.sprite) target.sprite.interface = SpriteInterface.normalize(targetJSON.interface);
    }
    if (stageJSON && stage && Array.isArray(stageJSON.costumes)) {
        // Costumes are loaded in the same order as project.json lists them
        stage.getCostumes().forEach((costume, index) => {
            const costumeJSON = stageJSON.costumes[index];
            if (costumeJSON && costumeJSON.environment && typeof costumeJSON.environment === 'object') {
                costume.environment = Environment.mergeEnvironment(Environment.default2DEnvironment(),
                    costumeJSON.environment);
            }
        });
    }
    if (!isSingleSprite && stageJSON && typeof stageJSON.currentCamera === 'string') {
        const camera = result.targets.find(target => target && target.isCamera &&
            target.getName() === stageJSON.currentCamera);
        if (camera) runtime.scene3D.setActiveCamera(camera);
    }
    if (!isSingleSprite && stageJSON && stageJSON.gravity && typeof stageJSON.gravity === 'object') {
        runtime.scene3D.physics.setGravity(stageJSON.gravity);
    }
    if (!isSingleSprite && stageJSON && Array.isArray(stageJSON.collisionGroups)) {
        runtime.scene3D.physics.setGroupMasks(stageJSON.collisionGroups);
    }
    if (!isSingleSprite && stageJSON) {
        runtime.setScreenSettings(Screen.normalize(stageJSON.screen));
    }
    if (!isSingleSprite) runtime.scene3D.onBackdropChanged();
    return result;
};

// A component on its own: .3dsc, a zip with component.json (and the costumes and sounds)
const COMPONENT_FORMAT = '3dsc';
const COMPONENT_FORMAT_VERSION = 1;

/**
 * @param {Runtime} runtime
 * @param {Sprite} sprite a definition
 * @returns {Set<Sprite>} the definition, and the components that are in it (and in them)
 */
const componentClosure = (runtime, sprite) => {
    const result = new Set();
    const visit = definition => {
        if (!definition || !definition.component || result.has(definition)) return;
        result.add(definition);
        for (const member of definition.component.members || []) {
            if (member.kind === 'component') visit(runtime.components.definitions.get(member.componentId));
        }
    };
    visit(sprite);
    return result;
};

/**
 * @param {Runtime} runtime
 * @param {Target} instance an instance of a component
 * @returns {{json: object, files: string[]}} the component.json of the component it is an instance of, with the
 * components in it, and the names of the files (costumes and sounds) that it uses
 */
const serializeComponentFile = (runtime, instance) => {
    const holder = runtime.components.holderOf(instance);
    if (!holder) throw new Error('Not a component');
    const extensions = new Set();
    const targetJSON = sb3.serializeTarget(holder.toJSON(), extensions);
    targetJSON.kind = '2d';
    const json = {targets: [targetJSON], extensions: Array.from(extensions)};
    serializeComponents(runtime, json, [holder], componentClosure(runtime, holder.sprite));
    const instanceJSON = json.targets[0];
    // Where it is in the project isn't part of it
    Object.assign(instanceJSON, {x: 0, y: 0});
    delete instanceJSON.layerOrder;
    const file = {
        meta: {
            format: COMPONENT_FORMAT,
            formatVersion: COMPONENT_FORMAT_VERSION,
            semver: '3.0.0',
            platform: {name: 'Blocks3D', url: ''}
        },
        root: holder.sprite.component.id,
        instance: instanceJSON,
        components: json.components || {},
        extensions: json.extensions
    };
    // The files it uses
    const files = new Set();
    const walk = value => {
        if (Array.isArray(value)) {
            value.forEach(walk);
        } else if (value && typeof value === 'object') {
            if (typeof value.md5ext === 'string') files.add(value.md5ext);
            else if (typeof value.assetId === 'string' && typeof value.dataFormat === 'string') {
                files.add(`${value.assetId}.${value.dataFormat}`);
            }
            for (const [key, inner] of Object.entries(value)) {
                if (key !== 'blocks') walk(inner);
            }
        }
    };
    walk(file.components);
    walk(file.instance);
    return {json: file, files: Array.from(files)};
};

/**
 * What is in a component file, for asking before it is added.
 * @param {object} file component.json
 * @returns {{name: string, props: string[], inputs: string[], outputs: string[], components: string[],
 * extensions: string[]}} its name, its interface (the properties, the inputs (public custom blocks) and outputs of
 * its root), the components in it and the extensions it needs
 */
const describeComponentFile = file => {
    const definition = file.components && file.components[file.root];
    if (!definition) throw new Error('Not a component file');
    const iface = definition.interface && Array.isArray(definition.interface.public) ? definition.interface.public : [];
    const blocks = definition.root && definition.root.blocks ? definition.root.blocks : {};
    const label = proccode => String(proccode).replace(/(^|[^\\])%[snb]/g, '$1( )');
    const inputs = iface.map(id => blocks[id])
        .filter(block => block && block.mutation)
        .map(block => label(block.mutation.proccode));
    return {
        name: String(definition.name),
        props: (definition.props || []).map(prop => prop.name),
        inputs,
        outputs: (definition.outputs || []).map(output => label(output.proccode)),
        components: Object.values(file.components)
            .filter(each => each !== definition)
            .map(each => String(each.name)),
        extensions: Array.isArray(file.extensions) ? file.extensions : []
    };
};

/**
 * Make the ids and names of a component file unused in the project, so that adding it doesn't change what is
 * there, and turn it into a project.json with the component and one instance of it.
 * @param {object} file component.json
 * @param {Runtime} runtime
 * @returns {object} a project.json (with a stage that is not part of the project)
 */
const componentFileToProject = (file, runtime) => {
    if (!file || !file.meta || file.meta.format !== COMPONENT_FORMAT) throw new Error('Not a .3dsc file');
    const text = JSON.stringify(file);
    const copy = JSON.parse(text);
    const existing = runtime.components.definitions;
    const takenNames = new Set(Array.from(existing.values()).map(sprite => sprite.name));
    const idMap = new Map();
    const nameMap = new Map();
    for (const [id, definition] of Object.entries(copy.components || {})) {
        let newId = id;
        // A component with the same id is another one (or the same, which the project already has)
        while (existing.has(newId)) {
            newId = `cmp${Math.random().toString(36)
                .slice(2, 12)}`;
        }
        idMap.set(id, newId);
        let name = String(definition.name);
        for (let i = 2; takenNames.has(name); i++) name = `${definition.name}${i}`;
        takenNames.add(name);
        nameMap.set(String(definition.name), name);
        definition.name = name;
    }
    const components = {};
    for (const [id, definition] of Object.entries(copy.components || {})) {
        for (const member of definition.members || []) {
            if (member.kind === 'component' && idMap.has(member.component)) {
                member.component = idMap.get(member.component);
            }
        }
        components[idMap.get(id)] = definition;
    }
    // Blocks that name the components by their names follow
    const rename = value => {
        if (Array.isArray(value)) return value.forEach(rename);
        if (!value || typeof value !== 'object') return;
        if (value.fields && typeof value.fields === 'object') {
            for (const key of ['SPRITE', 'INSTANCE', 'COMPONENT']) {
                const field = value.fields[key];
                if (!Array.isArray(field) || typeof field[0] !== 'string') continue;
                const any = field[0].startsWith('_any_');
                const old = any ? field[0].slice('_any_'.length) : field[0];
                if (key === 'COMPONENT' || any) {
                    if (nameMap.has(old)) field[0] = any ? `_any_${nameMap.get(old)}` : nameMap.get(old);
                }
            }
        }
        for (const inner of Object.values(value)) rename(inner);
    };
    rename(components);
    const instance = copy.instance;
    instance.component = idMap.get(copy.root);
    instance.isStage = false;
    const names = new Set(runtime.targets.filter(target => !target.componentOwner).map(target => target.getName()));
    const baseName = String(instance.name || components[instance.component].name);
    let instanceName = baseName;
    for (let i = 2; names.has(instanceName); i++) instanceName = `${baseName}${i}`;
    instance.name = instanceName;
    return {
        meta: {semver: '3.0.0', format: '3dsb', formatVersion: FORMAT_VERSION},
        targets: [{
            isStage: true,
            name: 'Stage',
            variables: {},
            lists: {},
            broadcasts: {},
            blocks: {},
            comments: {},
            currentCostume: 0,
            costumes: [],
            sounds: [],
            volume: 100,
            layerOrder: 0,
            tempo: 60,
            videoTransparency: 50,
            videoState: 'on',
            textToSpeechLanguage: null,
            kind: '2d'
        }, instance],
        components,
        monitors: [],
        extensions: copy.extensions || [],
        extensionURLs: {}
    };
};

module.exports = {
    COMPONENT_FORMAT,
    serializeComponentFile,
    describeComponentFile,
    componentFileToProject,
    FORMAT,
    FORMAT_VERSION,
    MIGRATIONS,
    makeCameraJSON,
    is3dsb,
    migrate,
    unpack,
    serialize,
    deserialize
};

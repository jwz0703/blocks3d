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
 *   friction, rotation lock, see engine/scene-3d-physics.js) and parent, the name of the sprite it is attached to
 * - on camera sprites: position, rotation and fov (see sprites/camera-target.js)
 * - on the backdrops of the stage: environment (sky, lighting, sun, fog and tone mapping, see
 *   engine/scene-3d-environment.js). Backdrops without one show their 2D picture behind the 3D scene.
 * - on the stage: currentCamera, the name of the camera sprite that the stage shows (none: the default camera),
 *   gravity {x, y, z} and screen {mode, width, height, renderScale, shadows}, how the stage fits the screen (see
 *   engine/screen.js; none: a fixed 480x360 stage)
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

// The costume that sprites of these kinds get when loaded, since they don't save any
const PLACEHOLDERS = {
    '3d': placeholder3D,
    'camera': placeholderCamera,
    'canvas': placeholderCanvas
};

const FORMAT = '3dsb';

const FORMAT_VERSION = 3;

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
    2: () => {}
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
        runtime.targets.filter(target => target.isOriginal);
    const targetJSONs = targetId ? [json] : json.targets;

    targetJSONs.forEach((targetJSON, index) => {
        const target = originals[index];
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
    const targetJSONs = isSingleSprite ? [json] : (json.targets || []);
    zip = addPlaceholderCostumes(targetJSONs, runtime, zip);
    const result = await sb3.deserialize(json, runtime, zip, isSingleSprite);
    const stageJSON = targetJSONs.find(targetJSON => targetJSON && targetJSON.isStage);
    const stage = result.targets.find(target => target && target.isStage);
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
    if (!isSingleSprite && stageJSON) {
        runtime.setScreenSettings(Screen.normalize(stageJSON.screen));
    }
    if (!isSingleSprite) runtime.scene3D.onBackdropChanged();
    return result;
};

module.exports = {
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

/**
 * @fileoverview
 * The .3dsb project format of Blocks3D.
 *
 * A .3dsb file is a zip with project.json and the assets, like .sb3. project.json has the same blocks, variables,
 * sounds, monitors, fonts and files as .sb3 (they are read and written by sb3.js), plus:
 *
 * - meta.format: "3dsb" and meta.formatVersion (see MIGRATIONS)
 * - kind: "2d" or "3d" on every target
 * - on 3D sprites: position, rotation (degrees), scale, visible, models, currentModel and material,
 *   in place of costumes and the 2D position, size and direction
 * - on the stage: environment (background, lights, fog and camera, see engine/scene-3d.js)
 *
 * .sb3 projects can still be opened (all their sprites are 2D), but projects are only saved as .3dsb.
 */

const JSZip = require('@turbowarp/jszip');
const sb3 = require('./sb3');
const placeholder = require('../sprites/tw-3d-placeholder');

const FORMAT = '3dsb';

const FORMAT_VERSION = 1;

/**
 * MIGRATIONS[N] turns a project.json with formatVersion N into formatVersion N + 1, in place.
 * When changing the format: increase FORMAT_VERSION and add the function for the previous version here.
 * @type {Object.<number, function(object): void>}
 */
const MIGRATIONS = {};

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
        if (!target.is3D) {
            targetJSON.kind = '2d';
            if (target.isStage && !targetId) {
                targetJSON.environment = runtime.scene3D.getEnvironment();
            }
            return;
        }
        targetJSON.kind = '3d';
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

    if (!targetId) {
        json.meta.format = FORMAT;
        json.meta.formatVersion = FORMAT_VERSION;
    }
    return json;
};

/**
 * Give 3D sprites the placeholder costume that sb3.js and RenderedTarget expect.
 * @param {object[]} targetJSONs targets from project.json
 * @param {Runtime} runtime
 * @param {?JSZip} zip project zip
 * @returns {?JSZip} zip to load the project from
 */
const addPlaceholderCostumes = (targetJSONs, runtime, zip) => {
    let needed = false;
    for (const targetJSON of targetJSONs) {
        if (!Array.isArray(targetJSON.sounds)) targetJSON.sounds = [];
        if (targetJSON.kind !== '3d' || targetJSON.isStage) continue;
        if (!Array.isArray(targetJSON.costumes) || targetJSON.costumes.length === 0) {
            targetJSON.costumes = [placeholder.makeCostumeJSON()];
            targetJSON.currentCostume = 0;
        }
        if (targetJSON.costumes.some(costume => costume.assetId === placeholder.MD5)) needed = true;
    }
    if (!needed) return zip;
    if (zip) {
        zip.file(`${placeholder.MD5}.svg`, placeholder.SVG);
    } else if (runtime.storage) {
        // Without a zip (e.g. restore points), assets are loaded from storage
        const storage = runtime.storage;
        const data = new TextEncoder().encode(placeholder.SVG);
        // storage.cache() does the same but logs a deprecation warning
        if (storage.builtinHelper) {
            storage.builtinHelper._store(storage.AssetType.ImageVector, storage.DataFormat.SVG, data, placeholder.MD5);
        } else {
            storage.cache(storage.AssetType.ImageVector, storage.DataFormat.SVG, data, placeholder.MD5);
        }
    } else {
        zip = new JSZip();
        zip.file(`${placeholder.MD5}.svg`, placeholder.SVG);
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
    if (!isSingleSprite) {
        const stage = targetJSONs.find(targetJSON => targetJSON.isStage);
        runtime.scene3D.loadEnvironment(stage ? stage.environment : null);
    }
    return result;
};

module.exports = {
    FORMAT,
    FORMAT_VERSION,
    MIGRATIONS,
    is3dsb,
    migrate,
    unpack,
    serialize,
    deserialize
};

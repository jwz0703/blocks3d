/**
 * @fileoverview
 * Reading and writing project files: .3dsb (and .sb3) zips, or a project.json by itself.
 */
const fs = require('fs');
const path = require('path');
const {vmRequire} = require('./paths');
const {allTargets} = require('./model');

const JSZip = vmRequire('@turbowarp/jszip');

/**
 * @param {string} file
 * @returns {Promise<{json: object, zip: ?object}>} project.json and the zip it came from (null for a .json)
 */
const readProject = async file => {
    const data = fs.readFileSync(file);
    if (data[0] === 0x50 && data[1] === 0x4b) {
        const zip = await JSZip.loadAsync(data);
        const entry = zip.file(/^([^/]*\/)?project\.json$/)[0];
        if (!entry) throw new Error(`${file} 裡沒有 project.json`);
        return {json: JSON.parse(await entry.async('string')), zip, entry: entry.name};
    }
    return {json: JSON.parse(data.toString('utf8')), zip: null, entry: null};
};

/**
 * Write a project: a zip with project.json and the files of `assetZip`, or only project.json if the name ends in
 * .json.
 * @param {string} file
 * @param {object} json
 * @param {?object} assetZip the zip to copy the other files from
 */
const writeProject = async (file, json, assetZip) => {
    const text = JSON.stringify(json);
    if (path.extname(file).toLowerCase() === '.json') {
        fs.writeFileSync(file, text);
        return;
    }
    const zip = new JSZip();
    zip.file('project.json', text);
    if (assetZip) {
        // Some zips have everything in a folder; the new one doesn't
        const projectEntry = assetZip.file(/^([^/]*\/)?project\.json$/)[0];
        const folder = projectEntry ? projectEntry.name.slice(0, -'project.json'.length) : '';
        for (const entry of Object.values(assetZip.files)) {
            if (entry.dir || entry === projectEntry) continue;
            const name = folder && entry.name.startsWith(folder) ? entry.name.slice(folder.length) : entry.name;
            zip.file(name, await entry.async('uint8array'));
        }
    }
    const bytes = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: {level: 6}
    });
    fs.writeFileSync(file, bytes);
};

/**
 * @param {object} json project.json
 * @param {?object} zip
 * @returns {string[]} files that the project uses (costumes, sounds, models, fonts, files) but the zip doesn't have
 */
const missingAssets = (json, zip) => {
    if (!zip) return [];
    const have = new Set(Object.keys(zip.files).map(name => name.replace(/^.*\//, '')));
    const missing = new Set();
    const need = file => {
        if (typeof file === 'string' && file && !have.has(file)) missing.add(file);
    };
    const walk = value => {
        if (Array.isArray(value)) {
            value.forEach(walk);
        } else if (value && typeof value === 'object') {
            if (typeof value.md5ext === 'string') need(value.md5ext);
            else if (typeof value.assetId === 'string' && typeof value.dataFormat === 'string') {
                need(`${value.assetId}.${value.dataFormat}`);
            }
            for (const [key, inner] of Object.entries(value)) {
                if (key !== 'blocks') walk(inner);
            }
        }
    };
    for (const target of json.targets || []) walk(Object.assign({}, target, {blocks: null}));
    walk(json.customFonts);
    walk(json.customFiles);
    return [...missing];
};

/**
 * @param {object} json project.json
 * @param {?object} zip
 * @returns {Promise<object>} the text of every SVG costume in the zip, by file name (assetId.svg)
 */
const readSvgs = async (json, zip) => {
    const svgs = {};
    if (!zip) return svgs;
    // Components' sprites too
    for (const target of json.targets ? allTargets(json) : []) {
        for (const costume of target.costumes || []) {
            if (!costume || String(costume.dataFormat).toLowerCase() !== 'svg') continue;
            const file = costume.md5ext || `${costume.assetId}.svg`;
            if (svgs[file] !== void 0) continue;
            const entry = zip.file(file) || Object.values(zip.files).find(e => e.name.endsWith(`/${file}`));
            if (entry) svgs[file] = await entry.async('string');
        }
    }
    return svgs;
};

module.exports = {
    readProject,
    readSvgs,
    writeProject,
    missingAssets
};

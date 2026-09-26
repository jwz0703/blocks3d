const EventEmitter = require('events');
const md5 = require('js-md5');
const log = require('../util/log');

/**
 * @typedef FileAsset
 * Shaped like a scratch-storage Asset so it can go wherever vm.assets goes.
 * @property {string} assetId md5 of data
 * @property {string} dataFormat sanitized file extension
 * @property {Uint8Array} data
 */

/**
 * @typedef InternalFile
 * @property {string} name The file's name, including extension
 * @property {FileAsset} asset
 */

/**
 * @param {string} name
 * @returns {string} lowercase alphanumeric extension, or 'bin'
 */
const getExtension = name => {
    const dot = name.lastIndexOf('.');
    const ext = dot === -1 ? '' : name.substring(dot + 1).toLowerCase()
        .replace(/[^a-z0-9]/g, '');
    return ext || 'bin';
};

const MIME_TYPES = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ktx2: 'image/ktx2',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    mp4: 'video/mp4',
    webm: 'video/webm',
    txt: 'text/plain',
    csv: 'text/csv',
    html: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    json: 'application/json',
    xml: 'application/xml',
    glb: 'model/gltf-binary',
    gltf: 'model/gltf+json',
    ttf: 'font/ttf',
    otf: 'font/otf',
    woff: 'font/woff',
    woff2: 'font/woff2',
    pdf: 'application/pdf',
    zip: 'application/zip'
};

/**
 * @param {string} name Untrusted file name
 * @returns {string}
 */
const sanitizeName = name => {
    // Slashes would make names look like paths, which breaks relative lookups from glTF files.
    const cleaned = String(name).replace(/[/\\\0]/g, '_')
        .trim();
    return cleaned || 'file';
};

/**
 * @param {Uint8Array|ArrayBuffer} data
 * @returns {Uint8Array}
 */
const toUint8Array = data => {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    throw new Error('File data must be an ArrayBuffer or Uint8Array');
};

/**
 * @param {Uint8Array} data
 * @param {string} name
 * @returns {FileAsset}
 */
const createAsset = (data, name) => ({
    assetId: md5(data),
    dataFormat: getExtension(name),
    data,
    // Never try to upload these to the Scratch asset server
    clean: true
});

/**
 * Project-wide files that are saved inside the sb3, like custom fonts.
 * Names are case-insensitive for lookups, like fonts.
 */
class FileManager extends EventEmitter {
    /**
     * @param {Runtime} runtime
     */
    constructor (runtime) {
        super();

        /** @type {Runtime} */
        this.runtime = runtime;

        /** @type {InternalFile[]} */
        this.files = [];
    }

    /**
     * @param {string} name
     * @returns {number}
     */
    _indexOf (name) {
        const lower = String(name).toLowerCase();
        return this.files.findIndex(i => i.name.toLowerCase() === lower);
    }

    /**
     * @param {string} name Untrusted file name
     * @param {string} [ignoreName] A name that should not count as used
     * @returns {string} an unused name, "model (2).glb" style
     */
    getUnusedName (name, ignoreName) {
        name = sanitizeName(name);
        const ignore = typeof ignoreName === 'string' ? ignoreName.toLowerCase() : null;
        const exists = needle => this.files.some(i => {
            const lower = i.name.toLowerCase();
            return lower !== ignore && lower === needle.toLowerCase();
        });
        if (!exists(name)) return name;
        const dot = name.lastIndexOf('.');
        const base = dot > 0 ? name.substring(0, dot) : name;
        const ext = dot > 0 ? name.substring(dot) : '';
        let i = 2;
        while (exists(`${base} (${i})${ext}`)) i++;
        return `${base} (${i})${ext}`;
    }

    /**
     * @param {string} name
     * @returns {string} MIME type guessed from the extension
     */
    getMimeType (name) {
        return MIME_TYPES[getExtension(String(name))] || 'application/octet-stream';
    }

    changed () {
        this.emit('change');
        this.runtime.emitProjectChanged();
    }

    /**
     * @param {string} name
     * @returns {boolean}
     */
    hasFile (name) {
        return this._indexOf(name) !== -1;
    }

    /**
     * @param {string} name Untrusted file name
     * @param {Uint8Array|ArrayBuffer} data
     * @returns {string} The name the file was actually saved as
     */
    addFile (name, data) {
        const finalName = this.getUnusedName(name);
        const bytes = toUint8Array(data);
        this.files.push({
            name: finalName,
            asset: createAsset(bytes, finalName)
        });
        this.changed();
        return finalName;
    }

    /**
     * @param {string} oldName
     * @param {string} newName Untrusted file name
     * @returns {string|null} The name the file was actually renamed to, or null if it doesn't exist
     */
    renameFile (oldName, newName) {
        const index = this._indexOf(oldName);
        if (index === -1) return null;
        const file = this.files[index];
        const finalName = this.getUnusedName(newName, file.name);
        if (finalName === file.name) return finalName;
        file.name = finalName;
        // The extension decides the md5ext in the zip, so it must follow the name
        file.asset = createAsset(file.asset.data, finalName);
        this.changed();
        return finalName;
    }

    /**
     * @param {string} name
     * @returns {boolean} true if a file was removed
     */
    deleteFile (name) {
        const index = this._indexOf(name);
        if (index === -1) return false;
        this.files.splice(index, 1);
        this.changed();
        return true;
    }

    /**
     * @param {number} from Index of the file to move
     * @param {number} to Index it should end up at
     * @returns {boolean} true if anything moved
     */
    moveFile (from, to) {
        if (from === to || !this.files[from] || to < 0 || to >= this.files.length) return false;
        const [file] = this.files.splice(from, 1);
        this.files.splice(to, 0, file);
        this.changed();
        return true;
    }

    /**
     * @param {string} name
     * @returns {{name: string; size: number; data: Uint8Array; md5: string}|null}
     */
    getFile (name) {
        const index = this._indexOf(name);
        if (index === -1) return null;
        const file = this.files[index];
        return {
            name: file.name,
            size: file.asset.data.byteLength,
            data: file.asset.data,
            md5: file.asset.assetId
        };
    }

    /**
     * @returns {Array<{name: string; size: number; data: Uint8Array; md5: string}>}
     */
    getFiles () {
        return this.files.map(file => this.getFile(file.name));
    }

    /**
     * @returns {string[]}
     */
    getFileNames () {
        return this.files.map(file => file.name);
    }

    clear () {
        if (this.files.length === 0) return;
        this.files = [];
        this.emit('change');
    }

    /**
     * Get data to save in project.json.
     * @returns {Array<{name: string; md5ext: string}>|null}
     */
    serializeJSON () {
        if (this.files.length === 0) {
            return null;
        }
        return this.files.map(file => ({
            name: file.name,
            md5ext: `${file.asset.assetId}.${file.asset.dataFormat}`
        }));
    }

    /**
     * @returns {FileAsset[]}
     */
    serializeAssets () {
        return this.files.map(file => file.asset);
    }

    /**
     * @param {unknown} json
     * @param {JSZip} [zip]
     * @returns {Promise<void>}
     */
    async deserialize (json, zip) {
        this.files = [];

        if (!Array.isArray(json) || !zip) {
            this.emit('change');
            return;
        }

        for (const entry of json) {
            if (!entry || typeof entry !== 'object') continue;
            const {name, md5ext} = entry;
            if (typeof name !== 'string' || typeof md5ext !== 'string' || this.hasFile(name)) continue;
            try {
                // Same lookup as tw-asset-util: root of the zip, then one level of subfolders
                let file = zip.file(md5ext);
                if (!file) {
                    const escaped = md5ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    file = zip.file(new RegExp(`^([^/]*/)?${escaped}$`))[0];
                }
                if (!file) {
                    log.warn(`missing project file ${md5ext} for ${name}`);
                    continue;
                }
                const data = await file.async('uint8array');
                const finalName = sanitizeName(name);
                this.files.push({
                    name: finalName,
                    asset: createAsset(data, finalName)
                });
            } catch (e) {
                log.error('could not load project file', e);
            }
        }

        this.emit('change');
    }
}

module.exports = FileManager;

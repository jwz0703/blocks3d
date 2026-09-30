// Backdrops that are 3D skies (backdrop packs, see scratch-vm/src/engine/scene-3d-sky-packs.js): adding them from
// the backdrop library, and uploading images that can be either an HDRI sky or a 2D backdrop.

import {defaultSkyEnvironment, mergeEnvironment} from 'scratch-vm/src/engine/scene-3d-environment';
import {getSkyPack} from 'scratch-vm/src/engine/scene-3d-sky-packs';

import {emptyCostume} from './empty-assets';

// Always HDRI skies: they can't be 2D backdrops
const HDR_FILE = /\.(hdr|exr)$/i;
// Either an HDRI sky (a 360° panorama) or a 2D backdrop
const PANORAMA_FILE = /\.(png|jpe?g|jfif|webp)$/i;

// What the backdrop upload buttons accept
const BACKDROP_UPLOAD_ACCEPT = '.svg, .png, .bmp, .jpg, .jpeg, .jfif, .webp, .gif, .hdr, .exr';

/**
 * Add a backdrop whose sky is of a kind. Its picture is blank, since its sky covers it.
 * @param {VM} vm the VM
 * @param {string} type kind of sky
 * @param {object} [options] name, and sky (parameters of the sky, e.g. {file: 'sky.hdr'})
 * @returns {Promise} resolves when the backdrop was added and is the current one
 */
const addSkyBackdrop = (vm, type, options = {}) => {
    const pack = getSkyPack(type);
    const costume = emptyCostume(options.name || (pack ? pack.name : '背景'));
    costume.environment = mergeEnvironment(defaultSkyEnvironment(type), {sky: options.sky});
    return vm.addBackdrop(costume.md5, costume);
};

/**
 * @param {File} file an image or HDR file
 * @returns {string} its name without the extension
 */
const baseName = file => file.name.replace(/\.[^.]*$/, '') || file.name;

/**
 * Add HDRI sky backdrops: the files go to the Files tab.
 * @param {VM} vm the VM
 * @param {File[]} files images or HDR files
 * @returns {Promise} resolves when all were added
 */
const addHDRIBackdrops = async (vm, files) => {
    for (const file of files) {
        const fileName = vm.runtime.fileManager.addFile(file.name, await file.arrayBuffer());
        await addSkyBackdrop(vm, 'hdri', {name: baseName(file), sky: {file: fileName}});
    }
};

/**
 * @param {File[]} files uploaded backdrop files
 * @returns {{hdri: File[], either: File[], flat: File[]}} files that can only be HDRI skies, files that can be
 * either, and files that can only be 2D backdrops
 */
const splitBackdropFiles = files => ({
    hdri: files.filter(file => HDR_FILE.test(file.name)),
    either: files.filter(file => PANORAMA_FILE.test(file.name)),
    flat: files.filter(file => !HDR_FILE.test(file.name) && !PANORAMA_FILE.test(file.name))
});

/**
 * @param {File} file an image
 * @returns {Promise<boolean>} true if it is about twice as wide as it is high, like 360° panoramas
 */
const looksLikePanorama = file => new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(Math.abs((image.naturalWidth / image.naturalHeight) - 2) < 0.05);
    };
    image.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(false);
    };
    image.src = url;
});

/**
 * Upload backdrop files. Images that can be either ask whether they are HDRI skies or 2D backdrops.
 * @param {VM} vm the VM
 * @param {File[]} files the uploaded files
 * @param {function(File[]): Promise<?string>} askKind asks about those images: resolves to 'hdri', '2d', or null
 * to skip them
 * @param {function(File[]): void} upload2D uploads 2D backdrops like costumes
 * @returns {Promise<boolean>} resolves when the HDRI skies were added; true if any file is added
 */
const uploadBackdropFiles = async (vm, files, askKind, upload2D) => {
    const {hdri, either, flat} = splitBackdropFiles(files);
    const kind = either.length ? await askKind(either) : null;
    const skies = kind === 'hdri' ? hdri.concat(either) : hdri;
    const flats = kind === '2d' ? flat.concat(either) : flat;
    if (flats.length) upload2D(flats);
    await addHDRIBackdrops(vm, skies);
    return skies.length + flats.length > 0;
};

/**
 * Something like a file <input> for handleFileUpload in file-uploader.js, with some of the files of a real one.
 * @param {File[]} files the files
 * @returns {object} the "input"
 */
const fileInputOf = files => ({files, value: null});

/**
 * Open the file picker, like when the upload button of the Environment tab is clicked.
 * @param {string} accept file types
 * @returns {Promise<File[]>} the picked files; never resolves if the picker is closed without picking in browsers
 * that don't tell
 */
const pickFiles = accept => new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(Array.from(input.files)));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
});

export {
    BACKDROP_UPLOAD_ACCEPT,
    addHDRIBackdrops,
    addSkyBackdrop,
    fileInputOf,
    looksLikePanorama,
    pickFiles,
    uploadBackdropFiles
};

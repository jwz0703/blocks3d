// The costume every camera sprite has, like the 3D placeholder (see tw-3d-placeholder.js): the picture of the sprite
// in the sprite list. It is never saved in .3dsb projects; see serialization/3dsb.js

/* eslint-disable max-len */
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><g stroke="#2e5aa8" stroke-width="3" stroke-linejoin="round"><rect x="6" y="20" width="34" height="26" rx="4" fill="#4c97ff"/><path d="M40 28 58 19v28L40 38z" fill="#85b8ff"/><circle cx="17" cy="14" r="7" fill="#85b8ff"/><circle cx="31" cy="14" r="5" fill="#85b8ff"/></g></svg>';
/* eslint-enable max-len */

const MD5 = 'd0742206486e7daed0e4b7bbf1710a92';

/**
 * @param {string} [name] costume name
 * @returns {object} costume as it appears in project.json
 */
const makeCostumeJSON = name => ({
    name: name || '相機',
    bitmapResolution: 1,
    dataFormat: 'svg',
    assetId: MD5,
    md5ext: `${MD5}.svg`,
    rotationCenterX: 32,
    rotationCenterY: 32
});

module.exports = {
    SVG,
    MD5,
    makeCostumeJSON
};

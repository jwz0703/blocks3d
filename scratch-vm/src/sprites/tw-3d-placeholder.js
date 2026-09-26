// The costume every 3D sprite has, so that code written for 2D sprites (costume lists, thumbnails in the
// sprite list, the hidden 2D drawable) keeps working. It is never saved in .3dsb projects; see serialization/3dsb.js

/* eslint-disable max-len */
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><g stroke-linejoin="round" stroke-width="2"><path fill="#b3a6ff" stroke="#b3a6ff" d="M32 5 56 18.5 32 32 8 18.5z"/><path fill="#8a78ff" stroke="#8a78ff" d="M8 18.5 32 32v27L8 45.5z"/><path fill="#6c57f0" stroke="#6c57f0" d="M32 32 56 18.5v27L32 59z"/></g></svg>';
/* eslint-enable max-len */

const MD5 = '623151c014583854322beef9218ac7ea';

/**
 * @param {string} [name] costume name
 * @returns {object} costume as it appears in project.json
 */
const makeCostumeJSON = name => ({
    name: name || '3D',
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

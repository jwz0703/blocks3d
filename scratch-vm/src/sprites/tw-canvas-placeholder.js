// The costume every canvas sprite has, so that the sprite list and costume lists have something to show. What the
// sprite draws is its canvas (see canvas-target.js), never this. It is not saved in .3dsb projects.

/* eslint-disable max-len */
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect x="6" y="10" width="52" height="40" rx="3" fill="#ffffff" stroke="#855cd6" stroke-width="3"/><path d="M14 40c6-10 10-14 16-8s10 2 16-10" fill="none" stroke="#ff8c1a" stroke-width="4" stroke-linecap="round"/><path d="M20 50 16 60M44 50l4 10" stroke="#855cd6" stroke-width="3" stroke-linecap="round"/></svg>';
/* eslint-enable max-len */

const MD5 = 'a2afe99ad377854385c0eca9105cb70b';

/**
 * @param {string} [name] costume name
 * @returns {object} costume as it appears in project.json
 */
const makeCostumeJSON = name => ({
    name: name || '畫布',
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

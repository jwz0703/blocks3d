/* eslint-disable import/no-commonjs */

// tw: stands in for scratch-parser in the exported player.
// The player only loads the sb3 that this editor just saved, so it is unzipped and parsed without
// the Scratch 2 support and the schema validation that make scratch-parser big.

const JSZip = require('@turbowarp/jszip');
// Same JSON parser as scratch-parser, it handles the NaN and Infinity that TurboWarp can save
const ExtendedJSON = require('scratch-vm/node_modules/@turbowarp/json');

/**
 * @param {ArrayBuffer|Uint8Array|string} input sb3/sprite3 data, or its JSON
 * @param {boolean} isSprite Whether the input is a sprite instead of a whole project
 * @returns {Promise<Array>} The JSON, and the zip that has its assets (null for JSON input)
 */
const parse = async (input, isSprite) => {
    if (typeof input === 'string') {
        return [ExtendedJSON.parse(input), null];
    }
    const zip = await JSZip.loadAsync(input);
    const file = isSprite ?
        zip.file(/^([^/]*\/)?sprite\.json$/)[0] :
        zip.file(/^([^/]*\/)?project\.json$/)[0];
    if (!file) {
        throw new Error('Missing project or sprite json');
    }
    return [ExtendedJSON.parse(await file.async('string')), zip];
};

module.exports = (input, isSprite, callback) => {
    parse(input, isSprite)
        .then(([json, zip]) => {
            json.projectVersion = 3;
            callback(null, [json, zip]);
        })
        .catch(error => callback(`${error}`));
};

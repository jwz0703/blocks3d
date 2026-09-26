/* eslint-disable import/no-commonjs */

// tw: stands in for the hardware extensions (micro:bit, LEGO, Force & Acceleration) in the exported player.
// Projects that use one still load, but its blocks do nothing.
// The extension ID is the module's query string, see webpack.config.js

// eslint-disable-next-line no-undef
const id = __resourceQuery.substring(1);

class UnavailableExtension {
    getInfo () {
        return {
            id,
            name: id,
            blocks: []
        };
    }
}

module.exports = UnavailableExtension;

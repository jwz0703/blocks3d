/* eslint-disable import/no-commonjs */

// tw: stands in for three.js in the exported player.
// Projects that use the 3D extension are exported with standalone-three.js, which sets this first.
// This module is only evaluated when the 3D extension is loaded.

if (!window.TWStandaloneThree) {
    throw new Error('three.js was not exported with this project');
}

module.exports = window.TWStandaloneThree.THREE;

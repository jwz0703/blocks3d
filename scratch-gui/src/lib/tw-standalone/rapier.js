/* eslint-disable import/no-commonjs */

// tw: stands in for Rapier (@dimforge/rapier3d-compat) in the exported player.
// Projects that use collision or physics are exported with standalone-rapier.js, which sets this first.
// This module is only evaluated when the project needs physics.

if (!window.TWStandaloneRapier) {
    throw new Error('Rapier was not exported with this project');
}

module.exports = window.TWStandaloneRapier;

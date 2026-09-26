/* eslint-disable import/no-commonjs */

// tw: stands in for the music extension's sample manifest in the exported player.
// Projects that use the music extension are exported with standalone-music.js, which sets this first.
// CommonJS because the music extension uses require() and expects the manifest itself, not a module namespace.
module.exports = window.TWStandaloneMusicAssets || {};

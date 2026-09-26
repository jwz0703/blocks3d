// tw: music extension samples for the exported player, only included in projects that use the music extension.
// Must run before standalone.js, see lib/tw-standalone/music-assets.js

import musicAssets from 'scratch-vm/src/extensions/scratch3_music/manifest';

window.TWStandaloneMusicAssets = musicAssets;

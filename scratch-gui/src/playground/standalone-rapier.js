// tw: Rapier (collision and physics of 3D sprites) for the exported player, only included in projects that use it.
// Must run before standalone.js, see lib/tw-standalone/rapier.js
// Rapier is a dependency of scratch-vm, not of the GUI.

import RAPIER from 'scratch-vm/node_modules/@dimforge/rapier3d-compat';

window.TWStandaloneRapier = RAPIER;

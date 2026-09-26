// tw: three.js for the exported player, only included in projects that use the 3D extension.
// Must run before standalone.js, see lib/tw-standalone/three.js
// three is a dependency of scratch-vm, not of the GUI.

import * as THREE from 'scratch-vm/node_modules/three';
import {GLTFLoader} from 'scratch-vm/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {clone as cloneSkeleton} from 'scratch-vm/node_modules/three/examples/jsm/utils/SkeletonUtils.js';

window.TWStandaloneThree = {
    THREE,
    GLTFLoader,
    cloneSkeleton
};

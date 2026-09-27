// The basic shapes of Scene3D.SHAPES with their names in the editor
const SHAPES = [
    {shape: 'cube', name: '方塊'},
    {shape: 'sphere', name: '球體'},
    {shape: 'cylinder', name: '圓柱'},
    {shape: 'cone', name: '圓錐'},
    {shape: 'plane', name: '平面'},
    {shape: 'torus', name: '圓環'}
];

const MODEL_FILE = /\.(glb|gltf)$/i;

/** Color of new basic shapes */
const DEFAULT_SHAPE_COLOR = '#4c97ff';

/**
 * @param {string} fileName name of a model file
 * @returns {string} name for a sprite or model made from it
 */
const modelNameFromFile = fileName => fileName.replace(MODEL_FILE, '') || fileName;

export {
    SHAPES,
    MODEL_FILE,
    DEFAULT_SHAPE_COLOR,
    modelNameFromFile
};

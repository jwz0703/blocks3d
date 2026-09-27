/**
 * @fileoverview
 * How the stage fits the screen (ROADMAP.md 7.5), like Unity's Canvas Scaler.
 *
 * The stage is measured in logical units, not pixels. A project has a reference size, and the mode decides what
 * the stage size is when the screen has another aspect ratio:
 * - fixed: always the reference size, the player adds black bars
 * - height: the height is the reference height, the width follows the screen
 * - width: the width is the reference width, the height follows the screen
 * - expand: the reference size always fits, the stage grows in the other direction
 */

const MODES = ['fixed', 'height', 'width', 'expand'];

// Shadows of the sun in 3D scenes (ROADMAP.md 7.1): off, a 1024 shadow map, or a 2048 one
const SHADOW_QUALITIES = ['off', 'low', 'high'];

const MIN_SIZE = 1;
const MAX_SIZE = 4096;
const MIN_RENDER_SCALE = 0.25;
const MAX_RENDER_SCALE = 1;

// Speech bubbles and monitors are drawn at 1x on a stage of this size
const UI_REFERENCE_WIDTH = 480;
const UI_REFERENCE_HEIGHT = 360;

/**
 * @typedef {object} ScreenSettings
 * @property {string} mode one of MODES
 * @property {number} width reference width
 * @property {number} height reference height
 * @property {number} renderScale resolution of the rendered image compared to the screen, 0.25 to 1
 * @property {string} shadows one of SHADOW_QUALITIES
 */

/** @returns {ScreenSettings} the settings of projects that don't have any (.sb3) */
const defaultSettings = () => ({
    mode: 'fixed',
    width: UI_REFERENCE_WIDTH,
    height: UI_REFERENCE_HEIGHT,
    renderScale: 1,
    shadows: 'high'
});

/** @returns {ScreenSettings} the settings of new projects */
const newProjectSettings = () => ({
    mode: 'height',
    width: 1280,
    height: 720,
    renderScale: 1,
    shadows: 'high'
});

const clampSize = (value, fallback) => {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return fallback;
    return Math.max(MIN_SIZE, Math.min(MAX_SIZE, number));
};

/**
 * @param {object} settings possibly partial or invalid settings, e.g. from project.json
 * @param {ScreenSettings} [base] values for what settings leaves out
 * @returns {ScreenSettings} valid settings
 */
const normalize = (settings, base = defaultSettings()) => {
    const input = settings && typeof settings === 'object' ? settings : {};
    const renderScale = Number(input.renderScale);
    return {
        mode: MODES.includes(input.mode) ? input.mode : base.mode,
        width: clampSize(input.width, base.width),
        height: clampSize(input.height, base.height),
        renderScale: Number.isFinite(renderScale) ?
            Math.max(MIN_RENDER_SCALE, Math.min(MAX_RENDER_SCALE, renderScale)) :
            base.renderScale,
        shadows: SHADOW_QUALITIES.includes(input.shadows) ? input.shadows : base.shadows
    };
};

/**
 * @param {ScreenSettings} settings
 * @param {?number} aspect width / height of the screen, or null when unknown (e.g. no GUI)
 * @returns {{width: number, height: number}} size of the stage in logical units
 */
const computeStageSize = (settings, aspect) => {
    const {mode, width, height} = settings;
    if (mode === 'fixed' || !(aspect > 0) || !Number.isFinite(aspect)) {
        return {width, height};
    }
    let stageWidth = width;
    let stageHeight = height;
    if (mode === 'height' || (mode === 'expand' && aspect >= width / height)) {
        stageWidth = height * aspect;
    } else {
        stageHeight = width / aspect;
    }
    return {
        width: clampSize(stageWidth, width),
        height: clampSize(stageHeight, height)
    };
};

/**
 * @param {ScreenSettings} settings
 * @returns {number} how much bigger speech bubbles and monitors are than on a 480x360 stage
 */
const getUIScale = settings => Math.max(
    0.25,
    Math.min(settings.width / UI_REFERENCE_WIDTH, settings.height / UI_REFERENCE_HEIGHT)
);

module.exports = {
    MODES,
    SHADOW_QUALITIES,
    defaultSettings,
    newProjectSettings,
    normalize,
    computeStageSize,
    getUIScale
};

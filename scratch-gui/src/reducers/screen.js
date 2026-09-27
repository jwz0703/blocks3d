// How the stage fits the screen (scratch-vm engine/screen.js), and the screen shape the editor previews it on

const SET_SCREEN_SETTINGS = 'blocks3d/screen/SET_SETTINGS';
const SET_PREVIEW_ASPECT = 'blocks3d/screen/SET_PREVIEW_ASPECT';

// Screen shapes the editor can preview a stage that follows the screen on
const PREVIEW_ASPECTS = [
    {id: '16:9', aspect: 16 / 9},
    {id: '4:3', aspect: 4 / 3},
    {id: '21:9', aspect: 21 / 9},
    {id: '9:16', aspect: 9 / 16}
];

/**
 * @param {string} id one of PREVIEW_ASPECTS
 * @returns {number} width / height
 */
const getPreviewAspect = id => (PREVIEW_ASPECTS.find(preset => preset.id === id) || PREVIEW_ASPECTS[0]).aspect;

/**
 * Same as getUIScale in scratch-vm engine/screen.js
 * @param {{width: number, height: number}} settings screen settings
 * @returns {number} how much bigger monitors are than on a 480x360 stage
 */
const getUIScale = settings => Math.max(0.25, Math.min(settings.width / 480, settings.height / 360));

const initialState = {
    settings: {
        mode: 'fixed',
        width: 480,
        height: 360,
        renderScale: 1,
        shadows: 'high'
    },
    previewAspect: PREVIEW_ASPECTS[0].id
};

const reducer = function (state, action) {
    if (typeof state === 'undefined') state = initialState;
    switch (action.type) {
    case SET_SCREEN_SETTINGS:
        return Object.assign({}, state, {
            settings: action.settings
        });
    case SET_PREVIEW_ASPECT:
        return Object.assign({}, state, {
            previewAspect: action.previewAspect
        });
    default:
        return state;
    }
};

const setScreenSettings = settings => ({
    type: SET_SCREEN_SETTINGS,
    settings
});

const setPreviewAspect = previewAspect => ({
    type: SET_PREVIEW_ASPECT,
    previewAspect
});

export {
    reducer as default,
    initialState as screenInitialState,
    PREVIEW_ASPECTS,
    getPreviewAspect,
    getUIScale,
    setScreenSettings,
    setPreviewAspect
};

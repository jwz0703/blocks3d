import {STAGE_DISPLAY_SIZES} from '../lib/layout-constants.js';

const SET_STAGE_SIZE = 'scratch-gui/StageSize/SET_STAGE_SIZE';
const SET_STAGE_DISPLAY_WIDTH = 'scratch-gui/StageSize/SET_STAGE_DISPLAY_WIDTH';

const initialState = {
    stageSize: STAGE_DISPLAY_SIZES.full,
    // Width in px chosen by dragging the stage's left edge. null means use stageSize.
    stageDisplayWidth: null
};

const reducer = function (state, action) {
    if (typeof state === 'undefined') state = initialState;
    switch (action.type) {
    case SET_STAGE_SIZE:
        return {
            stageSize: action.stageSize,
            stageDisplayWidth: null
        };
    case SET_STAGE_DISPLAY_WIDTH:
        return {
            ...state,
            stageDisplayWidth: action.width
        };
    default:
        return state;
    }
};

const setStageSize = function (stageSize) {
    return {
        type: SET_STAGE_SIZE,
        stageSize: stageSize
    };
};

const setStageDisplayWidth = function (width) {
    return {
        type: SET_STAGE_DISPLAY_WIDTH,
        width: width
    };
};

export {
    reducer as default,
    initialState as stageSizeInitialState,
    setStageSize,
    setStageDisplayWidth
};

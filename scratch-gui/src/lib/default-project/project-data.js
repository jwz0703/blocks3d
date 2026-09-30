import {defineMessages} from 'react-intl';
import {defaultEnvironment} from 'scratch-vm/src/engine/scene-3d-environment';
import sharedMessages from '../shared-messages';
import {DEFAULT_SHAPE_COLOR} from '../../components/tw-3d/shapes';

let messages = defineMessages({
    variable: {
        defaultMessage: 'my variable',
        description: 'Name for the default variable',
        id: 'gui.defaultProject.variable'
    }
});

messages = {...messages, ...sharedMessages};

// use the default message if a translation function is not passed
const defaultTranslator = msgObj => msgObj.defaultMessage;

/**
 * Generate a localized version of the default project: a .3dsb project with a procedural sky, a camera sprite
 * looking at the origin from a little above, and a cube.
 * @param {function} translateFunction a function to use for translating the default names
 * @return {object} the project data json for the default project
 */
const projectData = translateFunction => {
    const translator = translateFunction || defaultTranslator;
    return ({
        targets: [
            {
                isStage: true,
                name: 'Stage',
                kind: '2d',
                currentCamera: '相機',
                // The stage follows the shape of the screen, 720 units tall (see scratch-vm engine/screen.js)
                screen: {mode: 'height', width: 1280, height: 720, renderScale: 1},
                variables: {
                    '`jEk@4|i[#Fk?(8x)AV.-my variable': [
                        translator(messages.variable),
                        0
                    ]
                },
                lists: {},
                broadcasts: {},
                blocks: {},
                currentCostume: 0,
                costumes: [
                    {
                        assetId: 'cd21514d0531fdffb22204e0ec5ed84a',
                        name: translator(messages.backdrop, {index: 1}),
                        md5ext: 'cd21514d0531fdffb22204e0ec5ed84a.svg',
                        dataFormat: 'svg',
                        rotationCenterX: 240,
                        rotationCenterY: 180,
                        environment: defaultEnvironment()
                    }
                ],
                sounds: [],
                volume: 100
            },
            {
                isStage: false,
                name: '方塊',
                kind: '3d',
                variables: {},
                lists: {},
                broadcasts: {},
                blocks: {},
                comments: {},
                // 3D sprites save no costumes; they get their picture when loaded
                costumes: [],
                sounds: [],
                volume: 100,
                draggable: false,
                position: {x: 0, y: 0, z: 0},
                rotation: {x: 0, y: 0, z: 0},
                scale: {x: 1, y: 1, z: 1},
                visible: true,
                models: [{name: '方塊', shape: 'cube'}],
                currentModel: 0,
                material: {color: DEFAULT_SHAPE_COLOR}
            },
            {
                isStage: false,
                name: '相機',
                kind: 'camera',
                variables: {},
                lists: {},
                broadcasts: {},
                blocks: {},
                comments: {},
                // Camera sprites save no costumes; they get their picture when loaded
                costumes: [],
                sounds: [],
                volume: 100,
                position: {x: 0, y: 2, z: 6},
                rotation: {x: -15, y: 0, z: 0},
                fov: 60
            }
        ],
        meta: {
            semver: '3.0.0',
            vm: '0.1.0',
            agent: '',
            format: '3dsb',
            formatVersion: 2
        }
    });
};


export default projectData;

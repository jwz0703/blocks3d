const {SKY_PACKS} = require('./scene-3d-sky-packs');

// The environment of the 3D scene: sky, lighting, sun, fog and tone mapping. Every backdrop of the stage has one
// (costume.environment), so switching backdrops switches environments, and the backdrop blocks switch levels or
// scenes like they did in 2D. A backdrop without one is a "2D backdrop": its picture shows behind the 3D scene.

// color: one color. gradient: from bottom to top. procedural: blue sky with a sun (where the sun light comes from)
// and fbm clouds, made by a shader. hdri: an equirectangular image from the Files tab (.hdr, .exr, UltraHDR .jpg or
// any image). 2d: the backdrop's own picture, drawn behind the scene like in Scratch.
const SKY_TYPES = ['color', 'gradient', 'procedural', 'hdri', '2d'];

// The block extension of each kind of sky (see scene-3d-sky-packs.js). The palette only shows one when a backdrop of
// the project has that kind of sky. 2D backdrops are changed with the paint editor and the looks blocks.
const SKY_EXTENSIONS = Object.fromEntries(SKY_PACKS.map(pack => [pack.id, pack.extension]));

// Image-based lighting. sky: from the sky itself (procedural, gradient and hdri skies; the others fall back to room).
// room: a neutral studio (three.js RoomEnvironment), needs no file. hdri: another image than the sky. none: only the
// ambient and sun lights.
const LIGHTING_TYPES = ['sky', 'room', 'hdri', 'none'];

const TONE_MAPPINGS = ['none', 'neutral', 'agx', 'aces'];

/**
 * @returns {object} the environment of a new project, and of new environments added in the editor
 */
const defaultEnvironment = () => ({
    sky: {
        type: 'procedural',
        color: '#87ceeb',
        top: '#3f7fd6',
        bottom: '#dbeaf7',
        file: '',
        // Percent of the sky covered by clouds
        clouds: 35,
        // Degrees around the y axis
        rotation: 0,
        // Percent
        blur: 0
    },
    lighting: {type: 'sky', file: '', intensity: 1, rotation: 0},
    ambient: {color: '#ffffff', intensity: 0.2},
    sun: {color: '#fff4e0', intensity: 2, x: 3, y: 5, z: 4, shadows: true},
    fog: {enabled: false, color: '#dbeaf7', near: 20, far: 150},
    toneMapping: 'neutral',
    exposure: 1
});

/**
 * @returns {object} the environment of a backdrop that has none: its 2D picture behind the scene
 */
/**
 * @param {string} type kind of sky, see scene-3d-sky-packs.js
 * @returns {object} the environment of a new backdrop of that kind
 */
const defaultSkyEnvironment = type => {
    const environment = defaultEnvironment();
    if (SKY_TYPES.includes(type)) environment.sky.type = type;
    return environment;
};

const default2DEnvironment = () => {
    const environment = defaultEnvironment();
    environment.sky.type = '2d';
    environment.lighting = {type: 'room', file: '', intensity: 0.6, rotation: 0};
    environment.ambient.intensity = 0.4;
    environment.sun = {color: '#ffffff', intensity: 1.5, x: 3, y: 5, z: 4, shadows: false};
    return environment;
};

const toNumber = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const toColor = (value, fallback) => (
    typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback
);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Merge a (possibly partial or invalid) environment into a complete, valid one.
 * @param {object} base complete environment
 * @param {object} changes partial environment, e.g. {sky: {clouds: 80}}
 * @returns {object} new environment
 */
const mergeEnvironment = (base, changes) => {
    const result = JSON.parse(JSON.stringify(base));
    if (!changes || typeof changes !== 'object') return result;
    const section = name => (changes[name] && typeof changes[name] === 'object' ? changes[name] : {});

    const sky = section('sky');
    if (SKY_TYPES.includes(sky.type)) result.sky.type = sky.type;
    for (const key of ['color', 'top', 'bottom']) result.sky[key] = toColor(sky[key], result.sky[key]);
    if (typeof sky.file === 'string') result.sky.file = sky.file;
    result.sky.clouds = clamp(toNumber(sky.clouds, result.sky.clouds), 0, 100);
    result.sky.rotation = toNumber(sky.rotation, result.sky.rotation);
    result.sky.blur = clamp(toNumber(sky.blur, result.sky.blur), 0, 100);

    const lighting = section('lighting');
    if (LIGHTING_TYPES.includes(lighting.type)) result.lighting.type = lighting.type;
    if (typeof lighting.file === 'string') result.lighting.file = lighting.file;
    result.lighting.intensity = Math.max(0, toNumber(lighting.intensity, result.lighting.intensity));
    result.lighting.rotation = toNumber(lighting.rotation, result.lighting.rotation);

    for (const name of ['ambient', 'sun']) {
        const light = section(name);
        result[name].color = toColor(light.color, result[name].color);
        result[name].intensity = Math.max(0, toNumber(light.intensity, result[name].intensity));
    }
    const sun = section('sun');
    for (const axis of ['x', 'y', 'z']) result.sun[axis] = toNumber(sun[axis], result.sun[axis]);
    if (typeof sun.shadows === 'boolean') result.sun.shadows = sun.shadows;
    if (result.sun.x === 0 && result.sun.y === 0 && result.sun.z === 0) result.sun.y = 1;

    const fog = section('fog');
    if (typeof fog.enabled === 'boolean') result.fog.enabled = fog.enabled;
    result.fog.color = toColor(fog.color, result.fog.color);
    result.fog.near = Math.max(0, toNumber(fog.near, result.fog.near));
    result.fog.far = Math.max(result.fog.near, toNumber(fog.far, result.fog.far));

    if (TONE_MAPPINGS.includes(changes.toneMapping)) result.toneMapping = changes.toneMapping;
    result.exposure = clamp(toNumber(changes.exposure, result.exposure), 0, 10);
    return result;
};

/**
 * @param {number} elevation degrees above the horizon
 * @param {number} azimuth degrees, 0 is behind the default camera (+z) and 90 is to its right (+x)
 * @returns {{x: number, y: number, z: number}} direction the sun light comes from
 */
const sunFromAngles = (elevation, azimuth) => {
    const e = elevation * Math.PI / 180;
    const a = azimuth * Math.PI / 180;
    const round = n => Math.round(n * 1e6) / 1e6;
    return {
        x: round(Math.cos(e) * Math.sin(a)),
        y: round(Math.sin(e)),
        z: round(Math.cos(e) * Math.cos(a))
    };
};

/**
 * @param {{x: number, y: number, z: number}} sun direction the sun light comes from
 * @returns {{elevation: number, azimuth: number}} its angles, see sunFromAngles
 */
const sunToAngles = sun => {
    const length = Math.hypot(sun.x, sun.y, sun.z) || 1;
    const round = n => Math.round(n * 1e4) / 1e4;
    return {
        elevation: round(Math.asin(clamp(sun.y / length, -1, 1)) * 180 / Math.PI),
        azimuth: round(Math.atan2(sun.x, sun.z) * 180 / Math.PI)
    };
};

/**
 * Turn the environment of a formatVersion 1 project (one for the whole project, with the camera in it) into one of
 * the current kind. Its lighting was only the ambient and sun lights, without tone mapping, and it still is.
 * @param {object} old environment of a formatVersion 1 stage
 * @returns {object} complete environment
 */
const fromVersion1 = old => {
    old = old && typeof old === 'object' ? old : {};
    const background = old.background && typeof old.background === 'object' ? old.background : {};
    const changes = {
        sky: {type: '2d', color: background.color},
        lighting: {type: 'none'},
        ambient: old.ambient,
        sun: Object.assign({shadows: false}, old.sun),
        fog: old.fog,
        toneMapping: 'none',
        exposure: 1
    };
    if (background.type === 'color') changes.sky.type = 'color';
    if (background.type === 'skybox' && background.file) {
        changes.sky.type = 'hdri';
        changes.sky.file = background.file;
    }
    const base = default2DEnvironment();
    base.ambient = {color: '#ffffff', intensity: 0.6};
    base.sun = {color: '#ffffff', intensity: 1.2, x: 3, y: 5, z: 4, shadows: false};
    base.fog.color = '#ffffff';
    base.fog.near = 10;
    base.fog.far = 100;
    return mergeEnvironment(base, changes);
};

module.exports = {
    SKY_TYPES,
    SKY_EXTENSIONS,
    LIGHTING_TYPES,
    TONE_MAPPINGS,
    defaultEnvironment,
    defaultSkyEnvironment,
    default2DEnvironment,
    mergeEnvironment,
    sunFromAngles,
    sunToAngles,
    fromVersion1
};

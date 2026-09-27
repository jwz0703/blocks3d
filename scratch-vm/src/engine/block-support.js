// What every block does on each kind of target, in one place. The palette and the runtime (interpreter, compiler
// and extensions alike) read this table instead of checking target.is3D themselves.
//
// For each kind of target ('2d' for 2D sprites and the stage, '3d' for 3D sprites, 'camera' for camera sprites) a
// block is one of:
// - KEEP: works as is.
// - REPLACE: runs a different implementation made for this kind (see replacements in tw_3d/replacements.js).
// - HIDE: makes no sense for this kind. Not in the palette; does nothing, reporters give a fixed value, and the
//   workspace draws it faded so that it is clear it has no effect.
// - NOOP: in the palette, but does nothing yet on this kind.
// Separately, `palette: false` leaves a working block out of the palette because another block of the same kind
// does the same thing, e.g. 2D "set x to" on 3D sprites, which the 3D motion category already has.

const KEEP = 'keep';
const REPLACE = 'replace';
const HIDE = 'hide';
const NOOP = 'noop';

// What the "[property] of [sprite]" block offers for a 3D sprite. The first two are the same as for 2D sprites.
const ATTRIBUTES_3D = [
    'x position',
    'y position',
    'z position',
    'yaw',
    'pitch',
    'roll',
    'model #',
    'model name',
    'scale',
    'opacity'
];

// ... and for a camera sprite
const ATTRIBUTES_CAMERA = [
    'x position',
    'y position',
    'z position',
    'yaw',
    'pitch',
    'roll',
    'fov'
];

const ATTRIBUTES = {
    '3d': ATTRIBUTES_3D,
    'camera': ATTRIBUTES_CAMERA
};

/**
 * @param {string} support KEEP, REPLACE, HIDE or NOOP
 * @param {object} [options]
 * @param {boolean} [options.palette] false to leave it out of the palette
 * @param {*} [options.value] what a HIDE or NOOP reporter gives
 * @returns {object} entry
 */
const entry = (support, options) => Object.assign({support}, options);

const keepOffPalette = entry(KEEP, {palette: false});
const replace = palette => entry(REPLACE, {palette});
const hide = value => entry(HIDE, {value});

// Blocks on 3D sprites. Anything not listed is KEEP, except for the prefixes below.
const BLOCKS_3D = {
    // Both kinds are y up, so x and y mean the same thing. The 3D motion category has its own copies.
    motion_gotoxy: keepOffPalette,
    motion_glidesecstoxy: keepOffPalette,
    motion_changexby: keepOffPalette,
    motion_setx: keepOffPalette,
    motion_changeyby: keepOffPalette,
    motion_sety: keepOffPalette,
    motion_xposition: keepOffPalette,
    motion_yposition: keepOffPalette,
    // Random position, the mouse (on the ground) and 3D sprites
    motion_goto: replace(true),
    motion_glideto: replace(true),
    motion_pointtowards: replace(false),
    // 2D directions have no 3D meaning: 3D sprites turn with yaw, pitch and roll
    motion_movesteps: hide(),
    motion_turnright: hide(),
    motion_turnleft: hide(),
    motion_pointindirection: hide(),
    motion_direction: hide(90),
    motion_setrotationstyle: hide(),
    motion_ifonedgebounce: hide(),
    motion_scroll_right: hide(),
    motion_scroll_up: hide(),
    motion_align_scene: hide(),
    motion_xscroll: hide(0),
    motion_yscroll: hide(0),

    // Costumes are models; size is the (even) scale
    looks_switchcostumeto: hide(),
    looks_nextcostume: hide(),
    looks_costumenumbername: hide(0),
    looks_setsizeto: replace(false),
    looks_changesizeby: replace(false),
    looks_size: replace(false),
    looks_changeeffectby: hide(),
    looks_seteffectto: hide(),
    looks_cleargraphiceffects: hide(),
    looks_gotofrontback: hide(),
    looks_goforwardbackwardlayers: hide(),
    looks_changestretchby: hide(),
    looks_setstretchto: hide(),

    // Touching and distance between 3D sprites, see Target3D
    sensing_touchingobject: replace(false),
    sensing_distanceto: replace(false),
    sensing_touchingcolor: hide(false),
    sensing_coloristouchingcolor: hide(false),
    sensing_setdragmode: hide(),

    // Clicks and the mouse find 3D sprites by casting a ray from the camera (Scene3D.pickTarget)
    event_whenthisspriteclicked: entry(KEEP)
};
const PREFIXES_3D = {
    pen_: hide()
};

// Blocks that every target can use: raycasts and gravity
const PHYSICS_FOR_EVERYONE = {
    physics3d_raycast: entry(KEEP),
    physics3d_raycastfrom: entry(KEEP),
    physics3d_setgravity: entry(KEEP),
    physics3d_gravity: entry(KEEP)
};

// Blocks that only camera sprites have: their field of view
const CAMERA_ONLY = {
    camera3d_setfov: hide(),
    camera3d_changefov: hide(),
    camera3d_fov: hide(60)
};

Object.assign(BLOCKS_3D, CAMERA_ONLY);

// Blocks on camera sprites: they move like 3D sprites, but have no model, no size, can't be seen, touch nothing and
// can't be cloned
const BLOCKS_CAMERA = Object.assign({}, BLOCKS_3D, {
    looks_say: hide(),
    looks_sayforsecs: hide(),
    looks_think: hide(),
    looks_thinkforsecs: hide(),
    looks_show: hide(),
    looks_hide: hide(),
    looks_setsizeto: hide(),
    looks_changesizeby: hide(),
    looks_size: hide(100),
    looks_log: hide(),
    sensing_touchingobject: hide(false),
    control_start_as_clone: hide(),
    control_delete_this_clone: hide(),
    event_whenthisspriteclicked: hide(),
    camera3d_setfov: entry(KEEP),
    camera3d_changefov: entry(KEEP),
    camera3d_fov: entry(KEEP),
    // Cameras hear, but make no 3D sound themselves
    sound3d_setspatial: hide(),
    sound3d_setsounddistance: hide()
}, PHYSICS_FOR_EVERYONE);
const PREFIXES_CAMERA = {
    pen_: hide(),
    looks3d_: hide(0),
    sensing3d_touching: hide(false),
    // Cameras take no space: no bodies, colliders or collisions
    physics3d_: hide(0),
    event3d_: hide()
};

// Blocks on 2D sprites and the stage
const BLOCKS_2D = Object.assign({
    // Reporters that let 2D sprites follow 3D sprites, e.g. for a HUD
    sensing3d_screenposition: entry(KEEP),
    sensing3d_onscreen: entry(KEEP),
    // Position, rotation and scale of 3D sprites, as {x, y, z}
    sensing3d_vectorof: entry(KEEP)
}, CAMERA_ONLY, PHYSICS_FOR_EVERYONE);
const PREFIXES_2D = {
    motion3d_: hide(0),
    looks3d_: hide(0),
    sensing3d_: hide(0),
    physics3d_: hide(0),
    sound3d_: hide()
};

const TABLES = {
    '2d': {blocks: BLOCKS_2D, prefixes: PREFIXES_2D},
    '3d': {blocks: BLOCKS_3D, prefixes: PREFIXES_3D},
    'camera': {blocks: BLOCKS_CAMERA, prefixes: PREFIXES_CAMERA}
};
const KINDS = Object.keys(TABLES);

const DEFAULT = entry(KEEP);

/**
 * @param {?Target} target
 * @returns {string} 'camera', '3d' or '2d'
 */
const kindOf = target => {
    if (target && target.isCamera) return 'camera';
    return target && target.is3D ? '3d' : '2d';
};

/**
 * @param {string} opcode
 * @param {string} kind '2d', '3d' or 'camera'
 * @returns {{support: string, palette?: boolean, value?: *}} what the block does on that kind of target
 */
const getBlockSupport = (opcode, kind) => {
    const table = TABLES[kind] || TABLES['2d'];
    if (Object.prototype.hasOwnProperty.call(table.blocks, opcode)) return table.blocks[opcode];
    for (const prefix of Object.keys(table.prefixes)) {
        if (opcode.startsWith(prefix)) return table.prefixes[prefix];
    }
    return DEFAULT;
};

/**
 * @param {string} opcode
 * @param {string} kind '2d', '3d' or 'camera'
 * @returns {boolean} true if the palette of that kind of target shows the block
 */
const isInPalette = (opcode, kind) => {
    const info = getBlockSupport(opcode, kind);
    if (info.support === HIDE) return false;
    return info.palette !== false;
};

/**
 * @param {string} opcode
 * @returns {boolean} true if the block works as is on every kind of target
 */
const isSameOnEveryKind = opcode => KINDS.every(kind => getBlockSupport(opcode, kind).support === KEEP);

/**
 * Wrap a block's function so that it does what the table says for the target it runs on.
 * @param {string} opcode
 * @param {Function} primitive the block's own function
 * @param {object} replacements opcode → function(args, util, primitive) for REPLACE blocks
 * @returns {Function} function(args, util)
 */
const wrapPrimitive = (opcode, primitive, replacements) => {
    const byKind = {};
    for (const kind of KINDS) byKind[kind] = getBlockSupport(opcode, kind);
    return (args, util) => {
        const info = byKind[kindOf(util.target)];
        if (info.support === KEEP) return primitive(args, util);
        if (info.support === REPLACE && replacements[opcode]) return replacements[opcode](args, util, primitive);
        return info.value;
    };
};

module.exports = {
    KEEP,
    REPLACE,
    HIDE,
    NOOP,
    ATTRIBUTES_3D,
    ATTRIBUTES_CAMERA,
    ATTRIBUTES,
    KINDS,
    kindOf,
    getBlockSupport,
    isInPalette,
    isSameOnEveryKind,
    wrapPrimitive
};

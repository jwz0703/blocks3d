import LazyScratchBlocks from './tw-lazy-scratch-blocks';
import {defaultBlockColors} from './themes';

const categorySeparator = '<sep gap="36"/>';

const blockSeparator = '<sep gap="36"/>'; // At default scale, about 28px

const translate = (id, english) => {
    if (LazyScratchBlocks.isLoaded()) {
        return LazyScratchBlocks.get().ScratchMsgs.translate(id, english);
    }
    return english;
};

/* eslint-disable no-unused-vars */
const motion = function (isInitialSetup, isStage, targetId, colors) {
    const stageSelected = translate(
        'MOTION_STAGE_SELECTED',
        'Stage selected: no motion blocks'
    );
    // Note: the category's secondaryColour matches up with the blocks' tertiary color, both used for border color.
    return `
    <category name="%{BKY_CATEGORY_MOTION}" id="motion" colour="${colors.primary}" secondaryColour="${colors.tertiary}">
        ${isStage ? `
        <label text="${stageSelected}"></label>
        ` : `
        <block type="motion_movesteps">
            <value name="STEPS">
                <shadow type="math_number">
                    <field name="NUM">10</field>
                </shadow>
            </value>
        </block>
        <block type="motion_turnright">
            <value name="DEGREES">
                <shadow type="math_number">
                    <field name="NUM">15</field>
                </shadow>
            </value>
        </block>
        <block type="motion_turnleft">
            <value name="DEGREES">
                <shadow type="math_number">
                    <field name="NUM">15</field>
                </shadow>
            </value>
        </block>
        ${blockSeparator}
        <block type="motion_goto">
            <value name="TO">
                <shadow type="motion_goto_menu">
                </shadow>
            </value>
        </block>
        <block type="motion_gotoxy">
            <value name="X">
                <shadow id="movex" type="math_number">
                    <field name="NUM">0</field>
                </shadow>
            </value>
            <value name="Y">
                <shadow id="movey" type="math_number">
                    <field name="NUM">0</field>
                </shadow>
            </value>
        </block>
        <block type="motion_glideto" id="motion_glideto">
            <value name="SECS">
                <shadow type="math_number">
                    <field name="NUM">1</field>
                </shadow>
            </value>
            <value name="TO">
                <shadow type="motion_glideto_menu">
                </shadow>
            </value>
        </block>
        <block type="motion_glidesecstoxy">
            <value name="SECS">
                <shadow type="math_number">
                    <field name="NUM">1</field>
                </shadow>
            </value>
            <value name="X">
                <shadow id="glidex" type="math_number">
                    <field name="NUM">0</field>
                </shadow>
            </value>
            <value name="Y">
                <shadow id="glidey" type="math_number">
                    <field name="NUM">0</field>
                </shadow>
            </value>
        </block>
        ${blockSeparator}
        <block type="motion_pointindirection">
            <value name="DIRECTION">
                <shadow type="math_angle">
                    <field name="NUM">90</field>
                </shadow>
            </value>
        </block>
        <block type="motion_pointtowards">
            <value name="TOWARDS">
                <shadow type="motion_pointtowards_menu">
                </shadow>
            </value>
        </block>
        ${blockSeparator}
        <block type="motion_changexby">
            <value name="DX">
                <shadow type="math_number">
                    <field name="NUM">10</field>
                </shadow>
            </value>
        </block>
        <block type="motion_setx">
            <value name="X">
                <shadow id="setx" type="math_number">
                    <field name="NUM">0</field>
                </shadow>
            </value>
        </block>
        <block type="motion_changeyby">
            <value name="DY">
                <shadow type="math_number">
                    <field name="NUM">10</field>
                </shadow>
            </value>
        </block>
        <block type="motion_sety">
            <value name="Y">
                <shadow id="sety" type="math_number">
                    <field name="NUM">0</field>
                </shadow>
            </value>
        </block>
        ${blockSeparator}
        <block type="motion_ifonedgebounce"/>
        ${blockSeparator}
        <block type="motion_setrotationstyle"/>
        ${blockSeparator}
        <block id="${targetId}_xposition" type="motion_xposition"/>
        <block id="${targetId}_yposition" type="motion_yposition"/>
        <block id="${targetId}_direction" type="motion_direction"/>`}
        ${categorySeparator}
    </category>
    `;
};

const xmlEscape = function (unsafe) {
    return unsafe.replace(/[<>&'"]/g, c => {
        switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        }
    });
};

const looks = function (isInitialSetup, isStage, targetId, costumeName, backdropName, colors) {
    const hello = translate('LOOKS_HELLO', 'Hello!');
    const hmm = translate('LOOKS_HMM', 'Hmm...');
    // Note: the category's secondaryColour matches up with the blocks' tertiary color, both used for border color.
    return `
    <category name="%{BKY_CATEGORY_LOOKS}" id="looks" colour="${colors.primary}" secondaryColour="${colors.tertiary}">
        ${isStage ? '' : `
        <block type="looks_sayforsecs">
            <value name="MESSAGE">
                <shadow type="text">
                    <field name="TEXT">${hello}</field>
                </shadow>
            </value>
            <value name="SECS">
                <shadow type="math_number">
                    <field name="NUM">2</field>
                </shadow>
            </value>
        </block>
        <block type="looks_say">
            <value name="MESSAGE">
                <shadow type="text">
                    <field name="TEXT">${hello}</field>
                </shadow>
            </value>
        </block>
        <block type="looks_thinkforsecs">
            <value name="MESSAGE">
                <shadow type="text">
                    <field name="TEXT">${hmm}</field>
                </shadow>
            </value>
            <value name="SECS">
                <shadow type="math_number">
                    <field name="NUM">2</field>
                </shadow>
            </value>
        </block>
        <block type="looks_think">
            <value name="MESSAGE">
                <shadow type="text">
                    <field name="TEXT">${hmm}</field>
                </shadow>
            </value>
        </block>
        ${blockSeparator}
        `}
        ${isStage ? `
            <block type="looks_switchbackdropto">
                <value name="BACKDROP">
                    <shadow type="looks_backdrops">
                        <field name="BACKDROP">${backdropName}</field>
                    </shadow>
                </value>
            </block>
            <block type="looks_switchbackdroptoandwait">
                <value name="BACKDROP">
                    <shadow type="looks_backdrops">
                        <field name="BACKDROP">${backdropName}</field>
                    </shadow>
                </value>
            </block>
            <block type="looks_nextbackdrop"/>
        ` : `
            <block id="${targetId}_switchcostumeto" type="looks_switchcostumeto">
                <value name="COSTUME">
                    <shadow type="looks_costume">
                        <field name="COSTUME">${costumeName}</field>
                    </shadow>
                </value>
            </block>
            <block type="looks_nextcostume"/>
            <block type="looks_switchbackdropto">
                <value name="BACKDROP">
                    <shadow type="looks_backdrops">
                        <field name="BACKDROP">${backdropName}</field>
                    </shadow>
                </value>
            </block>
            <block type="looks_nextbackdrop"/>
            ${blockSeparator}
            <block type="looks_changesizeby">
                <value name="CHANGE">
                    <shadow type="math_number">
                        <field name="NUM">10</field>
                    </shadow>
                </value>
            </block>
            <block type="looks_setsizeto">
                <value name="SIZE">
                    <shadow type="math_number">
                        <field name="NUM">100</field>
                    </shadow>
                </value>
            </block>
        `}
        ${blockSeparator}
        <block type="looks_changeeffectby">
            <value name="CHANGE">
                <shadow type="math_number">
                    <field name="NUM">25</field>
                </shadow>
            </value>
        </block>
        <block type="looks_seteffectto">
            <value name="VALUE">
                <shadow type="math_number">
                    <field name="NUM">0</field>
                </shadow>
            </value>
        </block>
        <block type="looks_cleargraphiceffects"/>
        ${blockSeparator}
        ${isStage ? '' : `
            <block type="looks_show"/>
            <block type="looks_hide"/>
        ${blockSeparator}
            <block type="looks_gotofrontback"/>
            <block type="looks_goforwardbackwardlayers">
                <value name="NUM">
                    <shadow type="math_integer">
                        <field name="NUM">1</field>
                    </shadow>
                </value>
            </block>
        `}
        ${isStage ? `
            <block id="backdropnumbername" type="looks_backdropnumbername"/>
        ` : `
            <block id="${targetId}_costumenumbername" type="looks_costumenumbername"/>
            <block id="backdropnumbername" type="looks_backdropnumbername"/>
            <block id="${targetId}_size" type="looks_size"/>
        `}
        ${blockSeparator}
        <block type="looks_log">
            <value name="MESSAGE">
                <shadow type="text">
                    <field name="TEXT">${hello}</field>
                </shadow>
            </value>
        </block>
        ${categorySeparator}
    </category>
    `;
};

const sound = function (isInitialSetup, isStage, targetId, soundName, colors) {
    // Note: the category's secondaryColour matches up with the blocks' tertiary color, both used for border color.
    return `
    <category name="%{BKY_CATEGORY_SOUND}" id="sound" colour="${colors.primary}" secondaryColour="${colors.tertiary}">
        <block id="${targetId}_sound_playuntildone" type="sound_playuntildone">
            <value name="SOUND_MENU">
                <shadow type="sound_sounds_menu">
                    <field name="SOUND_MENU">${soundName}</field>
                </shadow>
            </value>
        </block>
        <block id="${targetId}_sound_play" type="sound_play">
            <value name="SOUND_MENU">
                <shadow type="sound_sounds_menu">
                    <field name="SOUND_MENU">${soundName}</field>
                </shadow>
            </value>
        </block>
        <block type="sound_stopallsounds"/>
        ${blockSeparator}
        <block type="sound_changeeffectby">
            <value name="VALUE">
                <shadow type="math_number">
                    <field name="NUM">10</field>
                </shadow>
            </value>
        </block>
        <block type="sound_seteffectto">
            <value name="VALUE">
                <shadow type="math_number">
                    <field name="NUM">100</field>
                </shadow>
            </value>
        </block>
        <block type="sound_cleareffects"/>
        ${blockSeparator}
        <block type="sound_changevolumeby">
            <value name="VOLUME">
                <shadow type="math_number">
                    <field name="NUM">-10</field>
                </shadow>
            </value>
        </block>
        <block type="sound_setvolumeto">
            <value name="VOLUME">
                <shadow type="math_number">
                    <field name="NUM">100</field>
                </shadow>
            </value>
        </block>
        <block id="${targetId}_volume" type="sound_volume"/>
        ${categorySeparator}
    </category>
    `;
};

const events = function (isInitialSetup, isStage, targetId, colors) {
    // Note: the category's secondaryColour matches up with the blocks' tertiary color, both used for border color.
    return `
    <category name="%{BKY_CATEGORY_EVENTS}" id="events" colour="${colors.primary}" secondaryColour="${colors.tertiary}">
        <block type="event_whenflagclicked"/>
        <block type="event_whenkeypressed">
        </block>
        ${isStage ? `
            <block type="event_whenstageclicked"/>
        ` : `
            <block type="event_whenthisspriteclicked"/>
        `}
        <block type="event_whenbackdropswitchesto">
        </block>
        ${blockSeparator}
        <block type="event_whengreaterthan">
            <value name="VALUE">
                <shadow type="math_number">
                    <field name="NUM">10</field>
                </shadow>
            </value>
        </block>
        ${blockSeparator}
        <block type="event_whenbroadcastreceived">
        </block>
        <block type="event_broadcast">
            <value name="BROADCAST_INPUT">
                <shadow type="event_broadcast_menu"></shadow>
            </value>
        </block>
        <block type="event_broadcastandwait">
            <value name="BROADCAST_INPUT">
              <shadow type="event_broadcast_menu"></shadow>
            </value>
        </block>
        ${categorySeparator}
    </category>
    `;
};

// "create clone of [sprite] with id ()": an empty id numbers the clones 1, 2, 3...
const createCloneXML = `
    <block type="control_create_clone_of">
        <value name="CLONE_OPTION">
            <shadow type="control_create_clone_of_menu"/>
        </value>
        <value name="ID">
            <shadow type="text">
                <field name="TEXT"></field>
            </shadow>
        </value>
    </block>
`;

const control = function (isInitialSetup, isStage, targetId, colors) {
    // Note: the category's secondaryColour matches up with the blocks' tertiary color, both used for border color.
    return `
    <category
        name="%{BKY_CATEGORY_CONTROL}"
        id="control"
        colour="${colors.primary}"
        secondaryColour="${colors.tertiary}">
        <block type="control_wait">
            <value name="DURATION">
                <shadow type="math_positive_number">
                    <field name="NUM">1</field>
                </shadow>
            </value>
        </block>
        ${blockSeparator}
        <block type="control_repeat">
            <value name="TIMES">
                <shadow type="math_whole_number">
                    <field name="NUM">10</field>
                </shadow>
            </value>
        </block>
        <block id="forever" type="control_forever"/>
        <block type="control_foreachframe">
            <value name="DT">
                <shadow type="control_foreachframe_deltatime"></shadow>
            </value>
        </block>
        ${blockSeparator}
        <block type="control_whenframe">
            <field name="PHASE">update</field>
            <value name="DT">
                <shadow type="control_foreachframe_deltatime"></shadow>
            </value>
        </block>
        <block type="control_whenframe">
            <field name="PHASE">lateupdate</field>
            <value name="DT">
                <shadow type="control_foreachframe_deltatime"></shadow>
            </value>
        </block>
        ${blockSeparator}
        <block type="control_for_range">
            <value name="VAR">
                <shadow type="control_for_range_index">
                    <field name="VALUE">i</field>
                </shadow>
            </value>
            <value name="FROM">
                <shadow type="math_number">
                    <field name="NUM">1</field>
                </shadow>
            </value>
            <value name="TO">
                <shadow type="math_number">
                    <field name="NUM">10</field>
                </shadow>
            </value>
        </block>
        ${blockSeparator}
        <block type="control_if"/>
        <block type="control_if_else"/>
        <block id="wait_until" type="control_wait_until"/>
        <block id="repeat_until" type="control_repeat_until"/>
        <block id="while" type="control_while"/>
        ${blockSeparator}
        <block type="control_stop"/>
        ${blockSeparator}
        <block type="control_fold"/>
        ${blockSeparator}
        ${isStage ? `
            ${createCloneXML}
        ` : `
            <block type="control_start_as_clone">
                <value name="ID">
                    <shadow type="control_start_as_clone_id"/>
                </value>
            </block>
            ${createCloneXML}
            <block type="control_delete_this_clone"/>
        `}
        ${categorySeparator}
    </category>
    `;
};

/**
 * @param {boolean} isInitialSetup see makeToolboxXML
 * @param {boolean} isStage see makeToolboxXML
 * @param {string} targetId see makeToolboxXML
 * @param {object} colors see makeToolboxXML
 * @param {?string} blocks3D 3D sensing blocks to put first. The palette filter keeps the ones for this target.
 * @returns {string} XML of the category
 */
const sensing = function (isInitialSetup, isStage, targetId, colors, blocks3D) {
    const name = translate('SENSING_ASK_TEXT', 'What\'s your name?');
    // Note: the category's secondaryColour matches up with the blocks' tertiary color, both used for border color.
    return `
    <category
        name="%{BKY_CATEGORY_SENSING}"
        id="sensing"
        colour="${colors.primary}"
        secondaryColour="${colors.tertiary}">
        ${blocks3D ? `${blocks3D}${blockSeparator}` : ''}
        ${isStage ? '' : `
            <block type="sensing_touchingobject">
                <value name="TOUCHINGOBJECTMENU">
                    <shadow type="sensing_touchingobjectmenu"/>
                </value>
            </block>
            <block type="sensing_touchingcolor">
                <value name="COLOR">
                    <shadow type="colour_picker"/>
                </value>
            </block>
            <block type="sensing_coloristouchingcolor">
                <value name="COLOR">
                    <shadow type="colour_picker"/>
                </value>
                <value name="COLOR2">
                    <shadow type="colour_picker"/>
                </value>
            </block>
            <block type="sensing_distanceto">
                <value name="DISTANCETOMENU">
                    <shadow type="sensing_distancetomenu"/>
                </value>
            </block>
            ${blockSeparator}
        `}
        ${isInitialSetup ? '' : `
            <block id="askandwait" type="sensing_askandwait">
                <value name="QUESTION">
                    <shadow type="text">
                        <field name="TEXT">${name}</field>
                    </shadow>
                </value>
            </block>
        `}
        <block id="answer" type="sensing_answer"/>
        ${blockSeparator}
        <block type="sensing_keypressed">
            <value name="KEY_OPTION">
                <shadow type="sensing_keyoptions"/>
            </value>
        </block>
        <block type="sensing_keyjustpressed">
            <value name="KEY_OPTION">
                <shadow type="sensing_keyoptions"/>
            </value>
        </block>
        <block type="sensing_keyjustreleased">
            <value name="KEY_OPTION">
                <shadow type="sensing_keyoptions"/>
            </value>
        </block>
        <block type="sensing_keyheldseconds">
            <value name="KEY_OPTION">
                <shadow type="sensing_keyoptions"/>
            </value>
        </block>
        <block type="sensing_mousedown"/>
        <block type="sensing_mousex"/>
        <block type="sensing_mousey"/>
        ${isStage ? '' : `
            ${blockSeparator}
            '<block type="sensing_setdragmode" id="sensing_setdragmode"></block>'+
            ${blockSeparator}
        `}
        ${blockSeparator}
        <block id="loudness" type="sensing_loudness"/>
        ${blockSeparator}
        <block id="timer" type="sensing_timer"/>
        <block type="sensing_resettimer"/>
        ${blockSeparator}
        <block id="of" type="sensing_of">
            <value name="OBJECT">
                <shadow id="sensing_of_object_menu" type="sensing_of_object_menu"/>
            </value>
        </block>
        ${blockSeparator}
        <block id="current" type="sensing_current"/>
        <block type="sensing_dayssince2000"/>
        ${blockSeparator}
        <block id="online" type="sensing_online"/>
        <block type="sensing_username"/>
        ${categorySeparator}
    </category>
    `;
};

const operators = function (isInitialSetup, isStage, targetId, colors) {
    const apple = translate('OPERATORS_JOIN_APPLE', 'apple');
    const banana = translate('OPERATORS_JOIN_BANANA', 'banana');
    const letter = translate('OPERATORS_LETTEROF_APPLE', 'a');
    // Note: the category's secondaryColour matches up with the blocks' tertiary color, both used for border color.
    return `
    <category
        name="%{BKY_CATEGORY_OPERATORS}"
        id="operators"
        colour="${colors.primary}"
        secondaryColour="${colors.tertiary}">
        <block type="operator_add">
            <value name="NUM1">
                <shadow type="math_number">
                    <field name="NUM"/>
                </shadow>
            </value>
            <value name="NUM2">
                <shadow type="math_number">
                    <field name="NUM"/>
                </shadow>
            </value>
        </block>
        <block type="operator_subtract">
            <value name="NUM1">
                <shadow type="math_number">
                    <field name="NUM"/>
                </shadow>
            </value>
            <value name="NUM2">
                <shadow type="math_number">
                    <field name="NUM"/>
                </shadow>
            </value>
        </block>
        <block type="operator_multiply">
            <value name="NUM1">
                <shadow type="math_number">
                    <field name="NUM"/>
                </shadow>
            </value>
            <value name="NUM2">
                <shadow type="math_number">
                    <field name="NUM"/>
                </shadow>
            </value>
        </block>
        <block type="operator_divide">
            <value name="NUM1">
                <shadow type="math_number">
                    <field name="NUM"/>
                </shadow>
            </value>
            <value name="NUM2">
                <shadow type="math_number">
                    <field name="NUM"/>
                </shadow>
            </value>
        </block>
        ${blockSeparator}
        <block type="operator_random">
            <value name="FROM">
                <shadow type="math_number">
                    <field name="NUM">1</field>
                </shadow>
            </value>
            <value name="TO">
                <shadow type="math_number">
                    <field name="NUM">10</field>
                </shadow>
            </value>
        </block>
        ${blockSeparator}
        <block type="operator_gt">
            <value name="OPERAND1">
                <shadow type="text">
                    <field name="TEXT"/>
                </shadow>
            </value>
            <value name="OPERAND2">
                <shadow type="text">
                    <field name="TEXT">50</field>
                </shadow>
            </value>
        </block>
        <block type="operator_lt">
            <value name="OPERAND1">
                <shadow type="text">
                    <field name="TEXT"/>
                </shadow>
            </value>
            <value name="OPERAND2">
                <shadow type="text">
                    <field name="TEXT">50</field>
                </shadow>
            </value>
        </block>
        <block type="operator_equals">
            <value name="OPERAND1">
                <shadow type="text">
                    <field name="TEXT"/>
                </shadow>
            </value>
            <value name="OPERAND2">
                <shadow type="text">
                    <field name="TEXT">50</field>
                </shadow>
            </value>
        </block>
        ${blockSeparator}
        <block type="operator_and"/>
        <block type="operator_or"/>
        <block type="operator_not"/>
        ${blockSeparator}
        ${isInitialSetup ? '' : `
            <block type="operator_join">
                <value name="STRING1">
                    <shadow type="text">
                        <field name="TEXT">${apple} </field>
                    </shadow>
                </value>
                <value name="STRING2">
                    <shadow type="text">
                        <field name="TEXT">${banana}</field>
                    </shadow>
                </value>
            </block>
            <block type="operator_letter_of">
                <value name="LETTER">
                    <shadow type="math_whole_number">
                        <field name="NUM">1</field>
                    </shadow>
                </value>
                <value name="STRING">
                    <shadow type="text">
                        <field name="TEXT">${apple}</field>
                    </shadow>
                </value>
            </block>
            <block type="operator_length">
                <value name="STRING">
                    <shadow type="text">
                        <field name="TEXT">${apple}</field>
                    </shadow>
                </value>
            </block>
            <block type="operator_contains" id="operator_contains">
              <value name="STRING1">
                <shadow type="text">
                  <field name="TEXT">${apple}</field>
                </shadow>
              </value>
              <value name="STRING2">
                <shadow type="text">
                  <field name="TEXT">${letter}</field>
                </shadow>
              </value>
            </block>
        `}
        ${blockSeparator}
        <block type="operator_mod">
            <value name="NUM1">
                <shadow type="math_number">
                    <field name="NUM"/>
                </shadow>
            </value>
            <value name="NUM2">
                <shadow type="math_number">
                    <field name="NUM"/>
                </shadow>
            </value>
        </block>
        <block type="operator_round">
            <value name="NUM">
                <shadow type="math_number">
                    <field name="NUM"/>
                </shadow>
            </value>
        </block>
        ${blockSeparator}
        <block type="operator_mathop">
            <value name="NUM">
                <shadow type="math_number">
                    <field name="NUM"/>
                </shadow>
            </value>
        </block>
        ${categorySeparator}
    </category>
    `;
};

const variables = function (isInitialSetup, isStage, targetId, colors) {
    // Note: the category's secondaryColour matches up with the blocks' tertiary color, both used for border color.
    return `
    <category
        name="%{BKY_CATEGORY_VARIABLES}"
        id="variables"
        colour="${colors.primary}"
        secondaryColour="${colors.tertiary}"
        custom="VARIABLE">
    </category>
    `;
};

const myBlocks = function (isInitialSetup, isStage, targetId, colors) {
    // Note: the category's secondaryColour matches up with the blocks' tertiary color, both used for border color.
    return `
    <category
        name="%{BKY_CATEGORY_MYBLOCKS}"
        id="myBlocks"
        colour="${colors.primary}"
        secondaryColour="${colors.tertiary}"
        custom="PROCEDURE">
    </category>
    `;
};

// eslint-disable-next-line max-len
const extraTurboWarpBlocks = `
<block type="argument_reporter_boolean"><field name="VALUE">is compiled?</field></block>
<block type="argument_reporter_boolean"><field name="VALUE">is TurboWarp?</field></block>
`;
/* eslint-enable no-unused-vars */

/**
 * @param {string} categoryXML `<category ...>...</category>`
 * @returns {string} the blocks inside it
 */
const categoryContents = categoryXML => categoryXML
    .replace(/^\s*<category[^>]*>/, '')
    .replace(/<\/category>\s*$/, '');

// Reporters of 3D motion that can have a monitor. Like the 2D ones, their flyout blocks get IDs that include
// the target, so that the checkbox shows the monitor of this sprite.
const MOTION_3D_REPORTERS = ['xposition', 'yposition', 'zposition', 'yaw', 'pitch', 'roll'];
// 3D motion blocks whose X / Y / Z inputs are set to the sprite's position
const MOTION_3D_POSITION_BLOCKS = ['gotoxyz', 'glidexyz'];

/**
 * @param {string} xml category of the built-in motion3d blocks
 * @param {string} targetId editing target
 * @returns {string} same category with IDs for the reporters
 */
const addMotion3DReporterIds = (xml, targetId) => xml.replace(
    new RegExp(`<block type="motion3d_(${MOTION_3D_REPORTERS.join('|')})"`, 'g'),
    (match, opcode) => `<block type="motion3d_${opcode}" id="${xmlEscape(targetId)}_motion3d_${opcode}"`
).replace(
    // Like "go to x y" of 2D sprites, the blocks' inputs follow the sprite's position (blocks.jsx onTargetsUpdate)
    new RegExp(`<block type="motion3d_(${MOTION_3D_POSITION_BLOCKS.join('|')})"`, 'g'),
    (match, opcode) => `<block type="motion3d_${opcode}" id="motion3d_${opcode}"`
);

/**
 * @param {string} xml category of the built-in looks3d blocks
 * @param {string} hello default text of the log block
 * @returns {string} same category ending with the log block, like 2D Looks
 */
const addLogBlock = (xml, hello) => {
    const end = xml.lastIndexOf('</category>');
    return `${xml.slice(0, end)}${blockSeparator}
        <block type="looks_log">
            <value name="MESSAGE">
                <shadow type="text">
                    <field name="TEXT">${hello}</field>
                </shadow>
            </value>
        </block>
        ${categorySeparator}${xml.slice(end)}`;
};

/**
 * Leave out the blocks that the target's palette doesn't show (see the VM's block-support.js), then separators
 * that no longer separate anything, then categories that had blocks and have none left.
 * @param {string} xml whole toolbox
 * @param {function(string): boolean} isInPalette opcode → true to show the block
 * @returns {string} filtered toolbox, or the same one if it can't be parsed
 */
const filterPalette = (xml, isInPalette) => {
    if (typeof DOMParser === 'undefined') return xml;
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) return xml;
    for (const category of Array.from(doc.getElementsByTagName('category'))) {
        const blocks = Array.from(category.children).filter(child => child.tagName === 'block');
        if (blocks.length === 0) continue;
        let removed = 0;
        for (const block of blocks) {
            if (!isInPalette(block.getAttribute('type'))) {
                category.removeChild(block);
                removed++;
            }
        }
        if (removed === 0) continue;
        if (removed === blocks.length) {
            category.parentNode.removeChild(category);
            continue;
        }
        // Separators before the first block, after the last one, or next to each other
        let previousWasSeparator = true;
        for (const child of Array.from(category.children)) {
            const separator = child.tagName === 'sep';
            if (separator && previousWasSeparator) category.removeChild(child);
            else previousWasSeparator = separator;
        }
        const last = Array.from(category.children).pop();
        if (last && last.tagName === 'sep') category.removeChild(last);
    }
    return new XMLSerializer().serializeToString(doc.documentElement);
};

const xmlOpen = '<xml style="display: none">';
const xmlClose = '</xml>';

/**
 * @param {!boolean} isInitialSetup - Whether the toolbox is for initial setup. If the mode is "initial setup",
 * blocks with localized default parameters (e.g. ask and wait) should not be loaded. (LLK/scratch-gui#5445)
 * @param {?boolean} isStage - Whether the toolbox is for a stage-type target. This is always set to true
 * when isInitialSetup is true.
 * @param {?string} targetId - The current editing target
 * @param {?Array.<object>} categoriesXML - optional array of `{id,xml}` for categories. This can include both core
 * and other extensions: core extensions will be placed in the normal Scratch order; others will go at the bottom.
 * @property {string} id - the extension / category ID.
 * @property {string} xml - the `<category>...</category>` XML for this extension / category.
 * @param {?string} costumeName - The name of the default selected costume dropdown.
 * @param {?string} backdropName - The name of the default selected backdrop dropdown.
 * @param {?string} soundName -  The name of the default selected sound dropdown.
 * @param {?object} colors - The colors for the theme.
 * @param {object} [options] - About the target:
 * @param {boolean} [options.is3D] - Whether the target is a 3D sprite: its motion and looks are the 3D ones.
 * @param {boolean} [options.has3D] - Whether the project has 3D sprites, so that 2D sprites can use the blocks
 * that follow them.
 * @param {function(string): boolean} [options.isInPalette] - opcode → whether the target's palette shows it.
 * @returns {string} - a ScratchBlocks-style XML document for the contents of the toolbox.
 */
const makeToolboxXML = function (isInitialSetup, isStage = true, targetId, categoriesXML = [],
    costumeName = '', backdropName = '', soundName = '', colors = defaultBlockColors, options = {}) {
    isStage = isInitialSetup || isStage;
    const is3D = !!options.is3D && !isStage;
    const gap = [categorySeparator];

    costumeName = xmlEscape(costumeName);
    backdropName = xmlEscape(backdropName);
    soundName = xmlEscape(soundName);

    categoriesXML = categoriesXML.slice();
    const moveCategory = categoryId => {
        const index = categoriesXML.findIndex(categoryInfo => categoryInfo.id === categoryId);
        if (index >= 0) {
            // remove the category from categoriesXML and return its XML
            const [categoryInfo] = categoriesXML.splice(index, 1);
            return categoryInfo.xml;
        }
        // return `undefined`
    };
    // 3D sprites have their own motion and looks, and 3D blocks at the top of sensing. Other targets don't see them.
    const motion3DXML = moveCategory('motion3d');
    const looks3DXML = moveCategory('looks3d');
    const sensing3DXML = moveCategory('sensing3d');
    const use3D = is3D && motion3DXML && looks3DXML && sensing3DXML;

    const motionXML = use3D ?
        addMotion3DReporterIds(motion3DXML, targetId) :
        moveCategory('motion') || motion(isInitialSetup, isStage, targetId, colors.motion);
    const looksXML = use3D ?
        addLogBlock(looks3DXML, xmlEscape(translate('LOOKS_HELLO', 'Hello!'))) :
        moveCategory('looks') || looks(isInitialSetup, isStage, targetId, costumeName, backdropName, colors.looks);
    // Blocks of built-in extensions that belong in a category of the palette: they go at its end
    const appendToCategory = (xml, extensionXML) => {
        if (!extensionXML) return xml;
        const contents = extensionXML
            .replace(/^<category[^>]*>/, '')
            .replace(/<\/category>$/, '');
        const end = xml.lastIndexOf('</category>');
        return `${xml.slice(0, end)}${contents}${categorySeparator}${xml.slice(end)}`;
    };
    // 3D sound (built-in sound3d), for 3D sprites
    const sound3DXML = moveCategory('sound3d');
    let soundXML = moveCategory('sound') || sound(isInitialSetup, isStage, targetId, soundName, colors.sounds);
    if (is3D) soundXML = appendToCategory(soundXML, sound3DXML);
    // The mouse moving onto and off sprites (built-in event3d), for sprites
    const events3DXML = moveCategory('event3d');
    let eventsXML = moveCategory('event') || events(isInitialSetup, isStage, targetId, colors.event);
    if (!isStage) eventsXML = appendToCategory(eventsXML, events3DXML);
    // Size of the screen (built-in screen): the hat goes at the end of Events, the reporter at the end of Sensing
    const screenXML = moveCategory('screen');
    const screenBlock = opcode => {
        if (!screenXML) return '';
        const match = screenXML.match(new RegExp(`<block type="screen_${opcode}"[\\s\\S]*?</block>`));
        return match ? match[0] : '';
    };
    if (screenXML) eventsXML = appendToCategory(eventsXML, screenBlock('whenresized'));
    let controlXML = moveCategory('control') || control(isInitialSetup, isStage, targetId, colors.control);
    let sensingXML = moveCategory('sensing') || sensing(isInitialSetup, isStage, targetId, colors.sensing,
        sensing3DXML && (use3D || options.has3D) ? categoryContents(sensing3DXML) : null);
    if (screenXML) sensingXML = appendToCategory(sensingXML, screenBlock('size'));
    const operatorsXML = moveCategory('operators') || operators(isInitialSetup, isStage, targetId, colors.operators);
    // 資料 (built-in twdata: global variables with paths, arrays and objects) replaces the old "Make a Variable" category
    const variablesXML = moveCategory('twdata') || moveCategory('data') ||
        variables(isInitialSetup, isStage, targetId, colors.data);
    // 分身變數 and clones by id (built-in twclonevars) go at the end of Control, after the clone blocks. The stage
    // has no clones of its own (so no 分身變數), but can delete and read the clones of sprites.
    const clonesXML = moveCategory('twclonevars');
    if (clonesXML) {
        const cloneBlocks = clonesXML
            .replace(/^<category[^>]*>/, '')
            .replace(/<\/category>$/, '');
        const end = controlXML.lastIndexOf('</category>');
        controlXML = `${controlXML.slice(0, end)}${cloneBlocks}${categorySeparator}${controlXML.slice(end)}`;
    }
    const myBlocksXML = moveCategory('procedures') || myBlocks(isInitialSetup, isStage, targetId, colors.more);
    // 區域變數 (built-in twlocalvars) have no category of their own: blocks.jsx adds them to the My Blocks flyout
    moveCategory('twlocalvars');

    // Always display TurboWarp blocks as the first extension, if it exists,
    // and also add an "is compiled?" block to the top.
    // 檔案 is built in: always right after My Blocks
    const filesXML = moveCategory('twfiles');
    // Then 相機 and 環境 (built-in camera3d and environment3d), for every target. The field of view reporter of camera
    // sprites can have a monitor, like the 3D motion reporters.
    let cameraXML = moveCategory('camera3d');
    if (cameraXML && targetId) {
        cameraXML = cameraXML.replace('<block type="camera3d_fov"',
            `<block type="camera3d_fov" id="${xmlEscape(targetId)}_camera3d_fov"`);
    }
    const environmentXML = moveCategory('environment3d');
    // 物理 (built-in physics3d): collision and physics of 3D sprites; every target can cast rays
    const physicsXML = moveCategory('physics3d');
    // 程序物件 (three3d, from the extension library) comes next when it is loaded
    const proceduralXML = moveCategory('three3d');

    let turbowarpXML = moveCategory('tw');
    if (turbowarpXML && !turbowarpXML.includes(extraTurboWarpBlocks)) {
        turbowarpXML = turbowarpXML.replace('<block', `${extraTurboWarpBlocks}<block`);
    }

    const everything = [
        xmlOpen,
        motionXML, gap,
        looksXML, gap,
        soundXML, gap,
        eventsXML, gap,
        controlXML, gap,
        sensingXML, gap,
        operatorsXML, gap,
        variablesXML, gap,
        myBlocksXML
    ];

    if (filesXML) {
        everything.push(gap, filesXML);
    }

    if (cameraXML) {
        everything.push(gap, cameraXML);
    }

    if (environmentXML) {
        everything.push(gap, environmentXML);
    }

    if (physicsXML) {
        everything.push(gap, physicsXML);
    }

    if (proceduralXML) {
        everything.push(gap, proceduralXML);
    }

    if (turbowarpXML) {
        everything.push(gap, turbowarpXML);
    }

    for (const extensionCategory of categoriesXML) {
        everything.push(gap, extensionCategory.xml);
    }

    everything.push(xmlClose);
    const xml = everything.join('\n');
    return options.isInPalette ? filterPalette(xml, options.isInPalette) : xml;
};

export {
    makeToolboxXML as default,
    xmlEscape
};

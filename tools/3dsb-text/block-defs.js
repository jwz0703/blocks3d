/**
 * @fileoverview
 * What every block looks like in the editor, for the comments of the text and for checking it:
 *
 * - the blocks of scratch-blocks (with the zh-tw messages) and the ones scratch-gui's lib/blocks.js adds or changes,
 *   read by running their `init` against a stub of Blockly that records `jsonInit`
 * - the blocks of the VM's extensions, from their getInfo() (runtime._blockInfo)
 *
 * A definition is {opcode, text, args: {NAME: {kind: 'input'|'statement'|'field', options?: string[]}}, shadow?}.
 * `text` has [NAME] where the argument is, like getInfo(). `options` is only there for menus with fixed items.
 */
const fs = require('fs');
const path = require('path');
const vmContext = require('vm');
const {SCRATCH_BLOCKS, GUI} = require('./paths');

const LOCALE = 'zh-tw';

// Something that is every property, function and constructor at once, for the parts of Blockly that don't matter
const makeAnything = () => {
    const anything = new Proxy(function () {}, {
        get: (target, key) => {
            if (key === Symbol.toPrimitive) return () => '';
            if (key === 'toString' || key === 'valueOf') return () => '';
            if (key === Symbol.iterator) return function* () {};
            if (key === 'length') return 0;
            return anything;
        },
        set: () => true,
        apply: () => anything,
        construct: () => anything,
        has: () => true
    });
    return anything;
};

/**
 * An object with some real properties; everything else is `anything`
 * @param {object} real
 * @param {Function} anything
 * @returns {object}
 */
const partly = (real, anything) => new Proxy(real, {
    get: (target, key) => (key in target ? target[key] : anything)
});

const readScratchBlocks = () => {
    const anything = makeAnything();
    const Msg = {};
    const Blocks = {};
    const ScratchMsgs = {
        locales: {},
        translate: (key, fallback) => (key in Msg ? Msg[key] : fallback)
    };
    const Blockly = partly({Msg, Blocks, ScratchMsgs}, anything);
    const goog = partly({provide: () => {}, require: () => {}}, anything);
    const sandbox = vmContext.createContext({Blockly, goog, window: anything, document: anything, console});
    const run = file => {
        try {
            vmContext.runInContext(fs.readFileSync(file, 'utf8'), sandbox, {filename: file});
        } catch (e) {
            // Parts of the files that need a real Blockly; the block definitions come first
        }
    };
    run(path.join(SCRATCH_BLOCKS, 'msg', 'messages.js'));
    run(path.join(SCRATCH_BLOCKS, 'msg', 'scratch_msgs.js'));
    Object.assign(Msg, ScratchMsgs.locales[LOCALE] || {});
    for (const folder of ['blocks_common', 'blocks_vertical']) {
        const dir = path.join(SCRATCH_BLOCKS, folder);
        for (const file of fs.readdirSync(dir).sort()) {
            if (file.endsWith('.js')) run(path.join(dir, file));
        }
    }

    // scratch-gui's changes and additions: lib/blocks.js is `export default function (vm) {...}` using
    // LazyScratchBlocks.get()
    const guiFile = path.join(GUI, 'src', 'lib', 'blocks.js');
    if (fs.existsSync(guiFile)) {
        const source = fs.readFileSync(guiFile, 'utf8')
            .replace(/^import .*$/mg, '')
            .replace('export default function', 'module.exports = function');
        const module = {exports: null};
        const guiSandbox = vmContext.createContext({
            module,
            LazyScratchBlocks: {get: () => Blockly},
            Intl,
            document: anything,
            window: anything,
            console
        });
        try {
            vmContext.runInContext(source, guiSandbox, {filename: guiFile});
            // The editor's Msg constants (PROCEDURES_RETURN etc. are set by containers/blocks.jsx) don't matter here
            module.exports(anything);
        } catch (e) {
            // Everything assigned before the error is kept
        }
    }

    const defs = {};
    for (const opcode of Object.keys(Blocks)) {
        const definition = Blocks[opcode];
        if (!definition || typeof definition.init !== 'function') continue;
        let json = null;
        const self = partly({
            id: opcode,
            type: opcode,
            jsonInit: value => {
                json = json ? Object.assign(json, value) : value;
            }
        }, anything);
        try {
            definition.init.call(self);
        } catch (e) {
            // Keep what jsonInit got before the error
        }
        defs[opcode] = fromBlocklyJSON(opcode, json);
    }
    return defs;
};

/**
 * @param {string} opcode
 * @param {?object} json what the block gave jsonInit
 * @returns {object} definition
 */
const fromBlocklyJSON = (opcode, json) => {
    const def = {opcode, text: '', args: {}, source: 'blocks'};
    if (!json) return def;
    const texts = [];
    for (let i = 0; typeof json[`message${i}`] === 'string'; i++) {
        const args = Array.isArray(json[`args${i}`]) ? json[`args${i}`] : [];
        const message = json[`message${i}`].replace(/%(\d+)/g, (all, n) => {
            const arg = args[Number(n) - 1];
            if (!arg || typeof arg !== 'object') return '';
            if (arg.type === 'input_statement') {
                def.args[arg.name] = {kind: 'statement'};
                return '';
            }
            if (arg.type === 'input_value') {
                def.args[arg.name] = {kind: 'input'};
                // Hexagonal inputs only take Boolean blocks
                if (arg.check === 'Boolean') def.args[arg.name].boolean = true;
                return `[${arg.name}]`;
            }
            if (typeof arg.name === 'string' && arg.type && arg.type.startsWith('field_')) {
                const field = {kind: 'field'};
                if (arg.type === 'field_dropdown' && Array.isArray(arg.options)) {
                    field.options = arg.options.map(option => String(option[1]));
                }
                def.args[arg.name] = field;
                return `[${arg.name}]`;
            }
            return '';
        });
        texts.push(message.trim());
    }
    def.text = texts.filter(Boolean).join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    def.output = !!json.output || (Array.isArray(json.extensions) && json.extensions.some(e => /^output_/.test(e)));
    def.boolean = json.output === 'Boolean' ||
        (Array.isArray(json.extensions) && json.extensions.includes('output_boolean'));
    return def;
};

/**
 * @param {object} runtime a VM runtime with the extensions loaded
 * @returns {object} definitions of the extension blocks, by opcode
 */
const readExtensions = runtime => {
    const defs = {};
    for (const category of runtime._blockInfo) {
        const menus = {};
        const menuInfo = category.menuInfo || {};
        for (const [name, menu] of Object.entries(menuInfo)) {
            const items = Array.isArray(menu) ? menu : menu && menu.items;
            menus[name] = {
                options: Array.isArray(items) ?
                    items.map(item => String(item && typeof item === 'object' ? item.value : item)) :
                    null,
                acceptReporters: !!(menu && menu.acceptReporters)
            };
            // The shadow block of a menu that takes reporters
            const opcode = `${category.id}_menu_${name}`;
            defs[opcode] = {
                opcode,
                text: `[${name}]`,
                args: {[name]: {kind: 'field', options: menus[name].options || undefined}},
                source: 'extension',
                output: true
            };
        }
        for (const block of category.blocks) {
            const info = block.info;
            if (!info || !info.opcode || typeof info.opcode !== 'string') continue;
            const opcode = `${category.id}_${info.opcode}`;
            const args = {};
            for (const [name, arg] of Object.entries(info.arguments || {})) {
                if (arg && arg.type === 'image') continue;
                const menu = arg && arg.menu ? menus[arg.menu] : null;
                // Menus that don't take reporters are fields; the others are inputs with a menu shadow
                if (arg && arg.label) {
                    // A text on the block that isn't edited there (the name in a global broadcast)
                    args[name] = {kind: 'field'};
                } else if (menu && !menu.acceptReporters) {
                    args[name] = {kind: 'field', options: menu.options || undefined};
                } else if (arg && arg.menu) {
                    args[name] = {kind: 'input', menu: `${category.id}_menu_${arg.menu}`};
                } else {
                    args[name] = {kind: 'input', shadow: ARGUMENT_SHADOWS[arg && arg.type] || null};
                    if (arg && arg.type === 'Boolean') args[name].boolean = true;
                }
            }
            const branches = info.branchCount || (info.blockType === 'loop' ? 1 : 0);
            for (let i = 0; i < branches; i++) args[i === 0 ? 'SUBSTACK' : `SUBSTACK${i + 1}`] = {kind: 'statement'};
            const text = Array.isArray(info.text) ? info.text.join(' ') : String(info.text || '');
            defs[opcode] = {
                opcode,
                text,
                args,
                source: 'extension',
                output: ['reporter', 'Boolean', 'boolean'].includes(info.blockType),
                boolean: ['Boolean', 'boolean'].includes(info.blockType),
                // Round, but it goes into boolean inputs too (properties of components)
                anyInput: !!info.allowDropAnywhere
            };
        }
    }
    return defs;
};

// Shadows that are values, not menus, and their primitive type in sb3
const PRIMITIVE_SHADOWS = {
    math_number: 4,
    math_positive_number: 5,
    math_whole_number: 6,
    math_integer: 7,
    math_angle: 8,
    colour_picker: 9,
    text: 10,
    event_broadcast_menu: 11
};

// The shadow of extension arguments, by argument type
const ARGUMENT_SHADOWS = {
    number: 4,
    angle: 8,
    color: 9,
    string: 10
};

/**
 * The shadow each input of the core blocks gets in the palette, from scratch-gui's make-toolbox-xml.js
 * @returns {Object.<string, Object.<string, string>>} shadow opcode, by block opcode and input name
 */
const readToolboxShadows = () => {
    const file = path.join(GUI, 'src', 'lib', 'make-toolbox-xml.js');
    const result = {};
    if (!fs.existsSync(file)) return result;
    const source = fs.readFileSync(file, 'utf8');
    const tags = /<(\/?)(block|value|shadow)\b([^>]*?)(\/?)>/g;
    const stack = [];
    let match;
    while ((match = tags.exec(source))) {
        const [, close, tag, attributes, selfClosing] = match;
        const type = (/type="([^"]+)"/.exec(attributes) || [])[1];
        const name = (/name="([^"]+)"/.exec(attributes) || [])[1];
        if (tag === 'value') {
            if (close) stack.pop();
            else if (!selfClosing) stack.push({value: name});
            continue;
        }
        if (close) {
            stack.pop();
            continue;
        }
        const top = stack[stack.length - 1];
        if (top && top.value && tag === 'shadow' && type) {
            const owner = stack.slice().reverse()
                .find(item => item.block);
            if (owner) {
                if (!result[owner.block]) result[owner.block] = {};
                result[owner.block][top.value] = type;
            }
        }
        if (!selfClosing) stack.push({block: type});
    }
    return result;
};

// What the tool knows of blocks that don't describe themselves with jsonInit
const EXTRA_TEXT = {
    event_whenflagclicked: '當綠旗被點擊',
    control_stop: '停止 [STOP_OPTION]',
    procedures_definition: '定義 [custom_block]',
    procedures_prototype: '',
    argument_reporter_string_number: '[VALUE]',
    argument_reporter_boolean: '[VALUE]',
    data_variable: '[VARIABLE]',
    data_listcontents: '[LIST]'
};

let cached = null;

/**
 * @param {object} runtime a VM runtime with the extensions loaded
 * @returns {Object.<string, object>} every block definition, by opcode
 */
const getBlockDefs = runtime => {
    if (!cached) {
        cached = readScratchBlocks();
        for (const [opcode, shadows] of Object.entries(readToolboxShadows())) {
            if (!cached[opcode]) continue;
            for (const [name, shadow] of Object.entries(shadows)) {
                const arg = cached[opcode].args[name];
                if (!arg) continue;
                if (PRIMITIVE_SHADOWS[shadow]) arg.shadow = PRIMITIVE_SHADOWS[shadow];
                else arg.menu = shadow;
            }
        }
        for (const [opcode, text] of Object.entries(EXTRA_TEXT)) {
            const def = cached[opcode] || (cached[opcode] = {opcode, args: {}, source: 'blocks'});
            if (!def.text || opcode === 'event_whenflagclicked') {
                def.text = text;
                for (const name of text.match(/[A-Z_a-z]+(?=\])/g) || []) {
                    if (!def.args[name]) def.args[name] = {kind: name === 'custom_block' ? 'input' : 'field'};
                }
            }
        }
    }
    return Object.assign({}, cached, readExtensions(runtime));
};

/**
 * @param {Object.<string, object>} defs
 * @param {string} opcode
 * @param {string} input
 * @returns {?{opcode: string, field: string}} the menu shadow of an input, and the name of its field
 */
const menuOf = (defs, opcode, input) => {
    const def = defs[opcode];
    const menu = def && def.args[input] && def.args[input].menu;
    if (!menu || !defs[menu]) return null;
    const fields = Object.keys(defs[menu].args).filter(name => defs[menu].args[name].kind === 'field');
    return fields.length === 1 ? {opcode: menu, field: fields[0]} : null;
};

/**
 * @param {Object.<string, object>} defs
 * @param {string} opcode
 * @param {string} input
 * @returns {?number} the primitive type of the input's shadow in the palette (4 to 10), or null
 */
const shadowTypeOf = (defs, opcode, input) => {
    const def = defs[opcode];
    const type = def && def.args[input] && def.args[input].shadow;
    return type >= 4 && type <= 10 ? type : null;
};

/**
 * @param {?object} def
 * @param {function(string, object): string} describe the text for an argument
 * @returns {string} what the block says in the editor, with its arguments
 */
const label = (def, describe) => {
    if (!def || !def.text) return '';
    return def.text.replace(/\[([^\]]+)\]/g, (all, name) => (def.args[name] ? describe(name, def.args[name]) : all))
        .replace(/\s+/g, ' ')
        .trim();
};

module.exports = {
    getBlockDefs,
    menuOf,
    shadowTypeOf,
    label
};

/**
 * @fileoverview
 * Where a project uses its variables: the path blocks (資料, 分身變數, 區域變數, see scratch-vm
 * extensions/tw_data/path-blocks.js), ${path} in text blocks, the old variable / list blocks, broadcasts, and the
 * bindings in SVG costumes (scratch-vm engine/svg-bindings.js).
 */
const {vmModule} = require('./paths');

const {PATH_BLOCKS} = vmModule('src/extensions/tw_data/path-blocks');
const DataPath = vmModule('src/util/data-path');
const {scanSvgBindings} = vmModule('src/util/svg-binding-scan');
const {pathsOf} = vmModule('src/util/b3-expression');
const model = require('./model');

// Functions of DataPath that change what the path points to
const WRITES = new Set(['set', 'setObject', 'change', 'remove', 'addItem', 'insertItem', 'deleteItem', 'replaceItem',
    'clear']);

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * @param {object} block
 * @param {string} name
 * @param {object} blocks
 * @returns {?string} the text in an input, if it is a value typed in (not a block)
 */
const literalInput = (block, name, blocks) => {
    const input = block.inputs && block.inputs[name];
    if (!Array.isArray(input)) return null;
    const ref = input[1];
    if (Array.isArray(ref) && ref[0] >= 4 && ref[0] <= 10) return String(ref[1]);
    if (typeof ref === 'string' && isObject(blocks[ref]) && blocks[ref].shadow === true) {
        const fields = Object.values(blocks[ref].fields || {});
        if (fields.length === 1 && Array.isArray(fields[0])) return String(fields[0][0]);
    }
    return null;
};

/**
 * @param {object} costume
 * @param {object} svgs SVG text by file name (project-file.js readSvgs)
 * @returns {?string} the SVG of the costume, if it is one and it was read
 */
const svgOf = (costume, svgs) => {
    if (!svgs || !costume || String(costume.dataFormat).toLowerCase() !== 'svg') return null;
    const text = svgs[costume.md5ext || `${costume.assetId}.svg`];
    return typeof text === 'string' ? text : null;
};

/**
 * @param {object} json project.json
 * @param {object} svgs
 * @returns {Array<{target: string, costume: string, bindings: Array, errors: Array}>} the bindings of every costume
 * that has some (or mistakes in them)
 */
const svgBindings = (json, svgs) => {
    const result = [];
    for (const target of model.allTargets(json)) {
        for (const costume of target.costumes || []) {
            const svg = svgOf(costume, svgs);
            if (!svg || !(svg.includes('{') || svg.includes('data-bind-'))) continue;
            const {bindings, errors} = scanSvgBindings(svg);
            if (bindings.length || errors.length) result.push({target: target.name, costume: costume.name, bindings, errors});
        }
    }
    return result;
};

/**
 * @param {object} json project.json
 * @param {object} [svgs] SVG costumes by file name, to include what their bindings read
 * @returns {Array<object>} every use: {target, blockId, opcode, kind: 'path'|'variable'|'list'|'broadcast'|'event',
 * scope, name, text, write}; bindings have `costume` (its name) and blockId null; events have `sprite` (the sprite
 * that sends it) and write is true where it is sent
 */
const findRefs = (json, svgs) => {
    const refs = [];
    for (const {target, costume, bindings} of svgBindings(json, svgs)) {
        for (const binding of bindings) {
            for (const tree of binding.trees) {
                for (const node of pathsOf(tree)) {
                    if (node.scope === 'prop') continue;
                    const path = DataPath.parse(node.text, 'global');
                    if (!path || !path.steps.length || path.steps[0].key === void 0) continue;
                    refs.push({target, blockId: null, opcode: 'svg', costume, line: binding.line, kind: 'path',
                        scope: path.scope, name: path.steps[0].key, text: node.text, write: false});
                }
            }
        }
    }
    for (const target of model.allTargets(json)) {
        const blocks = isObject(target.blocks) ? target.blocks : {};
        const add = (blockId, opcode, ref) => refs.push(Object.assign({target: target.name, blockId, opcode}, ref));
        for (const [blockId, block] of Object.entries(blocks)) {
            if (Array.isArray(block)) {
                if (block[0] === 12 || block[0] === 13) {
                    add(blockId, block[0] === 12 ? 'data_variable' : 'data_listcontents',
                        {kind: block[0] === 12 ? 'variable' : 'list', name: block[1], text: block[1], id: block[2], write: false});
                }
                continue;
            }
            if (!isObject(block)) continue;
            const info = PATH_BLOCKS[block.opcode];
            if (info) {
                const text = literalInput(block, info.args[0], blocks);
                const path = text === null ? null : DataPath.parse(text, info.scope);
                if (path && path.steps.length && path.steps[0].key !== undefined) {
                    add(blockId, block.opcode, {
                        kind: 'path',
                        scope: path.scope,
                        name: path.steps[0].key,
                        text,
                        write: WRITES.has(info.fn)
                    });
                }
            }
            if (block.opcode === 'data_text' && block.fields && Array.isArray(block.fields.TEXT)) {
                const re = /\$\{([^}]*)\}/g;
                let match;
                while ((match = re.exec(String(block.fields.TEXT[0])))) {
                    const path = DataPath.parse(match[1], 'global');
                    if (path && path.steps.length && path.steps[0].key !== undefined) {
                        add(blockId, block.opcode, {kind: 'path', scope: path.scope, name: path.steps[0].key, text: match[1], write: false});
                    }
                }
            }
            // Events of the public interface of sprites: sent by the sprite, received by "when [sprite] [event]"
            if (/^twiface_(emit|emitValue|emitAndWait|whenEvent)$/.test(block.opcode) && block.fields &&
                Array.isArray(block.fields.EVENT)) {
                const receives = block.opcode === 'twiface_whenEvent';
                const sprite = receives ? (Array.isArray(block.fields.SPRITE) ? String(block.fields.SPRITE[0]) : '') :
                    (target.isComponent ? target.title : target.name);
                add(blockId, block.opcode, {kind: 'event', name: String(block.fields.EVENT[0]), sprite,
                    text: `${sprite}.${block.fields.EVENT[0]}`, write: !receives});
            }
            // Outputs of components: said in the component, heard by "when [instance] says [output]"
            if (/^twcomp_(emit|emitAndWait|whenOutput)$/.test(block.opcode) && block.fields &&
                Array.isArray(block.fields.PORT)) {
                const receives = block.opcode === 'twcomp_whenOutput';
                const sprite = receives ? (Array.isArray(block.fields.SPRITE) ? String(block.fields.SPRITE[0]) : '') :
                    (target.isComponent ? target.title : ((target.isMember && isObject(json.components) &&
                        isObject(json.components[target.componentId]) && json.components[target.componentId].name) ||
                        target.name));
                add(blockId, block.opcode, {kind: 'event', name: String(block.fields.PORT[0]), sprite,
                    text: `${sprite.replace(/^_any_/, '')}.${block.fields.PORT[0]}`, write: !receives});
            }
            for (const [name, field] of Object.entries(block.fields || {})) {
                if (!Array.isArray(field)) continue;
                const kind = {VARIABLE: 'variable', LIST: 'list', BROADCAST_OPTION: 'broadcast'}[name];
                if (kind) {
                    add(blockId, block.opcode, {
                        kind,
                        name: field[0],
                        text: field[0],
                        id: field[1],
                        write: /^data_(set|change)variable|^data_(add|delete|insert|replace)|^data_deleteall/.test(block.opcode)
                    });
                }
            }
            for (const input of Object.values(block.inputs || {})) {
                if (!Array.isArray(input)) continue;
                for (const ref of input.slice(1)) {
                    if (Array.isArray(ref) && ref[0] >= 11 && ref[0] <= 13) {
                        const kind = {11: 'broadcast', 12: 'variable', 13: 'list'}[ref[0]];
                        add(blockId, block.opcode, {kind, name: ref[1], text: ref[1], id: ref[2], write: false});
                    }
                }
            }
        }
    }
    return refs;
};

module.exports = {
    findRefs,
    svgBindings,
    literalInput,
    DataPath
};

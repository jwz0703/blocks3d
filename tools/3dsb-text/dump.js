/**
 * @fileoverview
 * project.json → text. Nothing is lost: `build` makes the same project.json from the text (with `ids`, the very
 * same block ids; without, new ones). Scripts that the syntax can't write (broken links between blocks) are written
 * as `rawblock` lines, the block's JSON as it is.
 */
const {writeName, writeOpcode, writePrimitive} = require('./syntax');
const {label, menuOf, shadowTypeOf} = require('./block-defs');
const model = require('./model');
const {svgBindings} = require('./data-refs');

// Keys of a block that the text writes; others go in @extra
const BLOCK_KEYS = ['opcode', 'next', 'parent', 'inputs', 'fields', 'shadow', 'topLevel', 'x', 'y', 'mutation', 'comment'];
const TARGET_KEYS = ['isStage', 'name', 'variables', 'lists', 'broadcasts', 'blocks', 'comments'];
const CALL_KEYS = ['tagName', 'children', 'proccode', 'argumentids', 'warp'];
const PROTOTYPE_KEYS = ['tagName', 'children', 'proccode', 'argumentids', 'argumentnames', 'argumentdefaults', 'warp'];

class Unwritable extends Error {}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Deep comparison that doesn't care about the order of keys
const deepEqual = (a, b) => {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
};

/**
 * Writes the scripts of one target.
 */
class TargetWriter {
    constructor (project, target, options) {
        this.project = project;
        this.target = target;
        this.stage = project.targets.find(t => t.isStage) || target;
        this.blocks = isObject(target.blocks) ? target.blocks : {};
        this.comments = isObject(target.comments) ? target.comments : {};
        this.options = options;
        this.defs = options.defs;
        this.procedures = model.proceduresOf(target);
        this.visited = new Set();
        this.usedComments = new Set();
    }

    // Is the id of a primitive (broadcast / variable / list) the one its name finds?
    idIsDefault (primitive) {
        const type = model.PRIMITIVE_VARIABLE_TYPES[primitive[0]];
        const id = primitive[2];
        return id !== null && id === model.resolveName(this.stage, this.target, type, primitive[1]);
    }

    /**
     * @param {string} name field name
     * @param {*} value
     * @returns {string|null|undefined} the id `build` gives the field when the text has none
     */
    defaultFieldId (name, value) {
        const type = model.FIELD_TYPES[name];
        if (type === undefined) return null;
        if (typeof value !== 'string') return undefined;
        return model.resolveName(this.stage, this.target, type, value);
    }

    visit (id) {
        if (this.visited.has(id)) throw new Unwritable(`block ${id} is used twice`);
        this.visited.add(id);
    }

    block (id) {
        const block = this.blocks[id];
        if (!isObject(block)) throw new Unwritable(`no block ${id}`);
        return block;
    }

    /**
     * @param {object} block
     * @param {?string} parent the parent the text will give it
     * @param {boolean} top
     * @returns {string[]} the @ parts for things the rest of the text doesn't say
     */
    specials (id, block, parent, top) {
        const parts = [];
        if (this.options.ids) parts.push(`@id ${JSON.stringify(id)}`);
        // Keys that build always makes, but this block doesn't have
        const missing = ['next', 'parent', 'inputs', 'fields', 'shadow', 'topLevel'].filter(key => !(key in block));
        if (missing.length) parts.push(`@drop ${JSON.stringify(missing)}`);
        if ('parent' in block && block.parent !== parent) parts.push(`@parent ${JSON.stringify(block.parent)}`);
        const extra = {};
        for (const key of Object.keys(block)) {
            if (!BLOCK_KEYS.includes(key)) extra[key] = block[key];
        }
        if (!top) {
            if ('topLevel' in block && block.topLevel !== false) extra.topLevel = block.topLevel;
            if ('x' in block) extra.x = block.x;
            if ('y' in block) extra.y = block.y;
        }
        if ('shadow' in block && typeof block.shadow !== 'boolean') extra.shadow = block.shadow;
        if (block.comment !== undefined) {
            const comment = this.comments[block.comment];
            if (isObject(comment) && comment.blockId === id && !this.usedComments.has(block.comment)) {
                this.usedComments.add(block.comment);
                const value = {};
                for (const [key, v] of Object.entries(comment)) {
                    if (key !== 'blockId') value[key] = v;
                }
                if ('id' in value) {
                    // The comment has an "id" of its own, so its id is said apart
                    parts.push(`@comment ${JSON.stringify(value)} @commentid ${JSON.stringify(block.comment)}`);
                } else {
                    parts.push(`@comment ${JSON.stringify(Object.assign({id: block.comment}, value))}`);
                }
            } else {
                extra.comment = block.comment;
            }
        }
        if (Object.keys(extra).length) parts.push(`@extra ${JSON.stringify(extra)}`);
        return parts;
    }

    /**
     * @param {*} ref what an input points to: null, a primitive or a block id
     * @returns {boolean} whether it is a value that stays in the input (a shadow), not a block over it
     */
    isShadowLike (ref) {
        if (ref === null) return true;
        if (Array.isArray(ref)) return ref[0] !== 12 && ref[0] !== 13;
        const block = this.blocks[ref];
        return isObject(block) && block.shadow === true;
    }

    /**
     * @returns {?number} the primitive type of the shadow the input gets in the editor (see model.inputShadowType)
     */
    shadowType (block, name) {
        return model.inputShadowType(this.defs, this.procedures, block, name);
    }

    /**
     * @returns {?string} the menu(...) of a shadow that the tool can make again, or null
     */
    menuSugar (ownerOpcode, inputName, ref, parent) {
        if (this.options.ids || typeof ref !== 'string') return null;
        const menu = menuOf(this.defs, ownerOpcode, inputName);
        const block = this.blocks[ref];
        if (!menu || !isObject(block) || block.opcode !== menu.opcode) return null;
        if (!model.hasExactKeys(block, ['opcode', 'next', 'parent', 'inputs', 'fields', 'shadow', 'topLevel'])) return null;
        if (block.next !== null || block.parent !== parent || block.shadow !== true || block.topLevel !== false) return null;
        if (!isObject(block.inputs) || Object.keys(block.inputs).length) return null;
        const fields = block.fields;
        if (!isObject(fields) || !model.hasExactKeys(fields, [menu.field])) return null;
        const field = fields[menu.field];
        if (!Array.isArray(field) || field.length !== 2 || field[1] !== null) return null;
        if (Array.isArray(field[0]) || isObject(field[0])) return null;
        this.visit(ref);
        return `menu(${JSON.stringify(field[0])})`;
    }

    expression (ref, parent, owner, inputName) {
        if (ref === null) return 'none';
        if (Array.isArray(ref)) return writePrimitive(ref, p => this.idIsDefault(p), this.shadowType(owner, inputName));
        if (typeof ref !== 'string') throw new Unwritable('bad input');
        const sugar = this.menuSugar(owner.opcode, inputName, ref, parent);
        if (sugar) return sugar;
        const block = this.block(ref);
        if (block.next !== null) throw new Unwritable('reporter with next');
        const head = this.head(ref, parent, false, false);
        return block.shadow === true ? `[${head.text}]` : `(${head.text})`;
    }

    inputValue (id, block, name, input) {
        if (!Array.isArray(input) || input.length < 2 || input.length > 3 || ![1, 2, 3].includes(input[0])) {
            throw new Unwritable('bad input');
        }
        // What build makes of it: a shadow alone is [1, shadow]; a block alone is [3, block, empty shadow] if the
        // input has a shadow type, otherwise [2, block]. Anything else says its type and shadow.
        const [type, ref, shadow] = input;
        const shadowType = this.shadowType(block, name);
        const shadowLike = this.isShadowLike(ref);
        if (input.length === 3 && type === 3 && !shadowLike && shadowType && deepEqual(shadow, [shadowType, ''])) {
            return this.expression(ref, id, block, name);
        }
        let inferred;
        if (input.length === 3) inferred = 3;
        else if (shadowLike) inferred = 1;
        else inferred = shadowType ? 0 : 2;
        let text = inferred === type ? '' : `%${type}`;
        text += this.expression(ref, id, block, name);
        if (input.length === 3) text += `|${this.expression(shadow, id, block, name)}`;
        return text;
    }

    // Whether an input is written as a stack of lines under the block
    isStackInput (block, name, input) {
        if (!Array.isArray(input) || input.length !== 2 || input[0] !== 2 || typeof input[1] !== 'string') return false;
        const inner = this.blocks[input[1]];
        if (!isObject(inner) || inner.shadow !== false) return false;
        const def = this.defs[block.opcode];
        return /^SUBSTACK\d*$/.test(name) ||
            (def && def.args[name] && def.args[name].kind === 'statement') ||
            inner.next !== null;
    }

    field (id, name, field) {
        if (!Array.isArray(field) || field.length !== 2 || Array.isArray(field[0])) {
            return `${writeName(name)}:${JSON.stringify(field)}`;
        }
        const [value, fieldId] = field;
        let text = `${writeName(name)}:${JSON.stringify(value)}`;
        if (fieldId !== this.defaultFieldId(name, value)) text += `@${JSON.stringify(fieldId)}`;
        return text;
    }

    // "define" for a custom block's definition that the tool can make again, or null
    defineSugar (id, block, parent) {
        if (this.options.ids || block.opcode !== 'procedures_definition' || block.mutation !== undefined) return null;
        if (!isObject(block.inputs) || !model.hasExactKeys(block.inputs, ['custom_block'])) return null;
        if (!isObject(block.fields) || Object.keys(block.fields).length) return null;
        const input = block.inputs.custom_block;
        if (!Array.isArray(input) || input.length !== 2 || input[0] !== 1 || typeof input[1] !== 'string') return null;
        const prototypeId = input[1];
        const prototype = this.blocks[prototypeId];
        if (!isObject(prototype) || prototype.opcode !== 'procedures_prototype') return null;
        if (!model.hasExactKeys(prototype, ['opcode', 'next', 'parent', 'inputs', 'fields', 'shadow', 'topLevel', 'mutation'])) {
            return null;
        }
        if (prototype.next !== null || prototype.parent !== id || prototype.shadow !== true || prototype.topLevel !== false) {
            return null;
        }
        if (!isObject(prototype.fields) || Object.keys(prototype.fields).length || !isObject(prototype.inputs)) return null;
        const mutation = prototype.mutation;
        if (!isObject(mutation) || !model.hasExactKeys(mutation, PROTOTYPE_KEYS)) return null;
        if (mutation.tagName !== 'mutation' || !same(mutation.children, []) || typeof mutation.proccode !== 'string') return null;
        if (mutation.warp !== 'true' && mutation.warp !== 'false') return null;
        const ids = model.parseJSONArray(mutation.argumentids);
        const names = model.parseJSONArray(mutation.argumentnames);
        const defaults = model.parseJSONArray(mutation.argumentdefaults);
        const types = model.argumentTypes(mutation.proccode);
        if (!ids || !names || !defaults || ids.length !== types.length || names.length !== types.length) return null;
        if (!names.every(name => typeof name === 'string') || !ids.every(argId => typeof argId === 'string')) return null;
        if (!same(Object.keys(prototype.inputs), ids)) return null;
        const reporters = [];
        for (let i = 0; i < ids.length; i++) {
            const argInput = prototype.inputs[ids[i]];
            if (!Array.isArray(argInput) || argInput.length !== 2 || argInput[0] !== 1) return null;
            const reporter = this.blocks[argInput[1]];
            if (!isObject(reporter) || reporter.opcode !== model.reporterOpcode(types[i])) return null;
            if (!model.hasExactKeys(reporter, ['opcode', 'next', 'parent', 'inputs', 'fields', 'shadow', 'topLevel'])) return null;
            if (reporter.next !== null || reporter.parent !== prototypeId || reporter.shadow !== true || reporter.topLevel !== false) {
                return null;
            }
            if (!same(reporter.inputs, {}) || !same(reporter.fields, {VALUE: [names[i], null]})) return null;
            reporters.push(argInput[1]);
        }
        if (block.parent !== parent) return null;
        const parts = ['define', JSON.stringify(mutation.proccode), ...names.map(name => JSON.stringify(name))];
        if (mutation.warp === 'true') parts.push('@warp');
        if (!same(defaults, types.map(model.defaultArgumentValue))) parts.push(`@defaults ${JSON.stringify(defaults)}`);
        // Keep the ids that other blocks point to (cross-sprite calls, calls the tool can't write as "call")
        if (this.options.referenced(prototypeId)) parts.push(`@protoid ${JSON.stringify(prototypeId)}`);
        if (ids.some(argId => this.options.referenced(argId))) parts.push(`@argids ${JSON.stringify(ids)}`);
        this.visit(prototypeId);
        for (const reporter of reporters) this.visit(reporter);
        return parts;
    }

    /**
     * @returns {?object} the procedure of a call that the tool can make again as "call", or null
     */
    callProcedure (block) {
        if (block.opcode !== 'procedures_call' || !isObject(block.mutation)) return null;
        const mutation = block.mutation;
        const procedure = this.procedures[mutation.proccode];
        if (!procedure) return null;
        const keys = CALL_KEYS.concat('return' in mutation ? ['return'] : []);
        if (!model.hasExactKeys(mutation, keys)) return null;
        if (!deepEqual(mutation, model.callMutation(procedure, mutation.return))) return null;
        if (!isObject(block.fields) || Object.keys(block.fields).length || !isObject(block.inputs)) return null;
        const names = procedure.argumentNames;
        if (names.length !== procedure.argumentIds.length || new Set(names).size !== names.length) return null;
        if (!names.every(name => typeof name === 'string')) return null;
        if (!Object.keys(block.inputs).every(key => procedure.argumentIds.includes(key))) return null;
        const types = model.argumentTypes(procedure.proccode);
        if (procedure.argumentIds.some((argId, i) => types[i] !== 'b' && !(argId in block.inputs))) return null;
        return procedure;
    }

    /**
     * The first line of a block: opcode (or define / call) and its arguments.
     * @returns {{text: string, stacks: Array<{name: string, id: string}>, label: string}}
     */
    head (id, parent, top, statement) {
        const block = this.block(id);
        this.visit(id);
        if (!isObject(block.inputs) || !isObject(block.fields) || typeof block.opcode !== 'string') {
            throw new Unwritable('bad block');
        }
        const stacks = [];
        let parts = this.defineSugar(id, block, parent);
        if (parts) {
            parts.push(...this.specials(id, block, parent, top));
            return {text: parts.join(' '), stacks, label: this.options.labels ? `定義 ${this.procedureLabel(parts)}` : ''};
        }
        const procedure = this.callProcedure(block);
        const argumentName = argId => procedure.argumentNames[procedure.argumentIds.indexOf(argId)];
        parts = procedure ? ['call', JSON.stringify(block.mutation.proccode)] : [writeOpcode(block.opcode)];
        const inline = {};
        for (const [name, input] of Object.entries(block.inputs)) {
            const written = procedure ? argumentName(name) : name;
            if (statement && this.isStackInput(block, name, input)) {
                stacks.push({name: written, id: input[1]});
            } else {
                inline[name] = input;
                parts.push(`${writeName(written)}=${this.inputValue(id, block, name, input)}`);
            }
        }
        for (const [name, field] of Object.entries(block.fields)) parts.push(this.field(id, name, field));
        if (procedure) {
            if ('return' in block.mutation) parts.push(`@return ${JSON.stringify(block.mutation.return)}`);
        } else if (block.mutation !== undefined) {
            parts.push(`@mutation ${JSON.stringify(block.mutation)}`);
        }
        if (statement && block.shadow === true) parts.push('@shadow');
        parts.push(...this.specials(id, block, parent, top));
        return {text: parts.join(' '), stacks, label: statement ? this.label(block, procedure) : ''};
    }

    procedureLabel (parts) {
        return JSON.parse(parts[1]).replace(/(?<!\\)%[snb]/g, '( )');
    }

    // What the block says in the editor, for the comment after it
    label (block, procedure) {
        if (!this.options.labels) return '';
        if (procedure) return block.mutation.proccode.replace(/(?<!\\)%[snb]/g, '( )');
        const def = this.defs[block.opcode];
        return label(def, (name, arg) => {
            if (arg.kind === 'field') {
                const field = block.fields[name];
                return Array.isArray(field) ? `[${field[0]}]` : '[ ]';
            }
            const input = block.inputs[name];
            if (!Array.isArray(input)) return '( )';
            const ref = input[1];
            if (Array.isArray(ref)) return ref[0] >= 11 ? `[${ref[1]}]` : `(${ref[1]})`;
            const inner = typeof ref === 'string' ? this.blocks[ref] : null;
            if (isObject(inner) && inner.shadow === true && isObject(inner.fields)) {
                const values = Object.values(inner.fields);
                if (values.length === 1 && Array.isArray(values[0])) return `[${values[0][0]}]`;
            }
            return '( )';
        });
    }

    statementLines (id, parent, indent, top) {
        const head = this.head(id, parent, top, true);
        const pad = ' '.repeat(indent);
        let text = `${pad}${head.text}`;
        if (this.options.labels && head.label) text += `  # ${head.label}`;
        const lines = [text];
        for (const stack of head.stacks) {
            lines.push(`${pad}  ${writeName(stack.name)}:`);
            lines.push(...this.stackLines(stack.id, id, indent + 4));
        }
        return lines;
    }

    stackLines (first, parent, indent, top) {
        const lines = [];
        let id = first;
        let previous = parent;
        while (id !== null) {
            if (typeof id !== 'string') throw new Unwritable('bad next');
            const block = this.block(id);
            if (block.shadow !== false && block.shadow !== true) throw new Unwritable('bad shadow');
            lines.push(...this.statementLines(id, previous, indent, top && id === first));
            previous = id;
            id = block.next;
        }
        return lines;
    }

    /**
     * @returns {string[]} ids of the blocks that start scripts, in order
     */
    scriptTops () {
        return Object.keys(this.blocks).filter(id => {
            const block = this.blocks[id];
            if (Array.isArray(block)) return block.length === 5 && (block[0] === 12 || block[0] === 13);
            return isObject(block) && (block.topLevel === true || block.parent === null);
        });
    }

    scriptLines (id, number) {
        const block = this.blocks[id];
        const lines = [];
        let header = '  script';
        if (Array.isArray(block)) {
            // A variable or list reporter by itself: [12, name, id, x, y]
            header += ` ${block[3]} ${block[4]}`;
            if (this.options.ids) header += ` @id ${JSON.stringify(id)}`;
            this.visit(id);
            lines.push(header + (this.options.labels ? `  # script ${number}` : ''));
            lines.push(`    ${writePrimitive(block.slice(0, 3), p => this.idIsDefault(p))}`);
            return lines;
        }
        if (block.topLevel === true) {
            if (typeof block.x === 'number' && typeof block.y === 'number') header += ` ${block.x} ${block.y}`;
            else if ('x' in block || 'y' in block) throw new Unwritable('bad position');
        } else {
            header += ' @orphan';
            if ('x' in block || 'y' in block) throw new Unwritable('bad position');
        }
        lines.push(header + (this.options.labels ? `  # script ${number}` : ''));
        if (block.shadow === true && block.next === null && !this.options.ids) {
            // A shadow block by itself (left over in some projects)
            lines.push(`    [${this.head(id, null, true, false).text}]`);
            return lines;
        }
        lines.push(...this.stackLines(id, null, 4, true));
        return lines;
    }

    write () {
        const target = this.target;
        const lines = [];
        const keyword = target.isComponent ? 'component' : target.isMember ? 'member' : (target.isStage ? 'stage' : 'sprite');
        lines.push(`${keyword} ${JSON.stringify(target.name)}`);
        for (const key of Object.keys(target)) {
            if (!TARGET_KEYS.includes(key) && key !== 'isComponent' && key !== 'isMember') {
                lines.push(`  prop ${writeName(key)} ${JSON.stringify(target[key])}`);
            }
        }
        // What the SVG costumes show (they are files, so only as comments)
        for (const binding of this.options.bindings || []) {
            if (binding.target !== target.name) continue;
            const shown = binding.bindings.map(b => (b.kind === 'element' ? `${b.name}="${b.source}"` : b.source));
            lines.push(`  # 造型「${binding.costume}」綁定：${shown.join('  ')}`);
            for (const error of binding.errors) lines.push(`  # 造型「${binding.costume}」第 ${error.line} 行錯誤：${error.message}`);
        }
        const rest = value => (value.length > 2 ? ` @rest ${JSON.stringify(value.slice(2))}` : '');
        for (const [id, value] of Object.entries(target.variables || {})) {
            lines.push(`  variable ${JSON.stringify(value[0])} ${JSON.stringify(value[1])} @id ${JSON.stringify(id)}${rest(value)}`);
        }
        for (const [id, value] of Object.entries(target.lists || {})) {
            lines.push(`  list ${JSON.stringify(value[0])} ${JSON.stringify(value[1])} @id ${JSON.stringify(id)}${rest(value)}`);
        }
        for (const [id, name] of Object.entries(target.broadcasts || {})) {
            lines.push(`  broadcast ${JSON.stringify(name)} @id ${JSON.stringify(id)}`);
        }

        const scripts = [];
        const raw = [];
        let number = 0;
        for (const top of this.scriptTops()) {
            if (this.visited.has(top)) continue;
            number++;
            const visited = new Set(this.visited);
            const usedComments = new Set(this.usedComments);
            try {
                scripts.push(...this.scriptLines(top, number));
            } catch (e) {
                if (!(e instanceof Unwritable)) throw e;
                // Leave the blocks of the script for the raw part
                this.visited = visited;
                this.usedComments = usedComments;
                number--;
            }
        }
        for (const [id, block] of Object.entries(this.blocks)) {
            if (!this.visited.has(id)) raw.push(`  rawblock ${JSON.stringify(id)} ${JSON.stringify(block)}`);
        }
        for (const [id, comment] of Object.entries(this.comments)) {
            if (this.usedComments.has(id)) continue;
            if (isObject(comment) && !('id' in comment)) {
                lines.push(`  comment ${JSON.stringify(Object.assign({id}, comment))}`);
            } else {
                lines.push(`  comment ${JSON.stringify(comment)} @id ${JSON.stringify(id)}`);
            }
        }
        lines.push(...scripts, ...raw);
        return lines;
    }
}

/**
 * @param {object} project project.json
 * @returns {function(string): boolean} whether an id is used in a mutation that `build` doesn't make itself
 */
const findReferenced = (project, defs) => {
    // Every string in those mutations, and in the JSON arrays they have (argumentids)
    const strings = new Set();
    const collect = value => {
        if (typeof value === 'string') {
            strings.add(value);
            if (value.startsWith('[')) {
                try {
                    collect(JSON.parse(value));
                } catch (e) {
                    // Not JSON
                }
            }
        } else if (value && typeof value === 'object') {
            Object.values(value).forEach(collect);
        }
    };
    for (const target of project.targets) {
        const writer = new TargetWriter(project, target, {defs, ids: false});
        for (const block of Object.values(target.blocks || {})) {
            if (!isObject(block) || !isObject(block.mutation) || block.opcode === 'procedures_prototype') continue;
            if (block.opcode === 'procedures_call' && writer.callProcedure(block)) continue;
            collect(block.mutation);
        }
    }
    return id => strings.has(id);
};

/**
 * @param {object} project project.json
 * @param {object} options
 * @param {object} options.defs block definitions (block-defs.js)
 * @param {boolean} [options.ids] write every block id (then `build` makes the same ids)
 * @param {boolean} [options.labels] write what the blocks say in the editor as comments (default true)
 * @param {?string} [options.assets] the project file to take the assets from when building
 * @param {?string[]} [options.targets] only these targets (by name)
 * @param {object} [options.svgs] SVG costumes by file name: their bindings are written as comments
 * @returns {string} the text
 */
const dump = (project, options) => {
    const settings = {
        defs: options.defs,
        ids: !!options.ids,
        labels: options.labels !== false,
        referenced: findReferenced(project, options.defs),
        bindings: options.svgs ? svgBindings(project, options.svgs) : []
    };
    const lines = [
        '# Blocks3D 專案文字，語法見 tools/3dsb-text/README.md。# 後面是註解（編輯器上的文字），轉回專案時不讀。',
        '# 分身不要自己寫 id 邏輯：用 建立分身 id = ()、當分身產生 (id)、self.id、twclonevars_isClone（是分身？）與依 id 操作分身的積木。',
        'blocks3d-text 1'
    ];
    if (options.assets) lines.push(`assets ${JSON.stringify(options.assets)}`);
    for (const [key, value] of Object.entries(project)) {
        // Components are written like sprites (component "id")
        if (key !== 'targets' && key !== 'components') lines.push(`project ${writeName(key)} ${JSON.stringify(value)}`);
    }
    for (const target of model.componentTargets(project)) {
        lines.push('');
        lines.push(target.isMember ?
            `# 元件裡的角色「${target.title}」` :
            `# 元件「${target.title}」（實體是 prop component ${JSON.stringify(target.name)} 的角色，它們只存自己的值）`);
        lines.push(...new TargetWriter(project, target, settings).write());
    }
    for (const target of project.targets) {
        if (options.targets && !options.targets.includes(target.name)) continue;
        lines.push('');
        lines.push(...new TargetWriter(project, target, settings).write());
    }
    return `${lines.join('\n')}\n`;
};

module.exports = {
    dump,
    deepEqual,
    TargetWriter
};

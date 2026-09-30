/**
 * @fileoverview
 * Text → project.json: makes the blocks (parent, next, shadows, menu shadows, custom block mutations) from the tree
 * that syntax.js reads.
 */
const {TextError, bareType} = require('./syntax');
const {menuOf} = require('./block-defs');
const model = require('./model');

const {COMPONENT_META, MEMBER_META} = require('./model');
const TARGET_KEYS = ['isStage', 'name', 'variables', 'lists', 'broadcasts', 'blocks', 'comments'];

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * New ids that no block, comment or variable of the project has.
 */
class IdMaker {
    constructor (used) {
        this.used = new Set(used);
        this.count = 0;
    }

    add (id) {
        this.used.add(id);
    }

    make () {
        let id;
        do {
            this.count++;
            id = `t${this.count.toString(36)}`;
        } while (this.used.has(id));
        this.used.add(id);
        return id;
    }
}

/**
 * @param {object} file the tree of syntax.parse
 * @returns {string[]} every id that the text gives
 */
const idsInText = file => {
    const ids = [];
    const special = s => {
        if (!s) return;
        if (typeof s.id === 'string') ids.push(s.id);
        if (typeof s.protoid === 'string') ids.push(s.protoid);
        if (Array.isArray(s.argids)) ids.push(...s.argids.filter(id => typeof id === 'string'));
        if (isObject(s.comment) && typeof s.comment.id === 'string') ids.push(s.comment.id);
    };
    const node = n => {
        if (!n || typeof n !== 'object') return;
        special(n.special);
        if (n.type === 'prim' && typeof n.value[2] === 'string') ids.push(n.value[2]);
        for (const input of n.inputs || []) {
            if (input.value.stack) input.value.stack.forEach(node);
            node(input.value.block);
            node(input.value.shadow);
        }
    };
    for (const target of file.targets) {
        for (const list of [target.variables, target.lists, target.broadcasts]) {
            for (const item of list) special(item.special);
        }
        for (const comment of target.comments) {
            if (isObject(comment.value) && typeof comment.value.id === 'string') ids.push(comment.value.id);
        }
        for (const raw of target.rawBlocks) ids.push(raw.id);
        for (const script of target.scripts) {
            special(script.special);
            script.body.forEach(node);
        }
    }
    return ids;
};

/**
 * Makes the blocks of one target.
 */
class TargetBuilder {
    /**
     * @param {object} context {defs, ids: IdMaker, stage, errors, lines}
     * @param {object} target target of project.json, with its variables already there
     */
    constructor (context, target) {
        this.context = context;
        this.defs = context.defs;
        this.ids = context.ids;
        this.target = target;
        this.blocks = target.blocks;
        this.comments = target.comments;
        this.lines = context.lines;
        this.procedures = model.proceduresOf(target);
    }

    get stage () {
        return this.context.stage || this.target;
    }

    error (message, line) {
        return new TextError(message, line);
    }

    /**
     * Find the custom blocks the text defines, and choose their ids, so calls before them work.
     * @param {Array} scripts
     */
    collectProcedures (scripts) {
        for (const script of scripts) {
            const first = script.body[0];
            if (!first) continue;
            if (first.type === 'define') {
                const types = model.argumentTypes(first.proccode);
                const special = first.special;
                first.prototypeId = typeof special.protoid === 'string' ? special.protoid : this.ids.make();
                first.argumentIds = Array.isArray(special.argids) ? special.argids : types.map(() => this.ids.make());
                this.procedures[first.proccode] = {
                    proccode: first.proccode,
                    prototypeId: first.prototypeId,
                    argumentIds: first.argumentIds,
                    argumentNames: first.argumentNames,
                    warp: special.warp ? 'true' : 'false'
                };
            } else if (first.type === 'block' && first.opcode === 'procedures_definition') {
                // Written out in full: the mutation of the prototype
                const input = first.inputs.find(i => i.name === 'custom_block');
                const prototype = input && input.value.block;
                const mutation = prototype && prototype.special && prototype.special.mutation;
                if (isObject(mutation) && typeof mutation.proccode === 'string') {
                    this.procedures[mutation.proccode] = {
                        proccode: mutation.proccode,
                        prototypeId: prototype.special.id,
                        argumentIds: model.parseJSONArray(mutation.argumentids) || [],
                        argumentNames: model.parseJSONArray(mutation.argumentnames) || [],
                        warp: mutation.warp
                    };
                }
            }
        }
    }

    remember (id, line) {
        if (line) this.lines[id] = line;
    }

    newBlock (id, line, properties) {
        if (Object.prototype.hasOwnProperty.call(this.blocks, id)) throw this.error(`積木 id ${id} 重複了`, line);
        this.ids.add(id);
        const block = Object.assign({
            opcode: '',
            next: null,
            parent: null,
            inputs: {},
            fields: {},
            shadow: false,
            topLevel: false
        }, properties);
        this.blocks[id] = block;
        this.remember(id, line);
        return block;
    }

    /**
     * @param {object} script from the text
     * @returns {string} id of its first block
     */
    buildScript (script) {
        const body = script.body;
        const first = body[0];
        if (body.length === 1 && first.type === 'prim' && (first.value[0] === 12 || first.value[0] === 13)) {
            // A variable or list reporter by itself
            const id = typeof script.special.id === 'string' ? script.special.id : this.ids.make();
            const primitive = this.primitive(first, null, script.line);
            this.blocks[id] = primitive.concat([script.x || 0, script.y || 0]);
            this.ids.add(id);
            this.remember(id, script.line);
            return id;
        }
        if (first.type !== 'block' && first.type !== 'define' && first.type !== 'call') {
            throw this.error('script 應該從積木開始', first.line || script.line);
        }
        return this.buildStack(body, null, script);
    }

    /**
     * @param {Array} nodes
     * @param {?string} parent
     * @param {?object} script the script, if this is its top stack
     * @returns {string} id of the first block
     */
    buildStack (nodes, parent, script) {
        let first = null;
        let previous = null;
        for (const node of nodes) {
            if (node.type !== 'block' && node.type !== 'define' && node.type !== 'call') {
                throw this.error('積木堆裡只能放積木（值要放在輸入裡）', node.line);
            }
            if (node.type === 'define' && !(script && node === nodes[0])) {
                throw this.error('define 要在 script 的第一行', node.line);
            }
            const id = this.buildNode(node, previous || parent, script && !first ? script : null);
            if (previous) this.blocks[previous].next = id;
            else first = id;
            previous = id;
        }
        return first;
    }

    /**
     * @param {object} node block, define or call
     * @param {?string} parent
     * @param {?object} script the script, if it is the first block of one
     * @returns {string} id
     */
    buildNode (node, parent, script) {
        const special = node.special || {};
        const id = typeof special.id === 'string' ? special.id : this.ids.make();
        const top = {};
        if (script) {
            top.topLevel = !script.special.orphan;
            if (top.topLevel && typeof script.x === 'number') {
                top.x = script.x;
                top.y = script.y;
            }
        }
        let block;
        if (node.type === 'define') {
            block = this.buildDefine(node, id, parent, top);
        } else if (node.type === 'call') {
            const procedure = this.procedures[node.proccode];
            if (!procedure) throw this.error(`找不到自訂積木「${node.proccode}」，要在同一個角色裡 define`, node.line);
            const mutation = model.callMutation(procedure, special.return);
            block = this.newBlock(id, node.line, Object.assign({opcode: 'procedures_call', parent}, top));
            const given = new Set();
            for (const input of node.inputs) {
                const index = procedure.argumentNames.indexOf(input.name);
                if (index === -1) {
                    throw this.error(`自訂積木「${node.proccode}」沒有參數「${input.name}」` +
                        `（參數：${procedure.argumentNames.join('、') || '無'}）`, input.line);
                }
                const argumentId = procedure.argumentIds[index];
                given.add(argumentId);
                block.inputs[argumentId] = this.buildInput({opcode: 'procedures_call', mutation}, id, argumentId, input);
            }
            // Arguments that aren't given get an empty slot, like in the editor
            const types = model.argumentTypes(procedure.proccode);
            procedure.argumentIds.forEach((argumentId, i) => {
                if (!given.has(argumentId) && types[i] !== 'b') block.inputs[argumentId] = [1, [10, '']];
            });
            block.mutation = mutation;
        } else {
            block = this.newBlock(id, node.line, Object.assign({opcode: node.opcode, parent}, top));
            if (node.shadow || special.shadow) block.shadow = true;
            const owner = {opcode: node.opcode, mutation: special.mutation};
            for (const input of node.inputs) {
                if (Object.prototype.hasOwnProperty.call(block.inputs, input.name)) {
                    throw this.error(`輸入 ${input.name} 寫了兩次`, input.line);
                }
                block.inputs[input.name] = this.buildInput(owner, id, input.name, input);
            }
            for (const field of node.fields) {
                if (Object.prototype.hasOwnProperty.call(block.fields, field.name)) {
                    throw this.error(`欄位 ${field.name} 寫了兩次`, node.line);
                }
                block.fields[field.name] = this.buildField(field, node.line);
            }
            if (special.mutation !== undefined) block.mutation = special.mutation;
        }
        if (special.comment !== undefined) {
            this.currentSpecial = special;
            this.attachComment(id, block, special.comment, node.line);
            this.currentSpecial = null;
        }
        if (Object.prototype.hasOwnProperty.call(special, 'parent')) block.parent = special.parent;
        if (Array.isArray(special.drop)) {
            for (const key of special.drop) delete block[key];
        }
        if (special.extra !== undefined) {
            if (!isObject(special.extra)) throw this.error('@extra 應該是物件', node.line);
            Object.assign(block, special.extra);
        }
        return id;
    }

    buildDefine (node, id, parent, top) {
        const types = model.argumentTypes(node.proccode);
        if (node.argumentNames.length !== types.length) {
            throw this.error(`「${node.proccode}」有 ${types.length} 個參數（%s %n %b），卻寫了 ${node.argumentNames.length} 個名稱`,
                node.line);
        }
        const special = node.special;
        const prototypeId = node.prototypeId;
        const argumentIds = node.argumentIds;
        if (argumentIds.length !== types.length) throw this.error('@argids 的數量和參數不一樣', node.line);
        const defaults = Array.isArray(special.defaults) ? special.defaults : types.map(model.defaultArgumentValue);
        const block = this.newBlock(id, node.line, Object.assign({
            opcode: 'procedures_definition',
            parent,
            inputs: {custom_block: [1, prototypeId]}
        }, top));
        const prototype = this.newBlock(prototypeId, node.line, {
            opcode: 'procedures_prototype',
            parent: id,
            shadow: true,
            mutation: {
                tagName: 'mutation',
                children: [],
                proccode: node.proccode,
                argumentids: JSON.stringify(argumentIds),
                argumentnames: JSON.stringify(node.argumentNames),
                argumentdefaults: JSON.stringify(defaults),
                warp: special.warp ? 'true' : 'false'
            }
        });
        types.forEach((type, i) => {
            const reporterId = this.ids.make();
            this.newBlock(reporterId, node.line, {
                opcode: model.reporterOpcode(type),
                parent: prototypeId,
                shadow: true,
                fields: {VALUE: [node.argumentNames[i], null]}
            });
            prototype.inputs[argumentIds[i]] = [1, reporterId];
        });
        return block;
    }

    attachComment (blockId, block, value, line) {
        if (!isObject(value)) throw this.error('@comment 應該是物件，例如 @comment {"text": "說明"}', line);
        const separate = this.currentSpecial && typeof this.currentSpecial.commentid === 'string';
        let id;
        if (separate) id = this.currentSpecial.commentid;
        else id = typeof value.id === 'string' ? value.id : this.ids.make();
        this.ids.add(id);
        const comment = {blockId};
        for (const [key, v] of Object.entries(value)) {
            if (key !== 'id' || separate) comment[key] = v;
        }
        this.comments[id] = withCommentDefaults(comment);
        block.comment = id;
    }

    /**
     * @param {object} owner {opcode, mutation} of the block with the input
     * @param {string} ownerId
     * @param {string} name
     * @param {object} input from the text
     * @returns {Array} the input as in project.json
     */
    buildInput (owner, ownerId, name, input) {
        const value = input.value;
        if (value.stack) return [value.type || 2, this.buildStack(value.stack, ownerId, null)];
        const shadowType = model.inputShadowType(this.defs, this.procedures, owner, name);
        const ref = this.expression(value.block, owner, ownerId, name, shadowType, input.line);
        if (value.shadow !== undefined) {
            const shadow = this.expression(value.shadow, owner, ownerId, name, shadowType, input.line);
            return [value.type || 3, ref, shadow];
        }
        if (value.type) return [value.type, ref];
        if (isShadowLike(value.block)) return [1, ref];
        if (shadowType) return [3, ref, [shadowType, '']];
        return [2, ref];
    }

    expression (node, owner, ownerId, inputName, shadowType, line) {
        switch (node.type) {
        case 'none':
            return null;
        case 'prim':
            return this.primitive(node, shadowType, line);
        case 'menu': {
            const menu = menuOf(this.defs, owner.opcode, inputName);
            if (!menu) throw this.error(`${owner.opcode} 的輸入 ${inputName} 沒有選單，不能用 menu(...)；請寫出 [選單積木 欄位:值]`, line);
            const id = this.ids.make();
            this.newBlock(id, line, {
                opcode: menu.opcode,
                parent: ownerId,
                shadow: true,
                fields: {[menu.field]: [node.value, null]}
            });
            return id;
        }
        case 'block':
        case 'call':
            return this.buildNode(node, ownerId, null);
        case 'define':
            throw this.error('define 只能在 script 的第一行', node.line || line);
        }
        throw this.error('不認得的值', line);
    }

    /**
     * @returns {string|undefined} the id of a variable, list or broadcast by its name (a new broadcast is made)
     */
    resolve (type, name, line) {
        const id = model.resolveName(this.stage, this.target, type, name);
        if (id !== undefined) return id;
        if (type === model.BROADCAST) {
            // Broadcasts are made when used, like in the editor
            const newId = this.ids.make();
            if (!isObject(this.stage.broadcasts)) this.stage.broadcasts = {};
            this.stage.broadcasts[newId] = name;
            return newId;
        }
        throw this.error(`${type === model.LIST ? '清單' : '變數'}「${name}」不存在（要先用 variable / list 宣告，或寫出 id）`, line);
    }

    primitive (node, shadowType, line) {
        const primitive = node.value.slice();
        if (node.bare) primitive[0] = bareType(node.bare, shadowType);
        if (node.value.idFromName) {
            primitive.push(this.resolve(model.PRIMITIVE_VARIABLE_TYPES[primitive[0]], primitive[1], line));
        }
        return primitive;
    }

    buildField (field, line) {
        if (field.raw) return field.raw;
        let id = field.id;
        if (id === undefined) {
            const type = model.FIELD_TYPES[field.name];
            id = type === undefined ? null : this.resolve(type, field.value, line);
        }
        return [field.value, id];
    }
}

/**
 * @param {object} comment
 * @param {boolean} [workspace] a comment that isn't on a block
 * @returns {object} the comment, with what it doesn't say (for comments written by hand)
 */
const withCommentDefaults = (comment, workspace) => {
    const defaults = {blockId: null, x: 0, y: 0, width: 200, height: 200, minimized: false, text: ''};
    const result = Object.assign({}, comment);
    for (const [key, value] of Object.entries(defaults)) {
        if (!(key in result) && (key !== 'blockId' || workspace)) result[key] = value;
    }
    return result;
};

const isShadowLike = node => node.type === 'none' || node.type === 'menu' ||
    (node.type === 'prim' && node.value[0] !== 12 && node.value[0] !== 13) ||
    (node.type === 'block' && node.shadow === true);

/**
 * Make the variables, lists and broadcasts of a target from the text.
 * @param {object} json the target in project.json
 * @param {object} target from the text
 * @param {IdMaker} ids
 */
const buildData = (json, target, ids) => {
    const make = (item, value) => {
        const id = typeof item.special.id === 'string' ? item.special.id : ids.make();
        if (item.special.cloud) value.push(true);
        if (Array.isArray(item.special.rest)) value.push(...item.special.rest);
        return id;
    };
    for (const item of target.variables) {
        const value = [item.name, item.value];
        json.variables[make(item, value)] = value;
    }
    for (const item of target.lists) {
        if (!Array.isArray(item.value)) throw new TextError('清單的值應該是陣列', item.line);
        const value = [item.name, item.value];
        json.lists[make(item, value)] = value;
    }
    for (const item of target.broadcasts) {
        json.broadcasts[make(item, [])] = item.name;
    }
};

/**
 * @param {object} file the tree of syntax.parse
 * @param {object} options
 * @param {object} options.defs block definitions
 * @returns {{json: object, lines: Object.<string, Object.<string, number>>, errors: TextError[]}} project.json,
 * the line of every block (by target name, then block id), and what went wrong
 */
const build = (file, options) => {
    const errors = [];
    const ids = new IdMaker(idsInText(file));
    const json = {targets: []};
    for (const {key, value, line} of file.project) {
        if (key === 'targets') errors.push(new TextError('targets 要用 stage / sprite 寫', line));
        else json[key] = value;
    }
    const names = new Set();
    const componentItems = [];
    for (const target of file.targets) {
        if (names.has(target.name)) errors.push(new TextError(`角色「${target.name}」出現了兩次`, target.line));
        names.add(target.name);
        const item = {
            isStage: target.isStage,
            name: target.name,
            variables: {},
            lists: {},
            broadcasts: {},
            blocks: {},
            comments: {}
        };
        for (const {key, value, line} of target.props) {
            if (TARGET_KEYS.includes(key)) errors.push(new TextError(`${key} 不能用 prop 寫`, line));
            else item[key] = value;
        }
        try {
            buildData(item, target, ids);
        } catch (e) {
            if (!(e instanceof TextError)) throw e;
            errors.push(e);
        }
        if (target.isComponent || target.isMember) componentItems.push(item);
        else json.targets.push(item);
    }
    const stage = json.targets.find(target => target.isStage) || null;
    if (!stage && file.targets.length) errors.push(new TextError('專案沒有 stage', 0));
    const lines = {};
    const items = file.targets.map(target => (target.isComponent || target.isMember ? componentItems.shift() : null));
    let index = 0;
    file.targets.forEach((target, i) => {
        const item = items[i] || json.targets[index++];
        lines[item.name] = {};
        const builder = new TargetBuilder({defs: options.defs, ids, stage, lines: lines[item.name]}, item);
        buildTargetScripts(builder, target, errors);
    });
    // Instances of components only have what differs from the component (like the VM writes them)
    for (const item of json.targets) {
        if (!item.component) continue;
        for (const key of ['variables', 'lists', 'broadcasts', 'blocks', 'comments']) {
            if (isObject(item[key]) && Object.keys(item[key]).length === 0) delete item[key];
        }
    }
    // Components: `component "id"` with the meta of the component as props, the rest is its root
    file.targets.forEach((target, i) => {
        const item = items[i];
        if (!item || target.isMember) return;
        if (!isObject(json.components)) json.components = {};
        const root = {};
        for (const [key, value] of Object.entries(item)) {
            if (!['isStage', 'name', ...COMPONENT_META].includes(key)) root[key] = value;
        }
        // In the order the VM writes them
        const definition = {name: item.title, color: item.color, props: item.props, root};
        if (item.outputs) definition.outputs = item.outputs;
        if (item.interface) definition.interface = item.interface;
        if (Array.isArray(item.members)) definition.members = item.members.map(member => Object.assign({}, member));
        json.components[item.name] = definition;
    });
    // Members' sprites (`member "id:key"`) go back into the members of their component
    file.targets.forEach((target, i) => {
        const item = items[i];
        if (!item || !target.isMember) return;
        const definition = isObject(json.components) && json.components[item.componentId];
        const key = item.name.slice(String(item.componentId).length + 1);
        const member = definition && Array.isArray(definition.members) ? definition.members.find(m => m.key === key) : null;
        if (!member) {
            errors.push(new TextError(`元件 ${item.componentId} 沒有成員 ${key}`, target.line));
            return;
        }
        const root = {};
        for (const [k, value] of Object.entries(item)) {
            if (!['isStage', 'name', ...MEMBER_META].includes(k)) root[k] = value;
        }
        member.root = root;
        if (item.interface) member.interface = item.interface;
    });
    return {json, lines, errors};
};

/**
 * Make the scripts, comments and raw blocks of a target.
 * @param {TargetBuilder} builder
 * @param {object} target from the text
 * @param {TextError[]} errors
 */
const buildTargetScripts = (builder, target, errors) => {
    try {
        builder.collectProcedures(target.scripts);
    } catch (e) {
        if (!(e instanceof TextError)) throw e;
        errors.push(e);
    }
    for (const {value, special, line} of target.comments) {
        if (!isObject(value)) {
            errors.push(new TextError('comment 應該是物件', line));
            continue;
        }
        if (typeof special.id === 'string') {
            // The id is said apart; the object is the comment as it is
            builder.comments[special.id] = value;
            continue;
        }
        const id = typeof value.id === 'string' ? value.id : builder.ids.make();
        const comment = {};
        for (const [key, v] of Object.entries(value)) {
            if (key !== 'id') comment[key] = v;
        }
        builder.comments[id] = withCommentDefaults(comment, true);
    }
    for (const script of target.scripts) {
        try {
            builder.buildScript(script);
        } catch (e) {
            if (!(e instanceof TextError)) throw e;
            errors.push(e);
        }
    }
    for (const {id, value, line} of target.rawBlocks) {
        if (Object.prototype.hasOwnProperty.call(builder.blocks, id)) {
            errors.push(new TextError(`積木 id ${id} 重複了`, line));
            continue;
        }
        builder.blocks[id] = value;
        builder.remember(id, line);
    }
};

module.exports = {
    build,
    buildTargetScripts,
    TargetBuilder,
    IdMaker,
    idsInText
};

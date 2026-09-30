/**
 * @fileoverview
 * Things both directions need to agree on: which variable or broadcast a name means, and what the tool makes for a
 * custom block.
 */

// Variable types of the VM (engine/variable.js)
const SCALAR = '';
const LIST = 'list';
const BROADCAST = 'broadcast_msg';

// The kind of thing a field or primitive names
const FIELD_TYPES = {
    VARIABLE: SCALAR,
    LIST: LIST,
    BROADCAST_OPTION: BROADCAST
};
const PRIMITIVE_VARIABLE_TYPES = {
    11: BROADCAST,
    12: SCALAR,
    13: LIST
};

/**
 * @param {object} target target of project.json
 * @param {string} type
 * @returns {object} its variables of that type, as {id: name}
 */
const namesOf = (target, type) => {
    const result = {};
    if (!target) return result;
    if (type === BROADCAST) {
        for (const [id, name] of Object.entries(target.broadcasts || {})) result[id] = name;
    } else {
        const store = type === LIST ? target.lists : target.variables;
        for (const [id, value] of Object.entries(store || {})) {
            if (Array.isArray(value)) result[id] = value[0];
        }
    }
    return result;
};

/**
 * The id that a variable, list or broadcast name means for blocks of `target`: its own first, then the stage's.
 * Broadcasts are all on the stage.
 * @param {object} stage
 * @param {object} target
 * @param {string} type
 * @param {string} name
 * @returns {string|undefined} the id, or undefined if there is none with that name
 */
const resolveName = (stage, target, type, name) => {
    const owners = type === BROADCAST ? [stage] : [target, stage];
    for (const owner of owners) {
        const names = namesOf(owner, type);
        for (const id of Object.keys(names)) {
            if (names[id] === name) return id;
        }
    }
    return undefined;
};

/**
 * @param {string} proccode e.g. "move %s steps %b"
 * @returns {string[]} the types of its arguments: 's', 'n' or 'b'
 */
const argumentTypes = proccode => {
    const types = [];
    const re = /(?<!\\)%([snb])/g;
    let match;
    while ((match = re.exec(proccode))) types.push(match[1]);
    return types;
};

const reporterOpcode = type => (type === 'b' ? 'argument_reporter_boolean' : 'argument_reporter_string_number');

const defaultArgumentValue = type => (type === 'b' ? 'false' : '');

/**
 * @param {object} mutation
 * @param {string[]} keys
 * @returns {boolean} whether the mutation has exactly these keys, in any order
 */
const hasExactKeys = (object, keys) => {
    const own = Object.keys(object);
    return own.length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(object, key));
};

const parseJSONArray = text => {
    try {
        const value = JSON.parse(text);
        return Array.isArray(value) ? value : null;
    } catch (e) {
        return null;
    }
};

/**
 * @param {object} target target of project.json
 * @returns {Object.<string, object>} the custom blocks defined in it, by proccode:
 * {proccode, prototypeId, argumentIds, argumentNames, warp}
 */
const proceduresOf = target => {
    const result = {};
    const blocks = target.blocks || {};
    for (const [id, block] of Object.entries(blocks)) {
        if (!block || Array.isArray(block) || block.opcode !== 'procedures_prototype' || !block.mutation) continue;
        const parent = blocks[block.parent];
        if (!parent || parent.opcode !== 'procedures_definition') continue;
        const mutation = block.mutation;
        result[mutation.proccode] = {
            proccode: mutation.proccode,
            prototypeId: id,
            argumentIds: parseJSONArray(mutation.argumentids) || [],
            argumentNames: parseJSONArray(mutation.argumentnames) || [],
            warp: mutation.warp
        };
    }
    return result;
};

/**
 * @param {object} procedure from proceduresOf
 * @param {?string} returnType the `return` of the call's mutation, if it has one
 * @returns {object} the mutation the tool gives a call of it
 */
const callMutation = (procedure, returnType) => {
    const mutation = {
        tagName: 'mutation',
        children: [],
        proccode: procedure.proccode,
        argumentids: JSON.stringify(procedure.argumentIds),
        warp: procedure.warp
    };
    if (returnType !== undefined) mutation.return = returnType;
    return mutation;
};

/**
 * @param {object} defs block definitions
 * @param {object} procedures the custom blocks of the target (proceduresOf)
 * @param {object} block
 * @param {string} name input name
 * @returns {?number} the primitive type of the shadow the input has in the editor (4 to 10), or null: numbers and
 * strings written without a type get it, and blocks written without a shadow get an empty one of it
 */
const inputShadowType = (defs, procedures, block, name) => {
    if (block.opcode === 'procedures_call') {
        const procedure = block.mutation && procedures[block.mutation.proccode];
        if (!procedure) return null;
        const index = procedure.argumentIds.indexOf(name);
        if (index === -1) return null;
        return argumentTypes(procedure.proccode)[index] === 'b' ? null : 10;
    }
    const {shadowTypeOf} = require('./block-defs');
    return shadowTypeOf(defs, block.opcode, name);
};

// Components (scratch-vm engine/components.js): their definitions are in project.json's `components`, with the
// sprite they are made of as `root`. The tool treats each root as a target named by the id of the component.
const COMPONENT_META = ['title', 'color', 'props', 'outputs', 'interface', 'members'];
const MEMBER_META = ['title', 'componentId', 'interface'];

/**
 * @param {object} json project.json
 * @returns {Array<object>} a target for every component: its root, with isComponent, name (the id) and title (the
 * name of the component), color, props and interface
 */
const componentTargets = json => {
    const components = json && json.components && typeof json.components === 'object' ? json.components : {};
    const result = [];
    for (const [id, definition] of Object.entries(components)) {
        if (!definition || !definition.root) continue;
        const target = Object.assign({isStage: false, name: id}, definition.root, {
            isComponent: true,
            title: definition.name,
            color: definition.color,
            props: definition.props
        });
        if (definition.outputs) target.outputs = definition.outputs;
        if (definition.interface) target.interface = definition.interface;
        const members = Array.isArray(definition.members) ? definition.members : null;
        // The members without their roots; each root is a target of its own (`member "id:key"`)
        if (members) target.members = members.map(member => {
            const copy = Object.assign({}, member);
            delete copy.root;
            delete copy.interface;
            return copy;
        });
        result.push(target);
        for (const member of members || []) {
            if (!member || !member.root) continue;
            const memberTarget = Object.assign({isStage: false, name: `${id}:${member.key}`}, member.root, {
                isMember: true,
                title: member.name,
                componentId: id
            });
            if (member.interface) memberTarget.interface = member.interface;
            result.push(memberTarget);
        }
    }
    return result;
};

/**
 * @param {object} json project.json
 * @returns {Array<object>} its targets, and the roots of its components (see componentTargets)
 */
const allTargets = json => (json.targets || []).concat(componentTargets(json));

/**
 * @param {object} json project.json
 * @param {string} name a sprite, an instance of a component, or `_any_` and a component
 * @returns {?object} what sends and receives events and is called under that name: the sprite, or the root of the
 * component (see componentTargets)
 */
const interfaceTargetOf = (json, name, from) => {
    const components = componentTargets(json);
    // Inside a component, its members first
    const componentId = from && (from.isComponent ? from.name : from.componentId);
    const definition = componentId && json.components && json.components[componentId];
    if (definition && Array.isArray(definition.members)) {
        const member = definition.members.find(m => m && m.name === name);
        if (member) {
            if (member.kind === 'component') return components.find(c => c.isComponent && c.name === member.component) || null;
            return components.find(c => c.isMember && c.name === `${componentId}:${member.key}`) || null;
        }
    }
    if (typeof name === 'string' && name.startsWith('_any_')) {
        return components.find(c => c.title === name.slice(5)) || null;
    }
    const target = (json.targets || []).find(t => t.name === name && !t.isStage);
    if (target && target.component) return components.find(c => c.name === target.component) || null;
    return target || null;
};

module.exports = {
    COMPONENT_META,
    MEMBER_META,
    componentTargets,
    allTargets,
    interfaceTargetOf,
    inputShadowType,
    SCALAR,
    LIST,
    BROADCAST,
    FIELD_TYPES,
    PRIMITIVE_VARIABLE_TYPES,
    resolveName,
    argumentTypes,
    reporterOpcode,
    defaultArgumentValue,
    hasExactKeys,
    parseJSONArray,
    proceduresOf,
    callMutation
};

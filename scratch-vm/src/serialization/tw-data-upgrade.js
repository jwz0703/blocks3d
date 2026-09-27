/**
 * @fileoverview
 * Turn the variable and list blocks of older projects into blocks with paths (ROADMAP.md 4.12, see
 * util/data-path.js), when projects and sprites are loaded and when blocks are copied between sprites:
 *
 * - Scratch's variable and list blocks (data_*): variables of the stage become 資料 blocks (`score`), variables of
 *   sprites ("for this sprite only") 分身變數 blocks. Lists become 資料 blocks too; lists of sprites get paths like
 *   `self.list`. Lists stay list variables whose value is an array.
 * - 變數 (twvars_*) become 資料 blocks, the list blocks of 分身變數 (twclonevars_*) 資料 blocks with `self.` paths.
 * - "create clone of" and "when I start as a clone" get their id input.
 *
 * The 分身變數 and 區域變數 blocks themselves (twclonevars_setVariable...) keep their opcodes, but their names are
 * paths now. For projects from before that (`old`), names that mean something else as a path are changed: names with
 * dots or brackets are quoted, and variables of sprites named like a built-in property (x, name...) are renamed, so
 * that they don't move the sprite. So are lists with the name of a variable of the same target, since they share
 * names now.
 */

const Variable = require('../engine/variable');
const DataPath = require('../util/data-path');
const uid = require('../util/uid');

// Old extensions whose blocks are converted
const OLD_EXTENSIONS = ['twvars'];

// Scratch blocks: the field that picks the variable or list, the 資料 block for global ones, and the 分身變數 block
// for scalar variables of sprites (lists of sprites use the 資料 block with a self. path)
const DATA_BLOCKS = {
    data_variable: {field: 'VARIABLE', op: 'get', cloneOp: 'getVariable'},
    data_setvariableto: {field: 'VARIABLE', op: 'set', cloneOp: 'setVariable'},
    data_changevariableby: {field: 'VARIABLE', op: 'change', cloneOp: 'changeVariable'},
    data_listcontents: {field: 'LIST', op: 'listText'},
    data_addtolist: {field: 'LIST', op: 'addItem'},
    data_deleteoflist: {field: 'LIST', op: 'deleteItem'},
    data_deletealloflist: {field: 'LIST', op: 'clear'},
    data_insertatlist: {field: 'LIST', op: 'insertItem'},
    data_replaceitemoflist: {field: 'LIST', op: 'replaceItem'},
    data_itemoflist: {field: 'LIST', op: 'itemOf'},
    data_itemnumoflist: {field: 'LIST', op: 'indexOf'},
    data_lengthoflist: {field: 'LIST', op: 'length'},
    data_listcontainsitem: {field: 'LIST', op: 'contains'}
};

// Blocks of 變數 (twvars_), which name the variable with the NAME input: the 資料 block, and whether it is a list
const TWVARS_BLOCKS = {
    setVariable: {op: 'set'},
    changeVariable: {op: 'change'},
    getVariable: {op: 'get'},
    variableExists: {op: 'exists'},
    deleteVariable: {op: 'delete'},
    addToList: {op: 'addItem', list: true},
    deleteOfList: {op: 'deleteItem', list: true},
    deleteAllOfList: {op: 'clear', list: true},
    insertAtList: {op: 'insertItem', list: true},
    replaceItemOfList: {op: 'replaceItem', list: true},
    getList: {op: 'listText', list: true},
    getItemOfList: {op: 'itemOf', list: true},
    getItemNumOfList: {op: 'indexOf', list: true},
    lengthOfList: {op: 'length', list: true},
    listContainsItem: {op: 'contains', list: true},
    listExists: {op: 'exists', list: true},
    deleteList: {op: 'delete', list: true}
};

// Blocks of 分身變數 and 區域變數 that still exist, with a NAME that is a path now
const NAME_BLOCKS = ['setVariable', 'changeVariable', 'getVariable', 'variableExists', 'deleteVariable'];

const isDataVariable = variable => variable.type === Variable.SCALAR_TYPE || variable.type === Variable.LIST_TYPE;

/**
 * @param {string} name
 * @param {function(string): boolean} taken
 * @param {string} suffix
 * @returns {string} name, or name with suffix (and a number) if it is taken
 */
const unusedName = (name, taken, suffix) => {
    if (!taken(name)) return name;
    let candidate = `${name}${suffix}`;
    for (let i = 2; taken(candidate); i++) candidate = `${name}${suffix}${i}`;
    return candidate;
};

/**
 * Rename variables that would clash now that variables and lists share names, and sprite variables named like
 * built-in properties.
 * @param {Target} target
 * @returns {Map<string, string>} "type|old name" → new name, for the blocks that name variables
 */
const renameClashingVariables = target => {
    const renamed = new Map();
    const variables = Object.values(target.variables).filter(isDataVariable);
    const names = new Set();
    const taken = name => names.has(name) || (!target.isStage && DataPath.RESERVED_NAMES.includes(name));
    // Variables before lists, so that lists are the ones renamed
    variables.sort((a, b) => (a.type === b.type ? 0 : (a.type === Variable.LIST_TYPE ? 1 : -1)));
    for (const variable of variables) {
        const isList = variable.type === Variable.LIST_TYPE;
        const name = unusedName(variable.name, taken, isList ? ' 清單' : ' 變數');
        if (name !== variable.name) {
            renamed.set(`${variable.type}|${variable.name}`, name);
            variable.name = name;
        }
        names.add(name);
    }
    return renamed;
};

/**
 * Converts the blocks of one target.
 */
class Upgrader {
    /**
     * @param {Target} target
     * @param {?Target} stage
     * @param {Map<string, Map<string, string>>} renames target id → renames of renameClashingVariables
     * @param {boolean} old true if the blocks are from before paths, see the top of this file
     */
    constructor (target, stage, renames, old) {
        this.target = target;
        this.stage = stage;
        this.renames = renames;
        this.old = old;
        this.blocks = target.blocks;
        this.changed = false;
    }

    /**
     * @param {string} parent id of the block the shadow is in
     * @param {string} opcode
     * @param {object} fields
     * @returns {string} id of the new shadow block
     */
    addShadow (parent, opcode, fields) {
        const id = uid();
        this.blocks.createBlock({
            id,
            opcode,
            inputs: {},
            fields,
            next: null,
            topLevel: false,
            parent,
            shadow: true
        });
        return id;
    }

    textShadow (parent, text) {
        return this.addShadow(parent, 'text', {TEXT: {name: 'TEXT', value: text}});
    }

    /**
     * @param {?Target} owner target that has the variable
     * @param {string} type Variable.SCALAR_TYPE or LIST_TYPE
     * @param {string} name old name
     * @returns {string} its name now
     */
    currentName (owner, type, name) {
        const renames = owner && this.renames.get(owner.id);
        return (renames && renames.get(`${type}|${name}`)) || name;
    }

    /**
     * @param {string} name name of a sprite variable that doesn't exist yet
     * @returns {string} the name it gets when renameClashingVariables would have renamed it
     */
    notReserved (name) {
        if (this.target.isStage || !DataPath.RESERVED_NAMES.includes(name)) return name;
        return `${name} 變數`;
    }

    /**
     * @param {object} field VARIABLE or LIST field of a data_ block
     * @param {string} type
     * @returns {{name: string, global: boolean}} the variable's name now, and whether it is a variable of the stage
     */
    variableOfField (field, type) {
        const target = this.target;
        const stage = this.stage;
        let variable = target.variables[field.id];
        let global = target.isStage;
        if (!variable && stage && stage.variables[field.id]) {
            variable = stage.variables[field.id];
            global = true;
        }
        if (!variable) {
            // Scratch looks for it by name: first in the sprite, then in the stage
            const byName = owner => owner && Object.values(owner.variables)
                .find(v => v.type === type && v.name === field.value);
            variable = byName(target);
            if (!variable && byName(stage)) {
                variable = byName(stage);
                global = true;
            }
        }
        return {name: variable ? variable.name : this.notReserved(field.value), global};
    }

    /**
     * @param {object} block
     * @param {string} inputName
     * @param {string} value
     */
    addTextInput (block, inputName, value) {
        const shadow = this.textShadow(block.id, value);
        block.inputs[inputName] = {name: inputName, block: shadow, shadow};
    }

    upgradeDataBlock (block, info) {
        const field = block.fields[info.field];
        if (!field) return;
        const type = info.field === 'LIST' ? Variable.LIST_TYPE : Variable.SCALAR_TYPE;
        const {name, global} = this.variableOfField(field, type);
        delete block.fields[info.field];
        if (!global && info.cloneOp) {
            block.opcode = `twclonevars_${info.cloneOp}`;
            this.addTextInput(block, 'NAME', DataPath.variablePath(null, name));
        } else {
            block.opcode = `twdata_${info.op}`;
            this.addTextInput(block, 'PATH', DataPath.variablePath(global ? null : 'self', name));
        }
    }

    /**
     * Turn the NAME input of an old block into a path input.
     * @param {object} block
     * @param {string} inputName name of the new input
     * @param {function(string): string} pathOf path of a constant name
     * @param {string} prefix text in front of a name given by a reporter
     */
    convertNameInput (block, inputName, pathOf, prefix) {
        const input = block.inputs.NAME;
        delete block.inputs.NAME;
        const shadowBlock = input && input.shadow ? this.blocks.getBlock(input.shadow) : null;
        const isConstant = input && input.block === input.shadow && shadowBlock && shadowBlock.fields.TEXT;
        if (!input || isConstant) {
            const path = pathOf(isConstant ? `${shadowBlock.fields.TEXT.value}` : '');
            if (shadowBlock) {
                shadowBlock.fields.TEXT.value = path;
                block.inputs[inputName] = {name: inputName, block: input.block, shadow: input.shadow};
            } else {
                this.addTextInput(block, inputName, path);
            }
            return;
        }
        if (!prefix) {
            // A reporter gives the name, which is the path as it is
            block.inputs[inputName] = Object.assign({}, input, {name: inputName});
            return;
        }
        // A reporter gives the name: the path is the prefix joined with it
        const join = uid();
        this.blocks.createBlock({
            id: join,
            opcode: 'operator_join',
            inputs: {},
            fields: {},
            next: null,
            topLevel: false,
            parent: block.id,
            shadow: false
        });
        const joinBlock = this.blocks.getBlock(join);
        const prefixShadow = this.textShadow(join, prefix);
        joinBlock.inputs.STRING1 = {name: 'STRING1', block: prefixShadow, shadow: prefixShadow};
        joinBlock.inputs.STRING2 = {name: 'STRING2', block: input.block, shadow: input.shadow};
        const reporter = this.blocks.getBlock(input.block);
        if (reporter) reporter.parent = join;
        if (shadowBlock) shadowBlock.parent = join;
        const pathShadow = this.textShadow(block.id, prefix);
        block.inputs[inputName] = {name: inputName, block: join, shadow: pathShadow};
    }

    upgradeTwVarsBlock (block, info) {
        const type = info.list ? Variable.LIST_TYPE : Variable.SCALAR_TYPE;
        block.opcode = `twdata_${info.op}`;
        this.convertNameInput(block, 'PATH',
            name => DataPath.variablePath(null, this.currentName(this.stage, type, name)), '');
    }

    upgradeCloneListBlock (block, info) {
        block.opcode = `twdata_${info.op}`;
        this.convertNameInput(block, 'PATH',
            name => DataPath.variablePath('self', this.currentName(this.target, Variable.LIST_TYPE, name)), 'self.');
    }

    /**
     * 分身變數 and 區域變數 blocks of old projects: their names are paths now
     * @param {object} block
     * @param {string} scope 'self' or 'local'
     */
    upgradeNameBlock (block, scope) {
        const input = block.inputs.NAME;
        const shadowBlock = input && input.shadow ? this.blocks.getBlock(input.shadow) : null;
        if (!input || input.block !== input.shadow || !shadowBlock || !shadowBlock.fields.TEXT) return;
        const oldName = `${shadowBlock.fields.TEXT.value}`;
        let name = oldName;
        if (scope === 'self') {
            name = this.currentName(this.target, Variable.SCALAR_TYPE, oldName);
            if (name === oldName) name = this.notReserved(name);
        }
        const path = DataPath.variablePath(null, name);
        if (path !== oldName) {
            shadowBlock.fields.TEXT.value = path;
            this.changed = true;
        }
    }

    upgradeCloneBlock (block) {
        if (block.opcode === 'control_create_clone_of' && !block.inputs.ID) {
            this.addTextInput(block, 'ID', '');
            return true;
        }
        if (block.opcode === 'control_start_as_clone' && !block.inputs.ID) {
            const shadow = this.addShadow(block.id, 'control_start_as_clone_id', {});
            block.inputs.ID = {name: 'ID', block: shadow, shadow};
            return true;
        }
        return false;
    }

    /**
     * "[variable] of [sprite]" names variables of other sprites
     * @param {object} block
     * @param {Array<Target>} targets
     */
    upgradeSensingOf (block, targets) {
        const property = block.fields.PROPERTY;
        const objectInput = block.inputs.OBJECT;
        const menu = objectInput && this.blocks.getBlock(objectInput.block);
        if (!property || !menu || !menu.fields.OBJECT) return;
        const spriteName = menu.fields.OBJECT.value;
        const owner = spriteName === '_stage_' ? this.stage :
            targets.find(t => t.isOriginal && t.getName() === spriteName);
        const newName = this.currentName(owner, Variable.SCALAR_TYPE, property.value);
        if (newName !== property.value) {
            property.value = newName;
            this.changed = true;
        }
    }

    /**
     * @param {?Array<string>} ids only these blocks; all blocks if null
     * @param {Array<Target>} targets every target, for "of" blocks
     * @returns {boolean} true if anything changed
     */
    run (ids, targets) {
        const all = this.blocks._blocks;
        for (const id of ids || Object.keys(all)) {
            const block = all[id];
            if (!block) continue;
            const opcode = block.opcode;
            if (Object.prototype.hasOwnProperty.call(DATA_BLOCKS, opcode)) {
                this.upgradeDataBlock(block, DATA_BLOCKS[opcode]);
                this.changed = true;
            } else if (opcode.startsWith('twvars_') && TWVARS_BLOCKS[opcode.substring(7)]) {
                this.upgradeTwVarsBlock(block, TWVARS_BLOCKS[opcode.substring(7)]);
                this.changed = true;
            } else if (opcode.startsWith('twclonevars_') && TWVARS_BLOCKS[opcode.substring(12)] &&
                TWVARS_BLOCKS[opcode.substring(12)].list) {
                this.upgradeCloneListBlock(block, TWVARS_BLOCKS[opcode.substring(12)]);
                this.changed = true;
            } else if (this.old && opcode.startsWith('twclonevars_') && NAME_BLOCKS.includes(opcode.substring(12))) {
                this.upgradeNameBlock(block, 'self');
            } else if (this.old && opcode.startsWith('twlocalvars_') && NAME_BLOCKS.includes(opcode.substring(12))) {
                this.upgradeNameBlock(block, 'local');
            } else if (this.old && opcode === 'sensing_of') {
                this.upgradeSensingOf(block, targets);
            } else if (this.upgradeCloneBlock(block)) {
                this.changed = true;
            }
        }
        if (this.changed) this.blocks.resetCache();
        return this.changed;
    }
}

/**
 * Convert the blocks of targets that are being loaded (a project, or sprites added to one).
 * @param {Array<Target>} targets targets being installed
 * @param {Runtime} runtime
 * @param {?Set<string>} extensionIDs extensions the targets use; the old ones are removed
 * @param {boolean} old true if the targets are from before paths: see the top of this file
 */
const upgradeTargets = (targets, runtime, extensionIDs, old) => {
    const stage = targets.find(target => target.isStage) || runtime.getTargetForStage();
    const renames = new Map();
    if (old) {
        for (const target of targets) {
            renames.set(target.id, renameClashingVariables(target));
        }
    }
    const everyTarget = runtime.targets.concat(targets);
    for (const target of targets) {
        new Upgrader(target, stage, renames, old).run(null, everyTarget);
    }
    if (extensionIDs) {
        for (const id of OLD_EXTENSIONS) extensionIDs.delete(id);
    }
};

/**
 * Convert blocks copied into a target, e.g. from the backpack. Only blocks that don't exist anymore are converted.
 * @param {Target} target
 * @param {Array<string>} ids ids of the new blocks
 * @param {Runtime} runtime
 */
const upgradeBlocks = (target, ids, runtime) => {
    new Upgrader(target, runtime.getTargetForStage(), new Map(), false).run(ids, runtime.targets);
};

/**
 * @param {string} opcode
 * @returns {boolean} true if the block doesn't exist anymore and is converted
 */
const isOldBlock = opcode => Object.prototype.hasOwnProperty.call(DATA_BLOCKS, opcode) ||
    OLD_EXTENSIONS.some(id => opcode.startsWith(`${id}_`)) ||
    (opcode.startsWith('twclonevars_') && !!TWVARS_BLOCKS[opcode.substring(12)] &&
        TWVARS_BLOCKS[opcode.substring(12)].list);

module.exports = {
    OLD_EXTENSIONS,
    upgradeTargets,
    upgradeBlocks,
    isOldBlock
};

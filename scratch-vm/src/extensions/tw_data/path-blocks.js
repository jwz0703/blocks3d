const DataPath = require('../../util/data-path');

/**
 * Every block that reads or writes a path (see util/data-path.js), by opcode, for the extensions and the compiler:
 * - fn: the function of DataPath, called with (target, locals, ...the arguments)
 * - args: the arguments; the first is the path
 * - scope: the variables its paths use when they don't start with a scope
 * - pathOrValue: the first argument can also be an array or object itself (see DataPath.resolve)
 */
const PATH_BLOCKS = {};

// Reporters that give a whole scope as a value, by opcode
const SCOPE_BLOCKS = {
    twdata_global: 'global',
    twclonevars_self: 'self',
    twlocalvars_local: 'local'
};

const add = (opcode, fn, args, scope, pathOrValue) => {
    PATH_BLOCKS[opcode] = {fn, args, scope, pathOrValue: !!pathOrValue};
};

// 資料: global variables
add('twdata_get', 'get', ['PATH'], 'global');
add('twdata_set', 'set', ['PATH', 'VALUE'], 'global');
add('twdata_setObject', 'setObject', ['PATH', 'TEXT'], 'global');
add('twdata_change', 'change', ['PATH', 'VALUE'], 'global');
add('twdata_exists', 'exists', ['PATH'], 'global');
add('twdata_delete', 'remove', ['PATH'], 'global');
add('twdata_addItem', 'addItem', ['PATH', 'ITEM'], 'global');
add('twdata_insertItem', 'insertItem', ['PATH', 'INDEX', 'ITEM'], 'global');
add('twdata_deleteItem', 'deleteItem', ['PATH', 'INDEX'], 'global');
add('twdata_replaceItem', 'replaceItem', ['PATH', 'INDEX', 'ITEM'], 'global');
add('twdata_clear', 'clear', ['PATH'], 'global');
add('twdata_itemOf', 'itemOf', ['PATH', 'INDEX'], 'global', true);
add('twdata_indexOf', 'indexOf', ['PATH', 'ITEM'], 'global', true);
add('twdata_length', 'length', ['PATH'], 'global', true);
add('twdata_contains', 'contains', ['PATH', 'ITEM'], 'global', true);
add('twdata_keys', 'keys', ['PATH'], 'global', true);
add('twdata_listText', 'listText', ['PATH'], 'global');

// 分身變數 and 區域變數: the same blocks, with the variables of the sprite or clone, or of the custom block call
for (const [prefix, scope] of [['twclonevars_', 'self'], ['twlocalvars_', 'local']]) {
    add(`${prefix}setVariable`, 'set', ['NAME', 'VALUE'], scope);
    add(`${prefix}changeVariable`, 'change', ['NAME', 'VALUE'], scope);
    add(`${prefix}getVariable`, 'get', ['NAME'], scope);
    add(`${prefix}variableExists`, 'exists', ['NAME'], scope);
    add(`${prefix}deleteVariable`, 'remove', ['NAME'], scope);
}

/**
 * @param {string} opcode
 * @param {object} info entry of PATH_BLOCKS
 * @returns {Function} the interpreter's function of the block
 */
const makeFunction = (opcode, info) => function (args, util) {
    const values = info.args.map(name => args[name]);
    // Text of blocks that also take values is parsed by DataPath.resolve
    if (!info.pathOrValue) values[0] = DataPath.parse(values[0], info.scope);
    return DataPath[info.fn](util.target, DataPath.interpreterLocals(util.thread), ...values);
};

/**
 * Give an extension class the interpreter's functions of its path blocks and scope reporters.
 * @param {Function} extensionClass
 * @param {string} id extension id
 */
const addPathMethods = (extensionClass, id) => {
    const prefix = `${id}_`;
    for (const [opcode, info] of Object.entries(PATH_BLOCKS)) {
        if (opcode.startsWith(prefix)) {
            extensionClass.prototype[opcode.substring(prefix.length)] = makeFunction(opcode, info);
        }
    }
    for (const [opcode, scope] of Object.entries(SCOPE_BLOCKS)) {
        if (opcode.startsWith(prefix)) {
            extensionClass.prototype[opcode.substring(prefix.length)] = function (args, util) {
                return new DataPath.ScopeRef(scope, util.target, DataPath.interpreterLocals(util.thread));
            };
        }
    }
};

module.exports = {
    PATH_BLOCKS,
    SCOPE_BLOCKS,
    addPathMethods
};

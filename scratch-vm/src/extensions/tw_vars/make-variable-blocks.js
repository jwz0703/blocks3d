const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const TargetType = require('../../extension-support/target-type');
const Variable = require('../../engine/variable');
const Cast = require('../../util/cast');
const uid = require('../../util/uid');

/**
 * Build an extension class whose variables and lists are addressed by name and created on first use,
 * replacing the "Make a Variable" button.
 * @param {object} options
 * @param {string} options.id Extension ID.
 * @param {string} options.name Category name.
 * @param {string} options.variableWord Word shown in front of a variable name, e.g. 變數.
 * @param {string} options.listWord Word shown in front of a list name, e.g. 清單.
 * @param {string[]} options.colors color1, color2, color3.
 * @param {boolean} options.perClone true: variables live on each sprite/clone. false: variables live on the stage.
 * @returns {Function} Extension class.
 */
const makeVariableBlocks = function ({id, name, variableWord: v, listWord: l, colors, perClone}) {
    const variableName = {NAME: {type: ArgumentType.STRING, defaultValue: '我的變數'}};
    const listName = {NAME: {type: ArgumentType.STRING, defaultValue: '我的清單'}};
    const block = (opcode, blockType, text, args) => {
        const info = {opcode, blockType, text, arguments: args, disableMonitor: true};
        // The stage has no clones
        if (perClone) info.filter = [TargetType.SPRITE];
        return info;
    };
    const withList = extra => Object.assign({}, listName, extra);
    const item = {ITEM: {type: ArgumentType.STRING, defaultValue: '東西'}};
    const index = {INDEX: {type: ArgumentType.NUMBER, defaultValue: 1}};

    /** @type {WeakMap<object, Map<string, Variable>>} per target: "type:name" -> variable */
    const caches = new WeakMap();

    class VariableBlocks {
        constructor (runtime) {
            this.runtime = runtime;
        }

        getInfo () {
            return {
                id,
                name,
                color1: colors[0],
                color2: colors[1],
                color3: colors[2],
                blocks: [
                    block('setVariable', BlockType.COMMAND, `${v} [NAME] 設為 [VALUE]`,
                        Object.assign({}, variableName, {VALUE: {type: ArgumentType.STRING, defaultValue: '0'}})),
                    block('changeVariable', BlockType.COMMAND, `${v} [NAME] 改變 [VALUE]`,
                        Object.assign({}, variableName, {VALUE: {type: ArgumentType.NUMBER, defaultValue: 1}})),
                    block('getVariable', BlockType.REPORTER, `取得${v} [NAME]`, variableName),
                    block('variableExists', BlockType.BOOLEAN, `${v} [NAME] 存在？`, variableName),
                    block('deleteVariable', BlockType.COMMAND, `刪除${v} [NAME]`, variableName),
                    '---',
                    block('addToList', BlockType.COMMAND, `${l} [NAME] 加入 [ITEM]`, withList(item)),
                    block('deleteOfList', BlockType.COMMAND, `刪除${l} [NAME] 的第 [INDEX] 項`, withList(index)),
                    block('deleteAllOfList', BlockType.COMMAND, `清空${l} [NAME]`, listName),
                    block('insertAtList', BlockType.COMMAND, `在${l} [NAME] 的第 [INDEX] 項插入 [ITEM]`,
                        withList(Object.assign({}, index, item))),
                    block('replaceItemOfList', BlockType.COMMAND, `把${l} [NAME] 的第 [INDEX] 項替換為 [ITEM]`,
                        withList(Object.assign({}, index, item))),
                    block('getList', BlockType.REPORTER, `取得${l} [NAME]`, listName),
                    block('getItemOfList', BlockType.REPORTER, `${l} [NAME] 的第 [INDEX] 項`, withList(index)),
                    block('getItemNumOfList', BlockType.REPORTER, `[ITEM] 在${l} [NAME] 中的位置`, withList(item)),
                    block('lengthOfList', BlockType.REPORTER, `${l} [NAME] 的長度`, listName),
                    block('listContainsItem', BlockType.BOOLEAN, `${l} [NAME] 包含 [ITEM]？`, withList(item)),
                    block('listExists', BlockType.BOOLEAN, `${l} [NAME] 存在？`, listName),
                    block('deleteList', BlockType.COMMAND, `刪除${l} [NAME]`, listName)
                ]
            };
        }

        _owner (util) {
            return perClone ? util.target : this.runtime.getTargetForStage();
        }

        /**
         * @param {object} args Block arguments.
         * @param {object} util Block utility.
         * @param {string} type Variable.SCALAR_TYPE or Variable.LIST_TYPE.
         * @param {boolean} create Create the variable when it doesn't exist.
         * @returns {?Variable} The variable.
         */
        _lookup (args, util, type, create) {
            const target = this._owner(util);
            if (!target) return null;
            const varName = Cast.toString(args.NAME);
            const key = `${type}:${varName}`;
            let cache = caches.get(target);
            if (!cache) {
                cache = new Map();
                caches.set(target, cache);
            }
            let variable = cache.get(key);
            if (variable && target.variables[variable.id] === variable && variable.name === varName) {
                return variable;
            }
            variable = null;
            for (const varId in target.variables) {
                const candidate = target.variables[varId];
                if (candidate.name === varName && candidate.type === type) {
                    variable = candidate;
                    break;
                }
            }
            if (!variable && create) {
                const newId = uid();
                target.createVariable(newId, varName, type);
                variable = target.variables[newId];
            }
            if (variable) {
                cache.set(key, variable);
            } else {
                cache.delete(key);
            }
            return variable;
        }

        _variable (args, util, create) {
            return this._lookup(args, util, Variable.SCALAR_TYPE, create);
        }

        _list (args, util, create) {
            return this._lookup(args, util, Variable.LIST_TYPE, create);
        }

        setVariable (args, util) {
            this._variable(args, util, true).value = args.VALUE;
        }

        changeVariable (args, util) {
            const variable = this._variable(args, util, true);
            variable.value = Cast.toNumber(variable.value) + Cast.toNumber(args.VALUE);
        }

        getVariable (args, util) {
            const variable = this._variable(args, util, false);
            return variable ? variable.value : 0;
        }

        variableExists (args, util) {
            return !!this._variable(args, util, false);
        }

        deleteVariable (args, util) {
            const variable = this._variable(args, util, false);
            if (variable) this._owner(util).deleteVariable(variable.id);
        }

        addToList (args, util) {
            const list = this._list(args, util, true);
            list.value.push(args.ITEM);
            list._monitorUpToDate = false;
        }

        deleteOfList (args, util) {
            const list = this._list(args, util, false);
            if (!list) return;
            const i = Cast.toListIndex(args.INDEX, list.value.length, true);
            if (i === Cast.LIST_INVALID) return;
            if (i === Cast.LIST_ALL) {
                list.value = [];
            } else {
                list.value.splice(i - 1, 1);
            }
            list._monitorUpToDate = false;
        }

        deleteAllOfList (args, util) {
            const list = this._list(args, util, true);
            list.value = [];
            list._monitorUpToDate = false;
        }

        insertAtList (args, util) {
            const list = this._list(args, util, true);
            const i = Cast.toListIndex(args.INDEX, list.value.length + 1, false);
            if (i === Cast.LIST_INVALID) return;
            list.value.splice(i - 1, 0, args.ITEM);
            list._monitorUpToDate = false;
        }

        replaceItemOfList (args, util) {
            const list = this._list(args, util, false);
            if (!list) return;
            const i = Cast.toListIndex(args.INDEX, list.value.length, false);
            if (i === Cast.LIST_INVALID) return;
            list.value[i - 1] = args.ITEM;
            list._monitorUpToDate = false;
        }

        getList (args, util) {
            const list = this._list(args, util, false);
            if (!list) return '';
            // Same joining rule as the original list reporter
            const allSingleLetters = list.value.every(x => typeof x === 'string' && x.length === 1);
            return list.value.join(allSingleLetters ? '' : ' ');
        }

        getItemOfList (args, util) {
            const list = this._list(args, util, false);
            if (!list) return '';
            const i = Cast.toListIndex(args.INDEX, list.value.length, false);
            if (i === Cast.LIST_INVALID) return '';
            return list.value[i - 1];
        }

        getItemNumOfList (args, util) {
            const list = this._list(args, util, false);
            if (!list) return 0;
            for (let i = 0; i < list.value.length; i++) {
                if (Cast.compare(list.value[i], args.ITEM) === 0) return i + 1;
            }
            return 0;
        }

        lengthOfList (args, util) {
            const list = this._list(args, util, false);
            return list ? list.value.length : 0;
        }

        listContainsItem (args, util) {
            return this.getItemNumOfList(args, util) !== 0;
        }

        listExists (args, util) {
            return !!this._list(args, util, false);
        }

        deleteList (args, util) {
            const list = this._list(args, util, false);
            if (list) this._owner(util).deleteVariable(list.id);
        }
    }

    return VariableBlocks;
};

module.exports = makeVariableBlocks;

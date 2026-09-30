const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const TargetType = require('../../extension-support/target-type');
const Cast = require('../../util/cast');
const DataPath = require('../../util/data-path');
const {addPathMethods} = require('../tw_data/path-blocks');

const MYSELF = '_myself_';

/**
 * 分身: shown at the end of Control, after the clone blocks.
 * - 分身變數: variables of this sprite; every clone has its own copy. Their names are paths like the ones of 資料
 *   (e.g. `stats.hp`), and `x`, `position`, `costume`, `id`... are the sprite itself (see util/data-path.js).
 * - 是分身？: whether the sprite running it is a clone (the sprite itself is `not` it).
 * - Clones by id: every clone has an id (`id`), given to "create clone of [sprite] with id ()" or else numbered 1, 2,
 *   3... Ids don't have to be unique.
 */
class CloneBlocks {
    constructor (runtime) {
        this.runtime = runtime;
    }

    getInfo () {
        const name = {type: ArgumentType.STRING, defaultValue: 'hp'};
        const sprite = {type: ArgumentType.STRING, menu: 'sprite', defaultValue: MYSELF};
        const id = {type: ArgumentType.STRING, defaultValue: '1'};
        const block = (opcode, blockType, text, args, spritesOnly) => {
            const info = {opcode, blockType, text, arguments: args || {}, disableMonitor: true};
            // The stage has no clones
            if (spritesOnly) info.filter = [TargetType.SPRITE];
            return info;
        };
        return {
            id: 'twclonevars',
            name: '分身',
            color1: '#FFAB19',
            color2: '#EC9C13',
            color3: '#CF8B17',
            blocks: [
                block('setVariable', BlockType.COMMAND, '設定分身變數 [NAME] 為 [VALUE]', {
                    NAME: name,
                    VALUE: {type: ArgumentType.STRING, defaultValue: '0'}
                }, true),
                block('changeVariable', BlockType.COMMAND, '分身變數 [NAME] 改變 [VALUE]', {
                    NAME: name,
                    VALUE: {type: ArgumentType.NUMBER, defaultValue: 1}
                }, true),
                block('getVariable', BlockType.REPORTER, '取得分身變數 [NAME]', {NAME: name}, true),
                block('variableExists', BlockType.BOOLEAN, '分身變數 [NAME] 存在？', {NAME: name}, true),
                block('deleteVariable', BlockType.COMMAND, '刪除分身變數 [NAME]', {NAME: name}, true),
                block('self', BlockType.REPORTER, '分身變數', {}, true),
                '---',
                // No "is original?": that is not (is clone?)
                block('isClone', BlockType.BOOLEAN, '是分身？', {}, true),
                block('deleteClones', BlockType.COMMAND, '刪除 [SPRITE] id 為 [ID] 的分身', {SPRITE: sprite, ID: id}),
                block('cloneExists', BlockType.BOOLEAN, '[SPRITE] id 為 [ID] 的分身存在？', {SPRITE: sprite, ID: id}),
                block('getOfClone', BlockType.REPORTER, '[SPRITE] id 為 [ID] 的分身的 [NAME]', {
                    SPRITE: sprite,
                    ID: id,
                    NAME: name
                }),
                block('setOfClone', BlockType.COMMAND, '設定 [SPRITE] id 為 [ID] 的分身的 [NAME] 為 [VALUE]', {
                    SPRITE: sprite,
                    ID: id,
                    NAME: name,
                    VALUE: {type: ArgumentType.STRING, defaultValue: '0'}
                })
            ],
            menus: {
                sprite: {
                    acceptReporters: true,
                    items: 'getSpriteItems'
                }
            }
        };
    }

    getSpriteItems () {
        const items = [{text: '自己', value: MYSELF}];
        for (const target of this.runtime.targets) {
            // Cameras can't be cloned
            if (target.isOriginal && !target.isStage && !target.isCamera) {
                const spriteName = target.getName();
                items.push({text: spriteName, value: spriteName});
            }
        }
        return items;
    }

    /**
     * @param {object} args
     * @param {object} util
     * @returns {Array<Target>} clones of the sprite with the id
     */
    _clones (args, util) {
        const spriteName = Cast.toString(args.SPRITE);
        const sprite = spriteName === MYSELF ? util.target : this.runtime.getSpriteTargetByName(spriteName);
        if (!sprite || sprite.isStage) return [];
        return DataPath.clonesWithId(this.runtime, sprite, args.ID);
    }

    deleteClones (args, util) {
        for (const clone of this._clones(args, util)) {
            this.runtime.disposeTarget(clone);
            this.runtime.stopForTarget(clone);
        }
    }

    isClone (args, util) {
        return !util.target.isOriginal;
    }

    cloneExists (args, util) {
        return this._clones(args, util).length > 0;
    }

    getOfClone (args, util) {
        const clone = this._clones(args, util)[0];
        const path = DataPath.asSelfPath(args.NAME);
        if (!clone || !path) return '';
        return DataPath.get(clone, null, path);
    }

    setOfClone (args, util) {
        const path = DataPath.asSelfPath(args.NAME);
        if (!path) return;
        for (const clone of this._clones(args, util)) {
            DataPath.set(clone, null, path, args.VALUE);
        }
    }
}

addPathMethods(CloneBlocks, 'twclonevars');

module.exports = CloneBlocks;

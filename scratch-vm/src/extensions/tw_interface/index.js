const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const TargetType = require('../../extension-support/target-type');
const Cast = require('../../util/cast');
const Runtime = require('../../engine/runtime');
const {HAT, ANY} = require('../../engine/sprite-interface');

const NONE = '';

// Actions in the menu of events, done by the GUI (containers/blocks.jsx)
const NEW = '__new__';
const RENAME = '__rename__';
const DELETE = '__delete__';

/**
 * 介面 (ROADMAP.md 階段 10): events of a sprite's public interface (see engine/sprite-interface.js). The palette
 * doesn't show this category as it is: scratch-gui's make-toolbox-xml.js makes the sprite's own 介面 category (its
 * events and the send blocks) and a category for each other sprite with an interface (its hats and public custom
 * blocks) out of these blocks.
 */
class InterfaceBlocks {
    constructor (runtime) {
        this.runtime = runtime;
    }

    getInfo () {
        const ownEvent = {type: ArgumentType.STRING, menu: 'ownEvents'};
        const block = (opcode, blockType, text, args, extra) => Object.assign({
            opcode,
            blockType,
            text,
            arguments: args || {},
            disableMonitor: true,
            filter: [TargetType.SPRITE, TargetType.STAGE]
        }, extra);
        return {
            id: 'twiface',
            name: '介面',
            color1: '#1f9e8f',
            color2: '#1b8a7d',
            color3: '#16756a',
            blocks: [
                block('emit', BlockType.COMMAND, '廣播事件 [EVENT]', {EVENT: ownEvent}, {filter: [TargetType.SPRITE]}),
                block('emitValue', BlockType.COMMAND, '廣播事件 [EVENT] 值 [VALUE]', {
                    EVENT: ownEvent,
                    VALUE: {type: ArgumentType.STRING, defaultValue: '10'}
                }, {filter: [TargetType.SPRITE]}),
                block('emitAndWait', BlockType.COMMAND, '廣播事件 [EVENT] 並等待', {EVENT: ownEvent},
                    {filter: [TargetType.SPRITE]}),
                block('whenEvent', BlockType.EVENT, '當收到 [SPRITE] 的 [EVENT]', {
                    SPRITE: {type: ArgumentType.STRING, menu: 'senders'},
                    EVENT: {type: ArgumentType.STRING, menu: 'senderEvents'}
                }, {isEdgeActivated: false, shouldRestartExistingThreads: true}),
                block('source', BlockType.REPORTER, '觸發的角色'),
                block('sourceId', BlockType.REPORTER, '觸發的分身 id'),
                block('value', BlockType.REPORTER, '事件值', {}, {allowDropAnywhere: true})
            ],
            menus: {
                ownEvents: {acceptReporters: false, items: 'getOwnEvents'},
                senders: {acceptReporters: false, items: 'getSenders'},
                senderEvents: {acceptReporters: false, items: 'getSenderEvents'}
            }
        };
    }

    /**
     * @param {?object} block the scratch-blocks block the menu is on, if it is shown in the editor
     * @param {string} name a field
     * @returns {?string} its value
     */
    fieldOf (block, name) {
        if (!block || !block.getFieldValue) return null;
        try {
            return block.getFieldValue(name);
        } catch (e) {
            return null;
        }
    }

    /**
     * @param {Array<string>} names
     * @param {?string} current the value the menu has, kept even if it isn't there any more
     * @param {string} empty what to say if there are none
     * @returns {Array<object>} menu items
     */
    items (names, current, empty) {
        const items = names.map(name => (typeof name === 'object' ? name : {text: name, value: name}));
        if (current && !items.some(item => item.value === current)) {
            // Missing ones are shown by the blocks (grey with a red outline), not in the name
            items.push({text: current.replace(ANY, '任一個'), value: current});
        }
        return items.length ? items : [{text: empty, value: NONE}];
    }

    eventsOf (sprite) {
        return sprite && sprite.interface ? sprite.interface.events.map(event => event.name) : [];
    }

    getOwnEvents (targetId, block) {
        const target = this.runtime.getTargetById(targetId);
        const events = this.eventsOf(target && target.sprite);
        const current = this.fieldOf(block, 'EVENT');
        const items = events.map(name => ({text: name, value: name}));
        if (current && !events.includes(current) && !current.startsWith('__')) {
            items.push({text: current, value: current});
        }
        // Like the menu of broadcasts: making, renaming and deleting events (scratch-gui containers/blocks.jsx)
        items.push({text: '新事件…', value: NEW});
        if (events.includes(current)) {
            items.push({text: `重新命名「${current}」…`, value: RENAME});
            items.push({text: `刪除「${current}」…`, value: DELETE});
        }
        return items;
    }

    getSenders (targetId, block) {
        const current = this.fieldOf(block, 'SPRITE');
        const components = this.runtime.components;
        const editing = this.runtime.getTargetById(targetId);
        // Inside a component: the sprites and instances in it; else the ones at the top level
        const holder = components.holderOf(editing);
        const visible = target => (target.componentOwner || null) === (holder || null);
        const instancesOf = definition => components.instancesOf(definition).filter(visible);
        // For an instance of a component: the instances of that component, and any of them
        const definition = current ? components.definitionOf(current, editing) : null;
        const names = [];
        if (definition) {
            for (const target of instancesOf(definition)) names.push(target.getName());
            names.push({text: `任一個${definition.name}`, value: `${ANY}${definition.name}`});
        } else {
            for (const target of this.runtime.spriteInterfaces.spritesWithInterface()) {
                if (!target.sprite.interface.events.length || !visible(target)) continue;
                if (target.sprite.component) {
                    const any = `${ANY}${target.sprite.name}`;
                    if (names.some(item => item.value === any)) continue;
                    for (const instance of instancesOf(target.sprite)) names.push(instance.getName());
                    names.push({text: `任一個${target.sprite.name}`, value: any});
                } else {
                    names.push(target.getName());
                }
            }
        }
        return this.items(names, current, '（沒有角色有事件）');
    }

    getSenderEvents (targetId, block) {
        const spriteName = this.fieldOf(block, 'SPRITE');
        const editing = this.runtime.getTargetById(targetId);
        const components = this.runtime.components;
        const definition = spriteName ? components.definitionOf(spriteName, editing) : null;
        const sender = spriteName ? components.resolveName(editing, spriteName) : null;
        const sprite = definition || (sender && sender.sprite);
        return this.items(this.eventsOf(sprite), this.fieldOf(block, 'EVENT'), '（沒有事件）');
    }

    emit (args, util) {
        this.runtime.spriteInterfaces.emit(util.target, Cast.toString(args.EVENT), '');
    }

    emitValue (args, util) {
        this.runtime.spriteInterfaces.emit(util.target, Cast.toString(args.EVENT), args.VALUE);
    }

    emitAndWait (args, util) {
        const threads = this.runtime.spriteInterfaces.emit(util.target, Cast.toString(args.EVENT), '');
        if (!threads.length) return;
        // Wait until every script it started has finished (like broadcast and wait)
        return new Promise(resolve => {
            const check = () => {
                if (threads.some(thread => this.runtime.threads.includes(thread) && !thread.isKilled)) return;
                this.runtime.off(Runtime.AFTER_EXECUTE, check);
                resolve();
            };
            this.runtime.on(Runtime.AFTER_EXECUTE, check);
        });
    }

    whenEvent () {
        // Started by emit
        return true;
    }

    /**
     * @param {object} util
     * @returns {?object} the event that started this script, if one did
     */
    eventOf (util) {
        return util.thread && util.thread.interfaceEvent ? util.thread.interfaceEvent : null;
    }

    source (args, util) {
        const event = this.eventOf(util);
        return event ? event.spriteName : '';
    }

    sourceId (args, util) {
        const event = this.eventOf(util);
        if (!event) return '';
        return event.source.cloneId === void 0 ? 0 : event.source.cloneId;
    }

    value (args, util) {
        const event = this.eventOf(util);
        return event ? event.value : '';
    }
}

InterfaceBlocks.HAT = HAT;

module.exports = InterfaceBlocks;

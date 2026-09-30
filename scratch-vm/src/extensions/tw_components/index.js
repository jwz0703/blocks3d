const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const TargetType = require('../../extension-support/target-type');
const Cast = require('../../util/cast');
const Runtime = require('../../engine/runtime');
const {ANY} = require('../../engine/components');

const NONE = '';

/**
 * 元件 (ROADMAP.md 階段 10, engine/components.js): properties of instances, and instances made by scripts. Like 介面
 * (tw_interface), the palette doesn't show this category as it is: scratch-gui's make-toolbox-xml.js puts the blocks
 * inside a component into its 介面 category, and the blocks that use a component into the category of the component.
 */
class ComponentBlocks {
    constructor (runtime) {
        this.runtime = runtime;
    }

    get components () {
        return this.runtime.components;
    }

    getInfo () {
        const ownProp = {type: ArgumentType.STRING, menu: 'ownProps'};
        const instance = {type: ArgumentType.STRING, menu: 'instances'};
        const instanceProp = {type: ArgumentType.STRING, menu: 'instanceProps'};
        const component = {type: ArgumentType.STRING, menu: 'components'};
        const value = {type: ArgumentType.STRING, defaultValue: ''};
        const block = (opcode, blockType, text, args, extra) => Object.assign({
            opcode,
            blockType,
            text,
            arguments: args || {},
            disableMonitor: true
        }, extra);
        const spritesOnly = {filter: [TargetType.SPRITE]};
        return {
            id: 'twcomp',
            name: '元件',
            color1: '#1f9e8f',
            color2: '#1b8a7d',
            color3: '#16756a',
            blocks: [
                // Properties can be booleans: they go into boolean inputs too
                block('prop', BlockType.REPORTER, '屬性 [PROP]', {PROP: ownProp},
                    Object.assign({allowDropAnywhere: true}, spritesOnly)),
                block('setProp', BlockType.COMMAND, '屬性 [PROP] 設為 [VALUE]', {PROP: ownProp, VALUE: value},
                    spritesOnly),
                block('whenPropChanged', BlockType.EVENT, '當屬性 [PROP] 改變', {PROP: ownProp},
                    Object.assign({isEdgeActivated: false, shouldRestartExistingThreads: true}, spritesOnly)),
                block('thisInstance', BlockType.REPORTER, '這個實體', {}, spritesOnly),
                // Outputs of the component, made like custom blocks: "發出 被點擊 次數 ( ) 開啟 < >" inside, "當
                // [instance] 被點擊 次數 (次數) 開啟 <開啟？>" outside. The arguments are inputs named by the ids
                // of the arguments; scratch-gui makes the shapes (lib/blocks.js), the VM only knows the ids.
                block('emit', BlockType.COMMAND, '發出 [PORT]', {
                    PORT: {type: ArgumentType.STRING, label: true, defaultValue: ''}
                }, spritesOnly),
                block('emitAndWait', BlockType.COMMAND, '發出 [PORT] 並等待', {
                    PORT: {type: ArgumentType.STRING, label: true, defaultValue: ''}
                }, spritesOnly),
                block('whenOutput', BlockType.EVENT, '當 [SPRITE] 發出 [PORT]', {
                    SPRITE: {type: ArgumentType.STRING, label: true, defaultValue: ''},
                    PORT: {type: ArgumentType.STRING, label: true, defaultValue: ''}
                }, {isEdgeActivated: false, shouldRestartExistingThreads: true}),
                block('outputParam', BlockType.REPORTER, '[PARAM]', {
                    PORT: {type: ArgumentType.STRING, label: true, defaultValue: ''},
                    PARAM: {type: ArgumentType.STRING, label: true, defaultValue: ''}
                }, {allowDropAnywhere: true}),
                // Instead of the green flag, which starts nothing in a component
                block('whenCreated', BlockType.EVENT, '當元件建立', {},
                    Object.assign({isEdgeActivated: false, shouldRestartExistingThreads: true}, spritesOnly)),
                // In a component the mouse is where it is in the component; these are where it is on the stage
                block('stageMouseX', BlockType.REPORTER, '舞台滑鼠 x'),
                block('stageMouseY', BlockType.REPORTER, '舞台滑鼠 y'),
                block('instanceProp', BlockType.REPORTER, '[INSTANCE] 的 [PROP]', {
                    INSTANCE: instance,
                    PROP: instanceProp
                }, {allowDropAnywhere: true}),
                // Gone: the outside can't write what is inside a component, it calls an input. Old projects have the
                // block, greyed out, doing nothing.
                block('setInstanceProp', BlockType.COMMAND, '[INSTANCE] 的 [PROP] 設為 [VALUE]', {
                    INSTANCE: instance,
                    PROP: instanceProp,
                    VALUE: value
                }, {hideFromPalette: true}),
                block('allInstances', BlockType.REPORTER, '所有 [COMPONENT] 實體', {COMPONENT: component}),
                block('spawn', BlockType.COMMAND, '放一個 [COMPONENT] 名稱 [NAME]', {
                    COMPONENT: component,
                    NAME: {type: ArgumentType.STRING, defaultValue: ''}
                })
            ],
            menus: {
                ownProps: {acceptReporters: false, items: 'getOwnProps'},
                instances: {acceptReporters: true, items: 'getInstances'},
                instanceProps: {acceptReporters: false, items: 'getInstanceProps'},
                components: {acceptReporters: false, items: 'getComponents'}
            }
        };
    }

    // Menus (they get the scratch-blocks block they are on, see extension-manager.js)

    fieldOf (block, name) {
        if (!block || !block.getFieldValue) return null;
        try {
            return block.getFieldValue(name);
        } catch (e) {
            return null;
        }
    }

    items (names, current, empty) {
        const items = names.map(name => (typeof name === 'object' ? name : {text: name, value: name}));
        if (current && !items.some(item => item.value === current)) {
            items.push({text: current, value: current});
        }
        return items.length ? items : [{text: empty, value: NONE}];
    }

    propNames (sprite) {
        return sprite && sprite.component ? sprite.component.props.map(prop => prop.name) : [];
    }

    getOwnProps (targetId, block) {
        // An instance, or a sprite in one
        const holder = this.components.holderOf(this.runtime.getTargetById(targetId));
        const names = this.propNames(holder && holder.sprite);
        const current = this.fieldOf(block, 'PROP');
        const items = names.map(name => ({text: name, value: name}));
        if (current && !names.includes(current) && !current.startsWith('__')) {
            items.push({text: current, value: current});
        }
        // Like the menu of variables: making, renaming and deleting properties (scratch-gui containers/blocks.jsx)
        items.push({text: '新屬性…', value: '__new__'});
        if (names.includes(current)) {
            items.push({text: `重新命名「${current}」…`, value: '__rename__'});
            items.push({text: `刪除「${current}」…`, value: '__delete__'});
        }
        return items;
    }

    /**
     * @param {string} targetId the target being edited
     * @param {Sprite} definition
     * @returns {Array<Target>} the instances of the definition it can name: inside a component the ones in it, else
     * the ones at the top level
     */
    instancesFor (targetId, definition) {
        const holder = this.components.holderOf(this.runtime.getTargetById(targetId));
        if (holder) return this.components.membersOf(holder).filter(member => member.sprite === definition);
        return this.components.instancesOf(definition).filter(instance => !instance.componentOwner);
    }

    getInstances (targetId, block) {
        const current = this.fieldOf(block, 'instances');
        const sprite = current ? this.components.definitionOf(current, this.runtime.getTargetById(targetId)) : null;
        const definitions = sprite ? [sprite] : Array.from(this.components.definitions.values());
        const names = [];
        for (const definition of definitions) {
            for (const target of this.instancesFor(targetId, definition)) names.push(target.getName());
        }
        return this.items(names, current, '（沒有實體）');
    }

    /**
     * @param {?object} block the block with the INSTANCE input
     * @param {string} targetId the target being edited
     * @returns {?Sprite} the component of the instance it names, if it names one with a menu
     */
    definitionOfBlock (block, targetId) {
        if (!block || !block.getInputTargetBlock) return null;
        const menu = block.getInputTargetBlock('INSTANCE');
        const name = this.fieldOf(menu, 'instances');
        return name ? this.components.definitionOf(name, this.runtime.getTargetById(targetId)) : null;
    }

    getInstanceProps (targetId, block) {
        const sprite = this.definitionOfBlock(block, targetId);
        let names;
        if (sprite) {
            names = this.propNames(sprite);
        } else {
            names = [];
            for (const definition of this.components.definitions.values()) {
                for (const name of this.propNames(definition)) if (!names.includes(name)) names.push(name);
            }
        }
        return this.items(names, this.fieldOf(block, 'PROP'), '（沒有屬性）');
    }

    getComponents (targetId, block) {
        const names = Array.from(this.components.definitions.values()).map(sprite => sprite.name);
        return this.items(names, this.fieldOf(block, 'COMPONENT'), '（沒有元件）');
    }

    // Blocks

    prop (args, util) {
        return this.components.getProp(util.target, Cast.toString(args.PROP));
    }

    setProp (args, util) {
        this.components.setProp(util.target, Cast.toString(args.PROP), args.VALUE);
    }

    /**
     * @param {object} args the inputs and fields of an emit block
     * @returns {object} the arguments of the output by id: every input but the port
     */
    outputArguments (args) {
        const values = {};
        for (const name of Object.keys(args)) {
            if (name !== 'PORT') values[name] = args[name];
        }
        return values;
    }

    emit (args, util) {
        this.components.emitOutput(util.target, Cast.toString(args.PORT), this.outputArguments(args));
    }

    emitAndWait (args, util) {
        const threads = this.components.emitOutput(util.target, Cast.toString(args.PORT), this.outputArguments(args));
        if (!threads.length) return;
        // Until every script it started has finished (like broadcast and wait)
        return new Promise(resolve => {
            const check = () => {
                if (threads.some(thread => this.runtime.threads.includes(thread) && !thread.isKilled)) return;
                this.runtime.off(Runtime.AFTER_EXECUTE, check);
                resolve();
            };
            this.runtime.on(Runtime.AFTER_EXECUTE, check);
        });
    }

    whenOutput () {
        // Started by emit
        return true;
    }

    outputParam (args, util) {
        const call = util.thread && util.thread.outputCall;
        if (!call || (args.PORT && call.output.id !== Cast.toString(args.PORT))) return '';
        const value = call.args[Cast.toString(args.PARAM)];
        return typeof value === 'undefined' ? '' : value;
    }

    whenCreated () {
        // Started by fireCreated
        return true;
    }

    stageMouseX () {
        return this.runtime.ioDevices.mouse.getScratchX();
    }

    stageMouseY () {
        return this.runtime.ioDevices.mouse.getScratchY();
    }

    thisInstance (args, util) {
        const holder = this.components.holderOf(util.target);
        return (holder || util.target).getName();
    }

    /**
     * @param {*} name
     * @returns {?Target} the instance with that name
     */
    instance (name, util) {
        const target = this.components.resolveName(util && util.target, Cast.toString(name));
        return target && this.components.isInstance(target) ? target : null;
    }

    instanceProp (args, util) {
        const target = this.instance(args.INSTANCE, util);
        return target ? this.components.getProp(target, Cast.toString(args.PROP)) : '';
    }

    setInstanceProp () {
        // Does nothing: call an input of the component instead
    }

    allInstances (args) {
        const sprite = this.components.definitionByName(Cast.toString(args.COMPONENT));
        if (!sprite) return [];
        // Instances placed by scripts too (they are like clones, but have names)
        return sprite.clones.filter(target => target.instanceName &&
            (target.isOriginal || !sprite.clones.some(t => t !== target && t.isOriginal &&
                t.instanceName === target.instanceName)))
            .map(target => target.getName());
    }

    spawn (args) {
        const sprite = this.components.definitionByName(Cast.toString(args.COMPONENT));
        if (!sprite || !this.runtime.clonesAvailable()) return;
        this.components.addInstance(sprite, {name: Cast.toString(args.NAME) || sprite.name, temporary: true});
    }
}

ComponentBlocks.ANY = ANY;

module.exports = ComponentBlocks;

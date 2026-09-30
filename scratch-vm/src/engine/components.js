/**
 * @fileoverview
 * Components (ROADMAP.md 階段 10): a sprite made reusable. The definition is a Sprite (its blocks, costumes, sounds
 * and public interface, see sprite-interface.js) with `sprite.component`:
 *   {id, color, props: [{name, type, default, options}]}
 * (and `outputs: [{id, proccode, params: [{id, name, type}]}]`, what it says to the outside, see emitOutput)
 * and its instances are targets of that sprite that are saved and have names of their own (`target.instanceName`),
 * not clones: they share the blocks and costumes, and each has its own position, variables and property values
 * (`target.componentProps`, only the ones that differ from the defaults). Instances can't have blocks of their own.
 *
 * Other sprites see a category of the definition: "when [instance] [event]" (an instance, or any instance of the
 * component), "[instance] 的 [property]", calls of its public custom blocks... Events are sent in the name of the
 * instance and of "any instance of the component", which is how they are scoped.
 *
 * A definition stays when its last instance is deleted (`sprite.componentTemplate` keeps that target for its
 * variables); deleting the definition is a separate step. Blocks that name an instance that doesn't exist stay, do
 * nothing, and work again when an instance with that name comes back.
 *
 * Members: a component can have more sprites in it (`sprite.component.members`, in the order they are drawn). Each is
 *   {key, kind: 'sprite', sprite: Sprite, name, x, y, size, direction, visible, currentCostume, rotationStyle,
 *    draggable, variables}  (a sprite of the component: its blocks and costumes belong to the definition)
 *   {key, kind: 'component', componentId, name, x, y, size, direction, visible, props}  (an instance of another
 *    component in it)
 * with x and y from the root. Every instance has its own targets of the members (`instance.componentMembers`, key →
 * target; `member.componentOwner` is the instance): they move with it, go when it goes, aren't in the sprite list
 * outside the component, and aren't saved (the definition is). Names of members are looked up in their instance
 * first (see resolveName), so two dialogs can both have an 確定 button.
 *
 * Editing a component (the component mode of the editor, `editScope`): changes to the members of the instance being
 * edited go into the definition and to the members of every other instance.
 */

const StringUtil = require('../util/string-util');
const Cast = require('../util/cast');
const MathUtil = require('../util/math-util');
const dataPath = require('../util/data-path');
const {parseTemplate, evaluate} = require('../util/b3-expression');
const StageLayering = require('./stage-layering');
const Variable = require('./variable');
const uid = require('../util/uid');
const Thread = require('./thread');

const ANY = '_any_';

/** Types of properties, and how values of them are kept */
const PROP_TYPES = ['number', 'string', 'boolean', 'color', 'menu', 'costume', 'sprite', 'sound'];

const PROP_HAT = 'twcomp_whenPropChanged';

/** Outputs of a component: blocks made like custom blocks (its own inside, "when [instance] ..." outside) */
const OUTPUT_EMIT = 'twcomp_emit';
const OUTPUT_HAT = 'twcomp_whenOutput';
const CREATED_HAT = 'twcomp_whenCreated';

/**
 * @param {string} prefix
 * @returns {string} a new id of letters and digits (ids of components and members show up in project.json and the
 * text of tools/3dsb-text, so they are kept simple)
 */
const newId = prefix => {
    let id = prefix;
    for (let i = 0; i < 10; i++) id += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)];
    return id;
};

/**
 * @param {string} type
 * @param {*} value
 * @returns {*} the value as that type keeps it
 */
const castProp = (type, value) => {
    switch (type) {
    case 'number': return Cast.toNumber(value);
    case 'boolean': return Cast.toBoolean(value);
    default: return Cast.toString(value);
    }
};

/**
 * @param {?object} value
 * @returns {{name: string, type: string, default: *, options: ?string[]}} a clean property definition
 */
const normalizeProp = value => {
    const type = PROP_TYPES.includes(value && value.type) ? value.type : 'string';
    const prop = {name: String((value && value.name) || '').trim(), type};
    const fallback = {number: 0, boolean: false, color: '#1f9e8f'}[type];
    prop.default = castProp(type, value && Object.prototype.hasOwnProperty.call(value, 'default') ?
        value.default : (typeof fallback === 'undefined' ? '' : fallback));
    if (type === 'menu') {
        prop.options = Array.isArray(value && value.options) ? value.options.map(String) : [];
    }
    return prop;
};

/**
 * @param {string} proccode text of a custom block: words and %s / %b for the arguments
 * @returns {string[]} the types of the arguments ('s' or 'b'), in order
 */
const argumentTypes = proccode => (String(proccode).match(/(^|[^\\])%[snb]/g) || [])
    .map(match => (match.slice(-1) === 'b' ? 'b' : 's'));

/**
 * @param {?object} value {id, proccode, params: [{id, name, type}]}
 * @returns {?{id: string, proccode: string, params: Array<{id: string, name: string, type: string}>}} a clean output
 * of a component: what it says, and its arguments (by id, which stay when they are renamed or moved)
 */
const normalizeOutput = value => {
    const proccode = String((value && value.proccode) || '').trim();
    if (!proccode) return null;
    const types = argumentTypes(proccode);
    const given = Array.isArray(value.params) ? value.params : [];
    const params = types.map((type, index) => {
        const param = given[index] || {};
        return {id: String(param.id || newId('a')), name: String(param.name || `參數${index + 1}`), type};
    });
    const output = {id: String(value.id || newId('out')), proccode, params};
    // An output that is one of a component inside: {instance, port, map: {own argument id: its argument id}}
    const forward = value.forward;
    if (forward && typeof forward.instance === 'string' && typeof forward.port === 'string') {
        const map = {};
        for (const param of params) {
            const from = forward.map && forward.map[param.id];
            if (typeof from === 'string') map[param.id] = from;
        }
        output.forward = {instance: forward.instance, port: forward.port, map};
    }
    return output;
};

/**
 * @param {?object} value
 * @param {string} [id]
 * @returns {{id: string, color: string, props: Array<object>}} clean component data
 */
const normalizeComponent = (value, id) => {
    const props = [];
    for (const prop of Array.isArray(value && value.props) ? value.props : []) {
        const clean = normalizeProp(prop);
        if (clean.name && !props.some(p => p.name === clean.name)) props.push(clean);
    }
    const outputs = [];
    for (const output of Array.isArray(value && value.outputs) ? value.outputs : []) {
        const clean = normalizeOutput(output);
        if (clean && !outputs.some(o => o.id === clean.id)) outputs.push(clean);
    }
    return {
        id: String((value && value.id) || id || newId('cmp')),
        color: typeof (value && value.color) === 'string' ? value.color : '#1f9e8f',
        props,
        outputs,
        members: []
    };
};

class Components {
    constructor (runtime) {
        this.runtime = runtime;
        /** @type {Map<string, Sprite>} id → definition */
        this.definitions = new Map();
        /** @type {Map<Target, Set<string>>} properties changed since the last frame */
        this.changed = new Map();
        /** @type {Set<Target>} instances with properties bound to the ones of the component around them */
        this.bound = new Set();
        /** @type {?Target} the instance whose component is being edited (component mode), if any */
        this.editScope = null;
        /**
         * @type {?{stack: Array<Sprite>, preview: Target}} the component page: a component on its own, as an instance
         * (`isPreview`) that is not saved and not part of the project, while the scripts of the project don't run
         */
        this.page = null;
    }

    static get ANY () {
        return ANY;
    }

    static get PROP_TYPES () {
        return PROP_TYPES;
    }

    /** Forget every definition (a new project) */
    clear () {
        this.definitions.clear();
        this.changed.clear();
        this.bound.clear();
        this.editScope = null;
        this.page = null;
    }

    /**
     * @param {Target} target
     * @returns {boolean} true if it is an instance of a component (or a clone of one)
     */
    isInstance (target) {
        return !!(target && target.sprite && target.sprite.component);
    }

    /**
     * @param {Sprite} sprite a definition
     * @returns {Array<Target>} every target of it: instances, their clones and the hidden one of a definition without
     */
    everyInstanceOf (sprite) {
        return sprite.clones.concat(sprite.componentTemplate && !sprite.clones.includes(sprite.componentTemplate) ?
            [sprite.componentTemplate] : []);
    }

    /**
     * @param {Sprite} sprite a definition
     * @returns {Array<Target>} its instances, in the order of the sprite list
     */
    instancesOf (sprite) {
        return this.runtime.targets.filter(target => target.sprite === sprite && target.isOriginal &&
            !target.isPreview);
    }

    /**
     * @param {string} name
     * @returns {?Sprite} the definition with that name
     */
    definitionByName (name) {
        for (const sprite of this.definitions.values()) {
            if (sprite.name === name) return sprite;
        }
        return null;
    }

    /**
     * @param {string} name an instance, or `_any_` and the name of a component
     * @returns {?Sprite} the definition it belongs to
     */
    definitionOf (name, from) {
        name = Cast.toString(name);
        if (name.startsWith(ANY)) return this.definitionByName(name.slice(ANY.length));
        const target = from ? this.resolveName(from, name) : this.runtime.getSpriteTargetByName(name);
        return target && target.sprite && target.sprite.component ? target.sprite : null;
    }

    /**
     * @returns {Array<string>} the names of every sprite and instance
     */
    usedNames () {
        return this.runtime.targets.filter(target => target.isOriginal && !target.isStage && !target.isPreview)
            .map(target => target.getName());
    }

    /**
     * Turn a 2D sprite into a component, with itself as its first instance.
     * @param {Target} target
     * @returns {?Sprite} the definition
     */
    makeComponent (target) {
        if (!target || target.isStage || !target.isOriginal || target.sprite.component) return null;
        if (target.is3D || target.isCamera || target.isCanvas) return null;
        const sprite = target.sprite;
        const names = Array.from(this.definitions.values()).map(s => s.name);
        const instanceName = sprite.name;
        sprite.name = StringUtil.unusedName(sprite.name, names);
        sprite.component = normalizeComponent(null);
        target.instanceName = instanceName;
        target.componentProps = {};
        this.definitions.set(sprite.component.id, sprite);
        this.runtime.emitProjectChanged();
        this.runtime.requestTargetsUpdate(target);
        return sprite;
    }

    /**
     * Place another instance of a component.
     * @param {Sprite} sprite the definition
     * @param {object} [options]
     * @param {string} [options.name] its name (made unique)
     * @param {Target} [options.like] the instance to copy the position, look and variables of
     * @param {boolean} [options.temporary] true for one made by a script: deleted when the project stops, like a clone
     * @returns {?Target} the new instance
     */
    addInstance (sprite, options = {}) {
        if (!sprite || !sprite.component) return null;
        const like = options.like || this.instancesOf(sprite)[0] || sprite.componentTemplate || null;
        const target = sprite.createClone(StageLayering.SPRITE_LAYER);
        // Sprites only give the first target a drawable
        if (target.drawableID === null) target.initDrawable(StageLayering.SPRITE_LAYER);
        target.isOriginal = !options.temporary;
        if (options.preview) target.isPreview = true;
        target.instanceName = StringUtil.unusedName(options.name || sprite.name, this.usedNames());
        if (like) {
            target.x = like.x;
            target.y = like.y;
            if (!options.temporary && like !== sprite.componentTemplate) {
                // Next to it, so that it can be seen
                target.x += 20;
                target.y -= 20;
            }
            target.direction = like.direction;
            target.draggable = like.draggable;
            target.mouseMode = like.mouseMode;
            target.visible = like.visible;
            target.size = like.size;
            target.currentCostume = like.currentCostume;
            target.rotationStyle = like.rotationStyle;
            target.volume = like.volume;
            target.variables = like.duplicateVariables();
        }
        // The properties start as the definition says, whatever the one it is like has
        target.componentProps = {};
        if (options.temporary) this.runtime.changeCloneCounter(1);
        target.updateAllDrawableProperties();
        this.runtime.addTarget(target);
        for (const member of this.buildMembers(target)) this.runtime.addTarget(member);
        // Made by a script, or while the project runs: it starts now
        if (!options.preview && (options.temporary || this.runtime.frameHatsEnabled)) this.fireCreated(target);
        if (options.preview) {
            this.runtime.requestTargetsUpdate(target);
        } else if (!options.temporary) {
            this.runtime.emitProjectChanged();
            this.runtime.requestTargetsUpdate(target);
        }
        return target;
    }

    /**
     * Delete an instance; the definition stays, even if it was the last one.
     * @param {Target} target
     */
    removeInstance (target) {
        const sprite = target.sprite;
        const last = this.instancesOf(sprite).filter(t => t !== target).length === 0;
        this.removeMembers(target, last);
        for (const clone of sprite.clones.slice()) {
            if (!clone.isOriginal && clone.instanceName === target.instanceName) {
                this.runtime.disposeTarget(clone);
            }
        }
        const others = this.instancesOf(sprite).filter(t => t !== target);
        if (others.length === 0) sprite.componentTemplate = target;
        this.runtime.disposeTarget(target);
        this.changed.delete(target);
        this.runtime.emitProjectChanged();
    }

    /**
     * Delete a definition and every instance of it. Blocks elsewhere that use it stay (and do nothing).
     * @param {Sprite} sprite
     */
    removeDefinition (sprite) {
        for (const target of sprite.clones.slice()) {
            this.removeMembers(target, false);
            this.runtime.disposeTarget(target);
        }
        this.definitions.delete(sprite.component.id);
        sprite.dispose();
        this.runtime.emitProjectChanged();
    }

    /**
     * @param {Sprite} sprite
     * @param {string} name
     * @returns {boolean} true if it was renamed
     */
    renameDefinition (sprite, name) {
        name = String(name || '').trim();
        if (!sprite || !sprite.component || !name || name === sprite.name) return false;
        const names = Array.from(this.definitions.values()).filter(s => s !== sprite)
            .map(s => s.name);
        const oldName = sprite.name;
        sprite.name = StringUtil.unusedName(name, names);
        this.updateFields(block => {
            for (const key of ['SPRITE', 'INSTANCE']) {
                const field = block.fields[key];
                if (field && field.value === `${ANY}${oldName}`) field.value = `${ANY}${sprite.name}`;
            }
            const field = block.fields.COMPONENT;
            if (field && field.value === oldName) field.value = sprite.name;
        });
        this.runtime.emitProjectChanged();
        return true;
    }

    // Members

    /**
     * @param {Target} instance
     * @returns {Array<Target>} the targets of the members of an instance
     */
    membersOf (instance) {
        return instance && instance.componentMembers ? Array.from(instance.componentMembers.values()) : [];
    }

    /**
     * @param {Sprite} sprite a definition
     * @param {Sprite} other another definition
     * @returns {boolean} true if `other` is (or is inside) `sprite`: putting an instance of `sprite` into `other`
     * would make a component that contains itself
     */
    contains (sprite, other) {
        if (sprite === other) return true;
        const seen = new Set();
        const visit = definition => {
            if (!definition || !definition.component || seen.has(definition)) return false;
            if (definition === other) return true;
            seen.add(definition);
            return definition.component.members.some(spec => spec.kind === 'component' &&
                visit(this.definitions.get(spec.componentId)));
        };
        return visit(sprite);
    }

    /**
     * Make the member targets of an instance (and of the instances in it).
     * @param {Target} instance
     * @param {number} [depth] how deep in other components it is
     * @returns {Array<Target>} the new targets, for the caller to add to the runtime
     */
    buildMembers (instance, depth = 0) {
        const made = [];
        if (!instance.sprite.component || depth > 8) return made;
        instance.componentMembers = new Map();
        for (const spec of instance.sprite.component.members || []) {
            made.push(...this.createMember(instance, spec, depth));
        }
        return made;
    }

    /**
     * @param {Target} instance
     * @param {object} spec a member of its component
     * @param {number} depth
     * @returns {Array<Target>} the member's target, and the members of it if it is an instance of a component
     */
    createMember (instance, spec, depth) {
        let sprite;
        let like = null;
        if (spec.kind === 'component') {
            sprite = this.definitions.get(spec.componentId);
            if (!sprite || this.contains(sprite, instance.sprite)) return [];
            like = this.instancesOf(sprite)[0] || sprite.componentTemplate || null;
        } else {
            sprite = spec.sprite;
        }
        if (!sprite) return [];
        const target = sprite.createClone(StageLayering.SPRITE_LAYER);
        if (target.drawableID === null) target.initDrawable(StageLayering.SPRITE_LAYER);
        target.isOriginal = instance.isOriginal;
        target.componentOwner = instance;
        target.memberKey = spec.key;
        if (spec.kind === 'component') {
            target.instanceName = spec.name;
            if (like) target.variables = like.duplicateVariables();
            // Bound to the outer component once it has an owner
            target.componentProps = Object.assign({}, spec.props);
        } else if (spec.variables) {
            target.variables = Object.keys(spec.variables).reduce((all, id) => {
                all[id] = spec.variables[id].clone();
                return all;
            }, {});
        }
        this.placeMember(target, instance, spec);
        target.layerOrder = (instance.layerOrder || 0) + 0.5;
        instance.componentMembers.set(spec.key, target);
        const made = [target];
        if (spec.kind === 'component') made.push(...this.buildMembers(target, depth + 1));
        return made;
    }

    /**
     * Give a member the place, direction and size its spec says. They are in the coordinates of the instance.
     * @param {Target} target
     * @param {Target} instance the one it is in
     * @param {object} spec
     */
    placeMember (target, instance, spec) {
        target.x = Number(spec.x) || 0;
        target.y = Number(spec.y) || 0;
        if (typeof spec.size === 'number') target.size = spec.size;
        if (typeof spec.direction === 'number') target.direction = spec.direction;
        if (typeof spec.visible === 'boolean') target.visible = spec.visible;
        if (typeof spec.currentCostume === 'number') target.currentCostume = spec.currentCostume;
        if (typeof spec.rotationStyle === 'string') target.rotationStyle = spec.rotationStyle;
        if (typeof spec.draggable === 'boolean') target.draggable = spec.draggable;
        // Not updateAllDrawableProperties: that would undo how the editor fades what is outside the component
        this.pushPose(target);
    }

    /**
     * Send where a target is (and its members) to the renderer.
     * @param {Target} target
     */
    pushPose (target) {
        const renderer = this.runtime.renderer;
        if (!renderer || typeof target.drawableID !== 'number') return;
        const {direction, scale} = target._getRenderedDirectionAndScale();
        renderer.updateDrawablePosition(target.drawableID, target._renderedPosition());
        renderer.updateDrawableDirectionScale(target.drawableID, direction, scale);
        renderer.updateDrawableVisible(target.drawableID, target._effectiveVisible());
        const costume = target.getCostumes()[target.currentCostume];
        if (costume) renderer.updateDrawableSkinId(target.drawableID, costume.skinId);
        this.runtime.requestRedraw();
        this.reposeMembers(target);
    }

    /**
     * An instance moved, turned, changed size or was shown or hidden: its members follow, and their own members.
     * @param {Target} instance
     */
    reposeMembers (instance) {
        const renderer = this.runtime.renderer;
        if (!renderer || !instance.componentMembers) return;
        for (const member of instance.componentMembers.values()) {
            if (typeof member.drawableID !== 'number') continue;
            const {direction, scale} = member._getRenderedDirectionAndScale();
            renderer.updateDrawablePosition(member.drawableID, member._renderedPosition());
            renderer.updateDrawableDirectionScale(member.drawableID, direction, scale);
            // The editor fades or hides what is outside the component (VirtualMachine.refreshComponentEditView)
            if (!this.editScope) renderer.updateDrawableVisible(member.drawableID, member._effectiveVisible());
            this.reposeMembers(member);
        }
        this.runtime.requestRedraw();
    }

    /**
     * Delete the member targets of an instance.
     * @param {Target} instance
     * @param {boolean} keep true to keep them as templates of the definition (its last instance is going)
     */
    removeMembers (instance, keep) {
        for (const member of this.membersOf(instance)) {
            this.removeMembers(member, false);
            const spec = this.specOf(member);
            if (keep && spec && spec.kind === 'sprite') spec.template = member;
            for (const clone of member.sprite.clones.slice()) {
                if (!clone.isOriginal && clone.componentOwner === instance && clone.memberKey === member.memberKey) {
                    this.runtime.disposeTarget(clone);
                }
            }
            this.runtime.disposeTarget(member);
        }
        if (instance.componentMembers) instance.componentMembers.clear();
    }

    /**
     * @param {Target} member
     * @returns {?object} its spec in the definition of the instance it belongs to
     */
    specOf (member) {
        const owner = member && member.componentOwner;
        if (!owner || !owner.sprite.component) return null;
        return owner.sprite.component.members.find(spec => spec.key === member.memberKey) || null;
    }

    /**
     * Put a sprite (or an instance of another component) into the component of an instance: it becomes a member,
     * and every other instance gets it too.
     * @param {Target} instance
     * @param {Target} target a top-level sprite or instance
     * @returns {boolean} true if it was put in
     */
    adoptMember (instance, target) {
        if (!instance || !instance.sprite.component || !target || target === instance || target.isStage ||
            target.componentOwner || target.is3D || target.isCamera || !target.isOriginal) return false;
        if (target.sprite.component && this.contains(target.sprite, instance.sprite)) return false;
        if (target.sprite === instance.sprite) return false;
        // The place it has on the stage becomes a place in the component
        const frame = instance._worldFrame();
        const radians = frame.angle * Math.PI / 180;
        const dx = target.x - frame.x;
        const dy = target.y - frame.y;
        const spec = {
            key: newId('m'),
            kind: target.sprite.component ? 'component' : 'sprite',
            name: target.getName(),
            x: ((dx * Math.cos(radians)) - (dy * Math.sin(radians))) / frame.k,
            y: ((dx * Math.sin(radians)) + (dy * Math.cos(radians))) / frame.k,
            size: target.size / frame.k,
            direction: MathUtil.wrapClamp(target.direction - frame.angle, -179, 180),
            visible: target.visible,
            currentCostume: target.currentCostume,
            rotationStyle: target.rotationStyle,
            draggable: target.draggable
        };
        if (spec.kind === 'component') {
            spec.componentId = target.sprite.component.id;
            spec.props = Object.assign({}, target.componentProps);
        } else {
            spec.sprite = target.sprite;
            spec.variables = target.duplicateVariables();
        }
        instance.sprite.component.members.push(spec);
        if (!instance.componentMembers) instance.componentMembers = new Map();
        target.componentOwner = instance;
        target.memberKey = spec.key;
        instance.componentMembers.set(spec.key, target);
        // It was on the stage, and is in the component now
        target.x = spec.x;
        target.y = spec.y;
        target.size = spec.size;
        target.direction = spec.direction;
        this.pushPose(target);
        for (const other of this.instancesOf(instance.sprite)) {
            if (other === instance) continue;
            if (!other.componentMembers) other.componentMembers = new Map();
            for (const made of this.createMember(other, spec, 0)) this.runtime.addTarget(made);
        }
        this.definitionChanged(instance.sprite);
        return true;
    }

    /**
     * Put an instance of a component into the component of an instance (in every instance of it).
     * @param {Target} instance
     * @param {Sprite} definition the component to put in
     * @returns {?Target} the new member of `instance`
     */
    addComponentMember (instance, definition) {
        if (!instance || !instance.sprite.component || !definition || !definition.component) return null;
        // A component can't contain itself
        if (this.contains(definition, instance.sprite)) return null;
        const names = this.membersOf(instance).map(member => member.getName());
        const like = this.instancesOf(definition)[0] || definition.componentTemplate || null;
        const spec = {
            key: newId('m'),
            kind: 'component',
            componentId: definition.component.id,
            name: StringUtil.unusedName(definition.name, names),
            x: 0,
            y: 0,
            size: like ? like.size : 100,
            direction: like ? like.direction : 90,
            visible: true,
            currentCostume: like ? like.currentCostume : 0,
            rotationStyle: like ? like.rotationStyle : 'all around',
            draggable: false,
            props: {}
        };
        instance.sprite.component.members.push(spec);
        let made = null;
        for (const each of this.instancesOf(instance.sprite)) {
            if (!each.componentMembers) each.componentMembers = new Map();
            const targets = this.createMember(each, spec, 0);
            for (const target of targets) this.runtime.addTarget(target);
            if (each === instance) made = targets[0] || null;
        }
        this.definitionChanged(instance.sprite);
        return made;
    }

    /**
     * Take a member out of its component, in every instance.
     * @param {Target} member
     */
    removeMember (member) {
        const spec = this.specOf(member);
        if (!spec) return;
        const sprite = member.componentOwner.sprite;
        sprite.component.members.splice(sprite.component.members.indexOf(spec), 1);
        for (const instance of sprite.clones.concat(sprite.componentTemplate ? [sprite.componentTemplate] : [])) {
            const target = instance.componentMembers && instance.componentMembers.get(spec.key);
            if (!target) continue;
            this.removeMembers(target, false);
            instance.componentMembers.delete(spec.key);
            this.runtime.disposeTarget(target);
        }
        this.definitionChanged(sprite);
    }

    /**
     * A member of the instance being edited moved or changed: the definition and the other instances follow.
     * @param {Target} member
     */
    memberChanged (member) {
        if (this._syncing || !this.editScope) return;
        const spec = this.specOf(member);
        if (!spec) return;
        const owner = member.componentOwner;
        Object.assign(spec, {
            name: member.getName(),
            x: member.x,
            y: member.y,
            size: member.size,
            direction: member.direction,
            visible: member.visible,
            currentCostume: member.currentCostume,
            rotationStyle: member.rotationStyle,
            draggable: member.draggable
        });
        this._syncing = true;
        try {
            for (const instance of owner.sprite.clones) {
                const other = instance.componentMembers && instance.componentMembers.get(spec.key);
                if (other && other !== member) this.placeMember(other, instance, spec);
            }
        } finally {
            this._syncing = false;
        }
        // The editor shows what is outside the component hidden or faded (VirtualMachine.refreshComponentEditView)
        if (this.onMembersSynced) this.onMembersSynced();
        this.runtime.emitProjectChanged();
    }

    /**
     * @param {Target} target an instance or a clone of one
     * @returns {Target} the instance (the original, not a clone)
     */
    originalOf (target) {
        if (target.isOriginal) return target;
        return target.sprite.clones.find(t => t.isOriginal && t.instanceName === target.instanceName &&
            t.componentOwner === target.componentOwner) || target;
    }

    /**
     * @param {Target} target
     * @returns {?Target} whose variables `global.` means for the target: the root of its component (the instance, or
     * the instance it is a member of), or null outside components, where they are the project's
     */
    globalOwner (target) {
        if (!target || !target.sprite || target.isStage) return null;
        if (target.sprite.component) return this.originalOf(target);
        return target.componentOwner ? this.originalOf(target.componentOwner) : null;
    }

    /**
     * @param {Target} target
     * @returns {?Target} the instance whose component it is part of: itself (or its original) if it is an
     * instance, the instance it is a sprite of, or null for a sprite outside components
     */
    instanceOfTarget (target) {
        if (!target || !target.sprite) return null;
        if (target.sprite.component) return this.originalOf(target);
        return target.componentOwner || null;
    }

    /**
     * @param {?Target} sender the target sending a broadcast
     * @returns {function(Target): boolean} which targets hear it: the ones of the same component (its root and the
     * sprites in it, not the components in it), or the ones outside components. Whatever crosses the edge of a
     * component is an input or an output (see emitOutput).
     */
    broadcastScope (sender) {
        const scope = this.globalOwner(sender);
        return receiver => this.globalOwner(receiver) === scope;
    }

    /**
     * @param {Target} from the target whose block names it
     * @param {string} name a sprite, an instance, or a member of the instance `from` is in
     * @returns {?Target} what the name means there: members of the same instance first, then top-level sprites
     */
    resolveName (from, name) {
        const owner = from && (from.componentMembers && from.componentMembers.size ? from : from.componentOwner);
        for (const scope of [from, owner]) {
            if (!scope || !scope.componentMembers) continue;
            for (const member of scope.componentMembers.values()) {
                if (member.getName() === name) return member;
            }
        }
        return this.runtime.getSpriteTargetByName(name) || null;
    }

    // Properties: variables of the root that the outside can set (the root's `self.` and `global.` are the same
    // variables, and so are the ones of the members' `global.`), with a type, a default and a place in the info panel.
    // `target.componentProps` is what is saved of them: the values that aren't the default.

    /**
     * @param {Target} target an instance, or a sprite in one
     * @param {string} name
     * @returns {?object} the definition of that property
     */
    propOf (target, name) {
        const holder = this.holderOf(target);
        if (!holder) return null;
        return holder.sprite.component.props.find(prop => prop.name === name) || null;
    }

    /**
     * @param {Target} target
     * @returns {?Target} whose properties it reads: itself if it is an instance, or the instance it is a sprite of
     */
    holderOf (target) {
        if (!target || !target.sprite || target.isStage) return null;
        if (target.sprite.component) return this.originalOf(target);
        const owner = target.componentOwner;
        return owner && owner.sprite.component ? this.originalOf(owner) : null;
    }

    /**
     * @param {Target} holder an instance
     * @param {string} name
     * @returns {?Variable} the variable of a property, if the instance has it
     */
    propVariable (holder, name) {
        for (const id in holder.variables) {
            const variable = holder.variables[id];
            if (variable.name === name && variable.type === Variable.SCALAR_TYPE) return variable;
        }
        return null;
    }

    /**
     * Make sure the instance has a variable for each property.
     * @param {Target} holder
     */
    ensureProps (holder) {
        if (!holder.sprite.component) return;
        for (const prop of holder.sprite.component.props) {
            if (!this.propVariable(holder, prop.name)) this.writeProp(holder, prop, prop.default);
        }
    }

    writeProp (holder, prop, value) {
        let variable = this.propVariable(holder, prop.name);
        if (!variable) {
            const id = uid();
            holder.createVariable(id, prop.name, Variable.SCALAR_TYPE);
            variable = holder.variables[id];
        }
        variable.value = value;
        variable._monitorUpToDate = false;
    }

    /**
     * @param {Target} target an instance (or clone of one), or a sprite in one (its properties are the instance's)
     * @param {string} name
     * @returns {*} the value of the property ('' if it has none)
     */
    getProp (target, name) {
        const prop = this.propOf(target, name);
        if (!prop) return '';
        const variable = this.propVariable(this.holderOf(target), name);
        return variable ? variable.value : prop.default;
    }

    /**
     * @param {Target} target an instance
     * @returns {object} what is saved of its properties: the values that differ from the defaults, and the bindings
     */
    overridesOf (target) {
        const result = {};
        if (!target.sprite.component) return result;
        for (const prop of target.sprite.component.props) {
            const binding = target.propBindings && target.propBindings.get(prop.name);
            if (typeof binding === 'string') {
                result[prop.name] = binding;
                continue;
            }
            const variable = this.propVariable(target, prop.name);
            if (variable && variable.value !== prop.default) result[prop.name] = variable.value;
        }
        return result;
    }

    /**
     * Set the properties of an instance from what is saved of them.
     * @param {Target} target an instance
     * @param {?object} values by name; the ones that aren't there get their defaults. A value in {braces} of an
     * instance inside another component is worked out in it (`{global.確定文字}` is the property of the outer one).
     */
    applyOverrides (target, values) {
        if (!target.sprite || !target.sprite.component) return;
        values = values || {};
        target.propBindings = null;
        for (const prop of target.sprite.component.props) {
            const raw = Object.prototype.hasOwnProperty.call(values, prop.name) ? values[prop.name] : prop.default;
            if (target.componentOwner && typeof raw === 'string' && raw.includes('{')) {
                if (!target.propBindings) target.propBindings = new Map();
                target.propBindings.set(prop.name, raw);
                this.writeProp(target, prop, this.boundValue(target, raw, prop.type));
            } else {
                this.writeProp(target, prop, castProp(prop.type, raw));
            }
        }
        if (target.propBindings) this.bound.add(target);
        else this.bound.delete(target);
    }

    /**
     * @param {Target} holder an instance inside another component
     * @param {string} text a value with {expressions} in it
     * @param {string} type of the property
     * @returns {*} the value, with the expressions worked out (in the component the instance is in)
     */
    boundValue (holder, text, type) {
        if (!this.templates) this.templates = new Map();
        let parts = this.templates.get(text);
        if (typeof parts === 'undefined') {
            try {
                parts = parseTemplate(text);
            } catch (e) {
                parts = null;
            }
            if (this.templates.size > 200) this.templates.clear();
            this.templates.set(text, parts);
        }
        if (!parts) return castProp(type, text);
        const outer = holder.componentOwner;
        const read = node => dataPath.get(outer, null, node.text);
        const value = (tree, format) => {
            try {
                const result = evaluate(tree, read);
                return format ? format(result) : result;
            } catch (e) {
                return '';
            }
        };
        // One expression alone keeps its type (a number stays a number)
        if (parts.length === 1 && typeof parts[0] !== 'string') {
            return castProp(type, value(parts[0].tree, parts[0].format));
        }
        return castProp(type, parts.map(part => (typeof part === 'string' ? part :
            Cast.toString(value(part.tree, part.format)))).join(''));
    }

    /**
     * Work out the properties that are bound to the ones of the component around them again. The inside can't
     * change them: the outside gives the value.
     */
    refreshBound () {
        for (const holder of this.bound) {
            if (!this.runtime.targets.includes(holder) || !holder.propBindings) {
                this.bound.delete(holder);
                continue;
            }
            for (const [name, raw] of holder.propBindings) {
                const prop = this.propOf(holder, name);
                if (!prop) continue;
                const value = this.boundValue(holder, raw, prop.type);
                if (this.getProp(holder, name) === value) continue;
                this.writeProp(holder, prop, value);
                this.markChanged(holder, name);
            }
        }
    }

    markChanged (holder, name) {
        if (!this.changed.has(holder)) this.changed.set(holder, new Set());
        this.changed.get(holder).add(name);
    }

    /**
     * @param {Target} target
     * @returns {object} every property of the instance, with defaults
     */
    propsOf (target) {
        const result = {};
        if (!this.isInstance(target)) return result;
        for (const prop of target.sprite.component.props) result[prop.name] = this.getProp(target, prop.name);
        return result;
    }

    /**
     * @param {Target} target
     * @param {string} name
     * @param {*} value
     */
    setProp (target, name, value) {
        const prop = this.propOf(target, name);
        if (!prop) return;
        target = this.holderOf(target);
        // A bound property has the value of the outside
        if (target.propBindings && target.propBindings.has(name)) return;
        value = castProp(prop.type, value);
        if (this.getProp(target, name) === value) return;
        this.writeProp(target, prop, value);
        this.markChanged(target, name);
        if (target.isOriginal) this.runtime.emitProjectChanged();
    }

    /**
     * Back to the default value (in the editor)
     * @param {Target} target
     * @param {string} name
     */
    resetProp (target, name) {
        const prop = this.propOf(target, name);
        if (!prop) return;
        target = this.holderOf(target);
        if (target.propBindings) target.propBindings.delete(name);
        if (this.getProp(target, name) === prop.default) return;
        this.writeProp(target, prop, prop.default);
        this.markChanged(target, name);
        this.runtime.emitProjectChanged();
    }

    /**
     * Start "when property [ ] changes" for the properties changed since the last frame.
     */
    flushChanges () {
        if (this.bound.size) this.refreshBound();
        if (this.changed.size === 0) return;
        const changed = this.changed;
        this.changed = new Map();
        for (const [target, names] of changed) {
            if (!this.runtime.targets.includes(target)) continue;
            // The instance, and the sprites in it (their properties are the instance's)
            const hearing = [target, ...this.membersOf(target).filter(member => !member.sprite.component)];
            for (const name of names) {
                for (const each of hearing) this.runtime.startHats(PROP_HAT, {PROP: name}, each);
            }
        }
    }

    /**
     * @param {Sprite} sprite a definition
     * @param {object} value {name, type, default, options}
     * @returns {boolean} true if it was added
     */
    addProp (sprite, value) {
        const prop = normalizeProp(value);
        if (!sprite || !sprite.component || !prop.name || sprite.component.props.some(p => p.name === prop.name)) {
            return false;
        }
        sprite.component.props.push(prop);
        for (const target of this.everyInstanceOf(sprite)) this.writeProp(target, prop, prop.default);
        this.definitionChanged(sprite);
        return true;
    }

    /**
     * Change the type, default or options of a property; values of instances are kept (cast to the type).
     * @param {Sprite} sprite
     * @param {string} name
     * @param {object} value {type, default, options}
     */
    updateProp (sprite, name, value) {
        const index = sprite && sprite.component ? sprite.component.props.findIndex(p => p.name === name) : -1;
        if (index < 0) return;
        const prop = normalizeProp(Object.assign({}, sprite.component.props[index], value, {name}));
        const before = sprite.component.props[index];
        sprite.component.props[index] = prop;
        for (const target of this.everyInstanceOf(sprite)) {
            const variable = this.propVariable(target, name);
            // Values stay (cast to the type); one that was the default follows the new default
            if (!variable) this.writeProp(target, prop, prop.default);
            else if (variable.value === before.default) variable.value = prop.default;
            else variable.value = castProp(prop.type, variable.value);
        }
        this.definitionChanged(sprite);
    }

    /**
     * Rename a property: values of instances and the blocks that use it follow.
     * @param {Sprite} sprite
     * @param {string} oldName
     * @param {string} newName
     * @returns {boolean} true if it was renamed
     */
    renameProp (sprite, oldName, newName) {
        newName = String(newName || '').trim();
        if (!sprite || !sprite.component || !newName) return false;
        const prop = sprite.component.props.find(p => p.name === oldName);
        if (!prop || sprite.component.props.some(p => p.name === newName)) return false;
        prop.name = newName;
        for (const target of this.everyInstanceOf(sprite)) {
            const variable = this.propVariable(target, oldName);
            if (variable) variable.name = newName;
            if (target.propBindings && target.propBindings.has(oldName)) {
                target.propBindings.set(newName, target.propBindings.get(oldName));
                target.propBindings.delete(oldName);
            }
        }
        // Inside the component (属性 [ ]) and outside ([instance] 的 [property])
        const instanceNames = new Set(this.instancesOf(sprite).map(t => t.getName())
            .concat(`${ANY}${sprite.name}`));
        for (const [blockTarget, block] of this.allBlocks()) {
            const field = block.fields.PROP;
            if (!field || field.value !== oldName || !/^twcomp_/.test(block.opcode)) continue;
            const inside = blockTarget.sprite === sprite &&
                /^twcomp_(prop|setProp|whenPropChanged)$/.test(block.opcode);
            const instance = this.instanceFieldOf(blockTarget, block);
            if (inside || (instance !== null && instanceNames.has(instance))) field.value = newName;
        }
        for (const target of this.runtime.targets) target.blocks.resetCache();
        this.definitionChanged(sprite);
        this.runtime.emit('BLOCKS_NEED_UPDATE');
        return true;
    }

    /**
     * @param {Sprite} sprite
     * @param {string} name
     */
    removeProp (sprite, name) {
        if (!sprite || !sprite.component) return;
        const index = sprite.component.props.findIndex(p => p.name === name);
        if (index < 0) return;
        sprite.component.props.splice(index, 1);
        for (const target of this.everyInstanceOf(sprite)) {
            const variable = this.propVariable(target, name);
            if (variable) delete target.variables[variable.id];
            if (target.propBindings) target.propBindings.delete(name);
        }
        this.definitionChanged(sprite);
    }

    // Outputs: what a component says to the outside. The author makes one like a custom block ("被點擊 次數 ( )
    // 開啟 < >", arguments with ids that stay when they are renamed or moved), and inside the component "發出 ..."
    // sends it. Outside, "當 [instance] 被點擊 ..." hears it, with the arguments to drag out. Each time it is sent
    // keeps its own arguments (on the threads it starts), so sending it again while it is handled changes nothing.

    /**
     * Make an output, or change one (its arguments keep their ids).
     * @param {Sprite} sprite a definition
     * @param {object} spec {proccode, argumentIds, argumentNames}: like the mutation of a custom block
     * @param {string} [id] the output to change
     * @returns {?object} the output
     */
    defineOutput (sprite, spec, id) {
        if (!sprite || !sprite.component) return null;
        const outputs = sprite.component.outputs;
        const existing = id ? outputs.find(o => o.id === id) : null;
        const proccode = String((spec && spec.proccode) || '').trim();
        if (!proccode || outputs.some(o => o !== existing && o.proccode === proccode)) return null;
        const ids = (spec && spec.argumentIds) || [];
        const names = (spec && spec.argumentNames) || [];
        const params = argumentTypes(proccode).map((type, index) => ({id: ids[index], name: names[index], type}));
        const forward = existing && existing.forward;
        const clean = normalizeOutput({id: existing ? existing.id : id, proccode, params, forward});
        if (existing) outputs[outputs.indexOf(existing)] = clean;
        else outputs.push(clean);
        this.definitionChanged(sprite);
        this.runtime.emit('BLOCKS_NEED_UPDATE');
        return clean;
    }

    /**
     * @param {Sprite} sprite
     * @param {string} id
     * @returns {boolean} true if it was removed (blocks that use it stay, and do nothing)
     */
    removeOutput (sprite, id) {
        if (!sprite || !sprite.component) return false;
        const index = sprite.component.outputs.findIndex(o => o.id === id);
        if (index < 0) return false;
        sprite.component.outputs.splice(index, 1);
        this.definitionChanged(sprite);
        return true;
    }

    /**
     * Make an output of the component that says what a component inside says ("onClick={props.onShake}"): it has the
     * same words and arguments, and is said whenever the one inside is.
     * @param {Sprite} sprite the definition of the component around
     * @param {string} instanceName the name of the instance inside
     * @param {string} port the id of its output
     * @returns {?object} the new output (the one that forwards it already, if there is one)
     */
    forwardOutput (sprite, instanceName, port) {
        if (!sprite || !sprite.component) return null;
        const spec = (sprite.component.members || []).find(m => m.kind === 'component' && m.name === instanceName);
        const inner = spec && this.definitions.get(spec.componentId);
        const source = inner && this.outputOf(inner, port);
        if (!source) return null;
        const existing = sprite.component.outputs.find(o => o.forward && o.forward.instance === instanceName &&
            o.forward.port === port);
        if (existing) return existing;
        let proccode = source.proccode;
        const taken = code => sprite.component.outputs.some(o => o.proccode === code);
        while (taken(proccode)) proccode = `${instanceName} ${proccode}`;
        const params = source.params.map(param => ({id: newId('a'), name: param.name, type: param.type}));
        const map = {};
        params.forEach((param, index) => {
            map[param.id] = source.params[index].id;
        });
        const clean = normalizeOutput({proccode, params, forward: {instance: instanceName, port, map}});
        sprite.component.outputs.push(clean);
        this.definitionChanged(sprite);
        this.runtime.emit('BLOCKS_NEED_UPDATE');
        return clean;
    }

    /**
     * @param {Sprite} sprite
     * @param {string} id
     * @returns {?object} the output with that id
     */
    outputOf (sprite, id) {
        return sprite && sprite.component ? sprite.component.outputs.find(o => o.id === id) || null : null;
    }

    /**
     * @param {Target} target an instance, or a sprite in one
     * @returns {?Sprite} the component whose blocks it runs: its own, or the one it is a sprite of
     */
    definitionOfTarget (target) {
        if (!target || !target.sprite) return null;
        if (target.sprite.component) return target.sprite;
        for (const sprite of this.definitions.values()) {
            const members = sprite.component.members || [];
            if (members.some(spec => spec.kind === 'sprite' && spec.sprite === target.sprite)) return sprite;
        }
        return null;
    }

    /**
     * Say an output of the component `source` is in.
     * @param {Target} source the instance (or sprite in one) saying it
     * @param {string} id of the output
     * @param {object} args its arguments by id
     * @returns {Array<Thread>} the scripts it started
     */
    emitOutput (source, id, args) {
        const holder = this.holderOf(source);
        const output = holder ? this.outputOf(holder.sprite, id) : null;
        if (!output) return [];
        const values = {};
        for (const param of output.params) {
            const value = args && Object.prototype.hasOwnProperty.call(args, param.id) ? args[param.id] : '';
            values[param.id] = param.type === 'b' ? Cast.toBoolean(value) : value;
        }
        const spriteName = holder.getName();
        const anyName = `${ANY}${holder.sprite.name}`;
        // Heard on the level the instance is on: the project, or the component around it
        const level = holder.componentOwner ? this.originalOf(holder.componentOwner) : null;
        const receivers = new Map();
        this.runtime.allScriptsByOpcodeDo(OUTPUT_HAT, (script, target) => {
            const fields = script.fieldsOfInputs;
            if (!fields.PORT || fields.PORT.value !== String(id).toUpperCase() || !fields.SPRITE) return;
            if (this.globalOwner(target) !== level) return;
            const field = fields.SPRITE.value;
            let heard = field === anyName.toUpperCase();
            if (!heard && field === spriteName.toUpperCase()) heard = this.resolveName(target, spriteName) === holder;
            if (!heard) return;
            if (!receivers.has(target)) receivers.set(target, new Set());
            receivers.get(target).add(field === anyName.toUpperCase() ? anyName : spriteName);
        });
        const call = {output, args: values, source: holder, spriteName};
        // The page of a component lists what its component says
        this.runtime.emit('COMPONENT_OUTPUT', {instance: holder, output, args: values});
        const threads = [];
        for (const [target, names] of receivers) {
            for (const name of names) {
                threads.push(...(this.runtime.startHats(OUTPUT_HAT, {SPRITE: name, PORT: String(id)}, target) || []));
            }
        }
        for (const thread of threads) thread.outputCall = call;
        // The component around may say it too
        const outer = holder.componentOwner ? this.originalOf(holder.componentOwner) : null;
        if (outer && outer.sprite.component) {
            for (const own of outer.sprite.component.outputs) {
                if (!own.forward || own.forward.port !== id || own.forward.instance !== spriteName) continue;
                const forwarded = {};
                for (const param of own.params) forwarded[param.id] = values[own.forward.map[param.id]];
                threads.push(...this.emitOutput(outer, own.id, forwarded));
            }
        }
        return threads;
    }

    /**
     * "When the component appears": an instance was made while the project runs, or the green flag reset all.
     * @param {Target} [target] an instance (and its members), or every instance
     */
    fireCreated (target) {
        const fire = each => {
            this.runtime.startHats(CREATED_HAT, null, each);
            for (const member of this.membersOf(each)) fire(member);
        };
        if (target) {
            fire(target);
            return;
        }
        for (const each of this.runtime.targets) {
            if (each.isOriginal && !each.isStage && each.sprite.component && !each.componentOwner) fire(each);
        }
    }

    /**
     * @param {Target} target
     * @returns {boolean} true if it is an instance of a component or a sprite in one: what the project doesn't reach
     * with its green flag and broadcasts
     */
    isInside (target) {
        return !!(target && target.sprite && (target.sprite.component || target.componentOwner));
    }

    definitionChanged (sprite) {
        this.runtime.emitProjectChanged();
        const target = this.instancesOf(sprite)[0];
        this.runtime.requestTargetsUpdate(target || this.runtime.getTargetForStage());
    }

    // The component page: a component on its own. The instance in it is a copy that is not saved and does not exist
    // for the project (no name of the project's is taken, the blocks of the project don't see it), and nothing
    // of the project runs meanwhile: what the component does stays inside (its variables are its root's, its outputs
    // go to the log of the page), so it can be tried without touching the project.

    /**
     * @param {Target} target
     * @returns {boolean} true if it is what the page shows: the instance of the page, or something in it
     */
    inPage (target) {
        const preview = this.page && this.page.preview;
        for (let each = target; each; each = each.componentOwner) {
            if (each === preview) return true;
        }
        return false;
    }

    /**
     * Show a component on its own page (on top of the one that is open, if any).
     * @param {Sprite} sprite the definition
     * @returns {?Target} the instance of the page
     */
    openPage (sprite) {
        if (!sprite || !sprite.component) return null;
        const stack = this.page ? this.page.stack.concat([sprite]) : [sprite];
        this.disposePreview();
        this.page = {stack, preview: null};
        this.startPreview();
        return this.page.preview;
    }

    /**
     * Go back to the component the page was opened from, or to the project.
     * @returns {?Target} the instance of the page that is shown now, if any
     */
    closePage () {
        if (!this.page) return null;
        const stack = this.page.stack.slice(0, -1);
        this.disposePreview();
        this.runtime.stopAll();
        if (!stack.length) {
            this.page = null;
            this.editScope = null;
            return null;
        }
        this.page = {stack, preview: null};
        this.startPreview();
        return this.page.preview;
    }

    /**
     * Start the component of the page again: new variables, and "when the component is created" runs.
     * @returns {?Target} the new instance
     */
    restartPage () {
        if (!this.page) return null;
        const stack = this.page.stack;
        this.disposePreview();
        this.page = {stack, preview: null};
        this.startPreview();
        return this.page.preview;
    }

    disposePreview () {
        const preview = this.page && this.page.preview;
        if (!preview) return;
        this.runtime.stopAll();
        this.editScope = null;
        this.removeMembers(preview, false);
        this.runtime.disposeTarget(preview);
        this.page.preview = null;
        this.changed.delete(preview);
        this.bound.delete(preview);
    }

    startPreview () {
        const sprite = this.page.stack[this.page.stack.length - 1];
        this.runtime.stopAll();
        const preview = this.addInstance(sprite, {preview: true, name: sprite.name});
        preview.x = 0;
        preview.y = 0;
        preview.direction = 90;
        preview.size = 100;
        preview.visible = true;
        preview.updateAllDrawableProperties();
        this.page.preview = preview;
        this.editScope = preview;
        // "When every frame" scripts of the component run, and the component starts
        this.runtime.frameHatsEnabled = true;
        this.fireCreated(preview);
    }

    /**
     * Run an input of the instance of the page, as the buttons of the test panel do.
     * @param {string} prototypeId the public custom block of the component
     * @param {object} values by id of the arguments
     * @returns {Promise<*>} resolves with what a custom block that reports gives (nothing for the others) when it is
     * done
     */
    callInput (prototypeId, values) {
        const preview = this.page && this.page.preview;
        const blocks = preview && preview.blocks;
        const prototype = blocks && blocks.getBlock(prototypeId);
        if (!prototype || prototype.opcode !== 'procedures_prototype' || !prototype.mutation) {
            return Promise.resolve();
        }
        const mutation = prototype.mutation;
        let ids;
        try {
            ids = JSON.parse(mutation.argumentids);
        } catch (e) {
            ids = [];
        }
        const types = argumentTypes(mutation.proccode);
        const made = [];
        const create = block => {
            block.id = uid();
            block.fields = block.fields || {};
            block.inputs = block.inputs || {};
            block.next = null;
            block.parent = block.parent || null;
            block.shadow = !!block.shadow;
            block.topLevel = !block.parent;
            blocks.createBlock(block);
            made.push(block.id);
            return block;
        };
        const call = create({
            opcode: 'procedures_call',
            mutation: {
                tagName: 'mutation',
                children: [],
                proccode: mutation.proccode,
                argumentids: mutation.argumentids,
                warp: 'false'
            }
        });
        ids.forEach((id, index) => {
            const value = values && Object.prototype.hasOwnProperty.call(values, id) ? values[id] : '';
            if (types[index] === 'b') {
                // A boolean is a block that is true or false
                const yes = Cast.toBoolean(value);
                const condition = create({opcode: 'operator_equals', parent: call.id});
                for (const [name, text] of [['OPERAND1', '1'], ['OPERAND2', yes ? '1' : '2']]) {
                    const shadow = create({opcode: 'text', shadow: true, parent: condition.id});
                    shadow.fields.TEXT = {name: 'TEXT', value: text};
                    condition.inputs[name] = {name, block: shadow.id, shadow: shadow.id};
                }
                call.inputs[id] = {name: id, block: condition.id, shadow: null};
            } else {
                const shadow = create({opcode: 'text', shadow: true, parent: call.id});
                shadow.fields.TEXT = {name: 'TEXT', value: Cast.toString(value)};
                call.inputs[id] = {name: id, block: shadow.id, shadow: shadow.id};
            }
        });
        blocks.resetCache();
        return new Promise(resolve => {
            let result;
            const onReport = report => {
                if (report && report.id === call.id) result = report.value;
            };
            const finish = () => {
                this.runtime.off('VISUAL_REPORT', onReport);
                for (const id of made) {
                    if (blocks.getBlock(id)) blocks.deleteBlock(id);
                }
                blocks.resetCache();
                resolve(result);
            };
            this.runtime.on('VISUAL_REPORT', onReport);
            const thread = this.runtime._pushThread(call.id, preview, {stackClick: true});
            const check = () => {
                if (this.runtime.threads.includes(thread) && thread.status !== Thread.STATUS_DONE &&
                    !thread.isKilled) {
                    return;
                }
                this.runtime.off('AFTER_EXECUTE', check);
                finish();
            };
            this.runtime.on('AFTER_EXECUTE', check);
        });
    }

    /**
     * The blocks of outputs (emit / when it says / their arguments) are shown from a mutation with the words and the
     * ids of the arguments. A file made by hand or by a tool has only the fields, so the mutation is filled in from
     * the outputs the component has.
     * @param {Target} target the sprite whose blocks are shown
     */
    completeOutputBlocks (target) {
        if (!target || !target.blocks) return;
        const blocks = target.blocks._blocks;
        // Where an output can come from: the hat of the script (an argument dragged out of it), or the component the
        // sprite is in (what it says)
        const definitionsFor = block => {
            const list = [];
            if (block.opcode === OUTPUT_HAT) {
                const field = block.fields && block.fields.SPRITE;
                if (field) list.push(this.definitionOf(field.value, target));
                return list;
            }
            if (block.opcode === 'twcomp_outputParam') {
                let hat = block;
                while (hat.parent && blocks[hat.parent]) hat = blocks[hat.parent];
                const field = hat.opcode === OUTPUT_HAT && hat.fields && hat.fields.SPRITE;
                if (field) list.push(this.definitionOf(field.value, target));
            }
            const holder = this.holderOf(target);
            if (holder) list.push(holder.sprite);
            return list;
        };
        const opcodes = [OUTPUT_EMIT, `${OUTPUT_EMIT}AndWait`, OUTPUT_HAT, 'twcomp_outputParam'];
        for (const block of Object.values(blocks)) {
            if (!opcodes.includes(block.opcode) || (block.mutation && block.mutation.port)) continue;
            const port = block.fields && block.fields.PORT && block.fields.PORT.value;
            const paramId = block.fields && block.fields.PARAM && block.fields.PARAM.value;
            let output = null;
            if (port) {
                for (const definition of definitionsFor(block)) {
                    const found = definition && definition.component.outputs.find(o => o.id === port &&
                        (block.opcode !== 'twcomp_outputParam' || o.params.some(p => p.id === paramId)));
                    if (found) {
                        output = found;
                        break;
                    }
                }
            }
            if (!output) continue;
            const mutation = {tagName: 'mutation', children: [], port};
            if (block.opcode === 'twcomp_outputParam') {
                const id = block.fields.PARAM && block.fields.PARAM.value;
                const param = output.params.find(p => p.id === id);
                if (!param) continue;
                mutation.param = id;
                mutation.name = param.name;
                mutation.ptype = param.type;
            } else {
                mutation.proccode = output.proccode;
                mutation.argumentids = JSON.stringify(output.params.map(p => p.id));
                mutation.argumentnames = JSON.stringify(output.params.map(p => p.name));
                if (block.opcode === OUTPUT_HAT) mutation.sprite = block.fields.SPRITE.value;
            }
            block.mutation = mutation;
        }
    }

    // Blocks that use instances

    * allBlocks () {
        for (const target of this.runtime.targets) {
            if (!target.isOriginal) continue;
            for (const block of Object.values(target.blocks._blocks)) {
                if (block.fields) yield [target, block];
            }
        }
    }

    /**
     * @param {Target} target
     * @param {object} block
     * @returns {?string} the instance a block names in its INSTANCE input (a menu), if it is a menu
     */
    instanceFieldOf (target, block) {
        const input = block.inputs && block.inputs.INSTANCE;
        const menu = input && target.blocks.getBlock(input.shadow || input.block);
        if (!menu || !menu.fields) return null;
        const field = Object.values(menu.fields)[0];
        return field ? field.value : null;
    }

    updateFields (fn) {
        for (const [target, block] of this.allBlocks()) {
            fn(block, target);
        }
        for (const target of this.runtime.targets) target.blocks.resetCache();
    }

    /**
     * An instance was renamed: blocks that name it follow.
     * @param {string} oldName
     * @param {string} newName
     */
    renameInstance (oldName, newName) {
        for (const sprite of this.definitions.values()) {
            for (const output of sprite.component.outputs) {
                if (output.forward && output.forward.instance === oldName) output.forward.instance = newName;
            }
        }
        this.updateFields(block => {
            for (const key of ['SPRITE', 'INSTANCE', 'instances']) {
                const field = block.fields[key];
                if (field && field.value === oldName) field.value = newName;
            }
        });
    }
}

module.exports = {
    Components,
    ANY,
    PROP_TYPES,
    PROP_HAT,
    OUTPUT_EMIT,
    OUTPUT_HAT,
    CREATED_HAT,
    argumentTypes,
    normalizeOutput,
    castProp,
    normalizeProp,
    normalizeComponent
};

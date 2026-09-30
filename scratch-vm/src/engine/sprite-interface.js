/**
 * @fileoverview
 * The public interface of a sprite (ROADMAP.md 階段 10): events it sends ("發出 [事件]", with a value or waiting for
 * the scripts that receive it) and the custom blocks it makes public. Other sprites get a category of that sprite,
 * with "when [sprite] [event]" hats and calls of its public custom blocks (the cross-sprite calls of cross-call.js).
 *
 * It belongs to the sprite (shared by its clones) as `sprite.interface`:
 *   {events: [{name: string}], public: [prototype block id of a custom block]}
 * and is saved as `interface` on the sprite in project.json (serialization/3dsb.js). Events are sent in the name of
 * the sprite: "when [sprite] [event]" runs for any clone of it; "觸發的角色" and "觸發的分身 id" say which one sent it.
 */

const HAT = 'twiface_whenEvent';

/** Hat field values of any sprite / instance: `_any_` then the name of the sprite (see step 5 for instances) */
const ANY = '_any_';

/**
 * @param {?object} value
 * @returns {{events: Array<{name: string}>, public: string[]}} a clean interface
 */
const normalize = value => {
    const result = {events: [], public: []};
    if (!value || typeof value !== 'object') return result;
    const names = new Set();
    for (const event of Array.isArray(value.events) ? value.events : []) {
        const name = event && typeof event === 'object' ? String(event.name || '').trim() : String(event || '').trim();
        if (name && !names.has(name)) {
            names.add(name);
            result.events.push({name});
        }
    }
    for (const id of Array.isArray(value.public) ? value.public : []) {
        if (typeof id === 'string' && id && !result.public.includes(id)) result.public.push(id);
    }
    return result;
};

/**
 * @param {?object} iface
 * @returns {boolean} true if there is nothing in it
 */
const isEmpty = iface => !iface || (iface.events.length === 0 && iface.public.length === 0);

/**
 * @param {Sprite} sprite
 * @returns {{events: Array<{name: string}>, public: string[]}} its interface (a new empty one if it has none)
 */
const getInterface = sprite => {
    if (!sprite.interface) sprite.interface = normalize(null);
    return sprite.interface;
};

/**
 * @param {Target} target a sprite
 * @returns {Array<object>} the public custom blocks of the sprite that still exist: {id, proccode, argumentIds,
 * argumentNames, returns}
 */
const publicProcedures = target => {
    if (!target || !target.sprite || !target.sprite.interface) return [];
    const blocks = target.blocks._blocks;
    const parse = text => {
        try {
            const value = JSON.parse(text);
            return Array.isArray(value) ? value : [];
        } catch (e) {
            return [];
        }
    };
    // Custom blocks with a return block in them are reporters, like in scratch-blocks
    const returning = new Set();
    for (const block of Object.values(blocks)) {
        if (block.opcode !== 'procedures_return') continue;
        let top = block;
        const seen = new Set();
        while (top.parent && blocks[top.parent] && !seen.has(top.parent)) {
            seen.add(top.parent);
            top = blocks[top.parent];
        }
        returning.add(top.id);
    }
    return target.sprite.interface.public
        .map(id => blocks[id])
        .filter(block => block && block.opcode === 'procedures_prototype' && block.mutation)
        .map(block => ({
            id: block.id,
            proccode: block.mutation.proccode,
            argumentIds: parse(block.mutation.argumentids),
            argumentNames: parse(block.mutation.argumentnames),
            returns: returning.has(block.parent)
        }));
};

/**
 * Update the fields of blocks in every target: `fn(block)` changes a block and returns true if it did.
 * @param {Runtime} runtime
 * @param {function(object, Target): boolean} fn
 */
const updateBlocks = (runtime, fn) => {
    for (const target of runtime.targets) {
        if (!target.isOriginal) continue;
        let changed = false;
        for (const block of Object.values(target.blocks._blocks)) {
            if (fn(block, target)) changed = true;
        }
        if (changed) target.blocks.resetCache();
    }
};

class SpriteInterfaces {
    constructor (runtime) {
        this.runtime = runtime;
    }

    changed (target) {
        this.runtime.emitProjectChanged();
        this.runtime.requestTargetsUpdate(target);
    }

    /**
     * @param {Target} target
     * @param {string} name
     * @returns {boolean} true if it was added
     */
    addEvent (target, name) {
        name = String(name || '').trim();
        if (!target || !target.sprite || target.isStage || !name) return false;
        const iface = getInterface(target.sprite);
        if (iface.events.some(event => event.name === name)) return false;
        iface.events.push({name});
        this.changed(target);
        return true;
    }

    /**
     * Rename an event, and every block that sends or receives it.
     * @param {Target} target
     * @param {string} oldName
     * @param {string} newName
     * @returns {boolean} true if it was renamed
     */
    renameEvent (target, oldName, newName) {
        newName = String(newName || '').trim();
        if (!target || !target.sprite || !newName) return false;
        const iface = getInterface(target.sprite);
        const event = iface.events.find(e => e.name === oldName);
        if (!event || iface.events.some(e => e.name === newName)) return false;
        event.name = newName;
        const spriteName = target.sprite.name;
        updateBlocks(this.runtime, (block, owner) => {
            if (!block.fields || !block.fields.EVENT || block.fields.EVENT.value !== oldName) return false;
            const sends = /^twiface_emit/.test(block.opcode) && owner.sprite === target.sprite;
            const receives = block.opcode === HAT && block.fields.SPRITE &&
                (block.fields.SPRITE.value === spriteName || block.fields.SPRITE.value === `${ANY}${spriteName}`);
            if (!sends && !receives) return false;
            block.fields.EVENT.value = newName;
            return true;
        });
        this.changed(target);
        this.runtime.emit('BLOCKS_NEED_UPDATE');
        return true;
    }

    /**
     * @param {Target} target
     * @param {string} name
     * @returns {boolean} true if it was removed (blocks using it stay, and do nothing)
     */
    removeEvent (target, name) {
        if (!target || !target.sprite || !target.sprite.interface) return false;
        const iface = target.sprite.interface;
        const index = iface.events.findIndex(event => event.name === name);
        if (index < 0) return false;
        iface.events.splice(index, 1);
        this.changed(target);
        return true;
    }

    /**
     * @param {Target} target
     * @param {string} prototypeId id of the prototype block of one of its custom blocks
     * @param {boolean} isPublic
     */
    setPublic (target, prototypeId, isPublic) {
        if (!target || !target.sprite) return;
        const iface = getInterface(target.sprite);
        const index = iface.public.indexOf(prototypeId);
        if (isPublic && index < 0) iface.public.push(prototypeId);
        else if (!isPublic && index >= 0) iface.public.splice(index, 1);
        else return;
        this.changed(target);
    }

    /**
     * @param {Target} target
     * @param {string} prototypeId
     * @returns {boolean} true if that custom block is public
     */
    isPublic (target, prototypeId) {
        return !!(target && target.sprite && target.sprite.interface &&
            target.sprite.interface.public.includes(prototypeId));
    }

    /**
     * A sprite was renamed: its hats in other sprites follow.
     * @param {string} oldName
     * @param {string} newName
     */
    renameSprite (oldName, newName) {
        updateBlocks(this.runtime, block => {
            if (block.opcode !== HAT || !block.fields || !block.fields.SPRITE) return false;
            const value = block.fields.SPRITE.value;
            if (value === oldName) block.fields.SPRITE.value = newName;
            else if (value === `${ANY}${oldName}`) block.fields.SPRITE.value = `${ANY}${newName}`;
            else return false;
            return true;
        });
    }

    /**
     * @returns {Array<Target>} the sprites (originals) that have an interface
     */
    spritesWithInterface () {
        return this.runtime.targets.filter(target => target.isOriginal && !target.isStage && target.sprite &&
            !isEmpty(target.sprite.interface));
    }

    /**
     * A key that changes whenever an interface or the name of a sprite with one does (for the palette)
     * @returns {string}
     */
    signature () {
        return JSON.stringify(this.spritesWithInterface().map(target => [target.getName(), target.sprite.interface,
            publicProcedures(target).map(p => p.proccode)]));
    }

    /**
     * Send an event.
     * @param {Target} source the sprite or clone sending it
     * @param {string} name the event
     * @param {*} value sent with it
     * @returns {Array<Thread>} the scripts it started
     */
    emit (source, name, value) {
        if (!source || !source.sprite) return [];
        // An instance of a component sends it as itself, and as "any instance" of the component. Members of a
        // component are only heard inside it: by the other members and the instance they are in.
        const spriteName = source.instanceName || source.sprite.name;
        const anyName = `${ANY}${source.sprite.name}`;
        const event = {source, name, value, spriteName};
        const eventName = String(name).toUpperCase();
        const components = this.runtime.components;
        const scope = target => (target ? target.componentOwner || null : null);
        const hears = (receiver, field) => {
            if (field === anyName.toUpperCase()) {
                return scope(receiver) === scope(source) || source.componentOwner === receiver;
            }
            if (field !== spriteName.toUpperCase()) return false;
            const resolved = components.resolveName(receiver, spriteName);
            if (!resolved) return false;
            // The sender may be a clone of it
            return resolved === source || (resolved.sprite === source.sprite && !source.isOriginal &&
                resolved.instanceName === source.instanceName && scope(resolved) === scope(source));
        };
        const receivers = new Map();
        this.runtime.allScriptsByOpcodeDo(HAT, (script, target) => {
            const fields = script.fieldsOfInputs;
            if (!fields.EVENT || fields.EVENT.value !== eventName || !fields.SPRITE) return;
            const field = fields.SPRITE.value;
            if (!hears(target, field)) return;
            if (!receivers.has(target)) receivers.set(target, new Set());
            receivers.get(target).add(field === anyName.toUpperCase() ? anyName : spriteName);
        });
        const threads = [];
        for (const [target, values] of receivers) {
            for (const field of values) {
                threads.push(...(this.runtime.startHats(HAT, {SPRITE: field, EVENT: String(name)}, target) || []));
            }
        }
        for (const thread of threads) thread.interfaceEvent = event;
        return threads;
    }
}

// For the GUI, which reaches this module through runtime.spriteInterfaces
SpriteInterfaces.helpers = {publicProcedures, normalize, isEmpty};

/**
 * @param {Target} target
 * @returns {?object} project.json value of its interface, or null for none
 */
const serialize = target => {
    if (!target.sprite || target.isStage || isEmpty(target.sprite.interface)) return null;
    return JSON.parse(JSON.stringify(target.sprite.interface));
};

module.exports = {
    HAT,
    ANY,
    SpriteInterfaces,
    normalize,
    isEmpty,
    publicProcedures,
    serialize
};

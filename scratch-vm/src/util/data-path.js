/**
 * @fileoverview
 * Data paths: variables whose values can be objects and arrays, read and written with a path string
 * (ROADMAP.md 4.12). Used by the 資料 blocks (extensions/tw_data), the 分身變數 blocks (tw_clone_vars), the 區域變數
 * blocks (tw_local_vars), the text block and the compiler.
 *
 * Which variables a path means comes from the block: 資料 blocks use the variables of the stage (global), 分身變數
 * blocks those of this sprite or clone (self; clones get a copy, see Target.duplicateVariable), 區域變數 blocks those of
 * this call of a custom block (local; outside of custom blocks: of this run of the script). A path can still start
 * with `self.`, `local.` or `global.` to use another scope, e.g. to add an item to a local array with a 資料 block.
 *
 * After the variable's name, `.name` reads a field, `[n]` an item of an array (the first item is 1, like lists),
 * `["a.b"]` a field whose name has dots, brackets or spaces at the ends in it. e.g. `enemies[1].x`
 *
 * Reading a path that doesn't exist gives an empty string. Writing creates the objects and arrays on the way.
 * Values are copied when they are stored (so after `set b to (get a)`, changing b.x doesn't change a), and changed in
 * place when a path goes into them (`set a.x to 1` changes the object in a).
 *
 * `x`, `name`, `position` and the other BUILTINS (all English) are properties of the sprite in the self scope:
 * setting them moves the sprite, switches its costume and so on. Their names can't be used for variables of sprites.
 *
 * Variables are Variable objects of the stage (global) and of sprites (self), found by name. Lists of old projects
 * are list variables whose value is an array; to paths they are the same as other variables.
 */

const Cast = require('./cast');
const Variable = require('../engine/variable');
const uid = require('./uid');

const SCOPES = ['self', 'global', 'local'];

/** Steps of a path: {key: string} for a field, {index: number} (1-based) for an array item */

const NAME_CHARS = /[^.[\]]/;

/**
 * @param {string} text path, trimmed
 * @param {number} start where the steps start
 * @param {boolean} bare true if the first step may be a name without a dot in front of it
 * @returns {?Array<object>} steps, or null if the path is invalid
 */
const parseSteps = (text, start, bare) => {
    const steps = [];
    let i = start;
    let first = true;
    while (i < text.length) {
        const c = text[i];
        if (c === '.' || (first && bare && c !== '[')) {
            if (c === '.') i++;
            const begin = i;
            while (i < text.length && NAME_CHARS.test(text[i])) i++;
            if (i === begin) return null;
            steps.push({key: text.slice(begin, i)});
        } else if (c === '[') {
            i++;
            while (text[i] === ' ') i++;
            const quote = text[i];
            if (quote === '"' || quote === '\'') {
                // A quoted name, which may have dots and brackets in it
                let j = i + 1;
                let key = '';
                while (j < text.length && text[j] !== quote) {
                    if (text[j] === '\\' && j + 1 < text.length) j++;
                    key += text[j];
                    j++;
                }
                if (j >= text.length) return null;
                j++;
                while (text[j] === ' ') j++;
                if (text[j] !== ']') return null;
                steps.push({key});
                i = j + 1;
            } else {
                const end = text.indexOf(']', i);
                if (end < 0) return null;
                const inside = text.slice(i, end).trim();
                const n = Number(inside);
                if (!inside || !Number.isInteger(n) || n < 1) return null;
                steps.push({index: n});
                i = end + 1;
            }
        } else {
            return null;
        }
        first = false;
    }
    return steps;
};

/** A parsed path. Shared: don't change it. */
class ParsedPath {
    /**
     * @param {string} scope 'self', 'global' or 'local'
     * @param {Array<object>} steps {key} or {index}
     */
    constructor (scope, steps) {
        this.scope = scope;
        this.steps = steps;
    }
}

/**
 * @param {{scope: string, steps: Array<object>}} json a path as JSON, e.g. from the compiler
 * @returns {ParsedPath} parsed path
 */
const makePath = json => new ParsedPath(json.scope, json.steps);

const MAX_CACHE = 1000;
const absoluteCache = new Map();
const relativeCache = new Map();

/**
 * @param {Map} cache
 * @param {string} key
 * @param {*} value
 * @returns {*} value
 */
const remember = (cache, key, value) => {
    if (cache.size >= MAX_CACHE) cache.clear();
    cache.set(key, value);
    return value;
};

/**
 * @param {*} path e.g. "enemies[1].x", or "self.hp" with a scope; a parsed path is given back as it is
 * @param {string} [defaultScope] scope of paths that don't start with one: 'global' (default), 'self' or 'local'
 * @returns {?ParsedPath} the parsed path, or null if it is invalid
 */
const parse = (path, defaultScope = 'global') => {
    if (path instanceof ParsedPath) return path;
    if (path === null || typeof path === 'undefined') return null;
    const text = Cast.toString(path).trim();
    const key = `${defaultScope}:${text}`;
    if (absoluteCache.has(key)) return absoluteCache.get(key);
    let result = null;
    const match = /^(self|global|local)(?=$|[.[])/.exec(text);
    const steps = match ? parseSteps(text, match[0].length, false) : parseSteps(text, 0, true);
    // Only a scope may have no steps (the scope itself); the first step is a variable name
    if (steps && (steps.length === 0 ? !!match : steps[0].key !== void 0)) {
        result = new ParsedPath(match ? match[1] : defaultScope, steps);
    }
    return remember(absoluteCache, key, result);
};

/**
 * @param {*} path a path without a scope, e.g. "x", "[1].name" or ".x"; an empty path is the value itself
 * @returns {?Array<object>} steps, or null if it is invalid
 */
const parseRelative = path => {
    if (Array.isArray(path)) return path;
    const text = Cast.toString(path).trim();
    if (relativeCache.has(text)) return relativeCache.get(text);
    return remember(relativeCache, text, parseSteps(text, 0, true));
};

/**
 * @param {?string} scope 'self', 'global' or 'local' to write it in front; null for none
 * @param {string} name variable name
 * @returns {string} path of the variable, e.g. "score", "self.hp" or '["my.var"]'
 */
const variablePath = (scope, name) => {
    name = String(name);
    const plain = name && !/[.[\]]/.test(name) && name.trim() === name;
    if (!scope) return plain && !SCOPES.includes(name) ? name : `[${JSON.stringify(name)}]`;
    return plain ? `${scope}.${name}` : `${scope}[${JSON.stringify(name)}]`;
};

// Values

const isPlainObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A scope as a value: what the self, global and local reporters give. It reads like an object of its variables.
 */
class ScopeRef {
    constructor (scope, target, locals) {
        this.scope = scope;
        this.target = target;
        this.locals = locals;
    }

    toJSON () {
        return snapshotScope(this); // eslint-disable-line no-use-before-define
    }

    toString () {
        return Cast.stringifyObject(this);
    }
}

/**
 * Deep copy of a value, for storing it. Scopes become plain objects.
 * @param {*} value
 * @returns {*} copy
 */
const copyValue = value => {
    if (typeof value !== 'object' || value === null) return value;
    if (value instanceof ScopeRef) return copyValue(value.toJSON());
    if (Array.isArray(value)) {
        const result = new Array(value.length);
        for (let i = 0; i < value.length; i++) result[i] = copyValue(value[i]);
        return result;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        // Not data, e.g. an object of an extension: keep it as it is
        return value;
    }
    const result = {};
    for (const key of Object.keys(value)) result[key] = copyValue(value[key]);
    return result;
};

/**
 * Text that looks like a JSON object or array becomes that object or array, so that typing {"x": 1} into a block that
 * wants an object works.
 * @param {*} value
 * @returns {*} the value, or the parsed object or array
 */
const toValue = value => {
    if (typeof value === 'string') {
        const first = value.trimStart()[0];
        if (first === '{' || first === '[') {
            try {
                return JSON.parse(value);
            } catch (e) {
                return value;
            }
        }
    }
    return value;
};

// Built-in properties of self

const finite = value => Cast.toNumber(value);

const vectorOf = (x, y, z) => ({x, y, z});

/**
 * @param {*} value object with x, y and z, or JSON text of one
 * @param {{x: number, y: number, z: number}} fallback used for missing parts
 * @returns {{x: number, y: number, z: number}} vector
 */
const toVector = (value, fallback) => {
    value = toValue(value);
    if (Array.isArray(value)) value = {x: value[0], y: value[1], z: value[2]};
    const result = Object.assign({x: 0, y: 0, z: 0}, fallback);
    if (isPlainObject(value)) {
        for (const axis of ['x', 'y', 'z']) {
            if (value[axis] !== void 0 && value[axis] !== '') result[axis] = finite(value[axis]);
        }
    }
    return result;
};

const looks = target => target.runtime.ext_scratch3_looks;

// Each built-in: which targets have it, how to read it, how to set it (none: read only)
const BUILTINS = {
    name: {
        has: () => true,
        get: target => target.getName()
    },
    id: {
        has: target => !target.isStage,
        get: target => (target.cloneId === void 0 ? 0 : target.cloneId),
        set: (target, value) => {
            target.cloneId = typeof value === 'object' ? Cast.toString(value) : value;
        }
    },
    x: {
        has: target => !target.isStage,
        get: target => target.x,
        set: (target, value) => target.setXY(finite(value), target.y)
    },
    y: {
        has: target => !target.isStage,
        get: target => target.y,
        set: (target, value) => target.setXY(target.x, finite(value))
    },
    z: {
        has: target => !!target.is3D,
        get: target => target.z,
        set: (target, value) => target.setZ(finite(value))
    },
    visible: {
        has: target => !target.isStage && !target.isCamera,
        get: target => !!target.visible,
        set: (target, value) => target.setVisible(Cast.toBoolean(value))
    },
    direction: {
        has: target => !target.isStage && !target.is3D,
        get: target => target.direction,
        set: (target, value) => target.setDirection(finite(value))
    },
    size: {
        has: target => !target.isStage && !target.is3D,
        get: target => Math.round(target.size),
        set: (target, value) => target.setSize(finite(value))
    },
    costume: {
        has: target => !target.isCamera,
        get: target => {
            if (target.is3D) return target.currentModel + 1;
            return target.currentCostume + 1;
        },
        set: (target, value) => {
            if (target.is3D) {
                const models = target.getModels();
                const index = models.findIndex(model => model.name === Cast.toString(value));
                target.setModel(index >= 0 ? index : finite(value) - 1);
            } else if (target.isStage) {
                looks(target)._setBackdrop(target, value);
            } else {
                looks(target)._setCostume(target, value);
            }
        }
    },
    yaw: {
        has: target => !!target.is3D,
        get: target => target.rotationY,
        set: (target, value) => target.setRotation(target.rotationX, finite(value), target.rotationZ)
    },
    pitch: {
        has: target => !!target.is3D,
        get: target => target.rotationX,
        set: (target, value) => target.setRotation(finite(value), target.rotationY, target.rotationZ)
    },
    roll: {
        has: target => !!target.is3D,
        get: target => target.rotationZ,
        set: (target, value) => target.setRotation(target.rotationX, target.rotationY, finite(value))
    },
    position: {
        has: target => !target.isStage,
        get: target => vectorOf(target.x, target.y, target.is3D ? target.z : 0),
        set: (target, value) => {
            const v = toVector(value, {x: target.x, y: target.y, z: target.is3D ? target.z : 0});
            if (target.is3D) target.setXYZ(v.x, v.y, v.z);
            else target.setXY(v.x, v.y);
        }
    },
    rotation: {
        has: target => !!target.is3D,
        get: target => vectorOf(target.rotationX, target.rotationY, target.rotationZ),
        set: (target, value) => {
            const v = toVector(value, {x: target.rotationX, y: target.rotationY, z: target.rotationZ});
            target.setRotation(v.x, v.y, v.z);
        }
    },
    scale: {
        has: target => !!target.is3D && !target.isCamera,
        get: target => vectorOf(target.scaleX, target.scaleY, target.scaleZ),
        set: (target, value) => {
            const v = toVector(value, {x: target.scaleX, y: target.scaleY, z: target.scaleZ});
            target.setScale(v.x, v.y, v.z);
        }
    },
    model: {
        has: target => !!target.is3D && !target.isCamera,
        get: target => target.currentModel + 1,
        set: (target, value) => BUILTINS.costume.set(target, value)
    },
    fov: {
        has: target => !!target.isCamera,
        get: target => target.fov,
        set: (target, value) => target.setFov(finite(value))
    },
    backdrop: {
        has: target => !!target.isStage,
        get: target => target.currentCostume + 1,
        set: (target, value) => looks(target)._setBackdrop(target, value)
    }
};

/** Names that sprites can't use for their own variables */
const RESERVED_NAMES = Object.keys(BUILTINS);

/**
 * @param {Target} target
 * @param {string} name
 * @returns {?object} the built-in property of that target with that name
 */
const getBuiltin = (target, name) => {
    if (!Object.prototype.hasOwnProperty.call(BUILTINS, name)) return null;
    const builtin = BUILTINS[name];
    return builtin.has(target) ? builtin : null;
};

// Variables

const isDataVariable = variable => variable.type === Variable.SCALAR_TYPE || variable.type === Variable.LIST_TYPE;

/** @type {WeakMap<object, Map<string, Variable>>} target → name → variable */
const variableCaches = new WeakMap();

/**
 * @param {Target} owner
 * @param {string} name
 * @returns {?Variable} the variable (or list) of the target with that name; not the stage's
 */
const findVariable = (owner, name) => {
    let cache = variableCaches.get(owner);
    if (cache) {
        const cached = cache.get(name);
        if (cached && owner.variables[cached.id] === cached && cached.name === name && isDataVariable(cached)) {
            return cached;
        }
    } else {
        cache = new Map();
        variableCaches.set(owner, cache);
    }
    for (const id in owner.variables) {
        const variable = owner.variables[id];
        if (variable.name === name && isDataVariable(variable)) {
            cache.set(name, variable);
            return variable;
        }
    }
    cache.delete(name);
    return null;
};

/**
 * Tell monitors and cloud variables that a variable changed.
 * @param {Target} owner
 * @param {Variable} variable
 */
const variableChanged = (owner, variable) => {
    variable._monitorUpToDate = false;
    if (variable.isCloud && owner.runtime && owner.runtime.ioDevices && owner.runtime.ioDevices.cloud) {
        owner.runtime.ioDevices.cloud.requestUpdateVariable(variable.name, variable.value);
    }
};

// Locals

/** @type {WeakMap<object, Map<string, *>>} thread → locals used outside of any custom block */
const scriptLocals = new WeakMap();

/**
 * The locals of the innermost custom block call of a thread run by the interpreter, found the same way as its
 * parameters. The compiler keeps locals in the generated function instead.
 * @param {Thread} thread
 * @returns {Map<string, *>} the locals
 */
const interpreterLocals = thread => {
    if (!thread) return new Map();
    const frames = thread.stackFrames;
    for (let i = frames.length - 1; i >= 0; i--) {
        const frame = frames[i];
        if (frame.params !== null) {
            if (!frame.locals) frame.locals = new Map();
            return frame.locals;
        }
    }
    let locals = scriptLocals.get(thread);
    if (!locals) {
        locals = new Map();
        scriptLocals.set(thread, locals);
    }
    return locals;
};

// Scopes

/**
 * @param {string} scope
 * @param {Target} target the target running the block
 * @returns {?Target} the target that owns the variables of that scope
 */
const ownerOf = (scope, target) => {
    if (scope === 'global') {
        if (!target.runtime) return null;
        // In a component the globals are those of its root, not the project's
        const root = target.runtime.components && target.runtime.components.globalOwner(target);
        return root || target.runtime.getTargetForStage();
    }
    return target;
};

const MISSING = void 0;

/**
 * @param {ScopeRef} ref
 * @param {string} name
 * @returns {*} the value of the variable or built-in; undefined if there is none
 */
const readScope = (ref, name) => {
    if (ref.scope === 'local') {
        return ref.locals && ref.locals.has(name) ? ref.locals.get(name) : MISSING;
    }
    const owner = ownerOf(ref.scope, ref.target);
    if (!owner) return MISSING;
    if (ref.scope === 'self') {
        const builtin = getBuiltin(owner, name);
        if (builtin) return builtin.get(owner);
    }
    const variable = findVariable(owner, name);
    return variable ? variable.value : MISSING;
};

/**
 * @param {ScopeRef} ref
 * @returns {object} its variables (and built-ins) as a plain object
 */
const snapshotScope = ref => {
    const result = {};
    if (ref.scope === 'local') {
        if (ref.locals) {
            for (const [name, value] of ref.locals) result[name] = copyValue(value);
        }
        return result;
    }
    const owner = ownerOf(ref.scope, ref.target);
    if (!owner) return result;
    if (ref.scope === 'self') {
        for (const name of RESERVED_NAMES) {
            const builtin = getBuiltin(owner, name);
            if (builtin) result[name] = builtin.get(owner);
        }
    }
    for (const id in owner.variables) {
        const variable = owner.variables[id];
        if (isDataVariable(variable) && !Object.prototype.hasOwnProperty.call(result, variable.name)) {
            result[variable.name] = copyValue(variable.value);
        }
    }
    return result;
};

// Steps

/**
 * @param {*} value
 * @param {object} step
 * @returns {*} the part of the value; undefined if there is none
 */
const readStep = (value, step) => {
    if (typeof value !== 'object' || value === null) return MISSING;
    if (value instanceof ScopeRef) {
        return step.key === void 0 ? MISSING : readScope(value, step.key);
    }
    if (step.key === void 0) {
        if (Array.isArray(value)) return value[step.index - 1];
        return Object.prototype.hasOwnProperty.call(value, step.index) ? value[step.index] : MISSING;
    }
    if (Array.isArray(value)) return MISSING;
    return Object.prototype.hasOwnProperty.call(value, step.key) ? value[step.key] : MISSING;
};

/**
 * @param {*} value
 * @param {Array<object>} steps
 * @param {number} from index of the first step to follow
 * @returns {*} the value at the end; undefined if there is none
 */
const readSteps = (value, steps, from) => {
    for (let i = from; i < steps.length && value !== MISSING; i++) value = readStep(value, steps[i]);
    return value;
};

const DELETE = {};

/**
 * Change the value at steps[from..] inside a container, making objects and arrays on the way.
 * @param {*} container
 * @param {Array<object>} steps
 * @param {number} from
 * @param {function(*): *} fn gets the old value (undefined if none), returns the new one, or DELETE
 * @returns {*} the container, or a new one if it had to be made
 */
const updateSteps = (container, steps, from, fn) => {
    const step = steps[from];
    const wantsArray = step.key === void 0;
    if (typeof container !== 'object' || container === null || container instanceof ScopeRef) {
        container = wantsArray ? [] : {};
    } else if (Array.isArray(container) && !wantsArray) {
        // A name in an array: not possible
        return container;
    }
    const last = from === steps.length - 1;
    const old = readStep(container, step);
    const value = last ? fn(old) : updateSteps(old, steps, from + 1, fn);
    if (Array.isArray(container)) {
        const i = step.index - 1;
        if (value === DELETE) {
            if (i < container.length) container.splice(i, 1);
        } else {
            while (container.length < i) container.push('');
            container[i] = value;
        }
    } else {
        const key = wantsArray ? String(step.index) : step.key;
        if (value === DELETE) delete container[key];
        else container[key] = value;
    }
    return container;
};

// Operations on paths

/**
 * Where the first step of a path is: a variable (maybe not made yet), a built-in or a local.
 * @param {Target} target
 * @param {?Map} locals
 * @param {object} parsed
 * @returns {?object} {get(), set(value), remove()}; null if there is nowhere to put it
 */
const rootOf = (target, locals, parsed) => {
    const name = parsed.steps[0].key;
    if (parsed.scope === 'local') {
        if (!locals) return null;
        return {
            get: () => (locals.has(name) ? locals.get(name) : MISSING),
            set: value => locals.set(name, value),
            remove: () => locals.delete(name)
        };
    }
    const owner = ownerOf(parsed.scope, target);
    if (!owner) return null;
    const builtin = parsed.scope === 'self' ? getBuiltin(owner, name) : null;
    if (builtin) {
        return {
            builtin: true,
            get: () => builtin.get(owner),
            set: value => {
                if (builtin.set) builtin.set(owner, value);
            },
            remove: () => {}
        };
    }
    return {
        get: () => {
            const variable = findVariable(owner, name);
            return variable ? variable.value : MISSING;
        },
        set: value => {
            let variable = findVariable(owner, name);
            if (!variable) {
                const id = uid();
                owner.createVariable(id, name, Variable.SCALAR_TYPE);
                variable = owner.variables[id];
            }
            variable.value = value;
            variableChanged(owner, variable);
        },
        remove: () => {
            const variable = findVariable(owner, name);
            if (variable) owner.deleteVariable(variable.id);
        }
    };
};

/**
 * @param {Target} target the target running the block
 * @param {?Map} locals locals of the running custom block call
 * @param {*} path
 * @returns {*} the value; undefined if there is none
 */
const lookup = (target, locals, path) => {
    const parsed = parse(path);
    if (!parsed) return MISSING;
    if (parsed.steps.length === 0) return new ScopeRef(parsed.scope, target, locals);
    const root = rootOf(target, locals, parsed);
    if (!root) return MISSING;
    return readSteps(root.get(), parsed.steps, 1);
};

/**
 * @param {Target} target
 * @param {?Map} locals
 * @param {*} path
 * @param {function(*): *} fn gets the old value, returns the new one (or DELETE)
 */
const update = (target, locals, path, fn) => {
    const parsed = parse(path);
    if (!parsed || parsed.steps.length === 0) return;
    const root = rootOf(target, locals, parsed);
    if (!root) return;
    const old = root.get();
    if (parsed.steps.length === 1) {
        const value = fn(old);
        if (value === DELETE) root.remove();
        else root.set(value);
        return;
    }
    // Built-ins give a new object every time: change a copy and set all of it
    const container = root.builtin ? copyValue(old) : old;
    root.set(updateSteps(container, parsed.steps, 1, fn));
};

const get = (target, locals, path) => {
    const value = lookup(target, locals, path);
    return value === MISSING ? '' : value;
};

const set = (target, locals, path, value) => {
    value = copyValue(value);
    update(target, locals, path, () => value);
};

const change = (target, locals, path, delta) => {
    delta = Cast.toNumber(delta);
    update(target, locals, path, old => Cast.toNumber(old) + delta);
};

const exists = (target, locals, path) => lookup(target, locals, path) !== MISSING;

const remove = (target, locals, path) => {
    const parsed = parse(path);
    if (!parsed || parsed.steps.length === 0) return;
    // Don't make the objects on the way just to delete nothing
    if (!exists(target, locals, parsed)) return;
    update(target, locals, parsed, () => DELETE);
};

/**
 * @param {*} value e.g. what a reporter gave
 * @param {*} path path without a scope
 * @returns {*} the part of the value at that path; '' if there is none
 */
const getFrom = (value, path) => {
    const steps = parseRelative(path);
    if (!steps) return '';
    const result = readSteps(toValue(value), steps, 0);
    return result === MISSING ? '' : result;
};

/**
 * What the blocks that read arrays and objects (length, item, contains...) work on: a path to it, or the value itself.
 * @param {Target} target
 * @param {?Map} locals
 * @param {*} pathOrValue
 * @returns {*} the value
 */
const resolve = (target, locals, pathOrValue) => {
    // Text is the name of a (global) variable; arrays and objects are used as they are
    if (pathOrValue instanceof ParsedPath || (typeof pathOrValue === 'string' && parse(pathOrValue))) {
        return get(target, locals, pathOrValue);
    }
    return toValue(pathOrValue);
};

// Arrays

/**
 * Change the array at a path. A path with nothing (or an empty string) becomes an empty array first; a path with
 * something else isn't changed.
 * @param {Target} target
 * @param {?Map} locals
 * @param {*} path
 * @param {function(Array)} edit changes the array in place
 */
const updateArray = (target, locals, path, edit) => {
    update(target, locals, path, old => {
        if (old === MISSING || old === '') old = [];
        else if (!Array.isArray(old)) return old;
        edit(old);
        return old;
    });
};

const addItem = (target, locals, path, item) => {
    item = copyValue(item);
    updateArray(target, locals, path, array => array.push(item));
};

const insertItem = (target, locals, path, index, item) => {
    item = copyValue(item);
    updateArray(target, locals, path, array => {
        const i = Cast.toListIndex(index, array.length + 1, false);
        if (i !== Cast.LIST_INVALID) array.splice(i - 1, 0, item);
    });
};

const deleteItem = (target, locals, path, index) => {
    updateArray(target, locals, path, array => {
        const i = Cast.toListIndex(index, array.length, true);
        if (i === Cast.LIST_ALL) array.length = 0;
        else if (i !== Cast.LIST_INVALID) array.splice(i - 1, 1);
    });
};

const replaceItem = (target, locals, path, index, item) => {
    item = copyValue(item);
    updateArray(target, locals, path, array => {
        const i = Cast.toListIndex(index, array.length, false);
        if (i !== Cast.LIST_INVALID) array[i - 1] = item;
    });
};

const clear = (target, locals, path) => {
    update(target, locals, path, old => (isPlainObject(old) && !(old instanceof ScopeRef) ? {} : []));
};

const itemOf = (target, locals, pathOrValue, index) => {
    const value = resolve(target, locals, pathOrValue);
    if (Array.isArray(value)) {
        const i = Cast.toListIndex(index, value.length, false);
        return i === Cast.LIST_INVALID ? '' : value[i - 1];
    }
    if (isPlainObject(value) || value instanceof ScopeRef) {
        const result = readStep(value, {key: Cast.toString(index)});
        return result === MISSING ? '' : result;
    }
    return '';
};

const indexOf = (target, locals, pathOrValue, item) => {
    const value = resolve(target, locals, pathOrValue);
    if (!Array.isArray(value)) return 0;
    for (let i = 0; i < value.length; i++) {
        if (Cast.compare(value[i], item) === 0) return i + 1;
    }
    return 0;
};

const length = (target, locals, pathOrValue) => {
    const value = resolve(target, locals, pathOrValue);
    if (Array.isArray(value)) return value.length;
    if (value instanceof ScopeRef) return Object.keys(value.toJSON()).length;
    if (isPlainObject(value)) return Object.keys(value).length;
    return Cast.toString(value).length;
};

const contains = (target, locals, pathOrValue, item) => {
    const value = resolve(target, locals, pathOrValue);
    if (Array.isArray(value)) return indexOf(target, locals, value, item) !== 0;
    if (isPlainObject(value) || value instanceof ScopeRef) {
        return readStep(value, {key: Cast.toString(item)}) !== MISSING;
    }
    return Cast.toString(value).toLowerCase()
        .includes(Cast.toString(item).toLowerCase());
};

const keys = (target, locals, pathOrValue) => {
    const value = resolve(target, locals, pathOrValue);
    if (Array.isArray(value)) return value.map((item, i) => i + 1);
    if (value instanceof ScopeRef) return Object.keys(value.toJSON());
    if (isPlainObject(value)) return Object.keys(value);
    return [];
};

/**
 * The text of an old list reporter: items joined with spaces, or with nothing if all of them are single letters.
 * @param {Target} target
 * @param {?Map} locals
 * @param {*} path
 * @returns {string} text
 */
const listText = (target, locals, path) => {
    const value = get(target, locals, path);
    if (!Array.isArray(value)) return Cast.toString(value);
    // Like TurboWarp's compiled list reporter: numbers count as text, since the compiler turns "3" into 3
    const allSingleLetters = value.every(item => (typeof item !== 'object' || item === null) &&
        String(item).length === 1);
    return value.map(item => Cast.toString(item)).join(allSingleLetters ? '' : ' ');
};

// JSON

const parseJSON = text => {
    if (typeof text === 'object' && text !== null) return copyValue(text);
    try {
        return JSON.parse(Cast.toString(text));
    } catch (e) {
        return '';
    }
};

const isJSON = text => {
    if (typeof text === 'object' && text !== null) return true;
    try {
        JSON.parse(Cast.toString(text));
        return true;
    } catch (e) {
        return false;
    }
};

// Parse once and store the object/array. Invalid JSON and scalar JSON become an empty string.
const setObject = (target, locals, path, text) => {
    const value = parseJSON(text);
    update(target, locals, path, () => (value !== null && typeof value === 'object' ? value : ''));
};

const stringify = (value, pretty) => {
    if (typeof value === 'object' && value !== null) return Cast.stringifyObject(value, pretty);
    return JSON.stringify(value === void 0 ? '' : value);
};

// Text with ${path} in it (the text block)

/**
 * @param {string} text
 * @returns {Array<string|object>} text and parsed paths, in order; a ${…} that isn't a valid path stays text
 */
const parseTemplate = text => {
    text = Cast.toString(text);
    const parts = [];
    let rest = '';
    let i = 0;
    while (i < text.length) {
        const start = text.indexOf('${', i);
        if (start < 0) break;
        const end = text.indexOf('}', start + 2);
        if (end < 0) break;
        const parsed = parse(text.slice(start + 2, end));
        if (parsed) {
            rest += text.slice(i, start);
            if (rest) parts.push(rest);
            rest = '';
            parts.push(parsed);
        } else {
            rest += text.slice(i, end + 1);
        }
        i = end + 1;
    }
    rest += text.slice(i);
    if (rest) parts.push(rest);
    return parts;
};

const templateCache = new Map();

/**
 * @param {Target} target
 * @param {?Map} locals
 * @param {string} text e.g. "hp: ${self.hp}"
 * @returns {string} the text with the values of the paths in it
 */
const fillTemplate = (target, locals, text) => {
    let parts = templateCache.get(text);
    if (!parts) parts = remember(templateCache, text, parseTemplate(text));
    let result = '';
    for (const part of parts) {
        result += typeof part === 'string' ? part : Cast.toString(get(target, locals, part));
    }
    return result;
};

/**
 * @param {Array<string|object>} parts see parseTemplate
 * @returns {boolean} true if some of it reads local variables
 */
const templateUsesLocals = parts => parts.some(part => typeof part === 'object' && part.scope === 'local');

// Clones by id

/**
 * @param {Runtime} runtime
 * @param {?Target} sprite a target of the sprite whose clones to look at; null for every sprite
 * @param {*} id
 * @returns {Array<Target>} clones (not originals) with that id
 */
const clonesWithId = (runtime, sprite, id) => {
    const clones = sprite ? sprite.sprite.clones : runtime.targets;
    return clones.filter(clone => !clone.isOriginal && !clone.isStage && clone.cloneId !== void 0 &&
        Cast.compare(clone.cloneId, id) === 0);
};

/**
 * @param {*} path path in a clone: "hp", "position.x" (or "self.hp")
 * @returns {?ParsedPath} the path in the self scope
 */
const asSelfPath = path => parse(path, 'self');

module.exports = {
    SCOPES,
    RESERVED_NAMES,
    BUILTINS,
    DELETE,
    ScopeRef,
    ParsedPath,
    makePath,
    parse,
    parseRelative,
    variablePath,
    copyValue,
    toValue,
    toVector,
    vectorOf,
    interpreterLocals,
    findVariable,
    get,
    set,
    setObject,
    change,
    exists,
    remove,
    getFrom,
    resolve,
    addItem,
    insertItem,
    deleteItem,
    replaceItem,
    clear,
    itemOf,
    indexOf,
    length,
    contains,
    keys,
    listText,
    parseJSON,
    isJSON,
    stringify,
    parseTemplate,
    fillTemplate,
    templateUsesLocals,
    clonesWithId,
    asSelfPath
};

// Calling a custom block of another sprite right away, in the caller's own thread, like Snap!'s "tell"
// (ROADMAP.md 6.6): "呼叫 [sprite] 的 [function] (arguments…)" and its variants.
//
// The other sprite's custom block runs compiled, as that sprite: `target` (and so self. paths) is the sprite being
// called, and its local variables are new for the call. It runs in the caller's thread, without being scheduled:
// if it waits, the caller waits with it. The blocks remember the custom block by the id of its prototype block, so
// that renaming it keeps them working; deleted custom blocks and sprites make them do nothing.

const Cast = require('../util/cast');

// Which sprites a call goes to
const MODE_SPRITE = 'sprite';
const MODE_EACH = 'each';
const MODE_ID = 'id';

const MYSELF = '_myself_';

// Inputs and fields of the calling blocks that aren't arguments of the custom block
const NOT_ARGUMENTS = ['mutation', 'SPRITE', 'FUNCTION', 'ID'];
const STAGE = '_stage_';

/**
 * @param {string} proccode
 * @param {boolean} warp
 * @returns {string} variant of the procedure, like the compiler's
 */
const procedureVariant = (proccode, warp) => `${warp ? 'W' : 'Z'}${proccode}`;

class CrossCall {
    constructor (runtime) {
        this.runtime = runtime;
    }

    static get MODE_SPRITE () {
        return MODE_SPRITE;
    }

    static get MODE_EACH () {
        return MODE_EACH;
    }

    static get MODE_ID () {
        return MODE_ID;
    }

    /**
     * @param {string} mode MODE_SPRITE: the sprite itself; MODE_EACH: the sprite and each of its clones, in the order
     * they were made; MODE_ID: the clones (and the sprite) whose id is `id`
     * @param {*} spriteName a sprite's name, '_myself_' or '_stage_'
     * @param {*} id see MODE_ID
     * @param {Target} caller the target running the block
     * @returns {Target[]} the targets to call
     */
    resolveTargets (mode, spriteName, id, caller) {
        spriteName = Cast.toString(spriteName);
        let original;
        if (spriteName === STAGE) {
            original = this.runtime.getTargetForStage();
        } else if (spriteName === MYSELF) {
            original = caller && caller.sprite ? caller.sprite.clones[0] : null;
        } else {
            // Members of a component find the other members of it first
            original = this.runtime.components.resolveName(caller, spriteName) ||
                (this.runtime.getTargetForStage() && this.runtime.getTargetForStage().getName() === spriteName ?
                    this.runtime.getTargetForStage() :
                    null);
        }
        if (!original) return [];
        if (mode === MODE_SPRITE) return [original];
        // sprite.clones has the sprite first, then its clones in the order they were made
        // Instances of a component share their sprite: only the clones of this one
        const everyone = original.sprite ? original.sprite.clones.filter(target => target === original ||
            (!target.isOriginal && target.instanceName === original.instanceName &&
                target.componentOwner === original.componentOwner)) : [original];
        if (mode === MODE_EACH) return everyone;
        if (mode === MODE_ID) {
            const wanted = Cast.toString(id);
            return everyone.filter(target => Cast.toString(target.cloneId) === wanted);
        }
        return [];
    }

    /**
     * @param {Target} callee
     * @param {?string} prototypeId id of the custom block's prototype block, which stays the same when it is renamed
     * @param {?string} proccode what the custom block was called when the calling block was made
     * @returns {?{proccode: string, warp: boolean, variant: string, paramIds: string[], paramDefaults: Array}} the
     * custom block, or null if the callee doesn't have it
     */
    resolveProcedure (callee, prototypeId, proccode) {
        const blocks = callee.blocks;
        let prototype = prototypeId ? blocks.getBlock(prototypeId) : null;
        if (!prototype || prototype.opcode !== 'procedures_prototype' || !prototype.mutation) {
            const definitionId = proccode ? blocks.getProcedureDefinition(proccode) : null;
            const definition = definitionId ? blocks.getBlock(definitionId) : null;
            const input = definition && definition.inputs.custom_block;
            prototype = input ? blocks.getBlock(input.block) : null;
        }
        if (!prototype || !prototype.mutation) return null;
        const code = prototype.mutation.proccode;
        const params = blocks.getProcedureParamNamesIdsAndDefaults(code);
        if (!params) return null;
        const warp = prototype.mutation.warp === true || prototype.mutation.warp === 'true';
        return {
            proccode: code,
            warp,
            variant: procedureVariant(code, warp),
            paramIds: params[1],
            paramDefaults: params[2]
        };
    }

    /**
     * Compile the callee's custom block, with the custom blocks it uses. Cached until its blocks change.
     * @param {Target} callee
     * @param {string} variant see procedureVariant
     * @returns {?{factories: object, yields: object, token: object}} factory and whether it yields by variant, or null
     * if it doesn't compile
     */
    getCompiled (callee, variant) {
        const cache = callee.blocks._cache;
        if (!cache.crossCall) cache.crossCall = {};
        const token = cache.crossCall;
        if (!Object.prototype.hasOwnProperty.call(token, variant)) {
            // Required here because the compiler requires the runtime's modules
            const {compileProcedures} = require('../compiler/compile');
            try {
                token[variant] = compileProcedures(callee, variant);
            } catch (error) {
                this.runtime.emitCompileError(callee, error);
                token[variant] = null;
            }
        }
        const compiled = token[variant];
        return compiled ? Object.assign({token}, compiled) : null;
    }

    /**
     * @param {Thread} thread the thread that calls
     * @param {Target} callee
     * @param {object} procedures the callee's bound procedures by variant
     * @returns {Thread} a stand-in for the thread in which `target` is the callee. Everything else, like its status,
     * is the caller's thread, so that waiting in the callee makes the caller wait.
     */
    _makeCalleeThread (thread, callee, procedures) {
        return new Proxy(thread, {
            get: (real, key) => {
                if (key === 'target') return callee;
                if (key === 'procedures') return procedures;
                if (key === 'blockContainer') return callee.blocks;
                return real[key];
            },
            set: (real, key, value) => {
                real[key] = value;
                return true;
            }
        });
    }

    /**
     * Get what calling a custom block of a target runs.
     * @param {Thread} thread the thread that calls
     * @param {Target} callee
     * @param {?string} prototypeId see resolveProcedure
     * @param {?string} proccode see resolveProcedure
     * @param {object} args argument values by argument id; missing ones get their defaults
     * @returns {?{fn: Function, yields: boolean, args: Array}} the compiled custom block, bound to the callee, and its
     * arguments in order; null if there is nothing to call
     */
    prepare (thread, callee, prototypeId, proccode, args) {
        if (!callee || !this.runtime.targets.includes(callee)) return null;
        const procedure = this.resolveProcedure(callee, prototypeId, proccode);
        if (!procedure) return null;
        const compiled = this.getCompiled(callee, procedure.variant);
        if (!compiled || !compiled.factories[procedure.variant]) return null;

        if (!thread.crossCallBindings) thread.crossCallBindings = new WeakMap();
        let binding = thread.crossCallBindings.get(callee);
        if (!binding || binding.token !== compiled.token) {
            const procedures = {};
            binding = {
                token: compiled.token,
                procedures,
                thread: this._makeCalleeThread(thread, callee, procedures)
            };
            thread.crossCallBindings.set(callee, binding);
        }
        for (const variant of Object.keys(compiled.factories)) {
            if (!binding.procedures[variant]) {
                binding.procedures[variant] = compiled.factories[variant](binding.thread);
            }
        }

        const values = procedure.paramIds.map((id, index) => (
            args && Object.prototype.hasOwnProperty.call(args, id) ? args[id] : procedure.paramDefaults[index]
        ));
        const raw = binding.procedures[procedure.variant];
        const yields = !!compiled.yields[procedure.variant];
        // Blocks that the compiler leaves to their functions (extensions) find their target in the thread that
        // runs, so the custom block runs as the thread of the callee, whenever it runs a piece
        const jsexecute = require('../compiler/jsexecute');
        const as = binding.thread;
        const fn = yields ?
            function* (...callArgs) {
                const generator = raw(...callArgs);
                let step = jsexecute.runInThread(as, () => generator.next());
                while (!step.done) {
                    const sent = yield step.value;
                    step = jsexecute.runInThread(as, () => generator.next(sent));
                }
                return step.value;
            } :
            (...callArgs) => jsexecute.runInThread(as, () => raw(...callArgs));
        return {fn, yields, args: values};
    }

    /**
     * Arguments of a calling block by argument id, from what the interpreter passes to its function.
     * @param {object} args the block's inputs and fields
     * @returns {object} argument values by argument id
     */
    static argumentsOf (args) {
        // Every input is an argument, named by the argument's id, except for these
        const values = {};
        for (const name of Object.keys(args)) {
            if (!NOT_ARGUMENTS.includes(name)) values[name] = args[name];
        }
        return values;
    }
}

module.exports = CrossCall;

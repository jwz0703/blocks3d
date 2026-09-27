const Thread = require('../engine/thread');
const Timer = require('../util/timer');
const CrossCall = require('../engine/cross-call');

// How long the interpreter's "從 [sprite] 呼叫 [function]" reporter may run a custom block that waits, in ms
const REPORTER_CALL_TIME = 500;

class Scratch3ProcedureBlocks {
    constructor (runtime) {
        /**
         * The runtime instantiating this block package.
         * @type {Runtime}
         */
        this.runtime = runtime;
    }

    /**
     * Retrieve the block primitives implemented by this package.
     * @return {object.<string, Function>} Mapping of opcode to Function.
     */
    getPrimitives () {
        return {
            procedures_definition: this.definition,
            procedures_call: this.call,
            procedures_return: this.return,
            argument_reporter_string_number: this.argumentReporterStringNumber,
            argument_reporter_boolean: this.argumentReporterBoolean,
            // Custom blocks of other sprites, see engine/cross-call.js. The compiler has its own version.
            procedures_callsprite: (args, util) => this.callSprites(CrossCall.MODE_SPRITE, args, util),
            procedures_callsprite_each: (args, util) => this.callSprites(CrossCall.MODE_EACH, args, util),
            procedures_callsprite_id: (args, util) => this.callSprites(CrossCall.MODE_ID, args, util),
            procedures_callsprite_reporter: this.callSpriteReporter.bind(this)
        };
    }

    definition () {
        // No-op: execute the blocks.
    }

    call (args, util) {
        const stackFrame = util.stackFrame;
        const isReporter = !!args.mutation.return;

        if (stackFrame.executed) {
            if (isReporter) {
                const returnValue = stackFrame.returnValue;
                // This stackframe will be reused for other reporters in this block, so clean it up for them.
                // Can't use reset() because that will reset too much.
                const threadStackFrame = util.thread.peekStackFrame();
                threadStackFrame.params = null;
                threadStackFrame.locals = null;
                delete stackFrame.returnValue;
                delete stackFrame.executed;
                return returnValue;
            }
            return;
        }

        const procedureCode = args.mutation.proccode;
        const paramNamesIdsAndDefaults = util.getProcedureParamNamesIdsAndDefaults(procedureCode);

        // If null, procedure could not be found, which can happen if custom
        // block is dragged between sprites without the definition.
        // Match Scratch 2.0 behavior and noop.
        if (paramNamesIdsAndDefaults === null) {
            if (isReporter) {
                return '';
            }
            return;
        }

        const [paramNames, paramIds, paramDefaults] = paramNamesIdsAndDefaults;

        // Initialize params for the current stackFrame to {}, even if the procedure does
        // not take any arguments. This is so that `getParam` down the line does not look
        // at earlier stack frames for the values of a given parameter (#1729)
        util.initParams();
        // Every call starts with no local variables
        util.thread.peekStackFrame().locals = null;
        for (let i = 0; i < paramIds.length; i++) {
            if (Object.prototype.hasOwnProperty.call(args, paramIds[i])) {
                util.pushParam(paramNames[i], args[paramIds[i]]);
            } else {
                util.pushParam(paramNames[i], paramDefaults[i]);
            }
        }

        const addonBlock = util.runtime.getAddonBlock(procedureCode);
        if (addonBlock) {
            const result = addonBlock.callback(util.thread.getAllparams(), util);
            if (util.thread.status === 1 /* STATUS_PROMISE_WAIT */) {
                // If the addon block is using STATUS_PROMISE_WAIT to force us to sleep,
                // make sure to not re-run this block when we resume.
                stackFrame.executed = true;
            }
            return result;
        }

        stackFrame.executed = true;

        if (isReporter) {
            util.thread.peekStackFrame().waitingReporter = true;
            // Default return value
            stackFrame.returnValue = '';
        }

        util.startProcedure(procedureCode);
    }

    /**
     * @param {string} mode see CrossCall.resolveTargets
     * @param {object} args
     * @param {object} util
     * @returns {Array} the targets to call, and the custom block
     */
    _crossCallPlan (mode, args, util) {
        const mutation = args.mutation || {};
        return {
            targets: this.runtime.crossCall.resolveTargets(mode, args.SPRITE, args.ID, util.target),
            prototypeId: mutation.prototypeid || (args.FUNCTION ? `${args.FUNCTION}` : null),
            proccode: mutation.proccode || null,
            args: CrossCall.argumentsOf(args),
            index: 0,
            generator: null
        };
    }

    /**
     * The interpreter runs the other sprite's compiled custom block a piece at a time, like a block that waits.
     * @param {string} mode see CrossCall.resolveTargets
     * @param {object} args
     * @param {object} util
     */
    callSprites (mode, args, util) {
        const jsexecute = require('../compiler/jsexecute');
        const frame = util.stackFrame;
        if (!frame.crossCall) frame.crossCall = this._crossCallPlan(mode, args, util);
        const plan = frame.crossCall;
        const thread = util.thread;
        for (;;) {
            if (!plan.generator) {
                if (plan.index >= plan.targets.length) {
                    frame.crossCall = null;
                    return;
                }
                const call = this.runtime.crossCall.prepare(thread, plan.targets[plan.index++], plan.prototypeId,
                    plan.proccode, plan.args);
                if (!call) continue;
                if (!call.yields) {
                    jsexecute.runInThread(thread, () => call.fn(...call.args));
                    continue;
                }
                plan.generator = call.fn(...call.args);
            }
            const step = jsexecute.runInThread(thread, () => plan.generator.next());
            if (step.done) {
                plan.generator = null;
                continue;
            }
            // It waits: come back to it later. A promise or the next frame set the thread's status themselves.
            if (thread.status === Thread.STATUS_RUNNING) util.yield();
            return;
        }
    }

    /**
     * Reporters can't wait in the interpreter, so a custom block that waits runs on for at most REPORTER_CALL_TIME.
     * @param {object} args
     * @param {object} util
     * @returns {*} what the custom block returns
     */
    callSpriteReporter (args, util) {
        const jsexecute = require('../compiler/jsexecute');
        const plan = this._crossCallPlan(CrossCall.MODE_SPRITE, args, util);
        const thread = util.thread;
        const call = plan.targets.length ?
            this.runtime.crossCall.prepare(thread, plan.targets[0], plan.prototypeId, plan.proccode, plan.args) :
            null;
        if (!call) return '';
        const status = thread.status;
        const value = jsexecute.runInThread(thread, () => {
            if (!call.yields) return call.fn(...call.args);
            const generator = call.fn(...call.args);
            const timer = new Timer();
            timer.start();
            let step = generator.next();
            while (!step.done && thread.status !== Thread.STATUS_PROMISE_WAIT &&
                timer.timeElapsed() < REPORTER_CALL_TIME) {
                thread.status = Thread.STATUS_RUNNING;
                step = generator.next();
            }
            return step.done ? step.value : '';
        });
        thread.status = status;
        return typeof value === 'undefined' ? '' : value;
    }

    return (args, util) {
        util.stopThisScript();
        // If used outside of a custom block, there may be no stackframe.
        if (util.thread.peekStackFrame()) {
            util.stackFrame.returnValue = args.VALUE;
        }
    }

    argumentReporterStringNumber (args, util) {
        const value = util.getParam(args.VALUE);
        if (value === null) {
            // tw: support legacy block
            if (String(args.VALUE).toLowerCase() === 'last key pressed') {
                return util.ioQuery('keyboard', 'getLastKeyPressed');
            }
            // When the parameter is not found in the most recent procedure
            // call, the default is always 0.
            return 0;
        }
        return value;
    }

    argumentReporterBoolean (args, util) {
        const value = util.getParam(args.VALUE);
        if (value === null) {
            // tw: implement is compiled? and is turbowarp?
            const lowercaseValue = String(args.VALUE).toLowerCase();
            if (util.target.runtime.compilerOptions.enabled && lowercaseValue === 'is compiled?') {
                return true;
            }
            if (lowercaseValue === 'is turbowarp?') {
                return true;
            }
            // When the parameter is not found in the most recent procedure
            // call, the default is always 0.
            return 0;
        }
        return value;
    }
}

module.exports = Scratch3ProcedureBlocks;

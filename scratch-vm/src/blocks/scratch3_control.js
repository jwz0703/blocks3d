const Cast = require('../util/cast');

class Scratch3ControlBlocks {
    constructor (runtime) {
        /**
         * The runtime instantiating this block package.
         * @type {Runtime}
         */
        this.runtime = runtime;

        /**
         * The "counter" block value. For compatibility with 2.0.
         * @type {number}
         */
        this._counter = 0; // used by compiler

        this.runtime.on('RUNTIME_DISPOSED', this.clearCounter.bind(this));
    }

    /**
     * Retrieve the block primitives implemented by this package.
     * @return {object.<string, Function>} Mapping of opcode to Function.
     */
    getPrimitives () {
        return {
            control_repeat: this.repeat,
            control_foreachframe: this.forEachFrame,
            control_foreachframe_deltatime: this.frameDeltaTime,
            control_for_range: this.forRange,
            control_for_range_index: this.forRangeIndex,
            control_repeat_until: this.repeatUntil,
            control_while: this.repeatWhile,
            control_for_each: this.forEach,
            control_forever: this.forever,
            control_wait: this.wait,
            control_wait_until: this.waitUntil,
            control_if: this.if,
            control_if_else: this.ifElse,
            control_stop: this.stop,
            control_create_clone_of: this.createClone,
            control_start_as_clone_id: this.cloneId,
            control_delete_this_clone: this.deleteClone,
            control_get_counter: this.getCounter,
            control_incr_counter: this.incrCounter,
            control_clear_counter: this.clearCounter,
            control_all_at_once: this.allAtOnce,
            control_fold: this.allAtOnce
        };
    }

    getHats () {
        return {
            control_start_as_clone: {
                restartExistingThreads: false
            },
            // "when every frame [update / after update] (dt)", started by Runtime._runFramePhase(). A sprite whose
            // script of the last frame still runs (e.g. waits) skips it this frame.
            control_whenframe: {
                restartExistingThreads: false
            }
        };
    }

    repeat (args, util) {
        const times = Math.round(Cast.toNumber(args.TIMES));
        // Initialize loop
        if (typeof util.stackFrame.loopCounter === 'undefined') {
            util.stackFrame.loopCounter = times;
        }
        // Only execute once per frame.
        // When the branch finishes, `repeat` will be executed again and
        // the second branch will be taken, yielding for the rest of the frame.
        // Decrease counter
        util.stackFrame.loopCounter--;
        // If we still have some left, start the branch.
        if (util.stackFrame.loopCounter >= 0) {
            util.startBranch(1, true);
        }
    }

    repeatUntil (args, util) {
        const condition = Cast.toBoolean(args.CONDITION);
        // If the condition is false (repeat UNTIL), start the branch.
        if (!condition) {
            util.startBranch(1, true);
        }
    }

    repeatWhile (args, util) {
        const condition = Cast.toBoolean(args.CONDITION);
        // If the condition is true (repeat WHILE), start the branch.
        if (condition) {
            util.startBranch(1, true);
        }
    }

    forEach (args, util) {
        const variable = util.target.lookupOrCreateVariable(
            args.VARIABLE.id, args.VARIABLE.name);

        if (typeof util.stackFrame.index === 'undefined') {
            util.stackFrame.index = 0;
        }

        if (util.stackFrame.index < Number(args.VALUE)) {
            util.stackFrame.index++;
            variable.value = util.stackFrame.index;
            util.startBranch(1, true);
        }
    }

    waitUntil (args, util) {
        const condition = Cast.toBoolean(args.CONDITION);
        if (!condition) {
            util.yield();
        }
    }

    forever (args, util) {
        util.startBranch(1, true);
    }

    wait (args, util) {
        if (util.stackTimerNeedsInit()) {
            const duration = Math.max(0, 1000 * Cast.toNumber(args.DURATION));

            util.startStackTimer(duration);
            this.runtime.requestRedraw();
            util.yield();
        } else if (!util.stackTimerFinished()) {
            util.yield();
        }
    }

    if (args, util) {
        const condition = Cast.toBoolean(args.CONDITION);
        if (condition) {
            util.startBranch(1, false);
        }
    }

    ifElse (args, util) {
        const condition = Cast.toBoolean(args.CONDITION);
        if (condition) {
            util.startBranch(1, false);
        } else {
            util.startBranch(2, false);
        }
    }

    stop (args, util) {
        const option = args.STOP_OPTION;
        if (option === 'all') {
            util.stopAll();
        } else if (option === 'other scripts in sprite' ||
            option === 'other scripts in stage') {
            util.stopOtherTargetThreads();
        } else if (option === 'this script') {
            util.stopThisScript();
        }
    }

    createClone (args, util) {
        this._createClone(Cast.toString(args.CLONE_OPTION), util.target, args.ID);
    }

    /**
     * The id parameter of "when I start as a clone": the id the clone was made with (self.id).
     * @param {object} args
     * @param {object} util
     * @returns {*} id; 0 for originals
     */
    cloneId (args, util) {
        return typeof util.target.cloneId === 'undefined' ? 0 : util.target.cloneId;
    }

    /**
     * @param {*} id id given to "create clone of", maybe empty
     * @param {Sprite} sprite sprite of the new clone
     * @returns {*} the clone's id: the given one (numbers as numbers), or the sprite's next number
     */
    _cloneIdFor (id, sprite) {
        if (typeof id === 'undefined' || id === null || id === '') {
            // Numbers start again once every clone is gone, e.g. after the stop sign
            if (sprite.clones.length <= 2 || !sprite.nextCloneId) sprite.nextCloneId = 1;
            return sprite.nextCloneId++;
        }
        if (typeof id === 'string' && id.trim() !== '' && String(Number(id)) === id) return Number(id);
        return typeof id === 'object' ? Cast.toString(id) : id;
    }

    _createClone (cloneOption, target, id) { // used by compiler
        // Set clone target
        let cloneTarget;
        if (cloneOption === '_myself_') {
            cloneTarget = target;
        } else {
            cloneTarget = this.runtime.getSpriteTargetByName(cloneOption);
        }

        // If clone target is not found, return
        if (!cloneTarget) return;

        // Create clone
        const newClone = cloneTarget.makeClone();
        if (newClone) {
            // Before its "when I start as a clone" scripts run, which happens later in this frame
            newClone.cloneId = this._cloneIdFor(id, newClone.sprite);
            this.runtime.addTarget(newClone);

            // Place behind the original target.
            newClone.goBehindOther(cloneTarget);
        }
    }

    deleteClone (args, util) {
        if (util.target.isOriginal) return;
        this.runtime.disposeTarget(util.target);
        this.runtime.stopForTarget(util.target);
    }

    getCounter () {
        return this._counter;
    }

    clearCounter () {
        this._counter = 0;
    }

    incrCounter () {
        this._counter++;
    }

    allAtOnce (args, util) {
        // Since the "all at once" block is implemented for compatiblity with
        // Scratch 2.0 projects, it behaves the same way it did in 2.0, which
        // is to simply run the contained script (like "if 1 = 1").
        // (In early versions of Scratch 2.0, it would work the same way as
        // "run without screen refresh" custom blocks do now, but this was
        // removed before the release of 2.0.)
        util.startBranch(1, false);
    }

    forEachFrame (args, util) {
        // Run the body at most once per frame, even when nothing requests a redraw
        // or when used inside a "run without screen refresh" block.
        const frame = util.stackFrame;
        if (frame.lastFrame === this.runtime.frameCount) {
            util.yieldTick();
            return;
        }
        // Seconds since this loop's previous iteration, read by the dragged-out parameter
        util.thread.frameDelta = typeof frame.lastTime === 'number' ?
            (this.runtime.currentMSecs - frame.lastTime) / 1000 :
            0;
        frame.lastFrame = this.runtime.frameCount;
        frame.lastTime = this.runtime.currentMSecs;
        util.startBranch(1, true);
    }

    frameDeltaTime (args, util) {
        return util.thread.frameDelta || 0;
    }

    forRange (args, util) {
        // "讓 (i) 從 (FROM) 跑到 (TO)": counts by 1 towards TO, both ends included.
        // FROM and TO are read once, when the loop starts.
        const frame = util.stackFrame;
        if (typeof frame.forIndex === 'undefined') {
            frame.forIndex = Cast.toNumber(args.FROM);
            frame.forEnd = Cast.toNumber(args.TO);
            frame.forStep = frame.forIndex <= frame.forEnd ? 1 : -1;
        } else {
            frame.forIndex += frame.forStep;
        }
        if (frame.forStep > 0 ? frame.forIndex <= frame.forEnd : frame.forIndex >= frame.forEnd) {
            util.startBranch(1, true);
        }
    }

    /**
     * @param {Blocks} blocks Block container of the loop.
     * @param {object} loop A "control_for_range" block.
     * @returns {string} Name of the loop's parameter, "i" by default.
     */
    static forRangeName (blocks, loop) {
        const input = loop.inputs.VAR;
        const shadow = input && blocks.getBlock(input.block);
        return shadow && shadow.fields.VALUE ? String(shadow.fields.VALUE.value) : 'i';
    }

    forRangeIndex (args, util) {
        // The dragged-out "i" belongs to the closest "讓 (i) 從 () 跑到 ()" with the same
        // name whose body contains it, like a custom block parameter belongs to its definition.
        const name = typeof args.VALUE === 'string' ? args.VALUE : 'i';
        const thread = util.thread;
        const blocks = thread.blockContainer;
        let childId = thread.peekStack();
        let block = blocks.getBlock(childId);
        let loopId = null;
        while (block && block.parent) {
            const parent = blocks.getBlock(block.parent);
            if (!parent) break;
            if (parent.opcode === 'control_for_range' &&
                parent.inputs.SUBSTACK && parent.inputs.SUBSTACK.block === childId &&
                Scratch3ControlBlocks.forRangeName(blocks, parent) === name) {
                loopId = parent.id;
                break;
            }
            childId = parent.id;
            block = parent;
        }
        if (loopId === null) return 0;
        for (let i = thread.stack.length - 1; i >= 0; i--) {
            if (thread.stack[i] === loopId) {
                const context = thread.stackFrames[i].executionContext;
                return context && typeof context.forIndex === 'number' ? context.forIndex : 0;
            }
        }
        return 0;
    }
}

module.exports = Scratch3ControlBlocks;

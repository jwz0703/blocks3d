// @ts-check

const {IRGenerator} = require('./irgen');
const {IROptimizer} = require('./iroptimizer');
const JSGenerator = require('./jsgen');

const compile = (/** @type {import("../engine/thread")} */ thread) => {
    const irGenerator = new IRGenerator(thread);
    const ir = irGenerator.generate();

    const irOptimizer = new IROptimizer(ir);
    irOptimizer.optimize();

    const procedures = {};
    const target = thread.target;

    const compileScript = (/** @type {import("./intermediate").IntermediateScript} */ script) => {
        if (script.cachedCompileResult) {
            return script.cachedCompileResult;
        }

        const compiler = new JSGenerator(script, ir, target);
        const result = compiler.compile();
        script.cachedCompileResult = result;
        return result;
    };

    const entry = compileScript(ir.entry);

    for (const procedureVariant of Object.keys(ir.procedures)) {
        const procedureData = ir.procedures[procedureVariant];
        const procedureTree = compileScript(procedureData);
        procedures[procedureVariant] = procedureTree;
    }

    return {
        startingFunction: entry,
        procedures,
        executableHat: ir.entry.executableHat
    };
};

/**
 * Compile a custom block of a target on its own, for other sprites to call it (see engine/cross-call.js).
 * @param {import("../sprites/rendered-target")} target the target whose custom block it is
 * @param {string} variant the procedure's variant, e.g. "Zjump %s"
 * @returns {{factories: object, yields: object}} for the custom block and every custom block it uses, by variant:
 * the factory that makes its function for a thread, and whether that function is a generator
 */
const compileProcedures = (target, variant) => {
    const definitionId = target.blocks.getProcedureDefinition(variant.substring(1));
    if (!definitionId) throw new Error(`Cannot find procedure ${variant}`);
    // Stands in for a thread: the IR generator only needs to know whose blocks, and a top block to start from
    const thread = {
        target,
        blockContainer: target.blocks,
        topBlock: definitionId,
        stackClick: false
    };
    const irGenerator = new IRGenerator(thread);
    const ir = irGenerator.generate([variant]);

    const irOptimizer = new IROptimizer(ir);
    const optimized = new Set();
    for (const procedureVariant of Object.keys(ir.procedures)) {
        irOptimizer.optimizeScript(ir.procedures[procedureVariant], optimized);
    }

    const factories = {};
    const yields = {};
    for (const procedureVariant of Object.keys(ir.procedures)) {
        const script = ir.procedures[procedureVariant];
        if (!script.cachedCompileResult) {
            script.cachedCompileResult = new JSGenerator(script, ir, target).compile();
        }
        factories[procedureVariant] = script.cachedCompileResult;
        yields[procedureVariant] = script.yields;
    }
    return {factories, yields};
};

module.exports = compile;
module.exports.compileProcedures = compileProcedures;

// Helpers for the 3D integration tests: build scripts as if dragged in from the palette, and run them.

let nextId = 0;
/**
 * Add a script to a target, as if dragged in from the palette.
 * @param {Target} target where the script goes
 * @param {Array<object>} stack blocks after "when green flag clicked": {opcode, inputs, fields}, where an input is
 * a number or string (in a shadow of the given type), another block, or an array of blocks (a substack), and a field
 * is a value or {value, id}. A block can also have an id and a mutation.
 * @param {object} [hat] the hat block, like the blocks of the stack; "when green flag clicked" by default
 * @returns {string} id of the hat block
 */
const addScript = (target, stack, hat) => {
    const add = (block, parent) => {
        const id = block.id || `b${nextId++}`;
        const inputs = {};
        for (const [name, value] of Object.entries(block.inputs || {})) {
            if (Array.isArray(value)) {
                // A substack, e.g. of "forever"
                let previous = null;
                for (const child of value) {
                    const childId = add(child, previous || id);
                    if (previous) target.blocks.getBlock(previous).next = childId;
                    else inputs[name] = {name, block: childId, shadow: null};
                    previous = childId;
                }
            } else if (value && typeof value === 'object') {
                const child = add(value, id);
                inputs[name] = {name, block: child, shadow: value.shadow ? child : null};
            } else {
                const shadowId = `b${nextId++}`;
                const isNumber = typeof value === 'number';
                target.blocks.createBlock({
                    id: shadowId,
                    opcode: isNumber ? 'math_number' : 'text',
                    parent: id,
                    next: null,
                    shadow: true,
                    topLevel: false,
                    inputs: {},
                    fields: isNumber ? {NUM: {name: 'NUM', value}} : {TEXT: {name: 'TEXT', value}}
                });
                inputs[name] = {name, block: shadowId, shadow: shadowId};
            }
        }
        const fields = {};
        for (const [name, value] of Object.entries(block.fields || {})) {
            fields[name] = value && typeof value === 'object' ? Object.assign({name}, value) : {name, value};
        }
        const created = {
            id: block.id || id,
            opcode: block.opcode,
            parent,
            next: null,
            shadow: !!block.shadow,
            topLevel: !parent,
            inputs,
            fields
        };
        if (block.mutation) created.mutation = Object.assign({tagName: 'mutation', children: []}, block.mutation);
        target.blocks.createBlock(created);
        return created.id;
    };
    const topId = add(hat || {opcode: 'event_whenflagclicked'}, null);
    let previous = topId;
    for (const block of stack) {
        const id = add(block, previous);
        target.blocks.getBlock(previous).next = id;
        previous = id;
    }
    return topId;
};

const menu = (opcode, field, value) => ({opcode, shadow: true, fields: {[field]: value}});

const run = vm => {
    vm.greenFlag();
    for (let i = 0; i < 5; i++) vm.runtime._step();
};

module.exports = {
    addScript,
    menu,
    run
};

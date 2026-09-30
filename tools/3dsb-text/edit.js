/**
 * @fileoverview
 * Changing part of a project from text (the rest stays as it is, with the same block ids), and the round trip test.
 */
const syntax = require('./syntax');
const {TextError} = syntax;
const {dump, deepEqual, TargetWriter} = require('./dump');
const {build, TargetBuilder, IdMaker, idsInText} = require('./build');

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * @param {object} json project.json
 * @param {string} name
 * @returns {object} the target
 */
const findTarget = (json, name) => {
    const target = json.targets.find(t => t.name === name) ||
        (name === '舞台' || name === 'Stage' ? json.targets.find(t => t.isStage) : null);
    if (!target) throw new TextError(`找不到角色「${name}」（有：${json.targets.map(t => t.name).join('、')}）`, 0);
    if (!isObject(target.blocks)) target.blocks = {};
    if (!isObject(target.comments)) target.comments = {};
    return target;
};

/**
 * @param {object} json
 * @param {object} target
 * @returns {string[]} ids of the first blocks of the scripts, numbered like dump numbers them (1 is [0])
 */
const scriptTops = (json, target) => {
    const writer = new TargetWriter(json, target, {defs: {}, ids: true, labels: false, referenced: () => false});
    return writer.scriptTops();
};

/**
 * @param {object} target
 * @param {string} top
 * @returns {string[]} the ids of a script's blocks
 */
const blocksOfScript = (target, top) => {
    const result = [];
    const seen = new Set();
    const walk = id => {
        if (typeof id !== 'string' || seen.has(id) || !Object.prototype.hasOwnProperty.call(target.blocks, id)) return;
        seen.add(id);
        result.push(id);
        const block = target.blocks[id];
        if (!isObject(block)) return;
        walk(block.next);
        for (const input of Object.values(block.inputs || {})) {
            if (Array.isArray(input)) {
                walk(input[1]);
                walk(input[2]);
            }
        }
    };
    walk(top);
    return result;
};

const removeBlocks = (target, ids) => {
    for (const id of ids) {
        const block = target.blocks[id];
        if (isObject(block) && block.comment !== undefined) delete target.comments[block.comment];
        delete target.blocks[id];
    }
};

/**
 * Read a snippet: scripts (each with its "script x y" line), or a few blocks.
 * @param {string} source
 * @returns {Array<object>} scripts: {x, y, special, body, line}
 */
const parseScripts = source => {
    const lines = syntax.splitLines(source);
    if (!lines.length) throw new TextError('片段是空的', 0);
    const indent = Math.min(...lines.map(line => line.indent));
    const first = new syntax.LineReader(lines[0].text, lines[0].line);
    if (first.word() === 'script') {
        // Parse it like a sprite with these scripts
        const text = source.replace(/\r\n?/g, '\n').split('\n')
            .map(line => (line.trim() ? `  ${line.slice(Math.min(indent, line.length - line.trimStart().length))}` : line))
            .join('\n');
        const file = syntax.parse(`sprite "片段"\n${text}`);
        // Line numbers are 1 more than in the snippet because of the added first line
        return shiftLines(file.targets[0].scripts, -1);
    }
    const body = syntax.parseStack(lines.map(line => Object.assign({}, line, {indent: line.indent - indent})));
    return [{special: {}, body, line: lines[0].line}];
};

const parseSnippet = source => {
    const scripts = parseScripts(source);
    if (scripts.length !== 1) throw new TextError(`片段裡應該只有一個 script，卻有 ${scripts.length} 個`, 0);
    return scripts[0];
};

const shiftLines = (node, delta) => {
    if (Array.isArray(node)) {
        node.forEach(item => shiftLines(item, delta));
    } else if (node && typeof node === 'object') {
        if (typeof node.line === 'number') node.line += delta;
        for (const [key, value] of Object.entries(node)) {
            if (key !== 'value' || !Array.isArray(value)) shiftLines(value, delta);
        }
    }
    return node;
};

/**
 * A builder for adding blocks to a target that already has some.
 */
const makeBuilder = (json, target, defs, snippets) => {
    const used = [];
    for (const t of json.targets) {
        used.push(...Object.keys(t.blocks || {}), ...Object.keys(t.comments || {}));
        used.push(...Object.keys(t.variables || {}), ...Object.keys(t.lists || {}), ...Object.keys(t.broadcasts || {}));
    }
    used.push(...idsInText({targets: [{variables: [], lists: [], broadcasts: [], comments: [], rawBlocks: [], scripts: snippets}]}));
    const lines = {};
    const builder = new TargetBuilder({
        defs,
        ids: new IdMaker(used),
        stage: json.targets.find(t => t.isStage),
        lines
    }, target);
    builder.collectProcedures(snippets);
    return {builder, lines};
};

/**
 * Replace a script of a sprite. The script keeps its place unless the snippet has "script x y".
 * @returns {{lines: object, message: string}}
 */
const replaceScript = (json, {defs, sprite, script, snippet}) => {
    const target = findTarget(json, sprite);
    const tops = scriptTops(json, target);
    const top = tops[script - 1];
    if (!top) throw new TextError(`「${sprite}」只有 ${tops.length} 個 script`, 0);
    const parsed = parseSnippet(snippet);
    const old = target.blocks[top];
    if (parsed.x === undefined && isObject(old) && typeof old.x === 'number') {
        parsed.x = old.x;
        parsed.y = old.y;
    }
    const order = Object.keys(target.blocks);
    const oldIds = blocksOfScript(target, top);
    const {builder, lines} = makeBuilder(json, target, defs, [parsed]);
    removeBlocks(target, oldIds);
    builder.buildScript(parsed);
    // The new blocks go where the old script started, so the scripts keep their numbers
    const kept = new Set(order);
    const added = Object.keys(target.blocks).filter(id => !kept.has(id));
    const blocks = {};
    for (const id of order) {
        if (id === top) {
            for (const newId of added) blocks[newId] = target.blocks[newId];
        } else if (Object.prototype.hasOwnProperty.call(target.blocks, id)) {
            blocks[id] = target.blocks[id];
        }
    }
    target.blocks = blocks;
    return {
        lines: {[target.name]: lines},
        message: `已取代「${sprite}」的 script ${script}（${oldIds.length} 個積木 → ${added.length} 個）`
    };
};

/**
 * Add scripts to a sprite, below its other scripts.
 * @param {object} json
 * @param {object} options
 * @param {string} options.snippet scripts in the text format
 * @param {boolean} [options.below] put the scripts below the others even if they say where they are (for scripts
 * compiled from the simplified syntax, which start at 0)
 */
const addScript = (json, {defs, sprite, snippet, below}) => {
    const target = findTarget(json, sprite);
    const scripts = parseScripts(snippet);
    let bottom = -Infinity;
    for (const block of Object.values(target.blocks)) {
        if (isObject(block) && block.topLevel && typeof block.y === 'number') bottom = Math.max(bottom, block.y);
    }
    const start = bottom === -Infinity ? 0 : bottom + 400;
    let y = start;
    for (const script of scripts) {
        if (script.x === undefined) {
            script.x = 0;
            script.y = y;
        } else if (below) {
            script.y += start;
        }
        y = script.y + 400;
    }
    const {builder, lines} = makeBuilder(json, target, defs, scripts);
    const before = scriptTops(json, target).length;
    for (const script of scripts) builder.buildScript(script);
    const numbers = scripts.map((s, i) => before + i + 1).join('、');
    return {
        lines: {[target.name]: lines},
        message: `已在「${sprite}」加上 script ${numbers}（${Object.keys(lines).length} 個積木）`
    };
};

const deleteScript = (json, {sprite, script}) => {
    const target = findTarget(json, sprite);
    const tops = scriptTops(json, target);
    const top = tops[script - 1];
    if (!top) throw new TextError(`「${sprite}」只有 ${tops.length} 個 script`, 0);
    const ids = blocksOfScript(target, top);
    removeBlocks(target, ids);
    return {lines: {}, message: `已刪除「${sprite}」的 script ${script}（${ids.length} 個積木）`};
};

/**
 * Insert blocks after a block of a stack.
 */
const insertAfter = (json, {defs, sprite, after, snippet}) => {
    const target = findTarget(json, sprite);
    const anchor = target.blocks[after];
    if (!isObject(anchor)) throw new TextError(`「${sprite}」沒有 id 為 ${after} 的積木（用 dump --ids 看 id）`, 0);
    const parsed = parseSnippet(snippet);
    if (parsed.x !== undefined) throw new TextError('insert 的片段不要有 script 那一行，只寫積木', parsed.line);
    const {builder, lines} = makeBuilder(json, target, defs, [parsed]);
    const first = builder.buildStack(parsed.body, after, null);
    let last = first;
    while (target.blocks[last].next) last = target.blocks[last].next;
    const oldNext = anchor.next;
    anchor.next = first;
    target.blocks[last].next = oldNext;
    if (oldNext && isObject(target.blocks[oldNext])) target.blocks[oldNext].parent = last;
    return {lines: {[target.name]: lines}, message: `已在 ${after} 後面插入 ${parsed.body.length} 個積木`};
};

/**
 * @returns {string[]} where two values differ (up to `limit`), e.g. "targets[3].blocks.abc.next"
 */
const differences = (a, b, where = '', result = [], limit = 10) => {
    if (result.length >= limit || deepEqual(a, b)) return result;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) {
        result.push(`${where || '(整個)'}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`.substring(0, 300));
        return result;
    }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
        const path = Array.isArray(a) ? `${where}[${key}]` : `${where}${where ? '.' : ''}${key}`;
        if (!(key in a)) result.push(`${path}: 只有轉回來的有`);
        else if (!(key in b)) result.push(`${path}: 轉回來少了`);
        else differences(a[key], b[key], path, result, limit);
        if (result.length >= limit) break;
    }
    return result;
};

/**
 * Project → text → project, with and without block ids.
 * @returns {{ok: boolean, lines: string[]}}
 */
const roundtrip = async (json, defs) => {
    const lines = [];
    let ok = true;
    const count = project => project.targets.reduce((sum, t) => sum + Object.keys(t.blocks || {}).length, 0);

    // With ids: the very same project.json
    const withIds = dump(json, {defs, ids: true});
    const built = build(syntax.parse(withIds), {defs});
    if (built.errors.length) {
        ok = false;
        lines.push(`✗ 有 id：轉回時出錯：${built.errors.map(e => e.message).join('；')}`);
    } else if (deepEqual(built.json, json)) {
        lines.push(`✓ 有 id（--ids）：project.json 完全一樣（${json.targets.length} 個角色，${count(json)} 個積木）`);
    } else {
        ok = false;
        lines.push('✗ 有 id（--ids）：project.json 不一樣：', ...differences(json, built.json).map(d => `    ${d}`));
    }

    // Without ids: the same blocks, with new ids, so the text of the new project is the same text
    const text = dump(json, {defs});
    const again = build(syntax.parse(text), {defs});
    if (again.errors.length) {
        ok = false;
        lines.push(`✗ 沒有 id：轉回時出錯：${again.errors.map(e => e.message).join('；')}`);
    } else {
        const text2 = dump(again.json, {defs});
        if (text2 === text && count(again.json) === count(json)) {
            lines.push(`✓ 沒有 id：積木相同（id 重新產生），再轉成文字完全一樣（${text.split('\n').length} 行）`);
        } else {
            ok = false;
            const a = text.split('\n');
            const b = text2.split('\n');
            const i = a.findIndex((line, n) => line !== b[n]);
            lines.push(`✗ 沒有 id：再轉成文字不一樣（積木 ${count(json)} → ${count(again.json)}），第 ${i + 1} 行：`,
                `    原本：${a[i]}`, `    之後：${b[i]}`);
        }
    }
    return {ok, lines};
};

module.exports = {
    replaceScript,
    addScript,
    deleteScript,
    insertAfter,
    roundtrip,
    differences,
    parseSnippet,
    parseScripts,
    findTarget
};

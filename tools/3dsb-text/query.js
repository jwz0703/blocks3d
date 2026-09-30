/**
 * @fileoverview
 * Questions about a project: how big it is, where a variable or broadcast is used, which blocks it uses.
 */
const {findRefs, DataPath} = require('./data-refs');
const {TargetWriter} = require('./dump');
const model = require('./model');

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Text width, counting CJK characters as two columns
const width = text => [...String(text)].reduce((sum, c) => sum + (/[ᄀ-￿]/.test(c) ? 2 : 1), 0);
const pad = (text, n) => `${text}${' '.repeat(Math.max(0, n - width(text)))}`;

const table = rows => {
    const widths = rows[0].map((cell, i) => Math.max(...rows.map(row => width(row[i]))));
    return rows.map(row => row.map((cell, i) => pad(cell, widths[i])).join('  ')
        .trimEnd()).join('\n');
};

/**
 * @param {object} json
 * @param {object} target
 * @returns {function(string): number} the number of the script (as dump numbers them) a block is in
 */
const scriptNumbers = (json, target) => {
    const tops = new TargetWriter(json, target, {defs: {}, ids: true, labels: false, referenced: () => false}).scriptTops();
    const blocks = target.blocks || {};
    return id => {
        let top = id;
        const seen = new Set();
        while (isObject(blocks[top]) && blocks[top].parent && !seen.has(top)) {
            seen.add(top);
            top = blocks[top].parent;
        }
        return tops.indexOf(top) + 1;
    };
};

/**
 * @param {object} json project.json
 * @param {?string[]} names only these targets
 * @returns {string} the size of every target, and the blocks used most
 */
const stats = (json, names) => {
    const rows = [['角色', '種類', 'script', '積木', '含 shadow', '自訂積木', '變數']];
    const opcodes = {};
    const totals = [0, 0, 0, 0];
    for (const target of model.allTargets(json)) {
        if (names && !names.includes(target.name) && !names.includes(target.title)) continue;
        const blocks = Object.values(target.blocks || {});
        const tops = new TargetWriter(json, target, {defs: {}, ids: true, labels: false, referenced: () => false}).scriptTops();
        const visible = blocks.filter(block => Array.isArray(block) || (isObject(block) && !block.shadow));
        const procedures = blocks.filter(block => isObject(block) && block.opcode === 'procedures_definition').length;
        for (const block of visible) {
            const opcode = Array.isArray(block) ? (block[0] === 12 ? 'data_variable' : 'data_listcontents') : block.opcode;
            opcodes[opcode] = (opcodes[opcode] || 0) + 1;
        }
        const kind = target.isComponent ? '元件' : target.isStage ? '舞台' : ({'3d': '3D', 'camera': '相機', 'canvas': '畫布'}[target.kind] || '2D');
        const variables = Object.keys(target.variables || {}).length + Object.keys(target.lists || {}).length;
        rows.push([target.isComponent ? target.title : target.name, kind, String(tops.length), String(visible.length), String(blocks.length),
            String(procedures), String(variables)]);
        totals[0] += tops.length;
        totals[1] += visible.length;
        totals[2] += blocks.length;
        totals[3] += procedures;
    }
    rows.push(['合計', '', ...totals.map(String), '']);
    const top = Object.entries(opcodes).sort((a, b) => b[1] - a[1])
        .slice(0, 20);
    const lines = [table(rows), '', '最常用的積木：', table(top.map(([opcode, n]) => [`  ${opcode}`, String(n)]))];
    return `${lines.join('\n')}\n`;
};

/**
 * @param {object} json project.json
 * @param {string} name a target, or a component or member of one (model.componentTargets)
 * @returns {string} how to show it
 */
const targetLabel = (json, name) => {
    const target = model.allTargets(json).find(t => t.name === name);
    if (target && target.isComponent) return `元件「${target.title}」`;
    if (target && target.isMember) {
        const component = model.allTargets(json).find(t => t.isComponent && t.name === target.componentId);
        return `元件「${component ? component.title : target.componentId}」的「${target.title}」`;
    }
    return name;
};

/**
 * @param {object} json project.json
 * @param {string} query a variable (a path: name, self.name, local.name), list or broadcast name
 * @param {object} [svgs] SVG costumes by file name, for bindings
 * @returns {string} every place it is used
 */
const refs = (json, query, svgs) => {
    const path = DataPath.parse(query, 'global');
    const scope = path && path.steps.length && path.steps[0].key !== undefined ? path.scope : null;
    const name = scope ? path.steps[0].key : query;
    const found = findRefs(json, svgs).filter(ref => {
        if (ref.kind === 'path') return ref.scope === scope && ref.name === name;
        // An event: 被點到, or 按鈕.被點到 for the one of that sprite
        if (ref.kind === 'event') return ref.name === query || ref.text === query;
        return ref.name === query;
    });
    if (!found.length) return `沒有地方用到「${query}」\n`;
    const numbers = {};
    const rows = [['角色', 'script', '積木', '讀寫', '路徑']];
    for (const ref of found) {
        if (ref.costume !== void 0) {
            rows.push([targetLabel(json, ref.target), '-', `造型「${ref.costume}」第 ${ref.line} 行（綁定）`, '讀', JSON.stringify(ref.text)]);
            continue;
        }
        const target = model.allTargets(json).find(t => t.name === ref.target);
        if (!numbers[ref.target]) numbers[ref.target] = scriptNumbers(json, target);
        let action = ref.write ? '寫' : '讀';
        if (ref.kind === 'broadcast') action = /^event_when/.test(ref.opcode) ? '接收' : '送出';
        if (ref.kind === 'event') action = ref.write ? '發出' : '接收';
        const where = targetLabel(json, ref.target);
        rows.push([where, String(numbers[ref.target](ref.blockId)), ref.opcode, action, JSON.stringify(ref.text)]);
    }
    const kinds = [...new Set(found.map(ref => ({path: {global: '全域變數', self: '分身變數', local: '區域變數'}[ref.scope],
        variable: '舊的變數', list: '清單', broadcast: '廣播', event: '角色事件'}[ref.kind])))];
    return `「${query}」（${kinds.join('、')}）用到 ${found.length} 次：\n${table(rows)}\n`;
};

/**
 * @param {object} json project.json
 * @returns {string} the opcodes of the project and how many times each is used
 */
const opcodes = json => {
    const counts = {};
    for (const target of model.allTargets(json)) {
        for (const block of Object.values(target.blocks || {})) {
            if (!isObject(block)) continue;
            counts[block.opcode] = (counts[block.opcode] || 0) + 1;
        }
    }
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return `${table(rows.map(([opcode, n]) => [opcode, String(n)]))}\n`;
};

module.exports = {
    stats,
    refs,
    opcodes
};

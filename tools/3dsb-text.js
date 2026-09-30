#!/usr/bin/env node
/**
 * @fileoverview
 * Blocks3D project ↔ text, for AI and code review. See tools/3dsb-text/README.md.
 */
const fs = require('fs');
const path = require('path');
const {getDefs} = require('./3dsb-text/vm-host');
const {readProject, readSvgs, writeProject, missingAssets} = require('./3dsb-text/project-file');
const {dump} = require('./3dsb-text/dump');
const syntax = require('./3dsb-text/syntax');
const {build} = require('./3dsb-text/build');
const {check} = require('./3dsb-text/check');
const query = require('./3dsb-text/query');
const edit = require('./3dsb-text/edit');
const simple = require('./3dsb-text/simple');

const USAGE = `用法：node tools/3dsb-text.js <指令> ...

專案 → 文字
  dump <專案.3dsb> [-o 文字.txt] [--ids] [--no-labels] [--sprite 名稱]...
      輸出整個專案（--sprite 只看某些角色；--ids 寫出每個積木的 id，轉回去 id 完全一樣）
  stats <專案.3dsb> [--sprite 名稱]      各角色的 script 與積木數量、用最多的積木
  refs <專案.3dsb> <名稱>                 哪裡用到某個變數（路徑，例如 分數、self.hp、local.i）、清單或廣播
  opcodes <專案.3dsb>                     專案用到的 opcode 與次數

文字 → 專案
  build <文字.txt> [-o 專案.3dsb] [--assets 素材來源.3dsb] [--no-check]
      轉回專案；素材（造型、音效、模型、檔案）從文字開頭 assets 那一行的專案（或 --assets）複製。
      輸出 .json 就只寫 project.json。轉之前會先驗證，有錯就不寫。
  check <文字.txt | 專案.3dsb>            驗證：未知 opcode、選單值、自訂積木、變數、在 VM 裡載入與編譯
  roundtrip <專案.3dsb>                   往返測試：專案 → 文字 → 專案，積木要完全一樣

局部修改（其他部分原封不動，積木 id 不變）
  replace-script <專案.3dsb> --sprite 名稱 --script 編號 <片段.txt> [-o 輸出.3dsb]
  add-script <專案.3dsb> --sprite 名稱 <片段.txt | 程式.b3s> [-o 輸出.3dsb]
  delete-script <專案.3dsb> --sprite 名稱 --script 編號 [-o 輸出.3dsb]
  insert <專案.3dsb> --sprite 名稱 --after 積木id <片段.txt> [-o 輸出.3dsb]
      script 編號是 dump 裡「# script N」的 N；積木 id 用 dump --ids 看。
      片段是 script（有 script x y 那一行；add-script 可以有好幾個）或幾個積木；.b3s 會先編譯。
      -o 省略時覆寫原檔。

簡化語法
  compile <程式.b3s> [-o 片段.txt]         把簡化語法（if a == 1 { ... }）編譯成上面的文字格式
`;

/**
 * @param {string[]} argv
 * @returns {{positional: string[], options: object}}
 */
const parseArgs = argv => {
    const positional = [];
    const options = {sprite: []};
    const flags = new Set(['ids', 'no-labels', 'no-check', 'help']);
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '-o') {
            options.output = argv[++i];
        } else if (arg.startsWith('--')) {
            const name = arg.slice(2);
            if (flags.has(name)) {
                options[name] = true;
            } else if (name === 'sprite') {
                options.sprite.push(argv[++i]);
            } else {
                options[name] = argv[++i];
            }
        } else {
            positional.push(arg);
        }
    }
    return {positional, options};
};

const fail = message => {
    const error = new Error(message);
    error.userFacing = true;
    throw error;
};

const need = (value, what) => {
    if (value === undefined || value === null || value === '') fail(`少了${what}\n\n${USAGE}`);
    return value;
};

const printErrors = (problems, file) => {
    for (const problem of problems) {
        const where = problem.line ? `${file}:${problem.line}: ` : '';
        process.stderr.write(`${problem.level === 'warning' ? '警告' : '錯誤'}：${where}${problem.message}\n`);
    }
};

/**
 * Read a text file and build it.
 * @returns {Promise<object>} {json, lines, problems, file, assetZip}
 */
const buildText = async (textFile, options) => {
    const source = fs.readFileSync(textFile, 'utf8');
    const defs = getDefs();
    let file;
    try {
        file = syntax.parse(source);
    } catch (e) {
        if (!(e instanceof syntax.TextError)) throw e;
        return {problems: [{level: 'error', line: e.line, message: e.reason}]};
    }
    const result = build(file, {defs});
    const problems = result.errors.map(e => ({level: 'error', line: e.line, message: e.reason}));
    let assetZip = null;
    const assets = options.assets || (file.assets && path.resolve(path.dirname(textFile), file.assets));
    if (assets) {
        if (!fs.existsSync(assets)) {
            problems.push({level: 'error', line: 0, message: `找不到素材來源 ${assets}`});
        } else {
            assetZip = (await readProject(assets)).zip;
        }
    }
    if (!options['no-check']) {
        // The VM only gets projects without errors
        const svgs = await readSvgs(result.json, assetZip);
        problems.push(...await check(result.json, {defs, lines: result.lines, vm: !problems.length, svgs}));
        problems.sort((a, b) => (a.line || Infinity) - (b.line || Infinity));
    }
    return Object.assign(result, {problems, file, assetZip});
};

const commands = {
    async dump (positional, options) {
        const input = need(positional[0], '專案檔');
        const {json, zip} = await readProject(input);
        let assets = null;
        // Relative to the text, unless that goes far up
        assets = path.resolve(input);
        if (options.output) {
            const relative = path.relative(path.dirname(path.resolve(options.output)), assets);
            if (!relative.startsWith('../../')) assets = relative;
        }
        const text = dump(json, {
            defs: getDefs(),
            ids: options.ids,
            labels: !options['no-labels'],
            assets,
            svgs: await readSvgs(json, zip),
            targets: options.sprite.length ? options.sprite : null
        });
        if (options.output) fs.writeFileSync(options.output, text);
        else process.stdout.write(text);
    },

    async build (positional, options) {
        const textFile = need(positional[0], '文字檔');
        const result = await buildText(textFile, options);
        printErrors(result.problems, textFile);
        if (result.problems.some(p => p.level === 'error')) process.exit(1);
        const output = options.output || `${textFile.replace(/\.[^.]*$/, '')}.3dsb`;
        if (!options.output && fs.existsSync(output)) {
            fail(`${output} 已經存在；請用 -o 指定輸出檔（可以是同一個檔案）`);
        }
        const missing = missingAssets(result.json, result.assetZip);
        if (missing.length && path.extname(output) !== '.json') {
            process.stderr.write(`警告：素材來源裡沒有這些檔案：${missing.join(', ')}\n`);
        }
        await writeProject(output, result.json, result.assetZip);
        process.stderr.write(`已寫入 ${output}\n`);
    },

    async check (positional, options) {
        const input = need(positional[0], '文字檔或專案檔');
        let problems;
        const data = fs.readFileSync(input);
        const isZip = data[0] === 0x50 && data[1] === 0x4b;
        if (isZip || /\.json$/i.test(input)) {
            const {json, zip} = await readProject(input);
            problems = await check(json, {defs: getDefs(), svgs: await readSvgs(json, zip)});
        } else {
            problems = (await buildText(input, options)).problems;
        }
        printErrors(problems, input);
        const errors = problems.filter(p => p.level !== 'warning').length;
        process.stderr.write(errors ? `${errors} 個錯誤\n` : '沒有錯誤\n');
        if (errors) process.exit(1);
    },

    async roundtrip (positional) {
        const input = need(positional[0], '專案檔');
        const {json} = await readProject(input);
        const report = await edit.roundtrip(json, getDefs());
        for (const line of report.lines) process.stdout.write(`${line}\n`);
        if (!report.ok) process.exit(1);
    },

    async stats (positional, options) {
        const {json} = await readProject(need(positional[0], '專案檔'));
        process.stdout.write(query.stats(json, options.sprite.length ? options.sprite : null));
    },

    async refs (positional) {
        const {json, zip} = await readProject(need(positional[0], '專案檔'));
        process.stdout.write(query.refs(json, need(positional[1], '要找的名稱'), await readSvgs(json, zip)));
    },

    async opcodes (positional) {
        const {json} = await readProject(need(positional[0], '專案檔'));
        process.stdout.write(query.opcodes(json));
    },

    async 'replace-script' (positional, options) {
        await editProject(positional, options, (json, snippet) => edit.replaceScript(json, {
            defs: getDefs(),
            sprite: need(options.sprite[0], ' --sprite'),
            script: Number(need(options.script, ' --script')),
            snippet: need(snippet, '片段檔')
        }), true);
    },

    async 'add-script' (positional, options) {
        // A .b3s program is compiled first
        const compiled = /\.b3s$/i.test(positional[1] || '');
        await editProject(positional, options, (json, snippet) => edit.addScript(json, {
            defs: getDefs(),
            sprite: need(options.sprite[0], ' --sprite'),
            snippet: compiled ? simple.compile(snippet, {defs: getDefs()}) : need(snippet, '片段檔'),
            below: compiled
        }), true);
    },

    async 'delete-script' (positional, options) {
        await editProject(positional, options, json => edit.deleteScript(json, {
            sprite: need(options.sprite[0], ' --sprite'),
            script: Number(need(options.script, ' --script'))
        }), false);
    },

    async insert (positional, options) {
        await editProject(positional, options, (json, snippet) => edit.insertAfter(json, {
            defs: getDefs(),
            sprite: need(options.sprite[0], ' --sprite'),
            after: need(options.after, ' --after'),
            snippet: need(snippet, '片段檔')
        }), true);
    },

    async compile (positional, options) {
        const input = need(positional[0], '程式檔');
        let text;
        try {
            text = simple.compile(fs.readFileSync(input, 'utf8'), {defs: getDefs()});
        } catch (e) {
            if (!(e instanceof syntax.TextError)) throw e;
            printErrors([{level: 'error', line: e.line, message: e.reason}], input);
            process.exit(1);
        }
        if (options.output) fs.writeFileSync(options.output, text);
        else process.stdout.write(text);
    }
};

/**
 * Change a project file in place (or into -o).
 */
const editProject = async (positional, options, change, withSnippet) => {
    const input = need(positional[0], '專案檔');
    const snippetFile = withSnippet ? need(positional[1], '片段檔') : null;
    const {json, zip} = await readProject(input);
    const snippet = snippetFile ? fs.readFileSync(snippetFile, 'utf8') : null;
    let result;
    try {
        result = change(json, snippet);
    } catch (e) {
        if (!(e instanceof syntax.TextError)) throw e;
        printErrors([{level: 'error', line: e.line, message: e.reason}], snippetFile || input);
        process.exit(1);
    }
    const defs = getDefs();
    const problems = await check(json, {defs, lines: result && result.lines});
    printErrors(problems, snippetFile || input);
    if (problems.some(p => p.level !== 'warning')) process.exit(1);
    const output = options.output || input;
    await writeProject(output, json, zip);
    if (result && result.message) process.stderr.write(`${result.message}\n`);
    process.stderr.write(`已寫入 ${output}\n`);
};

const main = async () => {
    const [command, ...rest] = process.argv.slice(2);
    const {positional, options} = parseArgs(rest);
    if (!command || command === 'help' || options.help || !commands[command]) {
        process.stdout.write(USAGE);
        process.exit(command && command !== 'help' && !options.help ? 1 : 0);
    }
    await commands[command](positional, options);
};

main().then(() => process.exit(0), error => {
    process.stderr.write(`${error.userFacing ? error.message : error.stack}\n`);
    process.exit(1);
});

/**
 * @fileoverview
 * The text format of projects (see README.md next to this file): reading it into a tree, and writing the small
 * pieces of it (literals, names).
 *
 * A file is lines. `#` starts a comment (outside strings), which is ignored. Indentation nests: a target's lines are
 * inside `stage` / `sprite`, a script's blocks inside `script`, and the blocks of a C block's stack inside a
 * `SUBSTACK:` line under it. A line continues on the next ones while a ( [ or { is open.
 */

class TextError extends Error {
    /**
     * @param {string} message
     * @param {number} line 1-based line number, or 0 when not known
     */
    constructor (message, line) {
        super(line ? `第 ${line} 行：${message}` : message);
        this.line = line;
        this.reason = message;
    }
}

// Primitive types of sb3 (see serialization/sb3.js) and the name they have in the text
const PRIMITIVE_NAMES = {
    4: 'num',
    5: 'pos',
    6: 'whole',
    7: 'int',
    8: 'angle',
    9: 'color',
    10: 'text',
    11: 'broadcast',
    12: 'var',
    13: 'list'
};
const PRIMITIVE_TYPES = {};
for (const [type, name] of Object.entries(PRIMITIVE_NAMES)) PRIMITIVE_TYPES[name] = Number(type);

const NUMBER = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * @param {string} name
 * @returns {string} the name as the text writes it: bare if it can be, otherwise a JSON string
 */
const writeName = name => (NAME.test(name) ? name : JSON.stringify(name));

// Words that the syntax uses, which opcodes with the same name have to be quoted to not be
const RESERVED = new Set(['define', 'call', 'none', 'prim', 'menu', ...Object.values(PRIMITIVE_NAMES)]);

/**
 * @param {string} opcode
 * @returns {string} the opcode as the text writes it
 */
const writeOpcode = opcode => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(opcode) && !RESERVED.has(opcode) ? opcode : JSON.stringify(opcode));

/**
 * @param {unknown} value the second item of a primitive
 * @returns {string} the argument of num(...) etc.
 */
const writePrimitiveValue = value => (typeof value === 'string' && NUMBER.test(value) ? value : JSON.stringify(value));

/**
 * @param {Array} primitive e.g. [4, "10"]
 * @param {function(Array): boolean} idIsDefault whether the id of a broadcast / variable / list is the one found by
 * its name
 * @returns {string} the literal
 */
const writePrimitive = (primitive, idIsDefault, shadowType) => {
    const [type, value] = primitive;
    const name = PRIMITIVE_NAMES[type];
    if (!name) return `prim(${JSON.stringify(primitive)})`;
    if (type >= 11) {
        if (typeof value !== 'string') return `prim(${JSON.stringify(primitive)})`;
        // broadcast(name, id) / var(name, id) / list(name, id), x and y when it is a script of its own
        const rest = primitive.slice(2);
        if (type === 11 && rest.length !== 1) return `prim(${JSON.stringify(primitive)})`;
        if (type !== 11 && rest.length !== 1 && rest.length !== 3) return `prim(${JSON.stringify(primitive)})`;
        const id = rest[0];
        if (typeof id !== 'string' && id !== null) return `prim(${JSON.stringify(primitive)})`;
        const args = [JSON.stringify(value)];
        if (!idIsDefault(primitive)) args.push(JSON.stringify(id));
        return `${name}(${args.join(', ')})`;
    }
    if (primitive.length !== 2 || typeof value !== 'string') return `prim(${JSON.stringify(primitive)})`;
    // A number or string by itself has the type of the input's shadow (see bareType)
    if (NUMBER.test(value)) {
        if (type === bareType('number', shadowType)) return value;
    } else if (type === bareType('string', shadowType)) {
        return JSON.stringify(value);
    }
    return `${name}(${writePrimitiveValue(value)})`;
};

/**
 * @param {string} kind 'number' or 'string': how a value is written without a type
 * @param {?number} shadowType the primitive type of the input's shadow in the palette (4 to 10), if known
 * @returns {number} the type it has
 */
const bareType = (kind, shadowType) => shadowType || (kind === 'number' ? 4 : 10);

// Reading

/**
 * Split the text into logical lines: {indent, text, line}, without comments and empty lines. A line continues while
 * brackets are open.
 * @param {string} source
 * @returns {Array<{indent: number, text: string, line: number}>}
 */
const splitLines = source => {
    const raw = source.replace(/\r\n?/g, '\n').split('\n');
    const result = [];
    let current = null;
    let depth = 0;
    for (let i = 0; i < raw.length; i++) {
        let text = raw[i];
        // Remove the comment, and count brackets outside strings
        let inString = false;
        let cut = text.length;
        for (let j = 0; j < text.length; j++) {
            const c = text[j];
            if (inString) {
                if (c === '\\') j++;
                else if (c === '"') inString = false;
            } else if (c === '"') {
                inString = true;
            } else if (c === '#') {
                cut = j;
                break;
            } else if (c === '(' || c === '[' || c === '{') {
                depth++;
            } else if (c === ')' || c === ']' || c === '}') {
                depth--;
            }
        }
        if (inString) throw new TextError('字串沒有結束（少了 "）', i + 1);
        text = text.substring(0, cut);
        if (current) {
            current.text += ` ${text.trim()}`;
        } else {
            if (!text.trim()) continue;
            if (/^\t/.test(text)) throw new TextError('縮排請用空白，不要用 tab', i + 1);
            current = {indent: text.length - text.trimStart().length, text: text.trim(), line: i + 1};
        }
        if (depth <= 0) {
            if (depth < 0) throw new TextError('多了右括號', current.line);
            result.push(current);
            current = null;
            depth = 0;
        }
    }
    if (current) throw new TextError('括號沒有關上', current.line);
    return result;
};

/**
 * Reads the pieces of one logical line.
 */
class LineReader {
    constructor (text, line) {
        this.text = text;
        this.pos = 0;
        this.line = line;
    }

    error (message) {
        return new TextError(message, this.line);
    }

    skipSpace () {
        while (this.pos < this.text.length && /\s/.test(this.text[this.pos])) this.pos++;
    }

    atEnd () {
        this.skipSpace();
        return this.pos >= this.text.length;
    }

    peek () {
        this.skipSpace();
        return this.text[this.pos];
    }

    rest () {
        this.skipSpace();
        return this.text.substring(this.pos);
    }

    expect (c) {
        if (this.peek() !== c) {
            throw this.error(`這裡應該是「${c}」，卻是「${this.rest().substring(0, 20) || '行尾'}」`);
        }
        this.pos++;
    }

    tryChar (c) {
        if (this.peek() === c) {
            this.pos++;
            return true;
        }
        return false;
    }

    /**
     * @returns {?string} a bare word (letters, digits, _ and .), or null
     */
    word () {
        this.skipSpace();
        const match = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(this.text.substring(this.pos));
        if (!match) return null;
        this.pos += match[0].length;
        return match[0];
    }

    string () {
        this.skipSpace();
        if (this.text[this.pos] !== '"') throw this.error('這裡應該是字串（"..."）');
        const start = this.pos;
        this.pos++;
        while (this.pos < this.text.length && this.text[this.pos] !== '"') {
            if (this.text[this.pos] === '\\') this.pos++;
            this.pos++;
        }
        this.pos++;
        try {
            return JSON.parse(this.text.substring(start, this.pos));
        } catch (e) {
            throw this.error(`字串寫錯了：${this.text.substring(start, this.pos)}`);
        }
    }

    /**
     * @returns {?string} a number as written, or null
     */
    number () {
        this.skipSpace();
        const match = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/.exec(this.text.substring(this.pos));
        if (!match) return null;
        this.pos += match[0].length;
        return match[0];
    }

    /**
     * @returns {string} a name: a bare word or a string
     */
    name () {
        if (this.peek() === '"') return this.string();
        const word = this.word();
        if (word === null) throw this.error(`這裡應該是名稱，卻是「${this.rest().substring(0, 20) || '行尾'}」`);
        return word;
    }

    /**
     * @returns {*} a JSON value (object, array, string, number, true, false, null)
     */
    json () {
        this.skipSpace();
        const start = this.pos;
        const first = this.text[this.pos];
        if (first === '{' || first === '[') {
            let depth = 0;
            let inString = false;
            for (; this.pos < this.text.length; this.pos++) {
                const c = this.text[this.pos];
                if (inString) {
                    if (c === '\\') this.pos++;
                    else if (c === '"') inString = false;
                } else if (c === '"') {
                    inString = true;
                } else if (c === '{' || c === '[') {
                    depth++;
                } else if (c === '}' || c === ']') {
                    depth--;
                    if (depth === 0) {
                        this.pos++;
                        break;
                    }
                }
            }
        } else if (first === '"') {
            return this.string();
        } else {
            const match = /^(?:-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|true|false|null)/.exec(this.text.substring(this.pos));
            if (!match) throw this.error(`這裡應該是 JSON 值，卻是「${this.rest().substring(0, 20) || '行尾'}」`);
            this.pos += match[0].length;
        }
        const source = this.text.substring(start, this.pos);
        try {
            return JSON.parse(source);
        } catch (e) {
            throw this.error(`JSON 寫錯了：${source.substring(0, 60)}`);
        }
    }
}

/**
 * Read the arguments of a block after its opcode, up to `end` (')' or ']', or the end of the line).
 * @param {LineReader} reader
 * @param {?string} end
 * @returns {object} {inputs, fields, special}
 */
const readArguments = (reader, end) => {
    const inputs = [];
    const fields = [];
    const special = {};
    for (;;) {
        if (end ? reader.peek() === end : reader.atEnd()) break;
        if (reader.atEnd()) throw reader.error(`少了「${end}」`);
        if (reader.tryChar('@')) {
            const key = reader.word();
            if (!key) throw reader.error('@ 後面應該是名稱，例如 @id');
            if (key === 'shadow' || key === 'warp' || key === 'orphan') {
                special[key] = true;
            } else {
                special[key] = reader.json();
            }
            continue;
        }
        const name = reader.name();
        if (reader.tryChar('=')) {
            inputs.push({name, value: readInputValue(reader), line: reader.line});
        } else if (reader.tryChar(':')) {
            if (reader.atEnd() || reader.peek() === end) {
                throw reader.error(`欄位 ${name} 沒有值（「${name}:」單獨一行才是下一層的積木堆）`);
            }
            const value = reader.json();
            let id;
            if (Array.isArray(value)) {
                fields.push({name, raw: value});
                continue;
            }
            if (reader.peek() === '@' && reader.text[reader.pos + 1] === '"') {
                reader.pos++;
                id = reader.json();
            } else if (reader.text.startsWith('@null', reader.pos)) {
                reader.pos += 5;
                id = null;
            }
            fields.push({name, value, id});
        } else {
            throw reader.error(`「${name}」後面應該是 =（輸入）或 :（欄位）`);
        }
    }
    return {inputs, fields, special};
};

/**
 * Read an input: `%N` (optional) then the block, then `|` and the shadow under it (optional).
 * @param {LineReader} reader
 * @returns {object} {type?, block, shadow?}
 */
const readInputValue = reader => {
    let type;
    if (reader.tryChar('%')) {
        const n = reader.number();
        if (!['1', '2', '3'].includes(n)) throw reader.error('% 後面應該是 1、2 或 3');
        type = Number(n);
    }
    const block = readExpression(reader);
    const value = {block};
    if (type) value.type = type;
    if (reader.tryChar('|')) value.shadow = readExpression(reader);
    return value;
};

/**
 * @param {LineReader} reader
 * @returns {object} an expression: a block, a primitive, a menu or none
 */
const readExpression = reader => {
    const c = reader.peek();
    if (c === '(' || c === '[') {
        reader.pos++;
        const end = c === '(' ? ')' : ']';
        const opcode = reader.peek() === '"' ? {quoted: reader.string()} : reader.word();
        if (!opcode) throw reader.error(`「${c}」後面應該是積木的 opcode`);
        const node = readBlockAfterOpcode(reader, opcode, end);
        if (c === '[') node.shadow = true;
        reader.expect(end);
        return node;
    }
    if (c === '"') return {type: 'prim', value: [10, reader.string()], bare: 'string'};
    const number = reader.number();
    if (number !== null) return {type: 'prim', value: [4, number], bare: 'number'};
    const word = reader.word();
    if (word === 'none') return {type: 'none'};
    if (word === null) throw reader.error(`這裡應該是值，卻是「${reader.rest().substring(0, 20) || '行尾'}」`);
    reader.expect('(');
    let result;
    if (word === 'prim') {
        const value = reader.json();
        if (!Array.isArray(value)) throw reader.error('prim(...) 裡面應該是陣列');
        result = {type: 'prim', value};
    } else if (word === 'menu') {
        result = {type: 'menu', value: reader.json()};
    } else if (Object.prototype.hasOwnProperty.call(PRIMITIVE_TYPES, word)) {
        const type = PRIMITIVE_TYPES[word];
        const number = type < 11 ? reader.number() : null;
        const value = number === null ? reader.json() : number;
        const primitive = [type, value];
        if (type >= 11) {
            if (typeof value !== 'string') throw reader.error(`${word}(...) 的名稱應該是字串`);
            if (reader.tryChar(',')) primitive.push(reader.json());
            else primitive.idFromName = true;
        }
        result = {type: 'prim', value: primitive};
    } else {
        throw reader.error(`不認得「${word}(」；值可以是數字、"文字"、(積木)、[shadow 積木]、num() pos() whole() int() angle() color() text() broadcast() var() list() menu() prim() 或 none`);
    }
    reader.expect(')');
    return result;
};

/**
 * @param {LineReader} reader
 * @param {string} opcode
 * @param {?string} end
 * @returns {object} a block node
 */
const readBlockAfterOpcode = (reader, word, end) => {
    const line = reader.line;
    if (typeof word === 'object') {
        // A quoted opcode is always a block's
        const {inputs, fields, special} = readArguments(reader, end);
        return {type: 'block', opcode: word.quoted, inputs, fields, special, line};
    }
    const opcode = word;
    if (opcode === 'define') {
        const proccode = reader.string();
        const argumentNames = [];
        while (reader.peek() === '"') argumentNames.push(reader.string());
        const {special, inputs, fields} = readArguments(reader, end);
        if (inputs.length || fields.length) throw reader.error('define 的後面只能有參數名稱（"..."）和 @warp、@defaults');
        return {type: 'define', proccode, argumentNames, special, line};
    }
    if (opcode === 'call') {
        const proccode = reader.string();
        const {special, inputs, fields} = readArguments(reader, end);
        if (fields.length) throw reader.error('call 的參數要用 名稱=值');
        return {type: 'call', proccode, inputs, special, line};
    }
    const {inputs, fields, special} = readArguments(reader, end);
    return {type: 'block', opcode, inputs, fields, special, line};
};

/**
 * Read a whole file.
 * @param {string} source
 * @returns {object} {version, assets, project: [{key, value, line}], targets: [...]}
 */
const parse = source => {
    const lines = splitLines(source);
    const file = {version: 1, assets: null, project: [], targets: []};
    let i = 0;

    // The lines deeper than `indent`, from i
    const block = indent => {
        const start = i;
        while (i < lines.length && lines[i].indent > indent) i++;
        return lines.slice(start, i);
    };

    while (i < lines.length) {
        const {text, line, indent} = lines[i];
        if (indent !== 0) throw new TextError('這一行不應該縮排', line);
        const reader = new LineReader(text, line);
        const keyword = reader.word();
        i++;
        if (keyword === 'blocks3d-text' || (keyword === 'blocks3d' && reader.tryChar('-') && reader.word() === 'text')) {
            const version = reader.number();
            if (version !== '1') throw new TextError(`不支援的文字格式版本 ${version}`, line);
        } else if (keyword === 'assets') {
            file.assets = reader.string();
        } else if (keyword === 'project') {
            const key = reader.name();
            file.project.push({key, value: reader.json(), line});
        } else if (keyword === 'stage' || keyword === 'sprite' || keyword === 'component' || keyword === 'member') {
            const target = {isStage: keyword === 'stage', isComponent: keyword === 'component',
                isMember: keyword === 'member', name: reader.string(), line};
            if (!reader.atEnd()) throw new TextError(`多了「${reader.rest()}」`, line);
            Object.assign(target, parseTargetBody(block(0)));
            file.targets.push(target);
            continue;
        } else {
            throw new TextError(`不認得「${keyword || text}」；最外層可以是 blocks3d-text、assets、project、stage、sprite、component、member`,
                line);
        }
        if (!reader.atEnd()) throw new TextError(`多了「${reader.rest()}」`, line);
    }
    return file;
};

/**
 * @param {Array} lines the lines inside a target
 * @returns {object} props, variables, lists, broadcasts, comments, scripts, rawBlocks
 */
const parseTargetBody = lines => {
    const result = {props: [], variables: [], lists: [], broadcasts: [], comments: [], scripts: [], rawBlocks: []};
    let i = 0;
    while (i < lines.length) {
        const {text, line, indent} = lines[i];
        const reader = new LineReader(text, line);
        const keyword = reader.word();
        i++;
        const start = i;
        while (i < lines.length && lines[i].indent > indent) i++;
        const inner = lines.slice(start, i);
        if (keyword !== 'script' && inner.length) throw new TextError('這一行下面不應該有縮排的內容', inner[0].line);
        const special = () => readArguments(reader, null).special;
        if (keyword === 'prop') {
            const key = reader.name();
            result.props.push({key, value: reader.json(), line});
        } else if (keyword === 'variable') {
            const name = reader.string();
            const value = reader.json();
            result.variables.push({name, value, special: special(), line});
        } else if (keyword === 'list') {
            const name = reader.string();
            const value = reader.json();
            result.lists.push({name, value, special: special(), line});
        } else if (keyword === 'broadcast') {
            result.broadcasts.push({name: reader.string(), special: special(), line});
        } else if (keyword === 'comment') {
            const value = reader.json();
            result.comments.push({value, special: special(), line});
        } else if (keyword === 'rawblock') {
            const id = reader.string();
            result.rawBlocks.push({id, value: reader.json(), line});
        } else if (keyword === 'script') {
            const script = {line, special: {}};
            const x = reader.number();
            if (x !== null) {
                const y = reader.number();
                if (y === null) throw new TextError('script 後面應該是 x 和 y 兩個數字', line);
                script.x = Number(x);
                script.y = Number(y);
            }
            script.special = special();
            script.body = parseStack(inner, line);
            if (!script.body.length) throw new TextError('script 裡面沒有積木', line);
            result.scripts.push(script);
            continue;
        } else {
            throw new TextError(`不認得「${keyword || text}」；角色裡可以是 prop、variable、list、broadcast、comment、script、rawblock`, line);
        }
        if (!reader.atEnd()) throw new TextError(`多了「${reader.rest()}」`, line);
    }
    return result;
};

/**
 * @param {Array} lines statements of one stack, and what is nested under them
 * @returns {Array<object>} the blocks of the stack, in order
 */
const parseStack = lines => {
    const stack = [];
    let i = 0;
    const indent = lines.length ? lines[0].indent : 0;
    while (i < lines.length) {
        const {text, line} = lines[i];
        if (lines[i].indent !== indent) throw new TextError('縮排和上一個積木對不齊', line);
        i++;
        const start = i;
        while (i < lines.length && lines[i].indent > indent) i++;
        const inner = lines.slice(start, i);
        const node = parseStatement(text, line);
        // Stacks nested under it: "NAME:" lines, each followed by deeper lines
        let j = 0;
        while (j < inner.length) {
            const labelLine = inner[j];
            const match = /^("(?:[^"\\]|\\.)*"|[A-Za-z_][A-Za-z0-9_]*)\s*:$/.exec(labelLine.text);
            if (!match || labelLine.indent !== inner[0].indent) {
                throw new TextError('積木下面應該是「輸入名稱:」（例如 SUBSTACK:），再往下一層才是裡面的積木', labelLine.line);
            }
            const name = match[1].startsWith('"') ? JSON.parse(match[1]) : match[1];
            j++;
            const bodyStart = j;
            while (j < inner.length && inner[j].indent > labelLine.indent) j++;
            const body = inner.slice(bodyStart, j);
            if (!body.length) throw new TextError(`${name}: 下面沒有積木`, labelLine.line);
            if (node.type === 'block' || node.type === 'call') {
                node.inputs.push({name, value: {stack: parseStack(body)}, line: labelLine.line});
            } else {
                throw new TextError('這個積木下面不能有積木堆', labelLine.line);
            }
        }
        stack.push(node);
    }
    return stack;
};

/**
 * @param {string} text
 * @param {number} line
 * @returns {object} a block node, or an expression when a script is only a value (e.g. a variable reporter)
 */
const parseStatement = (text, line) => {
    const reader = new LineReader(text, line);
    const c = reader.peek();
    if (c === '"') return readBlockAfterOpcode(reader, {quoted: reader.string()}, null);
    if (c === '(' || c === '[' || /[-.\d]/.test(c)) {
        const node = readExpression(reader);
        if (!reader.atEnd()) throw reader.error(`多了「${reader.rest()}」`);
        return node;
    }
    const start = reader.pos;
    const opcode = reader.word();
    if (!opcode) throw reader.error(`這裡應該是積木的 opcode，卻是「${reader.rest().substring(0, 20)}」`);
    // A value by itself: var("x") etc.
    if (reader.peek() === '(' && (opcode in PRIMITIVE_TYPES || opcode === 'prim' || opcode === 'menu')) {
        reader.pos = start;
        const node = readExpression(reader);
        if (!reader.atEnd()) throw reader.error(`多了「${reader.rest()}」`);
        return node;
    }
    return readBlockAfterOpcode(reader, opcode, null);
};

module.exports = {
    TextError,
    PRIMITIVE_NAMES,
    PRIMITIVE_TYPES,
    NUMBER,
    writeName,
    writeOpcode,
    writePrimitive,
    bareType,
    parse,
    parseStack,
    splitLines,
    LineReader,
    readExpression
};

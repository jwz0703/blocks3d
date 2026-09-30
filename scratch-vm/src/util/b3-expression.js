/**
 * @fileoverview
 * Expressions of the simplified syntax (.b3s, tools/3dsb-text/simple.js) and of SVG bindings (engine/svg-bindings.js):
 * one tokenizer and one parser, so both read the same language. The parser makes a tree; .b3s turns it into blocks,
 * bindings evaluate it here (no `eval`, and only the functions of BINDING_FUNCTIONS can be called).
 *
 * Values: numbers, "strings", true / false. Variable paths: `分數` (global), `self.hp`, `local.i`, `global.分數`
 * (property of a component), then `.field`, `[1]` or `["key"]` like data paths (util/data-path.js).
 * Operators, loosest first: `c ? a : b`, `or`, `and`, `not`, `== != < > <= >=`, `+ - ++`, `* / %`, unary `-`.
 */

const Cast = require('./cast');

/** Words of the language of expressions; .b3s adds its statements */
const EXPRESSION_KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false']);

class ExpressionError extends Error {
    /**
     * @param {string} message in Chinese, for the user
     * @param {number} line 1-based
     * @param {number} [column] 1-based
     */
    constructor (message, line, column) {
        super(message);
        this.line = line;
        this.column = column;
    }
}

const TWO_CHAR_OPS = ['==', '!=', '<=', '>=', '+=', '-=', '..', '++'];
const ONE_CHAR_OPS = '+-*/%<>=(){}[],.:?';

/**
 * @param {string} source
 * @param {object} [options]
 * @param {Set<string>} [options.keywords] words that are keywords, not names
 * @returns {Array<{type: string, value: ?string, line: number, column: number, offset: number}>} tokens; the last is
 * {type: 'end'}. Types: string, number, name, keyword, op.
 */
const tokenize = (source, options = {}) => {
    const keywords = options.keywords || EXPRESSION_KEYWORDS;
    const tokens = [];
    let line = 1;
    let lineStart = 0;
    let i = 0;
    const push = (type, value, offset) => tokens.push({type, value, line, column: offset - lineStart + 1, offset});
    const error = message => new ExpressionError(message, line, i - lineStart + 1);
    while (i < source.length) {
        const c = source[i];
        if (c === '\n') {
            line++;
            i++;
            lineStart = i;
        } else if (/\s/.test(c)) {
            i++;
        } else if (c === '#') {
            while (i < source.length && source[i] !== '\n') i++;
        } else if (c === '\'') {
            // 'text' too, for strings inside SVG attributes written with ""
            let j = i + 1;
            let value = '';
            while (j < source.length && source[j] !== '\'') {
                if (source[j] === '\n') throw error('字串沒有結束（少了 \'）');
                if (source[j] === '\\' && j + 1 < source.length) {
                    j++;
                    value += source[j] === 'n' ? '\n' : source[j];
                } else {
                    value += source[j];
                }
                j++;
            }
            if (j >= source.length) throw error('字串沒有結束（少了 \'）');
            push('string', value, i);
            i = j + 1;
        } else if (c === '"') {
            let j = i + 1;
            while (j < source.length && source[j] !== '"') {
                if (source[j] === '\\') j++;
                if (source[j] === '\n') throw error('字串沒有結束（少了 "）');
                j++;
            }
            if (j >= source.length) throw error('字串沒有結束（少了 "）');
            let value;
            try {
                value = JSON.parse(source.slice(i, j + 1));
            } catch (e) {
                throw error(`字串寫錯了：${source.slice(i, j + 1)}`);
            }
            push('string', value, i);
            i = j + 1;
        } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(source[i + 1]))) {
            // 1..5 is a range, so a number's dot needs a digit after it
            const match = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?/.exec(source.slice(i));
            push('number', match[0], i);
            i += match[0].length;
        } else if (/[A-Za-z_À-￿]/.test(c)) {
            const match = /^[A-Za-z_À-￿][A-Za-z0-9_À-￿]*/.exec(source.slice(i));
            push(keywords.has(match[0]) ? 'keyword' : 'name', match[0], i);
            i += match[0].length;
        } else {
            const two = source.slice(i, i + 2);
            if (TWO_CHAR_OPS.includes(two)) {
                push('op', two, i);
                i += 2;
            } else if (ONE_CHAR_OPS.includes(c)) {
                push('op', c, i);
                i++;
            } else {
                throw error(`不認得的字元「${c}」`);
            }
        }
    }
    tokens.push({type: 'end', value: null, line, column: i - lineStart + 1, offset: i});
    return tokens;
};

/**
 * Reads expressions from tokens. .b3s keeps using the same object for its statements (pos moves as it reads).
 */
class ExpressionParser {
    constructor (tokens) {
        this.tokens = tokens;
        this.pos = 0;
    }

    peek (offset = 0) {
        return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
    }

    next () {
        return this.tokens[this.pos++];
    }

    is (type, value) {
        const token = this.peek();
        return token.type === type && (typeof value === 'undefined' || token.value === value);
    }

    accept (type, value) {
        if (this.is(type, value)) return this.next();
        return null;
    }

    expect (type, value, what) {
        if (this.is(type, value)) return this.next();
        const token = this.peek();
        const got = token.type === 'end' ? '結尾' : `「${token.value}」`;
        throw this.error(`這裡應該是${what || `「${value}」`}，卻是${got}`, token);
    }

    error (message, token = this.peek()) {
        return new ExpressionError(message, token.line, token.column);
    }

    /**
     * @returns {object} tree of the expression. Nodes: {type: 'number', value: string}, {type: 'string', value},
     * {type: 'boolean', value}, {type: 'path', scope, name, text}, {type: 'unary', op, operand},
     * {type: 'binary', op, left, right}, {type: 'conditional', test, then, otherwise},
     * {type: 'call', name, args: [{name: ?string, value, token}]}. Every node has its first token as `token`.
     */
    parseExpression () {
        const token = this.peek();
        const test = this.or();
        if (!this.accept('op', '?')) return test;
        const then = this.parseExpression();
        this.expect('op', ':', '「:」（條件 ? 值 : 另一個值）');
        const otherwise = this.parseExpression();
        return {type: 'conditional', test, then, otherwise, token};
    }

    binaryLevel (operators, operand) {
        const token = this.peek();
        let left = operand();
        for (;;) {
            const op = this.peek();
            if (!((op.type === 'op' || op.type === 'keyword') && operators.includes(op.value))) return left;
            this.next();
            left = {type: 'binary', op: op.value, left, right: operand(), token};
        }
    }

    or () {
        return this.binaryLevel(['or'], () => this.and());
    }

    and () {
        return this.binaryLevel(['and'], () => this.not());
    }

    not () {
        const token = this.peek();
        if (this.accept('keyword', 'not')) return {type: 'unary', op: 'not', operand: this.not(), token};
        return this.comparison();
    }

    comparison () {
        const token = this.peek();
        const left = this.sum();
        const op = this.peek();
        if (op.type !== 'op' || !['==', '!=', '<', '>', '<=', '>='].includes(op.value)) return left;
        this.next();
        return {type: 'binary', op: op.value, left, right: this.sum(), token};
    }

    sum () {
        return this.binaryLevel(['+', '-', '++'], () => this.term());
    }

    term () {
        return this.binaryLevel(['*', '/', '%'], () => this.unary());
    }

    unary () {
        const token = this.peek();
        if (this.accept('op', '-')) {
            const operand = this.unary();
            if (operand.type === 'number') {
                const value = operand.value.startsWith('-') ? operand.value.slice(1) : `-${operand.value}`;
                return {type: 'number', value, token};
            }
            return {type: 'unary', op: '-', operand, token};
        }
        return this.primary();
    }

    primary () {
        const token = this.peek();
        if (this.accept('op', '(')) {
            const value = this.parseExpression();
            this.expect('op', ')');
            return value;
        }
        if (token.type === 'number') return {type: 'number', value: this.next().value, token};
        if (token.type === 'string') return {type: 'string', value: this.next().value, token};
        if (this.accept('keyword', 'true')) return {type: 'boolean', value: true, token};
        if (this.accept('keyword', 'false')) return {type: 'boolean', value: false, token};
        if (token.type === 'name') {
            if (this.peek(1).type === 'op' && this.peek(1).value === '(') {
                this.next();
                return {type: 'call', name: token.value, args: this.parseArguments(), token};
            }
            return this.path();
        }
        throw this.error(`這裡應該是值，卻是「${token.value === null ? '結尾' : token.value}」`);
    }

    /**
     * A variable path: name, then .field, [n] or ["key"]; self. and local. are the scopes (global. is the default).
     * @returns {{type: 'path', scope: string, name: string, text: string, steps: boolean, token: object}} name is
     * the path without the scope; steps is true if there is more than a name
     */
    path () {
        const token = this.expect('name', void 0, '變數名稱');
        let text = token.value;
        let steps = false;
        while (this.is('op', '.') || this.is('op', '[')) {
            steps = true;
            if (this.accept('op', '.')) {
                const part = this.next();
                if (part.type !== 'name' && part.type !== 'keyword') throw this.error('「.」後面應該是名稱', part);
                text += `.${part.value}`;
            } else {
                this.next();
                const part = this.next();
                if (part.type === 'number') text += `[${part.value}]`;
                else if (part.type === 'string') text += `[${JSON.stringify(part.value)}]`;
                else throw this.error('路徑的 [ ] 裡只能是數字或 "文字"', part);
                this.expect('op', ']');
            }
        }
        const match = /^(self|local)\.(.+)$/.exec(text);
        if (match) return {type: 'path', scope: match[1], name: match[2], text, steps, token};
        return {type: 'path', scope: 'global', name: text, text, steps, token};
    }

    /**
     * The arguments in ( ): values, or NAME: value
     * @returns {Array<{name: ?string, value: object, token: object}>}
     */
    parseArguments () {
        this.expect('op', '(');
        const args = [];
        if (this.accept('op', ')')) return args;
        do {
            const token = this.peek();
            let name = null;
            const named = token.type === 'name' || token.type === 'keyword';
            if (named && this.peek(1).type === 'op' && this.peek(1).value === ':') {
                name = token.value;
                this.pos += 2;
            }
            args.push({name, value: this.parseExpression(), token});
        } while (this.accept('op', ','));
        this.expect('op', ')');
        return args;
    }
}

/**
 * @param {string} source one expression
 * @returns {object} its tree
 * @throws {ExpressionError}
 */
const parse = source => {
    const parser = new ExpressionParser(tokenize(source));
    const tree = parser.parseExpression();
    if (!parser.is('end')) throw parser.error(`多了「${parser.peek().value}」`);
    return tree;
};

// Evaluating (bindings)

const isNumeric = value => {
    if (typeof value === 'number') return true;
    if (typeof value === 'boolean') return false;
    if (typeof value !== 'string' || Cast.isWhiteSpace(value)) return false;
    return !isNaN(Number(value));
};

const num = Cast.toNumber;
const degrees = Math.PI / 180;

/** Functions that bindings can call: name → [number of arguments, function] */
const BINDING_FUNCTIONS = {
    min: [2, (a, b) => Math.min(num(a), num(b))],
    max: [2, (a, b) => Math.max(num(a), num(b))],
    clamp: [3, (v, lo, hi) => Math.min(Math.max(num(v), num(lo)), num(hi))],
    lerp: [3, (a, b, t) => num(a) + ((num(b) - num(a)) * num(t))],
    abs: [1, v => Math.abs(num(v))],
    round: [1, v => Math.round(num(v))],
    floor: [1, v => Math.floor(num(v))],
    ceil: [1, v => Math.ceil(num(v))],
    sqrt: [1, v => Math.sqrt(num(v))],
    // Degrees, like the blocks
    sin: [1, v => Math.round(Math.sin(num(v) * degrees) * 1e10) / 1e10],
    cos: [1, v => Math.round(Math.cos(num(v) * degrees) * 1e10) / 1e10],
    atan2: [2, (y, x) => Math.atan2(num(y), num(x)) / degrees],
    length: [1, v => (Array.isArray(v) ? v.length : Cast.toString(v).length)],
    join: [2, (a, b) => Cast.toString(a) + Cast.toString(b)]
};

/**
 * @param {object} tree from parse()
 * @returns {?ExpressionError} an error if it calls functions that bindings don't have
 */
const checkBinding = tree => {
    let error = null;
    const visit = node => {
        if (error || !node) return;
        if (node.type === 'call') {
            const fn = BINDING_FUNCTIONS[node.name];
            if (!fn) {
                error = new ExpressionError(`沒有函式「${node.name}」（可以用：${Object.keys(BINDING_FUNCTIONS).join(' ')}）`,
                    node.token.line, node.token.column);
                return;
            }
            if (node.args.length !== fn[0]) {
                error = new ExpressionError(`${node.name} 要 ${fn[0]} 個值，卻給了 ${node.args.length} 個`, node.token.line,
                    node.token.column);
                return;
            }
            node.args.forEach(arg => visit(arg.value));
        } else if (node.type === 'path' && node.scope === 'local') {
            error = new ExpressionError('綁定裡不能用 local. 變數（只有全域和 self.）', node.token.line, node.token.column);
        }
        visit(node.operand);
        visit(node.left);
        visit(node.right);
        visit(node.test);
        visit(node.then);
        visit(node.otherwise);
    };
    visit(tree);
    return error;
};

/**
 * @param {object} tree from parse()
 * @param {function(object): *} read gives the value of a path node
 * @returns {*} the value
 */
const evaluate = (tree, read) => {
    const ev = node => {
        switch (node.type) {
        case 'number': return Number(node.value);
        case 'string': return node.value;
        case 'boolean': return node.value;
        case 'path': return read(node);
        case 'unary':
            if (node.op === 'not') return !Cast.toBoolean(ev(node.operand));
            return -num(ev(node.operand));
        case 'conditional':
            return Cast.toBoolean(ev(node.test)) ? ev(node.then) : ev(node.otherwise);
        case 'call': {
            const fn = BINDING_FUNCTIONS[node.name];
            if (!fn) throw new ExpressionError(`沒有函式「${node.name}」`, node.token.line, node.token.column);
            return fn[1](...node.args.map(arg => ev(arg.value)));
        }
        case 'binary': {
            if (node.op === 'and') return Cast.toBoolean(ev(node.left)) && Cast.toBoolean(ev(node.right));
            if (node.op === 'or') return Cast.toBoolean(ev(node.left)) || Cast.toBoolean(ev(node.right));
            const a = ev(node.left);
            const b = ev(node.right);
            switch (node.op) {
            case '+':
                // Numbers add; anything else (text) is joined
                if (isNumeric(a) && isNumeric(b)) return num(a) + num(b);
                return Cast.toString(a) + Cast.toString(b);
            case '++': return Cast.toString(a) + Cast.toString(b);
            case '-': return num(a) - num(b);
            case '*': return num(a) * num(b);
            case '/': return num(a) / num(b);
            case '%': {
                const n = num(a);
                const m = num(b);
                const r = n % m;
                return r / m < 0 ? r + m : r;
            }
            case '==': return Cast.compare(a, b) === 0;
            case '!=': return Cast.compare(a, b) !== 0;
            case '<': return Cast.compare(a, b) < 0;
            case '>': return Cast.compare(a, b) > 0;
            case '<=': return Cast.compare(a, b) <= 0;
            case '>=': return Cast.compare(a, b) >= 0;
            }
        }
        }
        throw new ExpressionError('不支援的運算式', node.token ? node.token.line : 1);
    };
    return ev(tree);
};

/**
 * @param {string} format e.g. "00000", "0.0", "0%"
 * @returns {?function(*): string} formats a value; null if it isn't a format
 */
const parseFormat = format => {
    const match = /^(0+)(?:\.(0+))?(%?)$/.exec(format);
    if (!match) return null;
    const width = match[1].length;
    const decimals = match[2] ? match[2].length : 0;
    const percent = !!match[3];
    return value => {
        let n = num(value);
        if (percent) n *= 100;
        if (!isFinite(n)) return Cast.toString(n);
        const negative = n < 0 && Number(n.toFixed(decimals)) !== 0;
        let [whole, fraction] = Math.abs(n).toFixed(decimals)
            .split('.');
        whole = whole.padStart(width, '0');
        return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}${percent ? '%' : ''}`;
    };
};

/**
 * Text with {expressions} in it. `{{` and `}}` are braces.
 * @param {string} text
 * @returns {?Array<string|{tree: object, format: ?function, source: string, offset: number}>} parts, or null if there
 * are no expressions in it
 * @throws {ExpressionError} line and column are within the text
 */
const parseTemplate = text => {
    const parts = [];
    let literal = '';
    let hasExpression = false;
    let i = 0;
    const position = offset => {
        const before = text.slice(0, offset);
        const line = before.split('\n').length;
        return [line, offset - before.lastIndexOf('\n')];
    };
    while (i < text.length) {
        const c = text[i];
        if (c === '{' && text[i + 1] === '{') {
            literal += '{';
            i += 2;
        } else if (c === '}' && text[i + 1] === '}') {
            literal += '}';
            i += 2;
        } else if (c === '{') {
            // The closing brace, skipping over strings
            let j = i + 1;
            let depth = 0;
            while (j < text.length) {
                if (text[j] === '"' || text[j] === '\'') {
                    const quote = text[j];
                    j++;
                    while (j < text.length && text[j] !== quote) j += text[j] === '\\' ? 2 : 1;
                } else if (text[j] === '(') {
                    depth++;
                } else if (text[j] === ')') {
                    depth--;
                } else if (text[j] === '}' && depth <= 0) {
                    break;
                }
                j++;
            }
            if (j >= text.length) throw new ExpressionError('大括號沒有關起來。要顯示「{」請寫「{{」', ...position(i));
            const source = text.slice(i + 1, j);
            if (literal) parts.push(literal);
            literal = '';
            parts.push(parseTemplatePart(source, i + 1, position)); // eslint-disable-line no-use-before-define
            hasExpression = true;
            i = j + 1;
        } else {
            literal += c;
            i++;
        }
    }
    if (literal) parts.push(literal);
    return hasExpression ? parts : null;
};

const parseTemplatePart = (source, offset, position) => {
    const moveError = e => {
        if (!(e instanceof ExpressionError)) return e;
        // Positions within the expression → within the text
        const [line, column] = position(offset);
        return new ExpressionError(e.message, line + e.line - 1, e.line === 1 ? column + e.column - 1 : e.column);
    };
    if (!source.trim()) throw moveError(new ExpressionError('{ } 裡面是空的。要顯示「{」請寫「{{」', 1, 1));
    // {分數:00000}: a format after the last ":", if the rest is an expression
    const colon = source.lastIndexOf(':');
    if (colon > 0) {
        const format = parseFormat(source.slice(colon + 1).trim());
        if (format) {
            try {
                const tree = parse(source.slice(0, colon));
                const error = checkBinding(tree);
                if (!error) return {tree, format, source, offset};
            } catch (e) {
                // Not a format after all (e.g. a ? b : 0)
            }
        }
    }
    let tree;
    try {
        tree = parse(source);
    } catch (e) {
        throw moveError(e);
    }
    const error = checkBinding(tree);
    if (error) throw moveError(error);
    return {tree, format: null, source, offset};
};

/**
 * @param {object} tree
 * @returns {Array<object>} the path nodes in it
 */
const pathsOf = tree => {
    const paths = [];
    const visit = node => {
        if (!node) return;
        if (node.type === 'path') paths.push(node);
        if (node.args) node.args.forEach(arg => visit(arg.value));
        [node.operand, node.left, node.right, node.test, node.then, node.otherwise].forEach(visit);
    };
    visit(tree);
    return paths;
};

module.exports = {
    EXPRESSION_KEYWORDS,
    BINDING_FUNCTIONS,
    ExpressionError,
    ExpressionParser,
    tokenize,
    parse,
    checkBinding,
    evaluate,
    parseFormat,
    parseTemplate,
    pathsOf
};

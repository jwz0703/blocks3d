/**
 * @fileoverview
 * The simplified syntax for writing scripts by hand (.b3s), compiled into the text format of syntax.js. See
 * README.md for the language. Everything it makes is ordinary text-format lines, so `build` and `check` see
 * nothing new.
 */
const {TextError, writeName, writeOpcode} = require('./syntax');
const {vmModule} = require('./paths');
const {ExpressionError, ExpressionParser, tokenize: tokenizeExpression} = vmModule('src/util/b3-expression');

// Tokens: the same as the expressions of SVG bindings (scratch-vm/src/util/b3-expression.js), with more keywords

const KEYWORDS = new Set(['when', 'define', 'warp', 'if', 'else', 'forever', 'repeat', 'while', 'until', 'for', 'in',
    'wait', 'broadcast', 'emit', 'and', 'or', 'not', 'stop', 'return', 'true', 'false']);

const tokenize = source => {
    try {
        return tokenizeExpression(source, {keywords: KEYWORDS});
    } catch (e) {
        if (e instanceof ExpressionError) throw new TextError(e.message, e.line);
        throw e;
    }
};

// Blocks that are written like functions
const FUNCTIONS = {
    join: {opcode: 'operator_join', args: ['STRING1', 'STRING2']},
    random: {opcode: 'operator_random', args: ['FROM', 'TO']},
    round: {opcode: 'operator_round', args: ['NUM']},
    length: {opcode: 'operator_length', args: ['STRING']},
    letter: {opcode: 'operator_letter_of', args: ['STRING', 'LETTER']},
    contains: {opcode: 'operator_contains', args: ['STRING1', 'STRING2']},
    min: {opcode: 'twmath_min', args: ['A', 'B']},
    max: {opcode: 'twmath_max', args: ['A', 'B']},
    clamp: {opcode: 'twmath_clamp', args: ['VALUE', 'MIN', 'MAX']},
    lerp: {opcode: 'twmath_lerp', args: ['A', 'B', 'T']},
    atan2: {opcode: 'twmath_atan2', args: ['Y', 'X']},
    isclone: {opcode: 'twclonevars_isClone', args: []},
    triggered_sprite: {opcode: 'twiface_source', args: []},
    triggered_id: {opcode: 'twiface_sourceId', args: []},
    event_value: {opcode: 'twiface_value', args: []},
    // Components: getprop("開始按鈕", "文字"), this_instance()
    getprop: {opcode: 'twcomp_instanceProp', args: ['INSTANCE', 'PROP']},
    this_instance: {opcode: 'twcomp_thisInstance', args: []},
    all_instances: {opcode: 'twcomp_allInstances', args: ['COMPONENT']},
    say: {opcode: 'looks_say', args: ['MESSAGE']},
    log: {opcode: 'looks_log', args: ['MESSAGE']}
};
const MATH = {
    abs: 'abs', floor: 'floor', ceil: 'ceiling', sqrt: 'sqrt', sin: 'sin', cos: 'cos', tan: 'tan', asin: 'asin',
    acos: 'acos', atan: 'atan', ln: 'ln', log10: 'log', exp: 'e ^', pow10: '10 ^'
};
const BINARY = {
    '+': 'operator_add',
    '-': 'operator_subtract',
    '*': 'operator_multiply',
    '/': 'operator_divide',
    '%': 'operator_mod'
};
const HATS = {
    flag: 'event_whenflagclicked',
    clicked: 'event_whenthisspriteclicked',
    stageclicked: 'event_whenstageclicked',
    // Components have no green flag: this runs when the component appears (and when the green flag resets them)
    created: 'twcomp_whenCreated'
};

// Expressions are strings of the text format; `block` marks those that are blocks (for shadows)
const literalNumber = value => ({text: value, literal: 'number', value});
const literalString = value => ({text: JSON.stringify(value), literal: 'string', value});
const blockExpr = text => ({text: `(${text})`});

class Compiler extends ExpressionParser {
    // `prop.文字` is the block 屬性 [文字] (it goes into hexagonal inputs too); the shared parser has no such scope
    path () {
        const result = super.path();
        if (result.scope === 'global' && /^prop\./.test(result.text)) {
            return Object.assign({}, result, {scope: 'prop', name: result.text.slice('prop.'.length)});
        }
        return result;
    }

    constructor (source, options) {
        super(tokenize(source));
        this.defs = options.defs;
        this.procedures = {};
        // Names in scope: parameters of a custom block, loop variables, dt
        this.scope = [];
    }

    error (message, token = this.peek()) {
        return new TextError(message, token.line);
    }

    // Program

    compile () {
        // Custom blocks first, so they can be called before they are defined
        this.collectDefines();
        const scripts = [];
        while (!this.is('end')) {
            if (this.accept('keyword', 'when')) scripts.push(this.when());
            else if (this.accept('keyword', 'define')) scripts.push(this.define());
            else throw this.error('最外層應該是 when（事件）或 define（自訂積木）');
        }
        let y = 0;
        const lines = [];
        for (const script of scripts) {
            lines.push(`script 0 ${y}`, ...script.map(line => `  ${line}`));
            // About the height of the blocks, so the scripts don't overlap in the editor
            y += (script.length + 2) * 48;
        }
        return lines;
    }

    collectDefines () {
        for (let i = 0; i < this.tokens.length - 1; i++) {
            if (!(this.tokens[i].type === 'keyword' && this.tokens[i].value === 'define')) continue;
            const save = this.pos;
            this.pos = i + 1;
            const {name, params} = this.signature();
            this.pos = save;
            const proccode = [name, ...params.map(p => (p.boolean ? '%b' : '%s'))].join(' ');
            if (this.procedures[name]) throw new TextError(`自訂積木「${name}」定義了兩次`, this.tokens[i].line);
            this.procedures[name] = {proccode, params, returns: false};
        }
        // Custom blocks that return a value are reporters
        for (let i = 0; i < this.tokens.length - 1; i++) {
            if (this.tokens[i].type === 'keyword' && this.tokens[i].value === 'define') {
                const name = this.tokens[i + 1].value;
                let depth = 0;
                for (let j = i + 1; j < this.tokens.length; j++) {
                    const t = this.tokens[j];
                    if (t.type === 'op' && t.value === '{') depth++;
                    if (t.type === 'op' && t.value === '}' && --depth === 0) break;
                    if (t.type === 'keyword' && t.value === 'return' && depth > 0) this.procedures[name].returns = true;
                }
            }
        }
    }

    signature () {
        const name = this.expect('name', undefined, '自訂積木的名稱').value;
        const params = [];
        this.expect('op', '(');
        if (!this.accept('op', ')')) {
            do {
                const param = this.expect('name', undefined, '參數名稱').value;
                let boolean = false;
                if (this.accept('op', ':')) {
                    const type = this.expect('name', undefined, '參數類型（bool）').value;
                    if (type !== 'bool') throw this.error('參數類型只能是 bool（真假值）；不寫就是數字或文字');
                    boolean = true;
                }
                params.push({name: param, boolean});
            } while (this.accept('op', ','));
            this.expect('op', ')');
        }
        return {name, params};
    }

    define () {
        const {name, params} = this.signature();
        const warp = !!this.accept('keyword', 'warp');
        const procedure = this.procedures[name];
        const head = ['define', JSON.stringify(procedure.proccode), ...params.map(p => JSON.stringify(p.name))];
        if (warp) head.push('@warp');
        this.scope.push(...params.map(p => ({name: p.name, text: `(${p.boolean ? 'argument_reporter_boolean' : 'argument_reporter_string_number'} VALUE:${JSON.stringify(p.name)})`})));
        const line = this.tokens[this.pos - 1].line;
        const body = this.block();
        this.scope = [];
        return [`${head.join(' ')}  # b3s:${line}`, ...body];
    }

    when () {
        const token = this.peek();
        const word = this.expect('name', undefined, '事件（flag、clicked、key、receive、clone、frame 或積木的 opcode）').value;
        let head;
        if (HATS[word]) {
            head = HATS[word];
        } else if (word === 'key') {
            head = `event_whenkeypressed KEY_OPTION:${JSON.stringify(this.expect('string', undefined, '按鍵名稱，例如 "space"').value)}`;
        } else if (word === 'receive') {
            head = `event_whenbroadcastreceived BROADCAST_OPTION:${JSON.stringify(this.expect('string', undefined, '廣播名稱').value)}`;
        } else if (word === 'clone') {
            head = 'control_start_as_clone ID=[control_start_as_clone_id VALUE:"id"]';
            this.scope.push({name: 'id', text: '(control_start_as_clone_id VALUE:"id")'});
        } else if (word === 'frame') {
            // when frame [late] (dt)
            const late = this.is('name', 'late') ? this.next() : null;
            head = `control_whenframe DT=[control_foreachframe_deltatime] PHASE:${late ? '"lateupdate"' : '"update"'}`;
            this.scope.push({name: 'dt', text: '(control_foreachframe_deltatime)'});
        } else if (word === 'prop' && this.is('op', '.')) {
            // when prop.文字 { }: a property of this component changed
            this.next();
            const prop = this.next();
            if (prop.type !== 'name' && prop.type !== 'string') throw this.error('「prop.」後面應該是屬性名稱', prop);
            head = `twcomp_whenPropChanged PROP:${JSON.stringify(prop.value)}`;
        } else if (word === 'out') {
            // when out 面板.clicked (count, open) { }: an output of the instance 面板 of a component (or, with
            // "any 面板.clicked", of any instance of it); the names in ( ) are the arguments of the output, by id
            let sprite = this.expect('name', undefined, '元件的實體（或 any 加元件）').value;
            if (sprite === 'any') sprite = `_any_${this.expect('name', undefined, '元件').value}`;
            this.expect('op', '.', '「.」');
            const port = this.next();
            if (port.type !== 'name' && port.type !== 'string') throw this.error('「實體.」後面應該是輸出的 id', port);
            head = `twcomp_whenOutput SPRITE:${JSON.stringify(sprite)} PORT:${JSON.stringify(port.value)}`;
            if (this.accept('op', '(')) {
                if (!this.accept('op', ')')) {
                    do {
                        const param = this.expect('name', undefined, '參數的 id').value;
                        const reporter = `twcomp_outputParam PORT:${JSON.stringify(port.value)} PARAM:${JSON.stringify(param)}`;
                        // Like the editor: the hat has the arguments as reporters in its inputs, to drag out
                        head += ` ${param}=[${reporter}]`;
                        this.scope.push({name: param, text: `(${reporter})`});
                    } while (this.accept('op', ','));
                    this.expect('op', ')');
                }
            }
        } else if (this.is('op', '.') || (word === 'any' && this.is('name'))) {
            // when 按鈕.被點到 { }: an event of another sprite's interface or an instance of a component;
            // when any 按鈕.被點到 { }: of any instance of the component 按鈕
            let sprite = word;
            if (word === 'any') sprite = `_any_${this.next().value}`;
            this.expect('op', '.', '「.」');
            const event = this.next();
            if (event.type !== 'name' && event.type !== 'string') throw this.error('「角色.」後面應該是事件名稱', event);
            head = `twiface_whenEvent SPRITE:${JSON.stringify(sprite)} EVENT:${JSON.stringify(event.value)}`;
        } else if (word.includes('_')) {
            head = this.call(word, token, false, this.parseArguments()).text.slice(1, -1);
        } else {
            throw this.error(`不認得的事件「${word}」（可以是 flag、clicked、stageclicked、key "…"、receive "…"、clone、frame、frame late 或積木的 opcode）`, token);
        }
        const body = this.block();
        this.scope = [];
        return [`${head}  # b3s:${token.line}`, ...body];
    }

    // Statements

    block () {
        this.expect('op', '{');
        const lines = [];
        while (!this.accept('op', '}')) {
            if (this.is('end')) throw this.error('少了「}」');
            lines.push(...this.statement());
        }
        return lines;
    }

    // "NAME:" and the lines of a stack inside a block
    stack (name, lines) {
        if (!lines.length) return [];
        return [`  ${name}:`, ...lines.map(line => `    ${line}`)];
    }

    statement () {
        const token = this.peek();
        const tag = `  # b3s:${token.line}`;
        const out = (head, stacks = []) => [head + tag, ...stacks];
        if (this.accept('keyword', 'if')) return this.ifStatement(token);
        if (this.accept('keyword', 'forever')) return out('control_forever', this.stack('SUBSTACK', this.block()));
        if (this.accept('keyword', 'repeat')) {
            const times = this.input(this.expression(), 6);
            return out(`control_repeat TIMES=${times}`, this.stack('SUBSTACK', this.block()));
        }
        if (this.accept('keyword', 'while')) {
            const condition = this.condition();
            return out(`control_while CONDITION=${condition}`, this.stack('SUBSTACK', this.block()));
        }
        if (this.accept('keyword', 'until')) {
            const condition = this.condition();
            return out(`control_repeat_until CONDITION=${condition}`, this.stack('SUBSTACK', this.block()));
        }
        if (this.accept('keyword', 'for')) {
            // for i in 1..10 { }
            const nameToken = this.peek();
            const name = this.expect('name', undefined, '迴圈變數名稱').value;
            // Like the editor, which renames a loop dropped into one with the same name (i → j → k)
            if (this.scope.some(item => item.loop && item.name === name)) {
                throw this.error(`外層的迴圈已經叫 ${name}，內層請換一個名字（在編輯器裡拖進去會自動改成 j、k…）`, nameToken);
            }
            this.expect('keyword', 'in', '「in」');
            const from = this.expression();
            this.expect('op', '..', '「..」');
            const to = this.expression();
            this.scope.push({name, loop: true, text: `(control_for_range_index VALUE:${JSON.stringify(name)})`});
            const body = this.block();
            this.scope.pop();
            return out(`control_for_range VAR=[control_for_range_index VALUE:${JSON.stringify(name)}] FROM=${this.input(from)} TO=${this.input(to)}`,
                this.stack('SUBSTACK', body));
        }
        if (this.accept('keyword', 'wait')) {
            if (this.accept('keyword', 'until')) return out(`control_wait_until CONDITION=${this.condition()}`);
            return out(`control_wait DURATION=${this.input(this.expression(), 5)}`);
        }
        if (this.accept('keyword', 'emit')) {
            // emit out clicked(count: 7, open: true) [and wait]: an output of this component, by its id, with its
            // arguments by their ids
            if (this.is('name', 'out')) {
                this.next();
                const port = this.expect('name', undefined, '輸出的 id').value;
                const inputs = [];
                if (this.accept('op', '(')) {
                    if (!this.accept('op', ')')) {
                        do {
                            const param = this.expect('name', undefined, '參數的 id').value;
                            this.expect('op', ':', '「:」');
                            inputs.push(`${param}=${this.input(this.expression())}`);
                        } while (this.accept('op', ','));
                        this.expect('op', ')');
                    }
                }
                let opcode = 'twcomp_emit';
                if (this.accept('keyword', 'and')) {
                    this.expect('keyword', 'wait', '「wait」');
                    opcode = 'twcomp_emitAndWait';
                }
                return out(`${opcode} PORT:${JSON.stringify(port)}${inputs.length ? ` ${inputs.join(' ')}` : ''}`);
            }
            // emit "事件" [值] [and wait]: an event of this sprite's interface
            const name = this.expect('string', undefined, '事件名稱（"…"）').value;
            if (this.accept('keyword', 'and')) {
                this.expect('keyword', 'wait', '「wait」');
                return out(`twiface_emitAndWait EVENT:${JSON.stringify(name)}`);
            }
            if (this.is('op', '}') || this.peek().line !== token.line) return out(`twiface_emit EVENT:${JSON.stringify(name)}`);
            return out(`twiface_emitValue EVENT:${JSON.stringify(name)} VALUE=${this.input(this.expression())}`);
        }
        if (this.accept('keyword', 'broadcast')) {
            const message = this.expect('string', undefined, '廣播名稱（"…"）').value;
            const wait = this.accept('keyword', 'and') ? (this.expect('keyword', 'wait', '「wait」'), true) : false;
            return out(`${wait ? 'event_broadcastandwait' : 'event_broadcast'} BROADCAST_INPUT=broadcast(${JSON.stringify(message)})`);
        }
        if (this.accept('keyword', 'stop')) {
            const option = this.expect('string', undefined, '"all"、"this script" 或 "other scripts in sprite"').value;
            if (!['all', 'this script', 'other scripts in sprite'].includes(option)) {
                throw this.error('stop 後面可以是 "all"、"this script" 或 "other scripts in sprite"', token);
            }
            const hasNext = option === 'other scripts in sprite' ? 'true' : 'false';
            return out(`control_stop STOP_OPTION:${JSON.stringify(option)} @mutation {"tagName":"mutation","children":[],"hasnext":"${hasNext}"}`);
        }
        if (this.accept('keyword', 'return')) return out(`procedures_return VALUE=${this.input(this.expression())}`);
        if (this.is('name') && this.peek(1).type === 'op' && this.peek(1).value === '(') {
            const name = this.next().value;
            const call = this.call(name, token, false, this.parseArguments());
            // Trailing { } are the stacks of C blocks
            const stacks = [];
            const names = call.stacks || [];
            let n = 0;
            while (this.is('op', '{') || (n > 0 && this.is('keyword', 'else'))) {
                if (n > 0) this.expect('keyword', 'else');
                const stackName = names[n] || (n === 0 ? 'SUBSTACK' : `SUBSTACK${n + 1}`);
                stacks.push(...this.stack(stackName, this.block()));
                n++;
            }
            return out(call.text.slice(1, -1), stacks);
        }
        if (this.is('name')) return this.assignment(token, tag);
        throw this.error(`這裡應該是一個指令，卻是「${token.value === null ? '檔案結尾' : token.value}」`);
    }

    ifStatement () {
        const token = this.tokens[this.pos - 1];
        const condition = this.condition();
        const then = this.block();
        if (!this.accept('keyword', 'else')) {
            return [`control_if CONDITION=${condition}  # b3s:${token.line}`, ...this.stack('SUBSTACK', then)];
        }
        let otherwise;
        if (this.accept('keyword', 'if')) otherwise = this.ifStatement();
        else otherwise = this.block();
        return [`control_if_else CONDITION=${condition}  # b3s:${token.line}`, ...this.stack('SUBSTACK', then),
            ...this.stack('SUBSTACK2', otherwise)];
    }

    assignment (token, tag) {
        const path = this.path();
        const operator = this.next();
        if (operator.type !== 'op' || !['=', '+=', '-='].includes(operator.value)) {
            throw this.error(`「${path.text}」後面應該是 =、+= 或 -=`, operator);
        }
        let value = this.expression();
        const {opcode, arg, field} = this.variableBlock(path, operator.value === '=' ? 'set' : 'change');
        if (operator.value === '-=') {
            value = value.literal === 'number' ? literalNumber(value.value.startsWith('-') ? value.value.slice(1) : `-${value.value}`) :
                blockExpr(`operator_subtract NUM1=0 NUM2=${this.input(value, 4)}`);
        }
        return [`${opcode} ${arg}${field ? ':' : '='}${JSON.stringify(path.name)} VALUE=${this.input(value)}${tag}`];
    }

    /**
     * @param {object} path from this.path() (the shared parser)
     * @param {string} action 'get', 'set' or 'change'
     * @returns {{opcode: string, arg: string}} the block for a variable, by its scope
     */
    variableBlock (path, action, token = path.token) {
        if (path.scope === 'prop') {
            // A property of this component: 屬性 [ ] and 屬性 [ ] 設為 ( ) (no paths into it)
            if (action === 'change') throw this.error('屬性不能用 += 或 -=，請寫 prop.x = prop.x + 1', token);
            if (/[.[]/.test(path.name)) throw this.error('prop. 後面只能是屬性名稱', token);
            return {opcode: action === 'get' ? 'twcomp_prop' : 'twcomp_setProp', arg: 'PROP', field: true};
        }
        const suffix = {get: 'getVariable', set: 'setVariable', change: 'changeVariable'}[action];
        if (path.scope === 'self') return {opcode: `twclonevars_${suffix}`, arg: 'NAME'};
        if (path.scope === 'local') return {opcode: `twlocalvars_${suffix}`, arg: 'NAME'};
        return {opcode: `twdata_${action}`, arg: 'PATH'};
    }

    // Expressions

    condition () {
        return this.input(this.expression());
    }

    /**
     * @param {object} expression
     * @returns {string} the expression as an input value (the shadow type comes from the block, see build)
     */
    input (expression) {
        return expression.text;
    }

    /**
     * @returns {object} the next expression as a text-format value
     */
    expression () {
        return this.convert(this.parseExpression());
    }

    /**
     * @param {object} node a tree from the shared parser
     * @returns {{text: string, literal?: string, value?: string}} the value in the text format
     */
    convert (node) {
        switch (node.type) {
        case 'number': return literalNumber(node.value);
        case 'string': return literalString(node.value);
        case 'boolean': return literalString(node.value ? 'true' : 'false');
        case 'path': {
            if (!node.steps) {
                const bound = this.scope.slice().reverse()
                    .find(item => item.name === node.text);
                if (bound) return {text: bound.text};
            }
            const {opcode, arg, field} = this.variableBlock(node, 'get', node.token);
            return blockExpr(`${opcode} ${arg}${field ? ':' : '='}${JSON.stringify(node.name)}`);
        }
        case 'call': return this.call(node.name, node.token, true, node.args);
        case 'conditional':
            throw this.error('「條件 ? 值 : 另一個值」只能用在 SVG 綁定；積木請用 if / else', node.token);
        case 'unary':
            if (node.op === 'not') return blockExpr(`operator_not OPERAND=${this.convert(node.operand).text}`);
            return blockExpr(`operator_subtract NUM1=0 NUM2=${this.convert(node.operand).text}`);
        }
        const left = this.convert(node.left);
        const right = this.convert(node.right);
        const compare = (opcode, a, b) => `${opcode} OPERAND1=${a.text} OPERAND2=${b.text}`;
        switch (node.op) {
        case 'or': return blockExpr(`operator_or OPERAND1=${left.text} OPERAND2=${right.text}`);
        case 'and': return blockExpr(`operator_and OPERAND1=${left.text} OPERAND2=${right.text}`);
        case '==': return blockExpr(compare('operator_equals', left, right));
        case '!=': return blockExpr(`operator_not OPERAND=(${compare('operator_equals', left, right)})`);
        case '<': return blockExpr(compare('operator_lt', left, right));
        case '>': return blockExpr(compare('operator_gt', left, right));
        case '<=': return blockExpr(`operator_not OPERAND=(${compare('operator_gt', left, right)})`);
        case '>=': return blockExpr(`operator_not OPERAND=(${compare('operator_lt', left, right)})`);
        case '++': return blockExpr(`operator_join STRING1=${left.text} STRING2=${right.text}`);
        default: return blockExpr(`${BINARY[node.op]} NUM1=${left.text} NUM2=${right.text}`);
        }
    }

    /**
     * A call: a custom block, a function of FUNCTIONS / MATH, or any block by its opcode.
     * @returns {{text: string, stacks?: string[]}}
     */
    call (name, token, reporter, trees) {
        const args = trees.map(arg => ({name: arg.name, token: arg.token, value: this.convert(arg.value)}));
        if (this.procedures[name]) {
            const procedure = this.procedures[name];
            if (args.length !== procedure.params.length) {
                throw this.error(`${name} 要 ${procedure.params.length} 個參數，卻給了 ${args.length} 個`, token);
            }
            const parts = ['call', JSON.stringify(procedure.proccode)];
            args.forEach((arg, i) => {
                if (arg.name && arg.name !== procedure.params[i].name) throw this.error(`${name} 的第 ${i + 1} 個參數是 ${procedure.params[i].name}`, arg.token);
                parts.push(`${writeName(procedure.params[i].name)}=${arg.value.text}`);
            });
            if (reporter && procedure.returns) parts.push('@return "1"');
            return {text: `(${parts.join(' ')})`};
        }
        if (MATH[name]) {
            if (args.length !== 1) throw this.error(`${name} 要 1 個參數`, token);
            return blockExpr(`operator_mathop OPERATOR:${JSON.stringify(MATH[name])} NUM=${args[0].value.text}`);
        }
        let opcode;
        let order;
        if (FUNCTIONS[name]) {
            opcode = FUNCTIONS[name].opcode;
            order = FUNCTIONS[name].args;
        } else if (this.defs[name]) {
            opcode = name;
        } else {
            throw this.error(`不認得「${name}」：不是這個檔案的自訂積木、內建函式，也不是積木的 opcode`, token);
        }
        const def = this.defs[opcode];
        const argNames = Object.keys(def.args);
        // Positional arguments go in the order they appear on the block
        if (!order) {
            order = (def.text.match(/\[([^\]]+)\]/g) || []).map(s => s.slice(1, -1))
                .filter(n => def.args[n] && def.args[n].kind !== 'statement');
            for (const n of argNames) if (!order.includes(n) && def.args[n].kind !== 'statement') order.push(n);
        }
        const parts = [writeOpcode(opcode)];
        const given = new Set();
        args.forEach((arg, i) => {
            const argName = arg.name || order[i];
            if (!argName) throw this.error(`${opcode} 只有 ${order.length} 個參數`, arg.token);
            if (!def.args[argName] && argNames.length) {
                throw this.error(`${opcode} 沒有參數「${argName}」（有：${order.join('、')}）`, arg.token);
            }
            if (given.has(argName)) throw this.error(`參數 ${argName} 給了兩次`, arg.token);
            given.add(argName);
            const kind = def.args[argName] ? def.args[argName] : {kind: 'input'};
            if (kind.kind === 'field') {
                if (!arg.value.literal) throw this.error(`${opcode} 的 ${argName} 是選單欄位，只能是 "文字" 或數字`, arg.token);
                parts.push(`${writeName(argName)}:${JSON.stringify(arg.value.value)}`);
            } else if (kind.menu && arg.value.literal) {
                parts.push(`${writeName(argName)}=menu(${JSON.stringify(arg.value.value)})`);
            } else if (kind.shadow === 11 && arg.value.literal === 'string') {
                parts.push(`${writeName(argName)}=broadcast(${JSON.stringify(arg.value.value)})`);
            } else {
                parts.push(`${writeName(argName)}=${arg.value.text}`);
            }
        });
        const stacks = argNames.filter(n => def.args[n].kind === 'statement');
        return {text: `(${parts.join(' ')})`, stacks};
    }
}

/**
 * @param {string} source a .b3s program
 * @param {object} options
 * @param {object} options.defs block definitions
 * @returns {string} its scripts in the text format (the part of a sprite after `sprite "…"`, indented)
 */
const compile = (source, options) => {
    const lines = new Compiler(source, options).compile();
    return `# 由簡化語法編譯（b3s:N 是原始檔的行號）\n${lines.map(line => `  ${line}`).join('\n')}\n`;
};

module.exports = {
    compile,
    tokenize
};

/**
 * @fileoverview
 * Checking a project.json: what the blocks are (unknown opcodes, inputs, fields, menu values), how they are linked,
 * custom blocks and variables, and then loading it in the VM and compiling every script.
 *
 * A problem is {level: 'error'|'warning', line, message}. `line` is the line of the text the block came from, when
 * the project was made from text.
 */
const {vmModule} = require('./paths');
const {makeVM, messages} = require('./vm-host');
const {findRefs, svgBindings, DataPath} = require('./data-refs');
const model = require('./model');

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const levenshtein = (a, b) => {
    const row = Array.from({length: b.length + 1}, (v, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let previous = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const current = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
            previous = current;
        }
    }
    return row[b.length];
};

/**
 * @param {string} word
 * @param {string[]} candidates
 * @returns {string} "（是不是 X？）" for the closest candidate, or ''
 */
const suggest = (word, candidates) => {
    let best = null;
    let bestDistance = Infinity;
    for (const candidate of candidates) {
        const distance = levenshtein(word.toLowerCase(), candidate.toLowerCase());
        if (distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
        }
    }
    const close = bestDistance <= Math.max(1, Math.floor(word.length / 3)) && bestDistance < word.length;
    return best !== null && close ? `（是不是 ${best}？）` : '';
};

const list = values => {
    const shown = values.slice(0, 12).map(v => JSON.stringify(v))
        .join('、');
    return values.length > 12 ? `${shown}…` : shown;
};

// Values that menus of sprites have besides the sprite names
const SPRITE_MENUS = {
    sensing_touchingobjectmenu: ['_mouse_', '_edge_'],
    motion_goto_menu: ['_random_', '_mouse_'],
    motion_glideto_menu: ['_random_', '_mouse_'],
    motion_pointtowards_menu: ['_mouse_', '_random_'],
    control_create_clone_of_menu: ['_myself_'],
    sensing_of_object_menu: ['_stage_'],
    sensing_distancetomenu: ['_mouse_']
};

// Names the sprite itself has as 分身變數 (see scratch-vm util/data-path.js BUILTINS)
const SELF_BUILTINS = new Set(DataPath.RESERVED_NAMES);

/**
 * Checks of one target that don't need the VM.
 */
class TargetChecker {
    constructor (json, target, options, report) {
        this.json = json;
        this.target = target;
        this.stage = json.targets.find(t => t.isStage) || target;
        this.defs = options.defs;
        this.blocks = isObject(target.blocks) ? target.blocks : {};
        this.lines = (options.lines && options.lines[target.name]) || null;
        this.report = report;
        this.procedures = model.proceduresOf(target);
        // Opcodes of extensions that aren't built in, which the tool can't know
        this.unknownExtensions = (json.extensions || []).filter(id => json.extensionURLs && json.extensionURLs[id]);
        // Shadows covered by a block, whose values don't matter
        this.obscured = new Set();
        for (const block of Object.values(this.blocks)) {
            if (!isObject(block)) continue;
            for (const input of Object.values(block.inputs || {})) {
                if (Array.isArray(input) && input.length === 3 && typeof input[2] === 'string') this.obscured.add(input[2]);
            }
        }
    }

    where (id) {
        const block = this.blocks[id];
        const opcode = isObject(block) ? block.opcode : '';
        return this.lines && this.lines[id] ? '' : `（「${this.target.name}」的積木 ${id}${opcode ? ` ${opcode}` : ''}）`;
    }

    problem (level, id, message) {
        this.report({level, line: this.lines ? this.lines[id] || 0 : 0, message: `${message}${this.where(id)}`});
    }

    names (type) {
        if (type === 'costume') return (this.target.costumes || []).map(c => c.name);
        if (type === 'backdrop') return (this.stage.costumes || []).map(c => c.name);
        if (type === 'sound') return (this.target.sounds || []).map(s => s.name);
        return this.json.targets.filter(t => !t.isStage).map(t => t.name);
    }

    check () {
        for (const [id, block] of Object.entries(this.blocks)) {
            if (Array.isArray(block)) continue;
            if (!isObject(block)) {
                this.problem('error', id, '積木不是物件');
                continue;
            }
            this.checkLinks(id, block);
            this.checkBlock(id, block);
        }
        const seen = {};
        for (const block of Object.values(this.blocks)) {
            if (isObject(block) && block.opcode === 'procedures_prototype' && block.mutation) {
                const proccode = block.mutation.proccode;
                seen[proccode] = (seen[proccode] || 0) + 1;
                if (seen[proccode] === 2) this.report({level: 'warning', line: 0, message: `「${this.target.name}」有兩個自訂積木都叫「${proccode}」`});
            }
        }
    }

    checkLinks (id, block) {
        const exists = ref => typeof ref === 'string' && Object.prototype.hasOwnProperty.call(this.blocks, ref);
        if (block.next !== null && block.next !== undefined) {
            if (!exists(block.next)) this.problem('error', id, `next 指向不存在的積木 ${block.next}`);
            else if (isObject(this.blocks[block.next]) && this.blocks[block.next].parent !== id) {
                this.problem('error', id, `下一個積木 ${block.next} 的 parent 不是這個積木`);
            }
        }
        // The VM doesn't need parent to run the blocks, so it only matters for the editor
        if (block.parent !== null && block.parent !== undefined && !exists(block.parent)) {
            this.problem('warning', id, `parent 指向不存在的積木 ${block.parent}`);
        }
        for (const [name, input] of Object.entries(block.inputs || {})) {
            if (!Array.isArray(input) || ![1, 2, 3].includes(input[0])) {
                this.problem('error', id, `輸入 ${name} 的格式不對`);
                continue;
            }
            for (const ref of input.slice(1)) {
                if (typeof ref === 'string') {
                    if (!exists(ref)) this.problem('error', id, `輸入 ${name} 指向不存在的積木 ${ref}`);
                    else if (isObject(this.blocks[ref]) && this.blocks[ref].parent !== id) {
                        this.problem('error', id, `輸入 ${name} 的積木 ${ref} 的 parent 不是這個積木`);
                    }
                }
            }
        }
    }

    checkBlock (id, block) {
        const opcode = block.opcode;
        const def = this.defs[opcode];
        if (!def) {
            const prefix = opcode.split('_')[0];
            if (this.unknownExtensions.includes(prefix)) return;
            const candidates = Object.keys(this.defs);
            this.problem('error', id, `未知的 opcode「${opcode}」${suggest(opcode, candidates)}`);
            return;
        }
        if (opcode === 'procedures_call') {
            this.checkCall(id, block);
        } else if (!def.loose && !/^procedures_(prototype|callsprite)|^twcomp_(emit|whenOutput)/.test(opcode) && Object.keys(def.args).length) {
            const inputNames = Object.keys(def.args).filter(n => def.args[n].kind !== 'field');
            const fieldNames = Object.keys(def.args).filter(n => def.args[n].kind === 'field');
            for (const name of Object.keys(block.inputs || {})) {
                if (!def.args[name] || def.args[name].kind === 'field') {
                    this.problem('error', id, `${opcode} 沒有輸入「${name}」${inputNames.length ? `（有：${inputNames.join('、')}）` : ''}${suggest(name, inputNames)}`);
                }
            }
            for (const name of Object.keys(block.fields || {})) {
                if (!def.args[name] || def.args[name].kind !== 'field') {
                    this.problem('error', id, `${opcode} 沒有欄位「${name}」${fieldNames.length ? `（有：${fieldNames.join('、')}）` : ''}${suggest(name, fieldNames)}`);
                }
            }
        }
        for (const [name, field] of Object.entries(block.fields || {})) {
            if (!Array.isArray(field)) {
                this.problem('error', id, `欄位 ${name} 的格式不對`);
                continue;
            }
            this.checkFieldValue(id, block, def, name, field[0]);
        }
        if (/^argument_reporter_/.test(opcode)) this.checkArgument(id, block);
        if (opcode === 'control_for_range') this.checkForRange(id);
        if (opcode === 'control_for_range_index' && !block.shadow) this.checkForRangeIndex(id, block);
        if (opcode === 'twcomp_setInstanceProp') {
            this.problem('error', id, '外面不能直接設定元件裡的屬性（這個積木已經拿掉，不會執行）；' +
                '請在元件裡做一個輸入（公開的自訂積木），外面用「呼叫 [實體] 的 […]」');
        }
        if (/^procedures_callsprite/.test(opcode)) this.checkCrossCall(id, block);
        if (/^twiface_(emit|emitValue|emitAndWait|whenEvent)$/.test(opcode)) this.checkInterfaceEvent(id, block);
        if (/^twcomp_(emit|emitAndWait|whenOutput|outputParam)$/.test(opcode)) this.checkOutput(id, block);
        this.checkBooleanInputs(id, block, def);
    }

    // Hexagonal inputs (conditions) only take Boolean blocks: the editor drops a round reporter out of them
    checkBooleanInputs (id, block, def) {
        for (const [name, input] of Object.entries(block.inputs || {})) {
            const arg = def.args[name];
            if (!arg || !arg.boolean || !Array.isArray(input) || typeof input[1] !== 'string') continue;
            const inner = this.blocks[input[1]];
            if (!isObject(inner) || inner.shadow) continue;
            const innerDef = this.defs[inner.opcode];
            // Custom blocks and their arguments decide their shape themselves
            if (!innerDef || innerDef.boolean || innerDef.anyInput || !innerDef.output ||
                /^(procedures_|argument_)/.test(inner.opcode)) continue;
            this.problem('error', input[1], `${inner.opcode} 是圓角的積木，不能放進 ${block.opcode} 的 ${name}（六角形，要放` +
                '條件積木）；可以比較：operator_equals OPERAND1=(…) OPERAND2="true"（.b3s：… == true）');
        }
    }

    checkFieldValue (id, block, def, name, value) {
        if (this.obscured.has(id)) return;
        const arg = def.args[name];
        const lower = String(value).toLowerCase();
        if (arg && arg.options && arg.options.length && !arg.options.some(option => option.toLowerCase() === lower)) {
            this.problem('error', id, `${block.opcode} 的 ${name} 是 ${JSON.stringify(value)}，不在選項裡（可以是：${list(arg.options)}）`);
            return;
        }
        let names = null;
        let extra = [];
        if (block.opcode === 'looks_costume') names = this.names(this.target.isStage ? 'backdrop' : 'costume');
        else if (block.opcode === 'looks_backdrops' || block.opcode === 'event_whenbackdropswitchesto') {
            names = this.names('backdrop');
            extra = ['next backdrop', 'previous backdrop', 'random backdrop'];
        } else if (block.opcode === 'sound_sounds_menu') names = this.names('sound');
        else if (SPRITE_MENUS[block.opcode]) {
            names = this.names('sprite');
            extra = SPRITE_MENUS[block.opcode];
        }
        if (names && !names.includes(value) && !extra.includes(value)) {
            this.problem('warning', id, `${block.opcode} 的 ${name} 是 ${JSON.stringify(value)}，專案裡沒有這個名稱（有：${list(extra.concat(names))}）`);
        }
    }

    checkCall (id, block) {
        const mutation = block.mutation;
        if (!isObject(mutation) || typeof mutation.proccode !== 'string') {
            this.problem('error', id, '自訂積木的呼叫沒有 mutation');
            return;
        }
        const procedure = this.procedures[mutation.proccode];
        if (!procedure) {
            // Scratch runs it as nothing
            this.problem('warning', id, `找不到自訂積木「${mutation.proccode}」${suggest(mutation.proccode, Object.keys(this.procedures))}`);
            return;
        }
        const ids = model.parseJSONArray(mutation.argumentids);
        if (!ids || JSON.stringify(ids) !== JSON.stringify(procedure.argumentIds)) {
            this.problem('error', id, `呼叫「${mutation.proccode}」的參數 id 和定義對不上`);
            return;
        }
        for (const name of Object.keys(block.inputs || {})) {
            if (!ids.includes(name)) this.problem('error', id, `呼叫「${mutation.proccode}」多了輸入 ${name}`);
        }
    }

    // Argument reporters outside the definition of a custom block with that argument
    checkArgument (id, block) {
        if (block.shadow) return;
        let top = id;
        const seen = new Set();
        while (isObject(this.blocks[top]) && this.blocks[top].parent && !seen.has(top)) {
            seen.add(top);
            top = this.blocks[top].parent;
        }
        const topBlock = this.blocks[top];
        const name = block.fields && Array.isArray(block.fields.VALUE) ? block.fields.VALUE[0] : '';
        if (!isObject(topBlock) || topBlock.opcode !== 'procedures_definition') {
            this.problem('warning', id, `參數「${name}」不在自訂積木的定義裡`);
            return;
        }
        const input = topBlock.inputs && topBlock.inputs.custom_block;
        const prototype = Array.isArray(input) ? this.blocks[input[1]] : null;
        const names = prototype && prototype.mutation ? model.parseJSONArray(prototype.mutation.argumentnames) || [] : [];
        if (!names.includes(name)) {
            this.problem('warning', id, `自訂積木「${prototype && prototype.mutation ? prototype.mutation.proccode : ''}」沒有參數「${name}」${suggest(String(name), names)}`);
        }
    }

    // The name of a "讓 (i) 從 () 跑到 ()" loop
    forRangeName (loop) {
        const input = loop.inputs && loop.inputs.VAR;
        const shadow = Array.isArray(input) ? this.blocks[input[input.length === 3 ? 2 : 1]] : null;
        const field = isObject(shadow) && shadow.fields && shadow.fields.VALUE;
        return Array.isArray(field) ? String(field[0]) : 'i';
    }

    // The for-range loops a block is inside, innermost first (like enclosingForRanges in scratch-gui lib/blocks.js)
    enclosingLoops (id) {
        const loops = [];
        let child = id;
        let parent = isObject(this.blocks[id]) ? this.blocks[id].parent : null;
        const seen = new Set();
        while (typeof parent === 'string' && isObject(this.blocks[parent]) && !seen.has(parent)) {
            seen.add(parent);
            const block = this.blocks[parent];
            const substack = block.inputs && block.inputs.SUBSTACK;
            if (block.opcode === 'control_for_range' && Array.isArray(substack) && substack[1] === child) loops.push(block);
            child = parent;
            parent = block.parent;
        }
        return loops;
    }

    // The editor renames a loop dropped into one with the same name, so text shouldn't have them either
    checkForRange (id) {
        const name = this.forRangeName(this.blocks[id]);
        if (this.enclosingLoops(id).some(loop => this.forRangeName(loop) === name)) {
            this.problem('warning', id, `迴圈 ${name} 在另一個也叫 ${name} 的迴圈裡；裡面的 ${name} 只會是內層的，編輯器裡拖動時會把內層改名（j、k…）`);
        }
    }

    checkForRangeIndex (id, block) {
        const name = Array.isArray(block.fields && block.fields.VALUE) ? String(block.fields.VALUE[0]) : '';
        if (!this.enclosingLoops(id).some(loop => this.forRangeName(loop) === name)) {
            this.problem('warning', id, `迴圈變數 ${name} 不在叫 ${name} 的「讓 () 從 () 跑到 ()」迴圈裡，會是 0`);
        }
    }

    // Events of the public interface of sprites: the sprite that sends it declares it
    checkInterfaceEvent (id, block) {
        const field = name => (block.fields && Array.isArray(block.fields[name]) ? String(block.fields[name][0]) : '');
        const event = field('EVENT');
        const receives = block.opcode === 'twiface_whenEvent';
        const spriteName = receives ? field('SPRITE') : this.target.name;
        // A sprite, an instance of a component or any instance: the events are the sprite's or the component's
        const sprite = receives ? model.interfaceTargetOf(this.json, spriteName, this.target) : this.target;
        if (!sprite) {
            const shown = spriteName.replace(/^_any_/, '任一個');
            this.problem('error', id, `「當 [${shown}] [${event}]」：角色或實體「${shown}」不存在`);
            return;
        }
        const events = sprite.interface && Array.isArray(sprite.interface.events) ?
            sprite.interface.events.map(e => e.name) : [];
        if (!events.includes(event)) {
            this.problem('error', id, `${sprite.isComponent ? `元件「${sprite.title}」` : `角色「${sprite.name}」`}` +
                `沒有事件「${event}」（有：${events.join('、') || '沒有'}；` +
                '事件寫在角色或元件的 prop interface {"events":[{"name":"…"}]}）');
        }
    }

    // Outputs of components: declared by the component (prop outputs), said inside it, heard by the level around it
    checkOutput (id, block) {
        const field = name => (block.fields && Array.isArray(block.fields[name]) ? String(block.fields[name][0]) : '');
        const port = field('PORT');
        const components = isObject(this.json.components) ? this.json.components : {};
        let definition;
        if (block.opcode === 'twcomp_whenOutput') {
            const sprite = model.interfaceTargetOf(this.json, field('SPRITE'), this.target);
            const shown = field('SPRITE').replace(/^_any_/, '任一個');
            if (!sprite || !sprite.isComponent) {
                this.problem('error', id, `「當 [${shown}] 發出」：元件的實體「${shown}」不存在`);
                return;
            }
            definition = components[sprite.name];
        } else if (block.opcode === 'twcomp_outputParam') {
            // The arguments of the output that the hat at the top of the script hears (or of this component's own)
            let top = id;
            const seen = new Set();
            while (isObject(this.blocks[top]) && this.blocks[top].parent && !seen.has(top)) {
                seen.add(top);
                top = this.blocks[top].parent;
            }
            const hat = this.blocks[top];
            const hatSprite = isObject(hat) && hat.opcode === 'twcomp_whenOutput' && isObject(hat.fields) &&
                Array.isArray(hat.fields.SPRITE) ? String(hat.fields.SPRITE[0]) : '';
            const sprite = hatSprite ? model.interfaceTargetOf(this.json, hatSprite, this.target) : null;
            const own = this.target.isComponent ? this.target.name : this.target.componentId;
            definition = sprite && sprite.isComponent ? components[sprite.name] : (own ? components[own] : null);
            if (!definition) {
                this.problem('error', id, '輸出的參數要放在「當 [實體] 發出 [輸出]」下面');
                return;
            }
        } else {
            const id2 = this.target.isComponent ? this.target.name : this.target.componentId;
            definition = id2 ? components[id2] : null;
            if (!definition) {
                this.problem('error', id, '「發出」只能用在元件裡');
                return;
            }
        }
        const outputs = Array.isArray(definition.outputs) ? definition.outputs : [];
        const output = outputs.find(o => o && o.id === port);
        if (!output) {
            this.problem('error', id, `元件「${definition.name}」沒有輸出「${port}」（有：` +
                `${outputs.map(o => o.id).join('、') || '沒有'}；寫在元件的 prop outputs [{"id":"…","proccode":"…"}]）`);
            return;
        }
        const params = Array.isArray(output.params) ? output.params.map(p => p.id) : [];
        if (block.opcode === 'twcomp_outputParam') {
            const param = field('PARAM');
            if (!params.includes(param)) {
                this.problem('error', id, `輸出「${port}」沒有參數「${param}」（有：${params.join('、') || '沒有'}）`);
            }
        } else if (block.opcode !== 'twcomp_whenOutput') {
            for (const name of Object.keys(block.inputs || {})) {
                if (!params.includes(name)) {
                    this.problem('error', id, `輸出「${port}」沒有參數「${name}」（有：${params.join('、') || '沒有'}）`);
                }
            }
        }
    }

    // 呼叫 [角色] 的 [函式]: the sprite and its custom block
    checkCrossCall (id, block) {
        const mutation = block.mutation;
        if (!isObject(mutation)) return;
        const sprite = mutation.sprite;
        let target = this.target;
        if (sprite === '_stage_') target = this.stage;
        else if (sprite && sprite !== '_myself_') target = model.interfaceTargetOf(this.json, sprite, this.target);
        if (!target) {
            this.problem('error', id, `呼叫的角色「${sprite}」不存在`);
            return;
        }
        if (mutation.prototypeid && !(isObject(target.blocks) && isObject(target.blocks[mutation.prototypeid]))) {
            this.problem('error', id, `「${target.name}」沒有這個自訂積木（「${mutation.proccode}」）`);
        }
    }
}

/**
 * Variables that are read but never written or declared
 */
const checkData = (json, report, lines, svgs) => {
    const refs = findRefs(json, svgs);
    const targets = model.allTargets(json);
    const stage = json.targets.find(t => t.isStage);
    const declared = target => new Set(Object.values(target && target.variables || {}).map(v => v[0])
        .concat(Object.values(target && target.lists || {}).map(v => v[0])));
    // In a component `global` is the variables of its root (its properties are some of them); elsewhere the project's
    const ownerOf = name => {
        const target = targets.find(t => t.name === name);
        if (target && target.isComponent) return `component:${target.name}`;
        if (target && target.isMember) return `component:${target.componentId}`;
        return 'project';
    };
    const globalsOf = {project: declared(stage)};
    const globalsFor = owner => {
        if (!globalsOf[owner]) {
            const root = targets.find(t => t.isComponent && `component:${t.name}` === owner);
            globalsOf[owner] = declared(root);
            for (const prop of (root && Array.isArray(root.props) ? root.props : [])) globalsOf[owner].add(prop.name);
        }
        return globalsOf[owner];
    };
    const selfNames = {};
    for (const ref of refs) {
        if (ref.kind !== 'path' || !ref.write) continue;
        const target = targets.find(t => t.name === ref.target);
        // The root of a component: self. and global. are the same variables
        if (ref.scope === 'global' || (ref.scope === 'self' && target && target.isComponent)) {
            globalsFor(ownerOf(ref.target)).add(ref.name);
        }
        if (ref.scope === 'self') (selfNames[ref.target] = selfNames[ref.target] || new Set()).add(ref.name);
    }
    const reported = new Set();
    for (const ref of refs) {
        if (ref.kind === 'variable' || ref.kind === 'list') {
            const target = targets.find(t => t.name === ref.target);
            const store = ref.kind === 'list' ? 'lists' : 'variables';
            const ok = [target, stage].some(t => t && t[store] && Object.prototype.hasOwnProperty.call(t[store], ref.id));
            if (!ok) {
                // The VM makes it when it loads the project, so it works, but it probably isn't what was meant
                report({
                    level: 'warning',
                    line: lines && lines[ref.target] ? lines[ref.target][ref.blockId] || 0 : 0,
                    message: `${ref.kind === 'list' ? '清單' : '變數'}「${ref.name}」（id ${ref.id}）不存在，載入時會新建一個（「${ref.target}」）`
                });
            }
            continue;
        }
        if (ref.kind !== 'path' || ref.write) continue;
        let known;
        if (ref.scope === 'global') known = globalsFor(ownerOf(ref.target)).has(ref.name);
        else if (ref.scope === 'self') {
            const target = targets.find(t => t.name === ref.target);
            known = SELF_BUILTINS.has(ref.name) || declared(target).has(ref.name) ||
                (target && target.isComponent && globalsFor(ownerOf(ref.target)).has(ref.name)) ||
                // Any sprite may set a clone variable of another one (設定 [角色] id 為 () 的分身的 ())
                Object.values(selfNames).some(names => names.has(ref.name));
        } else {
            known = true;
        }
        const key = `${ref.target}:${ref.scope}:${ref.name}`;
        if (!known && !reported.has(key)) {
            reported.add(key);
            const scopeName = {global: '全域變數', self: '分身變數'}[ref.scope];
            report({
                level: 'warning',
                line: lines && lines[ref.target] ? lines[ref.target][ref.blockId] || 0 : 0,
                message: `${scopeName}「${ref.name}」只有讀取，沒有地方設定（「${ref.target}」的 ${ref.costume === void 0 ? ref.opcode : `造型「${ref.costume}」的綁定`} ${JSON.stringify(ref.text)}）`
            });
        }
    }
};

/**
 * Load the project in a VM and compile every script.
 */
const checkInVM = async (json, report, lines) => {
    const vm = makeVM();
    const before = messages.length;
    const copy = JSON.parse(JSON.stringify(json));
    // Extensions loaded from URLs can't run in Node, so the VM loads the project without them
    if (isObject(copy.extensionURLs) && Object.keys(copy.extensionURLs).length) {
        const custom = Object.keys(copy.extensionURLs);
        report({level: 'warning', line: 0, message: `自訂擴充 ${custom.join('、')} 不能在 Node 裡載入，它們的積木沒有驗證`});
        copy.extensions = (copy.extensions || []).filter(id => !custom.includes(id));
        delete copy.extensionURLs;
    }
    try {
        await vm.loadProject(copy);
    } catch (e) {
        report({level: 'error', line: 0, message: `VM 載入失敗：${e && e.message ? e.message : e}`});
        return;
    }
    const Thread = vmModule('src/engine/thread');
    const compile = vmModule('src/compiler/compile');
    for (const target of vm.runtime.targets) {
        if (!target.isOriginal) continue;
        const name = target.getName();
        for (const topId of target.blocks.getScripts()) {
            const top = target.blocks.getBlock(topId);
            if (!top || !vm.runtime.getIsHat(top.opcode) && top.opcode !== 'procedures_definition') continue;
            const thread = new Thread(topId);
            thread.target = target;
            thread.blockContainer = target.blocks;
            try {
                compile(thread);
            } catch (e) {
                report({
                    level: 'error',
                    line: lines && lines[name] ? lines[name][topId] || 0 : 0,
                    message: `編譯失敗：${e && e.message ? e.message : e}（「${name}」的 script ${topId} ${top.opcode}）`
                });
            }
        }
    }
    for (const message of messages.slice(before)) {
        // Assets aren't loaded (the VM has no storage here), so what goes wrong with them doesn't count
        if (message.level === 'error' && !/cannot compile script|font|asset|storage/i.test(message.text)) {
            report({level: 'warning', line: 0, message: `VM：${message.text}`});
        }
    }
    messages.length = before;
    vm.stopAll();
};

/**
 * @param {object} json project.json
 * @param {object} options
 * @param {object} options.defs block definitions
 * @param {object} [options.lines] line of every block, by target name and block id
 * @param {boolean} [options.vm] load and compile in the VM (default true)
 * @param {object} [options.svgs] SVG costumes by file name (project-file.js readSvgs), to check their bindings
 * @returns {Promise<Array<object>>} problems, in the order of the lines
 */
const check = async (json, options) => {
    const problems = [];
    const report = problem => problems.push(problem);
    if (!json || !Array.isArray(json.targets)) {
        return [{level: 'error', line: 0, message: 'project.json 沒有 targets'}];
    }
    for (const target of model.allTargets(json)) new TargetChecker(json, target, options, report).check();
    // Instances of components share the blocks of the component
    const components = isObject(json.components) ? json.components : {};
    for (const target of json.targets) {
        if (!target.component) continue;
        if (!components[target.component]) {
            report({level: 'error', line: 0, message: `「${target.name}」是不存在的元件 ${target.component} 的實體`});
        } else if (isObject(target.blocks) && Object.keys(target.blocks).length) {
            report({level: 'error', line: 0, message: `「${target.name}」是元件的實體，不能有自己的積木（積木寫在 component 裡）`});
        }
    }
    checkData(json, report, options.lines, options.svgs);
    // Mistakes in the bindings of SVG costumes: that binding does nothing
    for (const {target, costume, errors} of svgBindings(json, options.svgs)) {
        for (const error of errors) {
            report({level: 'warning', line: 0, message: `「${target}」的造型「${costume}」第 ${error.line} 行：${error.message}`});
        }
    }
    if (options.vm !== false && !problems.some(p => p.level === 'error')) await checkInVM(json, report, options.lines);
    return problems.sort((a, b) => (a.line || Infinity) - (b.line || Infinity));
};

module.exports = {
    check
};

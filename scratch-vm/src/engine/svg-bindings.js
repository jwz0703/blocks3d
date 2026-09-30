/**
 * @fileoverview
 * SVG bindings (ROADMAP.md 階段 10): costumes whose SVG has `{expression}` in its text or attributes, or
 * `data-bind-*` attributes, are drawn with the values of variables and component properties, and redrawn when they
 * change.
 *
 * - Text: `掉落 {掉落數目} 個`, with formats `{分數:00000}`, `{時間:0.0}`, `{比例:0%}`; `{{` and `}}` are braces.
 * - Any attribute, e.g. `height="{min(燃料, 100) / 10}"` (the SVG code mode); not `href`, `on…` or `style`, and a
 *   value with `url(` in it is not used.
 * - On an element (a `<g>` from the paint editor): `data-bind-x / y` move it, `data-bind-rotate` (degrees),
 *   `data-bind-scale-x / y` turn and scale it around `data-bind-origin="x y"`, `data-bind-fill / stroke` color it
 *   and every shape in it, `data-bind-opacity`, `data-bind-visible`.
 *
 * Expressions are the language of util/b3-expression.js. Variables: `分數` (global), `self.hp` (the sprite or clone),
 * in a component `分數` is a variable of its root (its properties are too), with data paths after them (`玩家.x`).
 *
 * The SVG is parsed once per costume; after that only the bound attributes and texts of that DOM are changed (a
 * value can't change the structure of the SVG), and it is serialized for the renderer. The viewBox and rotation
 * center stay as they were. Every frame before drawing, the bindings of each sprite and clone showing such a costume
 * are evaluated; only if a value changed is the costume redrawn, at most once per costume per frame. The costume's
 * own skin shows the values of the first sprite or clone that shows it; others whose values differ get their own
 * skin. When an expression fails, a text shows nothing and an attribute keeps its last value.
 */

const {parse, parseTemplate, checkBinding, evaluate, ExpressionError} = require('../util/b3-expression');
const dataPath = require('../util/data-path');
const Cast = require('../util/cast');
const {isForbiddenAttribute, ELEMENT_BINDINGS, BIND_PREFIX} = require('../util/svg-binding-scan');

/**
 * @param {string} svg
 * @returns {boolean} true if the SVG may have bindings (checked properly when it is parsed)
 */
const mayHaveBindings = svg => typeof svg === 'string' && (svg.includes('{') || svg.includes(BIND_PREFIX));

/**
 * @param {Element} element
 * @returns {boolean} true if nothing in it can be bound (styles, scripts, metadata)
 */
const isOpaque = element => ['style', 'script', 'metadata'].includes(element.localName);

/**
 * The bindings of an SVG, found in its parsed DOM.
 */
class Template {
    /**
     * @param {string} svg
     */
    constructor (svg) {
        this.svg = svg;
        /** @type {Array<object>} each: {kind, node/element, ...}; `index` is its first value */
        this.bindings = [];
        /** Errors in expressions, for the editor: {message, where} */
        this.errors = [];
        this.valueCount = 0;
        this.document = new DOMParser().parseFromString(svg, 'image/svg+xml');
        const root = this.document.documentElement;
        if (!root || root.localName !== 'svg' || root.getElementsByTagName('parsererror').length) {
            this.document = null;
            return;
        }
        this.serializer = new XMLSerializer();
        this.collect(root);
    }

    /** @returns {boolean} true if there is something to bind */
    get bound () {
        return this.bindings.length > 0;
    }

    addValue () {
        return this.valueCount++;
    }

    /**
     * @param {string} text
     * @param {string} where for errors
     * @returns {?Array} template parts, or null if it has no expressions (or a mistake)
     */
    template (text, where) {
        try {
            const parts = parseTemplate(text);
            if (!parts) return null;
            return parts.map(part => {
                if (typeof part === 'string') return part;
                return Object.assign({}, part, {index: this.addValue()});
            });
        } catch (e) {
            if (!(e instanceof ExpressionError)) throw e;
            this.errors.push({message: e.message, where});
            return null;
        }
    }

    expression (source, where) {
        try {
            const tree = parse(source);
            const error = checkBinding(tree);
            if (error) throw error;
            return {tree, index: this.addValue()};
        } catch (e) {
            if (!(e instanceof ExpressionError)) throw e;
            this.errors.push({message: e.message, where});
            return null;
        }
    }

    collect (element) {
        if (isOpaque(element)) return;
        const elementBinding = {};
        let hasElementBinding = false;
        for (const attribute of Array.from(element.attributes)) {
            const name = attribute.name;
            const where = `<${element.localName} ${name}>`;
            if (name.startsWith(BIND_PREFIX)) {
                const key = name.slice(BIND_PREFIX.length);
                if (key === 'origin') {
                    const [ox, oy] = attribute.value.trim().split(/[\s,]+/)
                        .map(Number);
                    elementBinding.origin = [ox || 0, oy || 0];
                } else if (ELEMENT_BINDINGS.includes(key) && attribute.value.trim()) {
                    const expression = this.expression(attribute.value, where);
                    if (expression) {
                        elementBinding[key] = expression;
                        hasElementBinding = true;
                    }
                }
            } else if (!isForbiddenAttribute(name) && attribute.value.includes('{')) {
                const parts = this.template(attribute.value, where);
                if (parts) {
                    this.bindings.push({kind: 'attribute', element, name, parts, original: attribute.value});
                }
            }
        }
        if (hasElementBinding) {
            elementBinding.origin = elementBinding.origin || [0, 0];
            this.bindings.push({
                kind: 'element',
                element,
                bind: elementBinding,
                transform: element.getAttribute('transform') || '',
                display: element.getAttribute('display'),
                // Shapes whose colors data-bind-fill / stroke replace
                painted: {
                    fill: elementBinding.fill ? this.painted(element, 'fill') : [],
                    stroke: elementBinding.stroke ? this.painted(element, 'stroke') : []
                }
            });
        }
        for (const child of Array.from(element.childNodes)) {
            if (child.nodeType === 1) {
                this.collect(child);
            } else if (child.nodeType === 3 && child.data.includes('{')) {
                const parts = this.template(child.data, `<${element.localName}> 的文字`);
                if (parts) this.bindings.push({kind: 'text', node: child, parts});
            }
        }
    }

    painted (element, attribute) {
        const result = [element];
        const walk = node => {
            for (const child of Array.from(node.children)) {
                if (isOpaque(child) || child.localName === 'defs') continue;
                const value = child.getAttribute(attribute);
                if (value && value !== 'none') result.push(child);
                walk(child);
            }
        };
        walk(element);
        return result;
    }

    /**
     * @param {function(object): *} read value of a path node
     * @param {?Array} last values from last time, used where an expression fails
     * @returns {Array} the value of every expression (undefined where it failed and there was none before)
     */
    evaluate (read, last) {
        const values = new Array(this.valueCount);
        const run = (tree, index) => {
            try {
                values[index] = evaluate(tree, read);
            } catch (e) {
                values[index] = last ? last[index] : void 0;
            }
        };
        for (const binding of this.bindings) {
            if (binding.kind === 'element') {
                for (const key of ELEMENT_BINDINGS) {
                    if (binding.bind[key]) run(binding.bind[key].tree, binding.bind[key].index);
                }
            } else {
                for (const part of binding.parts) {
                    if (typeof part !== 'string') run(part.tree, part.index);
                }
            }
        }
        return values;
    }

    /**
     * @param {Array} values from evaluate()
     * @returns {string} the SVG with these values
     */
    render (values) {
        const fill = (parts, fallback) => {
            let text = '';
            for (const part of parts) {
                if (typeof part === 'string') {
                    text += part;
                } else {
                    const value = values[part.index];
                    if (value === void 0) {
                        if (fallback !== null) return fallback;
                        continue;
                    }
                    text += part.format ? part.format(value) : Cast.toString(value);
                }
            }
            return text;
        };
        for (const binding of this.bindings) {
            if (binding.kind === 'text') {
                binding.node.data = fill(binding.parts, null);
            } else if (binding.kind === 'attribute') {
                const value = fill(binding.parts, binding.original);
                // Values can't bring in other resources
                binding.element.setAttribute(binding.name, /url\s*\(/i.test(value) ? binding.original : value);
            } else {
                this.renderElement(binding, values);
            }
        }
        return this.serializer.serializeToString(this.document);
    }

    renderElement (binding, values) {
        const {bind, element} = binding;
        const value = (key, fallback) => {
            if (!bind[key]) return fallback;
            const v = values[bind[key].index];
            return v === void 0 ? fallback : v;
        };
        const number = (key, fallback) => {
            const n = Cast.toNumber(value(key, fallback));
            return isFinite(n) ? n : fallback;
        };
        const transforms = [];
        if (bind.x || bind.y) transforms.push(`translate(${number('x', 0)} ${number('y', 0)})`);
        if (bind.rotate || bind['scale-x'] || bind['scale-y']) {
            const [ox, oy] = bind.origin;
            transforms.push(`translate(${ox} ${oy})`);
            if (bind.rotate) transforms.push(`rotate(${number('rotate', 0)})`);
            if (bind['scale-x'] || bind['scale-y']) {
                transforms.push(`scale(${number('scale-x', 1)} ${number('scale-y', 1)})`);
            }
            transforms.push(`translate(${-ox} ${-oy})`);
        }
        if (binding.transform) transforms.push(binding.transform);
        if (transforms.length) element.setAttribute('transform', transforms.join(' '));
        else element.removeAttribute('transform');
        for (const key of ['fill', 'stroke']) {
            if (!bind[key]) continue;
            const color = value(key);
            if (color === void 0) continue;
            const text = Cast.toString(color);
            if (/url\s*\(/i.test(text)) continue;
            for (const shape of binding.painted[key]) shape.setAttribute(key, text);
        }
        if (bind.opacity) element.setAttribute('opacity', Math.min(1, Math.max(0, number('opacity', 1))));
        if (bind.visible) {
            const visible = value('visible');
            if (visible !== void 0 && !Cast.toBoolean(visible)) element.setAttribute('display', 'none');
            else if (binding.display === null) element.removeAttribute('display');
            else element.setAttribute('display', binding.display);
        }
    }
}

/**
 * @param {Target} target
 * @param {object} node a path node of an expression
 * @returns {*} its value for that target
 */
const readPath = (target, node) => dataPath.get(target, null, node.text);

class SvgBindings {
    constructor (runtime) {
        this.runtime = runtime;
        /** @type {WeakMap<object, {source: string, template: ?Template, key: ?string, owner: ?Target}>} costume → */
        this.costumes = new WeakMap();
        /** @type {Map<Target, {costume: object, skinId: ?number, key: ?string, values: ?Array}>} */
        this.targets = new Map();
        this.enabled = typeof DOMParser !== 'undefined' && typeof XMLSerializer !== 'undefined';
    }

    /**
     * @param {object} costume
     * @returns {?object} the binding state of the costume, if it has bindings
     */
    costumeState (costume) {
        const source = costume && costume.svgBindingSource;
        if (!source) return null;
        let state = this.costumes.get(costume);
        if (!state || state.source !== source) {
            let template = null;
            try {
                template = new Template(source);
            } catch (e) {
                template = null;
            }
            const bound = template && template.document && template.bound;
            state = {source, template: bound ? template : null, key: null, owner: null};
            this.costumes.set(costume, state);
        }
        return state.template ? state : null;
    }

    /**
     * @param {object} costume
     * @returns {Array<{message: string, where: string}>} mistakes in its bindings
     */
    errorsOf (costume) {
        this.costumeState(costume);
        const state = this.costumes.get(costume);
        return state && state.template ? state.template.errors : [];
    }

    /**
     * Evaluate the bindings and redraw what changed. Called once per frame, before drawing.
     */
    update () {
        const renderer = this.runtime.renderer;
        if (!this.enabled || !renderer) return;
        const entries = [];
        const alive = new Set();
        for (const target of this.runtime.targets) {
            if (target.is3D || typeof target.drawableID !== 'number' || !target.sprite) continue;
            alive.add(target);
        }
        for (const target of alive) {
            const costume = target.getCostumes()[target.currentCostume];
            const state = this.costumeState(costume);
            const own = this.targets.get(target);
            if (own && own.costume !== costume) this.release(target, own);
            if (!state) continue;
            if (!state.owner || !alive.has(state.owner) ||
                state.owner.getCostumes()[state.owner.currentCostume] !== costume) {
                state.owner = target;
                state.key = null;
            }
            entries.push({target, costume, state});
        }
        for (const [target, own] of this.targets) {
            if (!alive.has(target)) this.release(target, own);
        }
        // The owners first, so that the others compare with this frame's values
        entries.sort((a, b) => (a.state.owner === a.target ? 0 : 1) - (b.state.owner === b.target ? 0 : 1));
        for (const {target, costume, state} of entries) this.updateTarget(target, costume, state);
    }

    updateTarget (target, costume, state) {
        const renderer = this.runtime.renderer;
        let own = this.targets.get(target);
        if (!own) {
            own = {costume, skinId: null, key: null, values: null};
            this.targets.set(target, own);
        }
        const values = state.template.evaluate(node => readPath(target, node), own.values);
        own.values = values;
        const key = JSON.stringify(values, (k, v) => (v === void 0 ? null : v));
        const center = [costume.rotationCenterX, costume.rotationCenterY];
        let skinId;
        if (state.owner === target || key === state.key) {
            if (state.owner === target && key !== state.key) {
                renderer.updateSVGSkin(costume.skinId, state.template.render(values), center);
                state.key = key;
            }
            if (own.skinId !== null) {
                renderer.destroySkin(own.skinId);
                own.skinId = null;
                own.key = null;
            }
            skinId = costume.skinId;
        } else {
            if (own.skinId === null) {
                own.skinId = renderer.createSVGSkin(state.template.render(values), center);
                own.key = key;
            } else if (own.key !== key) {
                renderer.updateSVGSkin(own.skinId, state.template.render(values), center);
                own.key = key;
            }
            skinId = own.skinId;
        }
        if (renderer.getDrawableSkinId(target.drawableID) !== skinId) {
            renderer.updateDrawableSkinId(target.drawableID, skinId);
            this.runtime.requestRedraw();
        }
    }

    release (target, own) {
        const renderer = this.runtime.renderer;
        if (own.skinId !== null && renderer) {
            if (typeof target.drawableID === 'number' && renderer.getDrawableSkinId(target.drawableID) === own.skinId) {
                const costume = target.getCostumes()[target.currentCostume];
                if (costume) renderer.updateDrawableSkinId(target.drawableID, costume.skinId);
            }
            renderer.destroySkin(own.skinId);
        }
        this.targets.delete(target);
    }

    /** Forget everything (a new project) */
    reset () {
        for (const [target, own] of this.targets) this.release(target, own);
        this.costumes = new WeakMap();
    }
}

/**
 * @param {string} svg
 * @returns {string} the SVG to give the renderer before the bindings have values: expressions worked out with empty
 * variables (an attribute like `transform="rotate({…})"` would stop it from loading)
 */
const renderableSvg = svg => {
    if (!mayHaveBindings(svg) || typeof DOMParser === 'undefined') return svg;
    try {
        const template = new Template(svg);
        if (!template.document || !template.bound) return svg;
        return template.render(template.evaluate(() => '', null));
    } catch (e) {
        return svg;
    }
};

/**
 * Remember the SVG of a costume if it may have bindings.
 * @param {object} costume
 * @param {string} svg
 */
const setCostumeSource = (costume, svg) => {
    if (mayHaveBindings(svg)) costume.svgBindingSource = svg;
    else delete costume.svgBindingSource;
};

module.exports = {
    SvgBindings,
    Template,
    mayHaveBindings,
    setCostumeSource,
    renderableSvg,
    readPath
};

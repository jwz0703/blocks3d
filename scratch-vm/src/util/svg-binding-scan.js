/**
 * @fileoverview
 * Finds the bindings of an SVG in its text, with their lines: for the SVG code mode (errors on their lines) and
 * tools/3dsb-text (which variables costumes read), where there is no DOM. engine/svg-bindings.js does the binding
 * itself on the parsed SVG; the rules of what is a binding are the same.
 */
const {parse, parseTemplate, checkBinding, ExpressionError} = require('./b3-expression');

const BIND_PREFIX = 'data-bind-';
const ELEMENT_BINDINGS = ['x', 'y', 'rotate', 'scale-x', 'scale-y', 'fill', 'stroke', 'opacity', 'visible'];

/** Attributes that are not bound even if they look like templates */
const isForbiddenAttribute = name => /^on/i.test(name) || name === 'style' || /(^|:)href$/i.test(name);

const ENTITIES = {lt: '<', gt: '>', amp: '&', quot: '"', apos: '\''};

/**
 * @param {string} text XML text or attribute value
 * @returns {{text: string, map: Array<number>}} decoded, and for every character of it its offset in the input
 */
const decode = text => {
    let out = '';
    const map = [];
    let i = 0;
    while (i < text.length) {
        if (text[i] === '&') {
            const match = /^&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/i.exec(text.slice(i, i + 12));
            if (match) {
                const name = match[1];
                let c = ENTITIES[name];
                if (name[0] === '#') {
                    const hex = name[1] === 'x' || name[1] === 'X';
                    c = String.fromCodePoint(hex ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10));
                }
                if (typeof c === 'string') {
                    out += c;
                    for (let k = 0; k < c.length; k++) map.push(i);
                    i += match[0].length;
                    continue;
                }
            }
        }
        out += text[i];
        map.push(i);
        i++;
    }
    map.push(i);
    return {text: out, map};
};

/**
 * @param {string} svg
 * @returns {{bindings: Array<object>, errors: Array<object>}} bindings: {kind: 'text'|'attribute'|'element', name,
 * element, source, trees, line, column}; errors: {message, line, column}. Lines and columns are 1-based, in the SVG.
 */
const scanSvgBindings = svg => {
    const bindings = [];
    const errors = [];
    const lineStarts = [0];
    for (let i = 0; i < svg.length; i++) if (svg[i] === '\n') lineStarts.push(i + 1);
    const position = offset => {
        let lo = 0;
        let hi = lineStarts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (lineStarts[mid] <= offset) lo = mid;
            else hi = mid - 1;
        }
        return {line: lo + 1, column: offset - lineStarts[lo] + 1};
    };
    // Where an error within a piece of text (from `start` in the SVG) is
    const errorAt = (e, raw, start) => {
        const {map} = decode(raw);
        // e.line / e.column are within the decoded text
        const decodedLines = decode(raw).text.split('\n');
        let offset = 0;
        for (let l = 1; l < (e.line || 1); l++) offset += decodedLines[l - 1].length + 1;
        offset += (e.column || 1) - 1;
        const p = position(start + map[Math.min(offset, map.length - 1)]);
        errors.push({message: e.message, line: p.line, column: p.column});
    };
    const template = (raw, start, binding) => {
        const {text} = decode(raw);
        if (!text.includes('{')) return;
        try {
            const parts = parseTemplate(text);
            if (!parts) return;
            const p = position(start);
            bindings.push(Object.assign(binding, {
                source: text,
                trees: parts.filter(part => typeof part !== 'string').map(part => part.tree),
                line: p.line,
                column: p.column
            }));
        } catch (e) {
            if (!(e instanceof ExpressionError)) throw e;
            errorAt(e, raw, start);
        }
    };
    const skip = [];
    // Comments and the like, a closing tag, an opening tag (name, attributes, self-closing) or text
    const re = new RegExp([
        '<!--[\\s\\S]*?-->|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>|<[?!][^>]*>',
        '<\\/\\s*([\\w:.-]+)\\s*>',
        '<([\\w:.-]+)((?:\\s+[^\\s=/>]+\\s*=\\s*(?:"[^"]*"|\'[^\']*\'))*)\\s*(\\/?)>',
        '([^<]+)'
    ].join('|'), 'g');
    let match;
    let element = null;
    while ((match = re.exec(svg))) {
        const [whole, closing, open, attributes, selfClosing, text] = match;
        if (closing) {
            if (skip.length && skip[skip.length - 1] === closing) skip.pop();
            continue;
        }
        if (open) {
            element = open;
            if (skip.length) {
                if (!selfClosing && skip[skip.length - 1] === open) skip.push(open);
                continue;
            }
            if (['style', 'script', 'metadata'].includes(open) && !selfClosing) {
                skip.push(open);
                continue;
            }
            const attrRe = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
            let attr;
            const offset = match.index + 1 + open.length;
            while ((attr = attrRe.exec(attributes))) {
                const name = attr[1];
                const raw = typeof attr[3] === 'string' ? attr[3] : attr[4];
                const start = offset + attr.index + attr[0].indexOf(attr[2]) + 1;
                if (name.startsWith(BIND_PREFIX)) {
                    const key = name.slice(BIND_PREFIX.length);
                    if (!ELEMENT_BINDINGS.includes(key)) continue;
                    const {text: source} = decode(raw);
                    if (!source.trim()) continue;
                    try {
                        const tree = parse(source);
                        const error = checkBinding(tree);
                        if (error) throw error;
                        const {line, column} = position(start);
                        bindings.push({kind: 'element', name, element: open, source, trees: [tree], line, column});
                    } catch (e) {
                        if (!(e instanceof ExpressionError)) throw e;
                        errorAt(e, raw, start);
                    }
                } else if (!isForbiddenAttribute(name)) {
                    template(raw, start, {kind: 'attribute', name, element: open});
                }
            }
        } else if (text !== void 0 && !skip.length && whole.includes('{')) {
            template(text, match.index, {kind: 'text', name: null, element});
        }
    }
    return {bindings, errors};
};

module.exports = {
    scanSvgBindings,
    isForbiddenAttribute,
    ELEMENT_BINDINGS,
    BIND_PREFIX
};

const TOKEN = new RegExp([
    '<!--[\\s\\S]*?-->',
    '<!\\[CDATA\\[[\\s\\S]*?\\]\\]>',
    '<\\?[\\s\\S]*?\\?>',
    '<![^>]*>',
    '<\\/?[A-Za-z][^\\s>\\/]*(?:"[^"]*"|\'[^\']*\'|[^>"\'])*>',
    '[^<]+|<'
].join('|'), 'g');
const INLINE = /^(text|tspan|style|script|title|desc)$/;
const WIDTH = 100;

/**
 * Lays out SVG text one tag per line, indented. Works on the text, not a DOM, so `{…}` bindings stay as written.
 * Text inside <text> and friends is left alone, since its whitespace shows.
 * @param {string} source the SVG
 * @returns {string} the SVG laid out
 */
const formatSvg = source => {
    const out = [];
    let depth = 0;
    let inlineDepth = 0;
    let inlineLine = '';
    const pad = () => '  '.repeat(Math.max(0, depth));
    const emit = tag => {
        if (tag.length + (depth * 2) <= WIDTH) return pad() + tag;
        // One attribute per line
        const match = /^(<[^\s>/]+)((?:\s[\s\S]*?)?)(\/?>)$/.exec(tag);
        if (!match || !match[2].trim()) return pad() + tag;
        const attrs = match[2].match(/[^\s=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"']+))?/g) || [];
        return [pad() + match[1]].concat(attrs.map(a => `${pad()}  ${a}`)).join('\n') + match[3];
    };
    for (const token of source.match(TOKEN) || []) {
        if (inlineDepth > 0) {
            inlineLine += token;
            const name = /^<\/?([^\s>/]+)/.exec(token);
            if (name && token[0] === '<' && !/^<[!?]/.test(token)) {
                if (token[1] === '/') inlineDepth--;
                else if (!/\/>$/.test(token)) inlineDepth++;
            }
            if (inlineDepth === 0) {
                out.push(pad() + inlineLine.trim());
                inlineLine = '';
            }
            continue;
        }
        if (token[0] !== '<') {
            if (token.trim()) out.push(pad() + token.trim());
            continue;
        }
        if (/^<[!?]/.test(token)) {
            out.push(pad() + token);
            continue;
        }
        const name = /^<\/?([^\s>/]+)/.exec(token)[1];
        if (token[1] === '/') {
            depth--;
            out.push(emit(token));
        } else if (/\/>$/.test(token)) {
            out.push(emit(token));
        } else if (INLINE.test(name.replace(/^.*:/, ''))) {
            inlineLine = token;
            inlineDepth = 1;
        } else {
            out.push(emit(token));
            depth++;
        }
    }
    if (inlineLine) out.push(inlineLine);
    return `${out.join('\n')}\n`;
};

/**
 * @param {string} text the SVG
 * @returns {boolean} whether it is crammed into long lines
 */
const needsFormat = text => text.split('\n').some(line => line.length > 160);

export {formatSvg, needsFormat};

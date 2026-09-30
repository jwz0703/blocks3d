/**
 * @fileoverview
 * SVG bindings in the paint editor (Blocks3D, ROADMAP.md 階段 10).
 *
 * Group bindings: kept on a group as `item.data.bind` ({anchor: [ax, ay], x: '…', fill: '…', …}) and saved as
 * `data-bind-*` attributes of its `<g>`, which the runtime (scratch-vm engine/svg-bindings.js) reads. The anchor is
 * where the group turns and scales from, as a fraction of its bounds (0 0 is the top left); it is saved as
 * `data-bind-anchor` for the editor and as `data-bind-origin` (the point itself, in the coordinates of the SVG) for
 * the runtime.
 *
 * Code objects: an element with `{…}` in an attribute (`width="{寬度 - 1}"`) or in its text can't be turned into
 * paper.js shapes and back without losing the expressions, so it is kept as its markup (`item.data.codeBinding`) in a
 * group that shows it drawn with the values of the sprite being edited (the same Template as the runtime, so the
 * editor and the SVG code show the same thing). The group can be selected, moved, turned and scaled as a whole; three
 * invisible points in it (`isCodeBindingAnchor`) follow where the coordinates of the markup go, and when saving, the
 * markup goes back in its place with that transform (restoreCodeBindings). Its attributes and text are edited in the
 * binding panel, and any shape can be turned into one (toCodeObject) to bind any attribute.
 */
import paper from '@turbowarp/paper';
import {Template} from 'scratch-vm/src/engine/svg-bindings';
import {getGuideLayer} from './layer';
import {isGroupItem} from './item';
import {scaleWithStrokes} from './math';

const PREFIX = 'data-bind-';
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** What can be bound, in the order of the panel */
const BIND_KEYS = ['x', 'y', 'rotate', 'scale-x', 'scale-y', 'fill', 'stroke', 'opacity', 'visible'];

const DEFAULT_ANCHOR = [0.5, 0.5];

/**
 * @param {paper.Item} item the paper.js item
 * @returns {boolean} true if the item has bindings
 */
const hasBinding = item => !!(item && item.data && item.data.bind &&
    BIND_KEYS.some(key => typeof item.data.bind[key] === 'string' && item.data.bind[key].trim()));

const isForbiddenAttribute = name => /^on/i.test(name) || name === 'style' || /(^|:)href$/i.test(name);

/**
 * @param {string} text an attribute or text
 * @returns {boolean} true if it has an expression in it (`{{` is a brace)
 */
const hasExpression = text => typeof text === 'string' && text.replace(/\{\{/g, '').includes('{');

/**
 * @param {paper.Item} item the paper.js item
 * @returns {boolean} true if it is a code object
 */
const isCodeObject = item => !!(item && item.data && typeof item.data.codeBinding === 'string');

/**
 * @param {paper.Item} item the paper.js item
 * @returns {boolean} true if it is part of the picture of a code object (it can't be edited on its own)
 */
const isCodeObjectPart = item => {
    for (let parent = item && item.parent; parent; parent = parent.parent) {
        if (isCodeObject(parent)) return true;
    }
    return false;
};

/**
 * @param {paper.Item} item the paper.js item
 * @returns {boolean} true if it is a group that has to stay a group (reducing or ungrouping it would lose bindings)
 */
const keepsGroup = item => hasBinding(item) || isCodeObject(item);

/**
 * @param {Element} node the SVG element
 * @returns {boolean} true if an attribute of it (not data-bind-*) or its text is bound: it becomes a code object
 */
const hasCodeBinding = node => {
    const attributes = Array.from(node.attributes || []).some(attribute =>
        !attribute.name.startsWith(PREFIX) && !isForbiddenAttribute(attribute.name) && hasExpression(attribute.value));
    if (attributes) return true;
    // A text is one thing: its tspans can't be separate
    if (node.localName === 'text') return hasExpression(node.textContent);
    return Array.from(node.childNodes).some(child => child.nodeType === 3 && hasExpression(child.data));
};

// Values of variables and properties, given by the editor (scratch-gui): the sprite being edited
let readValue = () => '';

/**
 * @param {?function(object): *} read path node of an expression → its value, for the sprite being edited
 */
const setBindingReader = read => {
    readValue = typeof read === 'function' ? read : () => '';
};

/**
 * @param {string} markup an element
 * @returns {?Element} it parsed
 */
const parseMarkup = markup => {
    const doc = new DOMParser().parseFromString(
        `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}">${markup}</svg>`, 'image/svg+xml');
    if (doc.getElementsByTagName('parsererror').length) return null;
    return doc.documentElement.firstElementChild;
};

/**
 * Put back what the Template changed that isn't bound (data-bind-* of elements are the runtime's business: the
 * editor shows the element as it is drawn before them).
 * @param {Element} original the element as written
 * @param {Element} evaluated the same element, worked out
 */
const restoreUnbound = (original, evaluated) => {
    for (const attribute of Array.from(evaluated.attributes)) {
        if (!original.hasAttribute(attribute.name)) evaluated.removeAttribute(attribute.name);
    }
    for (const attribute of Array.from(original.attributes)) {
        if (!hasExpression(attribute.value) || attribute.name.startsWith(PREFIX)) {
            evaluated.setAttribute(attribute.name, attribute.value);
        }
    }
    const a = Array.from(original.children);
    const b = Array.from(evaluated.children);
    for (let i = 0; i < a.length && i < b.length; i++) restoreUnbound(a[i], b[i]);
};

/**
 * @param {string} markup an element with bindings
 * @returns {string} it with the values of the sprite being edited
 */
const evaluateMarkup = markup => {
    const original = parseMarkup(markup);
    if (!original) return markup;
    let rendered;
    try {
        const template = new Template(`<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}">${markup}</svg>`);
        if (!template.document || !template.bound) return markup;
        rendered = template.render(template.evaluate(node => {
            const value = readValue(node);
            return value === null || typeof value === 'undefined' ? '' : value;
        }, null));
    } catch (e) {
        return markup;
    }
    const doc = new DOMParser().parseFromString(rendered, 'image/svg+xml');
    const evaluated = doc.documentElement && doc.documentElement.firstElementChild;
    if (!evaluated) return markup;
    restoreUnbound(original, evaluated);
    return new XMLSerializer().serializeToString(evaluated);
};

/**
 * paper.js (Scratch's fork) ignores `x` and `y` of texts and puts a text without tspans a line lower, while browsers
 * (and so the stage) use them: texts become the form the paint editor writes, `transform` and `<tspan x="0" dy="0">`.
 * @param {Element} root an element
 */
const normalizeTexts = root => {
    const texts = root.localName === 'text' ? [root] : Array.from(root.getElementsByTagName('text'));
    for (const text of texts) {
        const x = parseFloat(text.getAttribute('x')) || 0;
        const y = parseFloat(text.getAttribute('y')) || 0;
        text.removeAttribute('x');
        text.removeAttribute('y');
        if (x || y) {
            const own = text.getAttribute('transform');
            text.setAttribute('transform', `${own ? `${own} ` : ''}translate(${x} ${y})`);
        }
        if (text.children.length === 0) {
            const tspan = text.ownerDocument.createElementNS(SVG_NS, 'tspan');
            tspan.setAttribute('x', '0');
            tspan.setAttribute('dy', '0');
            tspan.textContent = text.textContent;
            text.textContent = '';
            text.appendChild(tspan);
        }
    }
};

/**
 * Before importing: texts are made readable by paper.js (normalizeTexts), and elements with bindings of their
 * attributes or text become `<g data-code-binding="their markup">`
 * around them worked out with the values of the sprite being edited, the picture of them.
 * @param {string} svg the SVG
 * @returns {string} the SVG to import
 */
const prepareCodeBindings = svg => {
    if (typeof svg !== 'string' || !(svg.includes('{') || svg.includes('<text'))) return svg;
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) return svg;
    let changed = false;
    const serializer = new XMLSerializer();
    const walk = element => {
        for (const child of Array.from(element.children)) {
            if (['style', 'script', 'metadata', 'defs'].includes(child.localName)) continue;
            if (hasCodeBinding(child)) {
                const markup = serializer.serializeToString(child).replace(` xmlns="${SVG_NS}"`, '');
                const picture = parseMarkup(evaluateMarkup(markup));
                const group = doc.createElementNS(SVG_NS, 'g');
                group.setAttribute('data-code-binding', markup);
                if (picture) {
                    normalizeTexts(picture);
                    group.appendChild(doc.importNode(picture, true));
                }
                element.replaceChild(group, child);
                changed = true;
            } else {
                walk(child);
            }
        }
    };
    walk(root);
    if (root.getElementsByTagName('text').length) {
        // Not the markup of code objects: it is kept in an attribute
        normalizeTexts(root);
        changed = true;
    }
    return changed ? serializer.serializeToString(doc) : svg;
};

/**
 * @param {paper.Group} item a code object
 * @param {string} markup the markup of an element
 */
const markCodeObject = (item, markup) => {
    item.data.codeBinding = markup;
    item.data.codeBindingShown = evaluateMarkup(markup);
    item.opacity = 1;
    item.locked = false;
};

/**
 * @returns {paper.Path} the three points that follow the coordinates of the markup: (0, 0), (1, 0) and (0, 1)
 */
const makeAnchor = () => {
    const anchor = new paper.Path({segments: [[0, 0], [1, 0], [0, 1]], insert: false});
    anchor.fillColor = null;
    anchor.strokeColor = null;
    anchor.data.isCodeBindingAnchor = true;
    // Moves with the rest, but isn't in the bounds, hit or drawn
    anchor.visible = false;
    return anchor;
};

/**
 * @param {Element} node the <g> made by prepareCodeBindings
 * @param {paper.Group} item what paper.js made of it
 * @returns {paper.Group} the code object
 */
const importCodeObject = (node, item) => {
    item.insertChild(0, makeAnchor());
    markCodeObject(item, node.getAttribute('data-code-binding'));
    return item;
};

/**
 * @param {paper.Group} item a code object
 * @returns {paper.Matrix} from the coordinates of its markup to the ones of its children
 */
const codeObjectMatrix = item => {
    const anchor = item.children.find(child => child.data.isCodeBindingAnchor);
    if (!anchor) return new paper.Matrix();
    const [p0, p1, p2] = anchor.segments.map(segment => anchor.matrix.transform(segment.point));
    return new paper.Matrix(p1.x - p0.x, p1.y - p0.y, p2.x - p0.x, p2.y - p0.y, p0.x, p0.y);
};

/**
 * @param {string} shown markup worked out
 * @param {paper.Matrix} matrix where to put it
 * @returns {Array<paper.Item>} paper.js items that draw it
 */
const pictureOf = (shown, matrix) => {
    let root;
    try {
        const element = parseMarkup(shown);
        if (!element) return [];
        normalizeTexts(element);
        const markup = new XMLSerializer().serializeToString(element);
        const svg = `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}">${markup}</svg>`;
        root = paper.project.importSVG(svg, {insert: false, expandShapes: true});
    } catch (e) {
        return [];
    }
    if (!root) return [];
    const items = root.children.slice().filter(child => !child.isClipMask());
    const scale = Math.sqrt(Math.abs((matrix.a * matrix.d) - (matrix.b * matrix.c))) || 1;
    for (const item of items) {
        item.remove();
        item.transform(matrix);
        // Strokes get thicker with the rest (like scaleWithStrokes)
        const visit = each => {
            if (each.strokeWidth && !(each instanceof paper.PointText)) each.strokeWidth *= scale;
            if (each.children) each.children.forEach(visit);
        };
        visit(item);
    }
    return items;
};

/**
 * Draw a code object again from its markup (after it changed, or the values it shows did), where it is.
 * @param {paper.Group} item the paper.js item
 * @param {boolean} [force] even if the values shown are the same
 * @returns {boolean} true if it was drawn again
 */
const redrawCodeObject = (item, force) => {
    const shown = evaluateMarkup(item.data.codeBinding);
    if (!force && shown === item.data.codeBindingShown) return false;
    const matrix = codeObjectMatrix(item);
    const selected = item.selected;
    for (const child of item.children.slice()) {
        if (!child.data.isCodeBindingAnchor) child.remove();
    }
    item.addChildren(pictureOf(shown, matrix));
    item.data.codeBindingShown = shown;
    if (selected) item.selected = true;
    return true;
};

/**
 * Change the markup of a code object.
 * @param {paper.Group} item the paper.js item
 * @param {string} markup the markup of an element
 */
const setCodeObjectMarkup = (item, markup) => {
    item.data.codeBinding = markup;
    redrawCodeObject(item, true);
};

/**
 * Draw again the code objects whose values changed (the project running, a property changed in the sprite info).
 * @returns {boolean} true if something was drawn again
 */
const refreshCodeObjects = () => {
    if (!paper.project) return false;
    let changed = false;
    const visit = item => {
        if (isCodeObject(item)) {
            if (redrawCodeObject(item)) changed = true;
        } else if (item.children) {
            item.children.forEach(visit);
        }
    };
    for (const layer of paper.project.layers) {
        if (layer.data && layer.data.isPaintingLayer) visit(layer);
    }
    return changed;
};

/**
 * A rectangle drawn in the editor is a path; as a code object it is a <rect>, whose width and height can be bound.
 * @param {paper.Item} item the paper.js item
 * @param {Element} node what paper.js exported of it
 * @returns {Element} a <rect> with the same look, or the node
 */
const asRect = (item, node) => {
    if (!(item instanceof paper.Path) || !item.closed || item.segments.length !== 4 || node.localName !== 'path') {
        return node;
    }
    const round = n => Math.round(n * 1000) / 1000;
    const points = item.segments.map(segment => segment.point);
    if (item.segments.some(segment => !segment.handleIn.isZero() || !segment.handleOut.isZero())) return node;
    const xs = Array.from(new Set(points.map(point => round(point.x))));
    const ys = Array.from(new Set(points.map(point => round(point.y))));
    if (xs.length !== 2 || ys.length !== 2) return node;
    const rect = node.ownerDocument.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', Math.min(...xs));
    rect.setAttribute('y', Math.min(...ys));
    rect.setAttribute('width', round(Math.abs(xs[1] - xs[0])));
    rect.setAttribute('height', round(Math.abs(ys[1] - ys[0])));
    for (const attribute of Array.from(node.attributes)) {
        if (attribute.name === 'd' || /^xmlns/.test(attribute.name)) continue;
        rect.setAttribute(attribute.name, attribute.value);
    }
    return rect;
};

/**
 * Turn a shape (or group) into a code object, so that any attribute of it can be bound.
 * @param {paper.Item} item a root item
 * @param {function(paper.Item, Element)} [onExport] for bindings of groups in it
 * @returns {?paper.Group} the code object, in its place
 */
const toCodeObject = (item, onExport) => {
    if (isCodeObject(item)) return item;
    // In the coordinates of the costume (the editor works at 2x), so that the markup reads like the SVG code
    const toCostume = new paper.Matrix().scale(0.5);
    const copy = item.clone({insert: false});
    scaleWithStrokes(copy, 0.5, new paper.Point());
    let node = copy.exportSVG({asString: false, onExport});
    if (!node) return null;
    node = asRect(copy, node);
    const markup = new XMLSerializer().serializeToString(node)
        .replace(/ xmlns="[^"]*"/, '');
    const group = new paper.Group({insert: false});
    group.addChild(makeAnchor());
    group.transform(toCostume.inverted());
    group.data.codeBinding = markup;
    group.insertAbove(item);
    item.remove();
    redrawCodeObject(group, true);
    group.opacity = 1;
    return group;
};

/**
 * paper.js exportSVG `onExport` for code objects: marks them for restoreCodeBindings
 * @param {paper.Item} item the paper.js item
 * @param {Element} node the SVG element
 * @param {Array<paper.Item>} locked the marked items so far
 */
const markCodeBinding = (item, node, locked) => {
    if (!isCodeObject(item) || !node || !node.setAttribute) return;
    node.setAttribute('data-code-binding', String(locked.length));
    locked.push(item);
};

/**
 * @param {Element} element an SVG element
 * @param {Array<number>} m a matrix [a b c d e f] to put before its own transform
 */
const prependTransform = (element, m) => {
    const round = n => Math.round(n * 1e6) / 1e6;
    const own = element.getAttribute('transform');
    let matrix = new DOMMatrix(m);
    if (own && !hasExpression(own)) {
        const probe = document.createElementNS(SVG_NS, 'g');
        probe.setAttribute('transform', own);
        const list = probe.transform.baseVal;
        const consolidated = list.numberOfItems ? list.consolidate() : null;
        if (consolidated) matrix = matrix.multiply(DOMMatrix.fromMatrix(consolidated.matrix));
    } else if (own) {
        // A bound transform stays as it is, after ours
        element.setAttribute('transform', `matrix(${m.map(round).join(' ')}) ${own}`);
        return;
    }
    const values = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].map(round);
    const identity = values.every((value, i) => Math.abs(value - [1, 0, 0, 1, 0, 0][i]) < 1e-6);
    if (identity) element.removeAttribute('transform');
    else element.setAttribute('transform', `matrix(${values.join(' ')})`);
};

/**
 * paper.js exports everything in groups that move it back from where the editor draws it. Groups that only have
 * code objects in them are taken away, their transforms put into the code objects, so that a costume written as
 * code stays as it was written.
 * @param {Element} svg the exported SVG
 */
const tidyCodeObjects = svg => {
    const plain = group => group.localName === 'g' && Array.from(group.attributes)
        .every(attribute => ['transform', 'stroke-miterlimit'].includes(attribute.name));
    let changed = true;
    while (changed) {
        changed = false;
        for (const group of Array.from(svg.getElementsByTagName('g'))) {
            const children = Array.from(group.children);
            if (!plain(group) || !children.length ||
                !children.every(child => child.hasAttribute('data-tw-code-object'))) continue;
            const own = group.getAttribute('transform');
            let matrix = null;
            if (own) {
                const probe = document.createElementNS(SVG_NS, 'g');
                probe.setAttribute('transform', own);
                const list = probe.transform.baseVal;
                const consolidated = list.numberOfItems ? list.consolidate() : null;
                if (consolidated) matrix = consolidated.matrix;
            }
            for (const child of children) {
                if (matrix) prependTransform(child, [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]);
                group.parentNode.insertBefore(child, group);
            }
            group.remove();
            changed = true;
        }
    }
    for (const element of Array.from(svg.querySelectorAll('[data-tw-code-object]'))) {
        element.removeAttribute('data-tw-code-object');
        // Serialized inside the SVG, it doesn't need its own
        if (element.getAttribute('xmlns') === SVG_NS) element.removeAttribute('xmlns');
    }
};

/**
 * Put the markup of code objects back where they were exported, with how they were moved, turned and scaled
 * @param {Element} svg the exported SVG
 * @param {Array<paper.Item>} locked from markCodeBinding
 */
const restoreCodeBindings = (svg, locked) => {
    for (const node of Array.from(svg.querySelectorAll('[data-code-binding]'))) {
        const item = locked[Number(node.getAttribute('data-code-binding'))];
        const anchor = item && item.children.find(child => child.data.isCodeBindingAnchor);
        const element = item && parseMarkup(item.data.codeBinding);
        if (!anchor || !element) {
            node.remove();
            continue;
        }
        const [p0, p1, p2] = anchor.segments.map(segment => item.matrix.transform(segment.point));
        const imported = svg.ownerDocument.importNode(element, true);
        prependTransform(imported, [p1.x - p0.x, p1.y - p0.y, p2.x - p0.x, p2.y - p0.y, p0.x, p0.y]);
        imported.setAttribute('data-tw-code-object', '');
        node.parentNode.replaceChild(imported, node);
    }
    tidyCodeObjects(svg);
};

/**
 * paper.js importSVG `onImport`: bindings of `<g>` into item.data.bind; elements that only the code mode can edit
 * become locked stand-ins
 * @param {Element} node the SVG element
 * @param {paper.Item} item the paper.js item
 * @returns {?paper.Item} what to use instead of the item
 */
const importBindings = (node, item) => {
    if (!node || !node.getAttribute || !item) return null;
    if (node.getAttribute('data-code-binding')) return importCodeObject(node, item);
    importElementBindings(node, item); // eslint-disable-line no-use-before-define
    return null;
};

const importElementBindings = (node, item) => {
    const bind = {};
    let found = false;
    for (const key of BIND_KEYS) {
        const value = node.getAttribute(PREFIX + key);
        if (value !== null && value.trim()) {
            bind[key] = value;
            found = true;
        }
    }
    if (!found) return;
    const anchor = node.getAttribute(`${PREFIX}anchor`);
    const origin = node.getAttribute(`${PREFIX}origin`);
    if (anchor) {
        const [ax, ay] = anchor.trim().split(/[\s,]+/)
            .map(Number);
        bind.anchor = [isFinite(ax) ? ax : 0.5, isFinite(ay) ? ay : 0.5];
    } else if (origin) {
        // Written by hand: where the origin is in the bounds
        const [ox, oy] = origin.trim().split(/[\s,]+/)
            .map(Number);
        const bounds = item.bounds;
        bind.anchor = [
            bounds.width ? (ox - bounds.x) / bounds.width : 0.5,
            bounds.height ? (oy - bounds.y) / bounds.height : 0.5
        ];
    } else {
        bind.anchor = DEFAULT_ANCHOR.slice();
    }
    item.data.bind = bind;
};

/**
 * paper.js exportSVG `onExport`: item.data.bind as `data-bind-*` attributes
 * @param {paper.Item} item the paper.js item
 * @param {Element} node the SVG element
 */
const exportBindings = (item, node) => {
    if (!hasBinding(item) || !node || !node.setAttribute) return;
    const bind = item.data.bind;
    for (const key of BIND_KEYS) {
        if (typeof bind[key] === 'string' && bind[key].trim()) node.setAttribute(PREFIX + key, bind[key]);
    }
    const anchor = bind.anchor || DEFAULT_ANCHOR;
    // bounds are in the coordinates of the parent, the ones the runtime turns and scales the <g> in
    const bounds = item.bounds;
    const round = n => Math.round(n * 1000) / 1000;
    node.setAttribute(`${PREFIX}anchor`, `${anchor[0]} ${anchor[1]}`);
    node.setAttribute(`${PREFIX}origin`,
        `${round(bounds.x + (anchor[0] * bounds.width))} ${round(bounds.y + (anchor[1] * bounds.height))}`);
};

/**
 * Group.reduce() that keeps groups with bindings (their <g> is where the binding is)
 * @param {paper.Item} item the paper.js item
 * @returns {paper.Item} the item, or what it was reduced to
 */
const reduceKeepingBindings = item => {
    if (isGroupItem(item) && !keepsGroup(item) && item.children.length === 1) {
        const child = reduceKeepingBindings(item.children[0]);
        if (item.parent) {
            child.insertAbove(item);
            item.remove();
        } else {
            child.remove();
        }
        return child;
    }
    return item;
};

/**
 * @param {paper.Item} item a root item
 * @returns {paper.Group} the group to keep its bindings on: the item if it is a group, or a new group around it
 */
const groupForBinding = item => {
    if (isGroupItem(item) && !item.data.isPGTextItem && !isCodeObject(item)) return item;
    const group = new paper.Group();
    group.insertAbove(item);
    group.addChild(item);
    return group;
};

/**
 * @param {paper.Item} item the paper.js item
 * @param {string} key one of BIND_KEYS, or 'anchor'
 * @param {*} value an expression (empty to remove it), or [ax, ay] for the anchor
 */
const setBinding = (item, key, value) => {
    const bind = Object.assign({anchor: DEFAULT_ANCHOR.slice()}, item.data.bind);
    if (key === 'anchor') bind.anchor = value;
    else if (typeof value === 'string' && value.trim()) bind[key] = value;
    else delete bind[key];
    item.data.bind = bind;
};

/**
 * @param {paper.Item} layer the painting layer
 * @returns {boolean} true if something in it is bound (a group, or text with {…})
 */
const layerHasBindings = layer => {
    let found = false;
    const visit = item => {
        if (found) return;
        if (hasBinding(item) || isCodeObject(item)) found = true;
        else if (item.className === 'PointText' && /\{[^{]/.test(item.content.replace(/\{\{/g, ''))) found = true;
        else if (item.children) item.children.forEach(visit);
    };
    visit(layer);
    return found;
};

/**
 * Show, with a dashed rectangle, the canvas that a costume with bindings keeps: its size doesn't follow what the
 * bindings draw, so what goes outside is cut off.
 * @param {paper.Layer} layer the painting layer
 */
const updateBindingCanvas = layer => {
    const guideLayer = getGuideLayer();
    for (const child of guideLayer.children.slice()) {
        if (child.data.isBindingCanvas) child.remove();
    }
    if (!layer || !layerHasBindings(layer)) return;
    // What is drawn (not the mask that clips the workspace)
    let bounds = null;
    for (const child of layer.children) {
        if (child.isClipMask() || child.guide || (child.data && child.data.isHelperItem)) continue;
        const each = child.drawnBounds || child.bounds;
        if (!each || !each.width || !each.height) continue;
        bounds = bounds ? bounds.unite(each) : each;
    }
    if (!bounds || !bounds.width || !bounds.height) return;
    const rect = new paper.Path.Rectangle(bounds);
    rect.strokeColor = '#1f9e8f';
    rect.strokeWidth = 1 / paper.view.zoom;
    rect.dashArray = [6 / paper.view.zoom, 4 / paper.view.zoom];
    rect.fillColor = null;
    rect.guide = true;
    rect.locked = true;
    rect.data.isHelperItem = true;
    rect.data.isBindingCanvas = true;
    rect.parent = guideLayer;
};

export {
    BIND_KEYS,
    DEFAULT_ANCHOR,
    hasBinding,
    hasExpression,
    isCodeObject,
    isCodeObjectPart,
    keepsGroup,
    parseMarkup,
    setBindingReader,
    setCodeObjectMarkup,
    refreshCodeObjects,
    toCodeObject,
    isForbiddenAttribute,
    prepareCodeBindings,
    importBindings,
    exportBindings,
    markCodeBinding,
    restoreCodeBindings,
    reduceKeepingBindings,
    groupForBinding,
    setBinding,
    layerHasBindings,
    updateBindingCanvas
};

#!/usr/bin/env node
/**
 * @fileoverview
 * Makes the components that come with the editor (scratch-gui/src/lib/libraries/tw-builtin-components.json): a
 * button, a switch, a slider, a health bar, a dialog and a counter. They are written here as text (see
 * tools/3dsb-text/README.md), built like any project, and cut out as .3dsc files (scratch-vm
 * serialization/3dsb.js): the JSON of component.json, and the SVG files it uses.
 *
 *   node tools/make-builtin-components.js
 *
 * The result is checked in; run this again after changing a component here.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {getDefs} = require('./3dsb-text/vm-host');
const syntax = require('./3dsb-text/syntax');
const {build} = require('./3dsb-text/build');
const {check} = require('./3dsb-text/check');
const simple = require('./3dsb-text/simple');
const {vmRequire, VM} = require('./3dsb-text/paths');

const sb3 = require(path.join(VM, 'src', 'serialization', 'sb3'));
const {parseTemplate, evaluate} = require(path.join(VM, 'src', 'util', 'b3-expression'));

const OUT = path.join(__dirname, '..', 'scratch-gui', 'src', 'lib', 'libraries', 'tw-builtin-components.json');
const FONT = 'font-family="sans-serif"';

const md5 = text => crypto.createHash('md5').update(text).digest('hex');

// Each component: name, ids, the picture (SVG with {bindings}; the origin of the component is the point
// rotationCenter of it), properties, outputs, inputs (public custom blocks), members and scripts (.b3s)
const COMPONENTS = [{
    id: 'button',
    name: '按鈕',
    tags: ['UI'],
    svg: {
        width: 240,
        height: 35,
        center: [0, 35],
        body: `<rect x="0.5" y="0.5" width="{寬度 - 1}" height="34" rx="7" fill="{開 ? '#146b61' : '#1f9e8f'}" ` +
            `fill-opacity="{hover ? 0.85 : 1}" stroke="#146b61"/>` +
            `<text x="{寬度 / 2}" y="23" font-size="16" ${FONT} fill="#ffffff" text-anchor="middle">{文字}</text>`
    },
    props: [
        {name: '文字', type: 'string', default: '按鈕'},
        {name: '寬度', type: 'number', default: 122},
        {name: '開', type: 'boolean', default: false},
        {name: '可切換', type: 'boolean', default: false}
    ],
    outputs: [{id: 'pressed', proccode: '被點擊 開啟 %b', params: [{id: 'on', name: '開啟', type: 'b'}]}],
    scripts: `
when frame {
  hover = sensing_touchingobject("_mouse_")
}
when clicked {
  if prop.可切換 {
    prop.開 = not prop.開
  }
  emit out pressed(on: prop.開)
}
`
}, {
    id: 'switch',
    name: '開關',
    tags: ['UI'],
    svg: {
        width: 72,
        height: 36,
        center: [0, 36],
        body: `<rect x="1" y="4" width="70" height="28" rx="14" fill="{開 ? '#1f9e8f' : '#b7c0c4'}"/>` +
            `<circle cx="{開 ? 55 : 17}" cy="18" r="12" fill="#ffffff" stroke="#00000022"/>`
    },
    props: [{name: '開', type: 'boolean', default: false}],
    outputs: [{id: 'changed', proccode: '切換 開啟 %b', params: [{id: 'on', name: '開啟', type: 'b'}]}],
    inputs: [{
        id: 'set',
        proccode: '設定 開啟 %b',
        code: `
define 設定(on: bool) {
  prop.開 = on
}
`
    }],
    scripts: `
when clicked {
  prop.開 = not prop.開
  emit out changed(on: prop.開)
}
`
}, {
    id: 'slider',
    name: '滑桿',
    tags: ['UI'],
    svg: {
        width: 400,
        height: 30,
        center: [0, 15],
        body: `<rect x="0" y="12" width="{寬度}" height="6" rx="3" fill="#cfd8dc"/>` +
            `<rect x="0" y="12" width="{(值 - 最小) / max(最大 - 最小, 0.0001) * 寬度}" height="6" rx="3" fill="#1f9e8f"/>` +
            `<circle cx="{(值 - 最小) / max(最大 - 最小, 0.0001) * 寬度}" cy="15" r="9" fill="#ffffff" ` +
            `stroke="#1f9e8f" stroke-width="2"/>`
    },
    props: [
        {name: '值', type: 'number', default: 50},
        {name: '最小', type: 'number', default: 0},
        {name: '最大', type: 'number', default: 100},
        {name: '寬度', type: 'number', default: 200}
    ],
    outputs: [{id: 'changed', proccode: '改變 值 %s', params: [{id: 'value', name: '值', type: 's'}]}],
    inputs: [{
        id: 'set',
        proccode: '設定值 %s',
        code: `
define 設定值(v) {
  prop.值 = clamp(v, prop.最小, prop.最大)
}
`
    }],
    // The mouse in a component is where it is in the component: the slider works turned and scaled too
    scripts: `
when clicked {
  拖著 = 1
}
when frame {
  if 拖著 == 1 {
    if sensing_mousedown() {
      local.新值 = clamp(sensing_mousex() / 寬度 * (prop.最大 - prop.最小) + prop.最小, prop.最小, prop.最大)
      if local.新值 != prop.值 {
        prop.值 = local.新值
        emit out changed(value: prop.值)
      }
    } else {
      拖著 = 0
    }
  }
}
`
}, {
    id: 'healthbar',
    name: '血條',
    tags: ['UI'],
    svg: {
        width: 400,
        height: 24,
        center: [0, 24],
        body: `<rect x="0.5" y="0.5" width="{寬度 - 1}" height="23" rx="5" fill="#263238" fill-opacity="0.65"/>` +
            `<rect x="2" y="2" width="{clamp(目前 / max(最大, 1), 0, 1) * (寬度 - 4)}" height="20" rx="4" ` +
            `fill="{目前 / max(最大, 1) < 0.3 ? '#e53935' : '#43a047'}"/>` +
            `<text x="{寬度 / 2}" y="17" font-size="13" ${FONT} fill="#ffffff" text-anchor="middle">` +
            `{round(目前)} / {最大}</text>`
    },
    props: [
        {name: '目前', type: 'number', default: 100},
        {name: '最大', type: 'number', default: 100},
        {name: '寬度', type: 'number', default: 200}
    ],
    outputs: [{id: 'empty', proccode: '歸零', params: []}],
    inputs: [{
        id: 'hurt',
        proccode: '扣血 %s',
        code: `
define 扣血(n) {
  prop.目前 = clamp(prop.目前 - n, 0, prop.最大)
  if prop.目前 == 0 {
    emit out empty
  }
}
`
    }, {
        id: 'heal',
        proccode: '補血 %s',
        code: `
define 補血(n) {
  prop.目前 = clamp(prop.目前 + n, 0, prop.最大)
}
`
    }],
    scripts: ''
}, {
    id: 'counter',
    name: '計數',
    tags: ['UI'],
    svg: {
        width: 320,
        height: 34,
        center: [0, 34],
        body: `<text x="0" y="26" font-size="26" ${FONT} fill="#263238">{前綴}{數量}</text>`
    },
    props: [
        {name: '數量', type: 'number', default: 0},
        {name: '前綴', type: 'string', default: ''}
    ],
    outputs: [],
    inputs: [{
        id: 'add',
        proccode: '增加 %s',
        code: `
define 增加(n) {
  prop.數量 = prop.數量 + n
}
`
    }, {
        id: 'set',
        proccode: '設定 %s',
        code: `
define 設定(n) {
  prop.數量 = n
}
`
    }],
    scripts: ''
}, {
    id: 'dialog',
    name: '對話框',
    tags: ['UI'],
    needs: ['button'],
    svg: {
        width: 320,
        height: 150,
        center: [0, 150],
        body: `<rect x="0.5" y="0.5" width="319" height="149" rx="10" fill="#ffffff" stroke="#b0bec5"/>` +
            `<text x="18" y="34" font-size="20" font-weight="bold" ${FONT} fill="#263238">{標題}</text>` +
            `<text x="18" y="66" font-size="15" ${FONT} fill="#455a64">{內容}</text>`
    },
    props: [
        {name: '標題', type: 'string', default: '提示'},
        {name: '內容', type: 'string', default: '確定要繼續嗎？'}
    ],
    outputs: [
        {id: 'confirmed', proccode: '按了確定', params: []},
        {id: 'cancelled', proccode: '按了取消', params: []}
    ],
    inputs: [{
        id: 'show',
        proccode: '顯示',
        code: `
define 顯示() {
  looks_show()
}
`
    }, {
        id: 'hide',
        proccode: '隱藏',
        code: `
define 隱藏() {
  looks_hide()
}
`
    }],
    // Two buttons of the button component, in the dialog: local places, the dialog moves them
    members: [
        {key: 'ok', name: '確定', component: 'button', x: 122, y: 14, props: {文字: '確定', 寬度: 88}},
        {key: 'cancel', name: '取消', component: 'button', x: 218, y: 14, props: {文字: '取消', 寬度: 88}}
    ],
    scripts: `
when out 確定.pressed (on) {
  looks_hide()
  emit out confirmed
}
when out 取消.pressed (on) {
  looks_hide()
  emit out cancelled
}
`
}];

/**
 * @param {string} svg a picture with {bindings}
 * @param {Array<{name: string, default: *}>} props the properties, which the bindings read
 * @returns {string} the picture as it is with the default values (for the thumbnail in the library)
 */
const withDefaults = (svg, props) => {
    const values = {};
    for (const prop of props) values[prop.name] = prop.default;
    const read = node => (Object.prototype.hasOwnProperty.call(values, node.text) ? values[node.text] : false);
    return parseTemplate(svg).map(part => {
        if (typeof part === 'string') return part;
        const value = evaluate(part.tree, read);
        return part.format ? part.format(value) : String(value);
    }).join('');
};

const svgOf = spec => `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.svg.width}" height="${spec.svg.height}" ` +
    `viewBox="0 0 ${spec.svg.width} ${spec.svg.height}">${spec.svg.body}</svg>`;

(async () => {
    const defs = getDefs();
    const svgs = {};
    const ids = {};
    for (const spec of COMPONENTS) {
        spec.svgText = svgOf(spec);
        spec.assetId = md5(spec.svgText);
        svgs[`${spec.assetId}.svg`] = spec.svgText;
        ids[spec.id] = `cmp_${spec.id}`;
    }
    // The pictures for the checker: a zip with them
    const JSZip = vmRequire('@turbowarp/jszip');
    const zip = new JSZip();
    for (const [name, text] of Object.entries(svgs)) zip.file(name, text);
    const assetFile = path.join(os.tmpdir(), 'builtin-components-assets.3dsb');
    fs.writeFileSync(assetFile, await zip.generateAsync({type: 'nodebuffer'}));

    const sections = [];
    for (const spec of COMPONENTS) {
        const inputs = spec.inputs || [];
        const publicIds = inputs.map(input => `p_${spec.id}_${input.id}`);
        const definitions = inputs.map((input, index) => simple.compile(input.code, {defs})
            .replace(/(define "[^"]*"[^\n]*?)(  # b3s)/, `$1 @protoid "${publicIds[index]}"$2`));
        const members = (spec.members || []).map(member => ({
            key: member.key,
            kind: 'component',
            name: member.name,
            x: member.x,
            y: member.y,
            size: 100,
            direction: 90,
            visible: true,
            currentCostume: 0,
            rotationStyle: 'all around',
            draggable: false,
            component: ids[member.component],
            props: member.props
        }));
        const costume = {
            name: spec.name,
            bitmapResolution: 1,
            dataFormat: 'svg',
            assetId: spec.assetId,
            md5ext: `${spec.assetId}.svg`,
            rotationCenterX: spec.svg.center[0],
            rotationCenterY: spec.svg.center[1]
        };
        sections.push([
            `component "${ids[spec.id]}"`,
            `  prop costumes ${JSON.stringify([costume])}`,
            '  prop currentCostume 0',
            '  prop volume 100',
            '  prop kind "2d"',
            `  prop title ${JSON.stringify(spec.name)}`,
            '  prop color "#1f9e8f"',
            `  prop props ${JSON.stringify(spec.props)}`,
            `  prop outputs ${JSON.stringify(spec.outputs)}`,
            inputs.length ? `  prop interface ${JSON.stringify({events: [], public: publicIds})}` : null,
            members.length ? `  prop members ${JSON.stringify(members)}` : null,
            spec.scripts ? simple.compile(spec.scripts, {defs}).replace(/\n$/, '') : null,
            ...definitions.map(text => text.replace(/\n$/, ''))
        ].filter(line => line !== null).join('\n'));
    }
    const instances = COMPONENTS.map(spec => `sprite ${JSON.stringify(spec.name)}\n  prop kind "2d"\n` +
        `  prop x 0\n  prop y 0\n  prop component "${ids[spec.id]}"`);
    const text = ['blocks3d-text 1', `assets ${JSON.stringify(assetFile)}`,
        'project meta {"semver":"3.0.0","format":"3dsb","formatVersion":5}',
        'stage "Stage"\n  prop currentCostume -1\n  prop costumes []\n  prop kind "2d"',
        ...sections, ...instances].join('\n');
    fs.writeFileSync(path.join(os.tmpdir(), 'builtin-components.txt'), text);
    const file = syntax.parse(text);
    const built = build(file, {defs});
    if (built.errors.length) {
        for (const error of built.errors) console.error(`第 ${error.line} 行：${error.reason}`);
        process.exit(1);
    }
    const problems = (await check(built.json, {defs, lines: built.lines, vm: true, svgs})).filter(p => p.level === 'error');
    if (problems.length) {
        for (const problem of problems) console.error(`第 ${problem.line} 行：${problem.message}`);
        process.exit(1);
    }

    // Cut out one file for each
    const library = [];
    const json = built.json;
    for (const spec of COMPONENTS) {
        const root = ids[spec.id];
        const closure = {};
        const visit = id => {
            if (closure[id] || !json.components[id]) return;
            closure[id] = json.components[id];
            for (const member of closure[id].members || []) {
                if (member.kind === 'component') visit(member.component);
            }
        };
        visit(root);
        const instance = JSON.parse(JSON.stringify(json.targets.find(target => target.component === root)));
        instance.name = spec.name;
        const extensions = new Set();
        const walk = value => {
            if (Array.isArray(value)) return value.forEach(walk);
            if (value && typeof value === 'object') {
                if (typeof value.opcode === 'string') {
                    const extension = sb3.getExtensionIdForOpcode(value.opcode);
                    if (extension) extensions.add(extension);
                }
                Object.values(value).forEach(walk);
            }
        };
        walk(closure);
        const files = {};
        const collect = value => {
            if (Array.isArray(value)) return value.forEach(collect);
            if (value && typeof value === 'object') {
                if (typeof value.md5ext === 'string' && svgs[value.md5ext]) files[value.md5ext] = svgs[value.md5ext];
                Object.values(value).forEach(collect);
            }
        };
        collect(closure);
        library.push({
            name: spec.name,
            id: spec.id,
            tags: spec.tags,
            thumbnail: withDefaults(spec.svgText, spec.props),
            component: {
                meta: {format: '3dsc', formatVersion: 1, semver: '3.0.0', platform: {name: 'Blocks3D', url: ''}},
                root,
                instance,
                components: closure,
                extensions: Array.from(extensions)
            },
            files
        });
    }
    fs.writeFileSync(OUT, `${JSON.stringify(library, null, 1)}\n`);
    console.log(`${library.length} 個元件 → ${path.relative(process.cwd(), OUT)}`);
    // The VM keeps timers running
    process.exit(0);
})().catch(e => {
    console.error(e.stack || e);
    process.exit(1);
});

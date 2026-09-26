import JSZip from '@turbowarp/jszip';
import getFonts from 'scratch-render-fonts';
import downloadBlob from './download-blob';

// Built by the "standalone*" configs in webpack.config.js
const PLAYER_URL = `${process.env.ROOT}js/standalone.js`;

/**
 * Big parts of the player that are only exported with projects that use them.
 * Each one is a script that runs before the player, and is music.js etc. in the ZIP.
 */
const OPTIONAL_SCRIPTS = [
    {
        name: 'music',
        extensionId: 'music',
        url: `${process.env.ROOT}js/standalone-music.js`
    },
    {
        name: 'three',
        extensionId: 'three3d',
        url: `${process.env.ROOT}js/standalone-three.js`
    }
];

/**
 * @param {string} url Script URL
 * @returns {Promise<string>} Script source
 */
const fetchScript = async url => {
    const res = await fetch(url, {cache: 'no-cache'});
    if (!res.ok) {
        throw new Error(`Could not load ${url}: HTTP ${res.status}`);
    }
    return res.text();
};

/**
 * Extensions stay loaded after switching to another project, so the extensions that are loaded are not
 * the ones that the project uses. The saved project only lists extensions that its blocks use.
 * @param {VirtualMachine} vm VM with the project to export
 * @returns {Set<string>} IDs of the extensions that the project uses
 */
const getUsedExtensions = vm => new Set(JSON.parse(vm.toJSON()).extensions || []);

/**
 * @param {Set<string>} usedExtensions See getUsedExtensions
 * @returns {Promise<{player: string, optional: {name: string, source: string}[]}>} Scripts for the project
 */
const fetchScripts = async usedExtensions => {
    const needed = OPTIONAL_SCRIPTS.filter(i => usedExtensions.has(i.extensionId));
    const [player, ...sources] = await Promise.all([
        fetchScript(PLAYER_URL),
        ...needed.map(i => fetchScript(i.url))
    ]);
    return {
        player,
        optional: needed.map((i, index) => ({
            name: i.name,
            source: sources[index]
        }))
    };
};

/**
 * The player only has the Scratch fonts that the project's vector costumes use, see lib/tw-standalone/fonts.js
 * @param {VirtualMachine} vm VM with the project to export
 * @returns {object.<string, string>} Font name to @font-face CSS
 */
const getUsedFonts = vm => {
    const allFonts = getFonts();
    const used = {};
    const decoder = new TextDecoder();
    for (const target of vm.runtime.targets) {
        if (!target.isOriginal) continue;
        for (const costume of target.getCostumes()) {
            if (!costume.asset || costume.asset.dataFormat !== 'svg') continue;
            // Same pattern as the SVG renderer's font inliner
            const fontRegex = /font-family="([^"]*)"/g;
            const svg = decoder.decode(costume.asset.data);
            let match;
            while ((match = fontRegex.exec(svg)) !== null) {
                const fontName = match[1];
                if (Object.prototype.hasOwnProperty.call(allFonts, fontName)) {
                    used[fontName] = allFonts[fontName];
                }
            }
        }
    }
    return used;
};

/**
 * @param {ArrayBuffer} buffer sb3 data
 * @returns {Promise<string>} base64 without the data: prefix
 */
const arrayBufferToBase64 = buffer => new Promise((resolve, reject) => {
    // FileReader is much faster than building a binary string for large projects
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.substring(reader.result.indexOf(',') + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([buffer]));
});

/**
 * @param {string} text Untrusted text
 * @returns {string} text that is safe to put between HTML tags
 */
const escapeHTML = text => text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * @param {string} js Script source
 * @returns {string} JS that can't end the <script> element it is in
 */
const escapeInlineScript = js => js.replace(/<\/(script)/gi, '<\\/$1');

/**
 * @param {string} title Project title
 * @param {string} scripts <script> elements for the body
 * @returns {string} full HTML page
 */
const makeHTML = (title, scripts) => `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHTML(title)}</title>
<style>
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
#app { width: 100%; height: 100%; }
</style>
</head>
<body>
<div id="app"></div>
${scripts}
</body>
</html>
`;

/**
 * @param {string} title Project title
 * @param {string} projectBase64 sb3 as base64
 * @param {object.<string, string>} fonts See getUsedFonts
 * @returns {string} JS that sets up the globals that the player reads
 */
const makeDataScript = (title, projectBase64, fonts) => [
    `window.TWStandaloneFonts = ${JSON.stringify(fonts)};`,
    `window.TWStandaloneData = ${JSON.stringify({
        title,
        project: projectBase64
    })};`
].join('\n');

/**
 * @param {string} title Project title
 * @returns {string} file name without extension
 */
const getBaseName = title => (title || 'Project').replace(/[\\/:*?"<>|]/g, '_');

/**
 * @param {VirtualMachine} vm VM with the project to export
 * @param {string} title Project title
 * @returns {Promise<{sb3: ArrayBuffer, data: string, player: string, optional: object[]}>} What to export
 */
const prepareExport = async (vm, title) => {
    const [scripts, sb3] = await Promise.all([
        fetchScripts(getUsedExtensions(vm)),
        vm.saveProjectSb3('arraybuffer')
    ]);
    const projectBase64 = await arrayBufferToBase64(sb3);
    return {
        ...scripts,
        sb3,
        data: makeDataScript(title, projectBase64, getUsedFonts(vm))
    };
};

/**
 * Download the project as one HTML file that includes the player and the project.
 * @param {VirtualMachine} vm VM with the project to export
 * @param {string} title Project title
 */
export const exportHTML = async (vm, title) => {
    const {optional, data, player} = await prepareExport(vm, title);
    const html = makeHTML(title, [
        ...optional.map(i => i.source),
        data,
        player
    ]
        .map(js => `<script>${escapeInlineScript(js)}</script>`)
        .join('\n'));
    downloadBlob(`${getBaseName(title)}.html`, new Blob([html], {type: 'text/html'}));
};

/**
 * Download the project as a ZIP with index.html, the player and the project as separate files,
 * plus music.js and three.js when the project uses those extensions.
 * The project is stored as JS instead of .sb3 so that opening index.html from file:// works.
 * @param {VirtualMachine} vm VM with the project to export
 * @param {string} title Project title
 */
export const exportZip = async (vm, title) => {
    const {optional, data, player, sb3} = await prepareExport(vm, title);
    const zip = new JSZip();
    zip.file('index.html', makeHTML(title, [
        ...optional.map(i => `${i.name}.js`),
        'project.js',
        'player.js'
    ]
        .map(file => `<script src="${file}"></script>`)
        .join('\n')));
    for (const i of optional) {
        zip.file(`${i.name}.js`, i.source);
    }
    zip.file('project.js', data);
    zip.file('player.js', player);
    zip.file('project.sb3', sb3);
    const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE'
    });
    downloadBlob(`${getBaseName(title)}.zip`, blob);
};

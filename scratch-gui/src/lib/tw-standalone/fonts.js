/* eslint-disable import/no-commonjs */

// tw: stands in for lib/tw-scratch-render-fonts in the exported player.
// Only the fonts that the project's vector costumes use are exported, as @font-face CSS in window.TWStandaloneFonts.

const fontData = window.TWStandaloneFonts || {};

const loadFonts = () => {
    const style = document.createElement('style');
    style.id = 'scratch-font-styles';
    style.textContent = Object.values(fontData).join('');
    document.head.appendChild(style);
    if (!document.fonts || !document.fonts.load) {
        return Promise.resolve();
    }
    return Promise.all(Object.keys(fontData).map(fontName => document.fonts.load(`12px ${fontName}`)))
        .catch(() => {
            // The costumes will be drawn with a fallback font
        });
};

// Same exports as lib/tw-scratch-render-fonts
const getFonts = () => fontData;
module.exports = getFonts;
module.exports.loadFonts = loadFonts;
module.exports.FONTS = fontData;

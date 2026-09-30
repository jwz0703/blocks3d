// Backdrop packs: the kinds of 3D sky that a backdrop can be. A backdrop is added as one kind (from the backdrop
// library, or by uploading an image as an HDRI) and stays that kind. The pack brings its parameters, which the
// Environment tab shows, and its blocks (extensions/tw_3d/sky-*.js), which the palette shows while a backdrop of the
// project is of that kind. Switching backdrops is how a project switches kinds of sky.

// Parameters are keys of environment.sky. kind: 'color', 'range' (min, max, step and unit) or 'file' (an image in
// the Files tab).
const blur = {key: 'blur', label: '模糊', kind: 'range', min: 0, max: 100, step: 1, unit: '%'};

const SKY_PACKS = [
    {
        id: 'procedural',
        name: '程序天空',
        description: '藍天、太陽和雲，跟著太陽位置變成清晨、黃昏或夜晚',
        extension: 'skyprocedural',
        params: [
            {key: 'clouds', label: '雲量', kind: 'range', min: 0, max: 100, step: 1, unit: '%'},
            blur
        ]
    },
    {
        id: 'gradient',
        name: '漸層天空',
        description: '由下往上的兩色漸層',
        extension: 'skycolor',
        params: [
            {key: 'top', label: '上方', kind: 'color'},
            {key: 'bottom', label: '下方', kind: 'color'},
            blur
        ]
    },
    {
        id: 'color',
        name: '純色天空',
        description: '單一顏色',
        extension: 'skycolor',
        params: [
            {key: 'color', label: '顏色', kind: 'color'}
        ]
    },
    {
        id: 'hdri',
        name: 'HDRI 天空',
        description: '360° 全景圖（.hdr、.exr 或一般圖片），也用來照明',
        extension: 'skyhdri',
        params: [
            {key: 'file', label: '檔案', kind: 'file'},
            {key: 'rotation', label: '旋轉', kind: 'range', min: -180, max: 180, step: 1, unit: '°'},
            blur
        ]
    }
];

/**
 * @param {string} id kind of sky
 * @returns {?object} its pack; 2D backdrops have none
 */
const getSkyPack = id => SKY_PACKS.find(pack => pack.id === id) || null;

module.exports = {
    SKY_PACKS,
    getSkyPack
};

// Small pictures of environments for the backdrop list of the Environment tab. They are drawn with Canvas2D: they
// only need to tell environments apart, not look like the 3D scene.

const WIDTH = 96;
const HEIGHT = 72;

// Data URLs by the environment's JSON, and blob URLs of image files by md5
const previews = new Map();
const fileURLs = new Map();

const IMAGE_FILE = /\.(png|jpe?g|webp)$/i;

/**
 * @param {function(CanvasRenderingContext2D): void} draw draws the picture
 * @returns {string} data URL
 */
const drawPreview = draw => {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    draw(canvas.getContext('2d'));
    return canvas.toDataURL();
};

/**
 * @param {CanvasRenderingContext2D} ctx where to draw
 * @param {string} bottom CSS color
 * @param {string} top CSS color
 */
const fillGradient = (ctx, bottom, top) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    gradient.addColorStop(0, top);
    gradient.addColorStop(1, bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
};

/**
 * @param {CanvasRenderingContext2D} ctx where to draw
 * @param {object} env environment with a procedural sky
 */
const drawProcedural = (ctx, env) => {
    const length = Math.hypot(env.sun.x, env.sun.y, env.sun.z) || 1;
    const elevation = Math.asin(Math.max(-1, Math.min(1, env.sun.y / length)));
    const day = Math.max(0, Math.min(1, (elevation + 0.1) / 0.4));
    const mix = (a, b, t) => a.map((value, i) => Math.round(value + ((b[i] - value) * t)));
    const rgb = color => `rgb(${color.join(',')})`;
    const horizonY = HEIGHT * 0.72;
    const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
    sky.addColorStop(0, rgb(mix([10, 14, 40], [63, 127, 214], day)));
    sky.addColorStop(1, rgb(mix([40, 40, 60], [207, 227, 245], day)));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WIDTH, horizonY);
    ctx.fillStyle = rgb(mix([20, 20, 26], [120, 132, 140], day));
    ctx.fillRect(0, horizonY, WIDTH, HEIGHT - horizonY);
    // The sun, seen from the default camera (looking along -z)
    const azimuth = Math.atan2(env.sun.x, env.sun.z);
    const sunX = (WIDTH / 2) + (Math.sin(azimuth) * WIDTH * 0.4);
    const sunY = horizonY - (Math.max(0, elevation) / (Math.PI / 2) * horizonY * 0.9);
    ctx.fillStyle = env.sun.color;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 5, 0, Math.PI * 2);
    ctx.fill();
    // Clouds
    const clouds = Math.round(env.sky.clouds / 12);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.35 + (0.5 * day)})`;
    for (let i = 0; i < clouds; i++) {
        const x = ((i * 37) + 11) % WIDTH;
        const y = 8 + (((i * 23) + 5) % Math.round(horizonY * 0.6));
        ctx.beginPath();
        ctx.ellipse(x, y, 12, 4, 0, 0, Math.PI * 2);
        ctx.fill();
    }
};

/**
 * @param {CanvasRenderingContext2D} ctx where to draw
 * @param {string} label e.g. "HDR"
 */
const drawLabel = (ctx, label) => {
    fillGradient(ctx, '#3a3f4b', '#7b8599');
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, WIDTH / 2, HEIGHT / 2);
};

/**
 * @param {object} env environment of a backdrop
 * @param {VM} vm the VM, for files in the Files tab
 * @returns {?string} URL of a picture of the environment, or null for a 2D backdrop (its costume is the picture)
 */
const getEnvironmentPreview = (env, vm) => {
    const sky = env.sky;
    if (sky.type === '2d') return null;
    if (sky.type === 'hdri') {
        const file = sky.file && vm.runtime.fileManager.getFile(sky.file);
        if (file && IMAGE_FILE.test(file.name)) {
            let url = fileURLs.get(file.md5);
            if (!url) {
                url = URL.createObjectURL(new Blob([file.data], {type: vm.runtime.fileManager.getMimeType(file.name)}));
                fileURLs.set(file.md5, url);
            }
            return url;
        }
    }
    const key = JSON.stringify([sky, env.sun]);
    let url = previews.get(key);
    if (url) return url;
    url = drawPreview(ctx => {
        if (sky.type === 'color') {
            ctx.fillStyle = sky.color;
            ctx.fillRect(0, 0, WIDTH, HEIGHT);
        } else if (sky.type === 'gradient') {
            fillGradient(ctx, sky.bottom, sky.top);
        } else if (sky.type === 'procedural') {
            drawProcedural(ctx, env);
        } else {
            drawLabel(ctx, sky.file ? sky.file.split('.').pop()
                .toUpperCase() : 'HDRI');
        }
    });
    // Keep the cache small; environments change while dragging sliders
    if (previews.size > 200) previews.clear();
    previews.set(key, url);
    return url;
};

export default getEnvironmentPreview;

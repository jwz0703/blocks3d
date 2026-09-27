const RenderedTarget = require('./rendered-target');

// Canvas pixels per stage unit, so that lines stay sharp on large and high-DPI stages
const RESOLUTION = 2;

/**
 * Make a 2D context that marks the canvas as drawn whenever anything draws with it, so that libraries such as
 * rough.js or paper.js, which keep the context and draw with it every frame, don't have to say they did.
 * @param {CanvasRenderingContext2D} context the real context
 * @param {function(): void} onDraw called for every method call and property change
 * @returns {CanvasRenderingContext2D} context to hand out
 */
const makeTrackingContext = (context, onDraw) => {
    const methods = new Map();
    return new Proxy(context, {
        get (target, property) {
            const value = target[property];
            if (typeof value !== 'function') return value;
            let method = methods.get(property);
            if (!method) {
                method = (...args) => {
                    onDraw();
                    return value.apply(target, args);
                };
                methods.set(property, method);
            }
            return method;
        },
        set (target, property, value) {
            target[property] = value;
            onDraw();
            return true;
        }
    });
};

/**
 * @param {number[]} color4f [r, g, b, a] from 0 to 1
 * @returns {string} CSS color
 */
const toCSSColor = color4f => `rgba(${Math.round(color4f[0] * 255)},${Math.round(color4f[1] * 255)},` +
    `${Math.round(color4f[2] * 255)},${color4f[3]})`;

/**
 * A canvas sprite: a 2D sprite whose picture is a Canvas2D that blocks, the pen and other libraries draw on. It
 * moves, turns, scales, changes layers, hides and uses effects like any 2D sprite, and "touching color" sees what
 * is drawn on it. At its normal size and position it covers the stage exactly.
 *
 * The canvas is only uploaded to the renderer in frames where something drew on it (see engine/canvas-sprites.js).
 * Its costume is only a placeholder for the sprite list; the canvas is what is drawn. The drawing isn't saved with
 * the project, like the pen layer.
 */
class CanvasTarget extends RenderedTarget {
    constructor (sprite, runtime) {
        super(sprite, runtime);
        this.isCanvas = true;
        /** @type {?HTMLCanvasElement} */
        this.canvas = null;
        this._context = null;
        this._trackingContext = null;
        this._skinId = -1;
        this._dirty = false;
        this._width = 0;
        this._height = 0;
    }

    get kind () {
        return 'canvas';
    }

    static get RESOLUTION () {
        return RESOLUTION;
    }

    initDrawable (layerGroup) {
        super.initDrawable(layerGroup);
        this._createCanvas();
        this.runtime.canvasSprites.add(this);
    }

    _createCanvas () {
        const width = this.runtime.stageWidth;
        const height = this.runtime.stageHeight;
        const canvas = this.runtime.createCanvas2D(width * RESOLUTION, height * RESOLUTION);
        if (!canvas) return;
        const old = this.canvas;
        this._width = width;
        this._height = height;
        // BitmapSkin would otherwise read the pixels back on every upload; this way it only does when touching
        // needs them
        canvas.reusable = false;
        this._context = canvas.getContext('2d');
        // Keep the drawing where it was on the stage (the center stays the center), instead of stretching it, since
        // the stage changes size whenever the screen does (see engine/screen.js)
        if (old) {
            this._context.drawImage(old, Math.round((canvas.width - old.width) / 2),
                Math.round((canvas.height - old.height) / 2));
        }
        this._trackingContext = makeTrackingContext(this._context, () => this.markDirty());
        // Libraries that take the canvas and get the context themselves get the tracking one too
        const getContext = canvas.getContext.bind(canvas);
        canvas.getContext = (type, ...rest) => {
            const context = getContext(type, ...rest);
            return context === this._context ? this._trackingContext : context;
        };
        this.canvas = canvas;

        const renderer = this.runtime.renderer;
        if (renderer) {
            if (this._skinId === -1) {
                this._skinId = renderer.createBitmapSkin(canvas, RESOLUTION, this._rotationCenter());
            } else {
                renderer.updateBitmapSkin(this._skinId, canvas, RESOLUTION, this._rotationCenter());
            }
            this._applySkin();
        }
    }

    /**
     * Keep the drawing when the stage size changes.
     */
    resizeCanvas () {
        if (this._width === this.runtime.stageWidth && this._height === this.runtime.stageHeight) return;
        this._createCanvas();
    }

    _rotationCenter () {
        return [this._width / 2, this._height / 2];
    }

    _applySkin () {
        if (this.renderer && this._skinId !== -1 && this.drawableID !== null) {
            this.renderer.updateDrawableSkinId(this.drawableID, this._skinId);
        }
    }

    // Costumes would replace the canvas

    setCostume (index) {
        super.setCostume(index);
        this._applySkin();
    }

    updateAllDrawableProperties () {
        super.updateAllDrawableProperties();
        this._applySkin();
    }

    /**
     * @returns {?HTMLCanvasElement} the canvas, for libraries that draw on it. Its getContext('2d') gives the same
     * context as getContext() here.
     */
    getCanvas () {
        return this.canvas;
    }

    /**
     * @returns {?CanvasRenderingContext2D} the canvas's 2D context. Drawing with it shows on the stage in the next
     * frame.
     */
    getContext () {
        return this._trackingContext;
    }

    /**
     * Show what was drawn in the next frame. The context from getContext() does this by itself.
     */
    markDirty () {
        if (this._dirty) return;
        this._dirty = true;
        this.runtime.canvasSprites.markDirty(this);
    }

    /**
     * Upload the canvas to the renderer if something drew on it. Called once per frame.
     * @returns {boolean} true if it was uploaded
     */
    upload () {
        if (!this._dirty) return false;
        this._dirty = false;
        if (this.renderer && this._skinId !== -1) {
            this.renderer.updateBitmapSkin(this._skinId, this.canvas, RESOLUTION, this._rotationCenter());
            this.runtime.requestRedraw();
        }
        return true;
    }

    // Drawing in stage coordinates, for the pen

    _toCanvasX (x) {
        return (x + (this._width / 2)) * RESOLUTION;
    }

    _toCanvasY (y) {
        return ((this._height / 2) - y) * RESOLUTION;
    }

    clear () {
        if (!this._context) return;
        this._context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.markDirty();
    }

    /**
     * @param {{color4f: number[], diameter: number}} penAttributes
     * @param {number} x
     * @param {number} y
     */
    drawPoint (penAttributes, x, y) {
        const context = this._context;
        if (!context) return;
        context.fillStyle = toCSSColor(penAttributes.color4f);
        context.beginPath();
        context.arc(this._toCanvasX(x), this._toCanvasY(y), penAttributes.diameter * RESOLUTION / 2, 0, 2 * Math.PI);
        context.fill();
        this.markDirty();
    }

    /**
     * @param {{color4f: number[], diameter: number}} penAttributes
     * @param {number} x0
     * @param {number} y0
     * @param {number} x1
     * @param {number} y1
     */
    drawLine (penAttributes, x0, y0, x1, y1) {
        const context = this._context;
        if (!context) return;
        context.strokeStyle = toCSSColor(penAttributes.color4f);
        context.lineWidth = penAttributes.diameter * RESOLUTION;
        context.lineCap = 'round';
        context.beginPath();
        context.moveTo(this._toCanvasX(x0), this._toCanvasY(y0));
        context.lineTo(this._toCanvasX(x1), this._toCanvasY(y1));
        context.stroke();
        this.markDirty();
    }

    /**
     * Draw a sprite onto the canvas, as it looks on the stage.
     * @param {RenderedTarget} target
     */
    stamp (target) {
        const context = this._context;
        const renderer = this.renderer;
        if (!context || !renderer || target.drawableID === null || !target.visible) return;
        let extracted;
        try {
            extracted = renderer.extractDrawableScreenSpace(target.drawableID);
        } catch (e) {
            // Empty costumes can't be extracted
            return;
        }
        const image = this.runtime.createCanvas2D(extracted.imageData.width, extracted.imageData.height);
        if (!image) return;
        image.getContext('2d').putImageData(extracted.imageData, 0, 0);
        // The extracted bounds are in CSS pixels of the stage, from its top left corner
        const rect = renderer.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const unitsPerPixelX = this._width / rect.width;
        const unitsPerPixelY = this._height / rect.height;
        const left = (extracted.x * unitsPerPixelX) - (this._width / 2);
        const top = (this._height / 2) - (extracted.y * unitsPerPixelY);
        context.drawImage(
            image,
            this._toCanvasX(left),
            this._toCanvasY(top),
            extracted.width * unitsPerPixelX * RESOLUTION,
            extracted.height * unitsPerPixelY * RESOLUTION
        );
        this.markDirty();
    }

    toJSON () {
        const json = super.toJSON();
        json.kind = 'canvas';
        return json;
    }

    makeClone () {
        const clone = super.makeClone();
        // A clone starts with a copy of the drawing
        if (clone && clone._context && this.canvas) {
            clone._context.drawImage(this.canvas, 0, 0);
            clone.markDirty();
        }
        return clone;
    }

    dispose () {
        this.runtime.canvasSprites.remove(this);
        const renderer = this.renderer;
        super.dispose();
        if (renderer && this._skinId !== -1) {
            renderer.destroySkin(this._skinId);
            this._skinId = -1;
        }
    }
}

module.exports = CanvasTarget;

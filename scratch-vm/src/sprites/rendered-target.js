const MathUtil = require('../util/math-util');
const StringUtil = require('../util/string-util');
const Cast = require('../util/cast');
const Clone = require('../util/clone');
const Target = require('../engine/target');
const StageLayering = require('../engine/stage-layering');

/**
 * Rendered target: instance of a sprite (clone), or the stage.
 */
class RenderedTarget extends Target {
    /**
     * @param {!Sprite} sprite Reference to the parent sprite.
     * @param {Runtime} runtime Reference to the runtime.
     * @constructor
     */
    constructor (sprite, runtime) {
        super(runtime, sprite.blocks);

        /**
         * Reference to the sprite that this is a render of.
         * @type {!Sprite}
         */
        this.sprite = sprite;
        /**
         * Reference to the global renderer for this VM, if one exists.
         * @type {?RenderWebGL}
         */
        this.renderer = null;
        if (this.runtime) {
            this.renderer = this.runtime.renderer;
        }
        /**
         * ID of the drawable for this rendered target,
         * returned by the renderer, if rendered.
         * @type {?Number}
         */
        this.drawableID = null;

        /**
         * Drag state of this rendered target. If true, x/y position can't be
         * changed by blocks.
         * @type {boolean}
         */
        this.dragging = false;

        /**
         * Map of current graphic effect values.
         * @type {!Object.<string, number>}
         */
        this.effects = {
            color: 0,
            fisheye: 0,
            whirl: 0,
            pixelate: 0,
            mosaic: 0,
            brightness: 0,
            ghost: 0
        };

        /**
         * Whether this represents an "original" non-clone rendered-target for a sprite,
         * i.e., created by the editor and not clone blocks.
         * @type {boolean}
         */
        this.isOriginal = true;

        /**
         * Whether this rendered target represents the Scratch stage.
         * @type {boolean}
         */
        this.isStage = false;

        /**
         * Scratch X coordinate. Currently should range from -240 to 240.
         * @type {Number}
         */
        this.x = 0;

        /**
         * Scratch Y coordinate. Currently should range from -180 to 180.
         * @type {number}
         */
        this.y = 0;

        /**
         * Scratch direction. Currently should range from -179 to 180.
         * @type {number}
         */
        this.direction = 90;

        /**
         * Whether the rendered target is draggable on the stage
         * @type {boolean}
         */
        this.draggable = false;

        /**
         * What the mouse does at the target (the twmouse "mouse ... this sprite" block):
         * - 'block': stops there. The target can be clicked, and hides what is behind it from clicks and the mouse.
         * - 'pass': goes through to what is behind it, e.g. leaves in front of a sprite that can be clicked. The
         *   target's own click and mouse hats never start.
         * - 'auto': 'block' for 2D sprites; for 3D sprites, see Target3D.blocksMouse.
         * The stage always stops the mouse.
         * @type {string}
         */
        this.mouseMode = 'auto';

        /**
         * Whether the rendered target is currently visible.
         * @type {boolean}
         */
        this.visible = true;

        /**
         * Size of rendered target as a percent of costume size.
         * @type {number}
         */
        this.size = 100;

        /**
         * Currently selected costume index.
         * @type {number}
         */
        this.currentCostume = 0;

        /**
         * Current rotation style.
         * @type {!string}
         */
        this.rotationStyle = RenderedTarget.ROTATION_STYLE_ALL_AROUND;

        /**
         * Loudness for sound playback for this target, as a percentage.
         * @type {number}
         */
        this.volume = 100;

        /**
         * Current tempo (used by the music extension).
         * This property is global to the project and stored in the stage.
         * @type {number}
         */
        this.tempo = 60;

        /**
         * The transparency of the video (used by extensions with camera input).
         * This property is global to the project and stored in the stage.
         * @type {number}
         */
        this.videoTransparency = 50;

        /**
         * The state of the video input (used by extensions with camera input).
         * This property is global to the project and stored in the stage.
         *
         * Defaults to ON. This setting does not turn the video by itself. A
         * video extension once loaded will set the video device to this
         * setting. Set to ON when a video extension is added in the editor the
         * video will start ON. If the extension is loaded as part of loading a
         * saved project the extension will see the value set when the stage
         * was loaded from the saved values including the video state.
         *
         * @type {string}
         */
        this.videoState = RenderedTarget.VIDEO_STATE.ON;

        /**
         * The language to use for speech synthesis, in the text2speech extension.
         * It is initialized to null so that on extension load, we can check for
         * this and try setting it using the editor locale.
         * @type {string}
         */
        this.textToSpeechLanguage = null;

        // Node-style event emitters have non-zero performance overhead compared to function calls, so we
        // replace some very high frequency events with these specific methods that are overridden elsewhere.
        this.onTargetMoved = null;
        this.onTargetVisualChange = null;

        this.interpolationData = null;
    }

    /**
     * Create a drawable with the this.renderer.
     * @param {boolean} layerGroup The layer group this drawable should be added to
     */
    initDrawable (layerGroup) {
        if (this.renderer) {
            this.drawableID = this.renderer.createDrawable(layerGroup);
        }
        // If we're a clone, start the hats.
        if (!this.isOriginal) {
            this.runtime.startHats(
                'control_start_as_clone', null, this
            );
        }
    }

    /**
     * @returns {?object} the properties of an instance of a component that aren't the default (they are variables of
     * its root, see engine/components.js)
     */
    get componentProps () {
        if (!this.sprite || !this.sprite.component) return this._componentProps;
        return this.runtime.components.overridesOf(this);
    }

    set componentProps (values) {
        if (!this.sprite || !this.sprite.component) this._componentProps = values;
        else this.runtime.components.applyOverrides(this, values);
    }

    get audioPlayer () {
        /* eslint-disable no-console */
        console.warn('get audioPlayer deprecated, please update to use .sprite.soundBank methods');
        console.warn(new Error('stack for debug').stack);
        /* eslint-enable no-console */
        const bank = this.sprite.soundBank;
        const audioPlayerProxy = {
            playSound: soundId => bank.play(this, soundId)
        };

        Object.defineProperty(this, 'audioPlayer', {
            configurable: false,
            enumerable: true,
            writable: false,
            value: audioPlayerProxy
        });

        return audioPlayerProxy;
    }

    /**
     * Initialize the audio player for this sprite or clone.
     */
    initAudio () {
    }

    /**
     * Rotation style for "all around"/spinning.
     * @type {string}
     */
    static get ROTATION_STYLE_ALL_AROUND () {
        return 'all around';
    }

    /**
     * Rotation style for "left-right"/flipping.
     * @type {string}
     */
    static get ROTATION_STYLE_LEFT_RIGHT () {
        return 'left-right';
    }

    /**
     * Rotation style for "no rotation."
     * @type {string}
     */
    static get ROTATION_STYLE_NONE () {
        return "don't rotate";
    }

    /**
     * Available states for video input.
     * @enum {string}
     */
    static get VIDEO_STATE () {
        return {
            OFF: 'off',
            ON: 'on',
            ON_FLIPPED: 'on-flipped'
        };
    }

    emitVisualChange () {
        if (this.onTargetVisualChange) {
            this.onTargetVisualChange(this);
        }
    }

    /**
     * Set the X and Y coordinates.
     * @param {!number} x New X coordinate, in Scratch coordinates.
     * @param {!number} y New Y coordinate, in Scratch coordinates.
     * @param {?boolean} force Force setting X/Y, in case of dragging
     */
    setXY (x, y, force) { // used by compiler
        if (this.isStage) return;
        if (this.dragging && !force) return;
        const oldX = this.x;
        const oldY = this.y;
        if (this.renderer) {
            // Members of a component are placed in the component (no fence: the edge of the stage isn't theirs)
            const position = this.runtime.runtimeOptions.fencing && !this.componentOwner ?
                this.renderer.getFencedPositionOfDrawable(this.drawableID, [x, y]) :
                [x, y];
            this.x = position[0];
            this.y = position[1];

            this.renderer.updateDrawablePosition(this.drawableID, this._renderedPosition());
            if (this.visible) {
                this.emitVisualChange();
                this.runtime.requestRedraw();
            }
        } else {
            this.x = x;
            this.y = y;
        }
        if (this.onTargetMoved) {
            this.onTargetMoved(this, oldX, oldY, force);
        }
        // Components (engine/components.js): members are placed from their instance; changing a member while editing
        // the component changes the component
        if (this.componentMembers) this.runtime.components.reposeMembers(this);
        if (this.componentOwner) this.runtime.components.memberChanged(this);
        this.runtime.requestTargetsUpdate(this);
    }

    /**
     * A component is a coordinate system with its root as the origin: the x, y, direction and size of a member are
     * relative to the instance it is in (which can itself be in another). The root's own are where the whole component
     * is on its level.
     * @returns {{x: number, y: number, angle: number, k: number}} where this target is on the stage: its position, how
     * far it is turned from direction 90 and its size as a factor
     */
    _worldFrame () {
        const own = {x: this.x, y: this.y, angle: this.direction - 90, k: this.size / 100};
        const owner = this.componentOwner;
        if (!owner || owner === this) return own;
        const outer = owner._worldFrame();
        const radians = outer.angle * Math.PI / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        const x = own.x * outer.k;
        const y = own.y * outer.k;
        return {
            x: outer.x + (x * cos) + (y * sin),
            y: outer.y - (x * sin) + (y * cos),
            angle: outer.angle + own.angle,
            k: outer.k * own.k
        };
    }

    /**
     * @returns {Array<number>} where the drawable is on the stage
     */
    _renderedPosition () {
        if (!this.componentOwner) return [this.x, this.y];
        const frame = this._worldFrame();
        return [frame.x, frame.y];
    }

    /**
     * @param {number} x on the stage
     * @param {number} y on the stage
     * @returns {Array<number>} the same place in the coordinates this target has: the ones of the component it is in
     */
    stageToLocal (x, y) {
        return this.componentOwner ? this.stageToComponent(x, y) : [x, y];
    }

    /**
     * @param {number} x on the stage
     * @param {number} y
     * @returns {Array<number>} the same place in the component this target is part of, root or member (the root of the
     * component is the origin, and it turns and scales the component), or on the stage if it isn't in one. The mouse
     * in the scripts of a component is where it is in the component.
     */
    stageToComponent (x, y) {
        const owner = this.componentOwner || (this.sprite && this.sprite.component ? this : null);
        if (!owner) return [x, y];
        const frame = owner._worldFrame();
        const radians = frame.angle * Math.PI / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        const dx = x - frame.x;
        const dy = y - frame.y;
        return [((dx * cos) - (dy * sin)) / frame.k, ((dx * sin) + (dy * cos)) / frame.k];
    }

    /**
     * @param {number} x in the coordinates of this target
     * @param {number} y
     * @returns {Array<number>} the same place on the stage
     */
    localToStage (x, y) {
        const owner = this.componentOwner;
        if (!owner) return [x, y];
        const frame = owner._worldFrame();
        const radians = frame.angle * Math.PI / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        const dx = x * frame.k;
        const dy = y * frame.k;
        return [frame.x + (dx * cos) + (dy * sin), frame.y - (dx * sin) + (dy * cos)];
    }

    /**
     * @returns {boolean} true if it is shown: itself, and the component it is in
     */
    _effectiveVisible () {
        for (let target = this; target; target = target.componentOwner) {
            if (!target.visible) return false;
            if (target.componentOwner === target) break;
        }
        return true;
    }

    /**
     * Get the rendered direction and scale, after applying rotation style.
     * @return {object<string, number>} Direction and scale to render.
     */
    _getRenderedDirectionAndScale () {
        // Default: no changes to `this.direction` or `this.scale`.
        let direction = this.direction;
        let size = this.size;
        if (this.componentOwner) {
            // Turned and scaled with the component it is in
            const frame = this._worldFrame();
            direction = MathUtil.wrapClamp(frame.angle + 90, -179, 180);
            size = frame.k * 100;
        }
        let finalDirection = direction;
        let finalScale = [size, size];
        if (this.rotationStyle === RenderedTarget.ROTATION_STYLE_NONE) {
            // Force rendered direction to be 90.
            finalDirection = 90;
        } else if (this.rotationStyle === RenderedTarget.ROTATION_STYLE_LEFT_RIGHT) {
            // Force rendered direction to be 90, and flip drawable if needed.
            finalDirection = 90;
            const scaleFlip = (direction < 0) ? -1 : 1;
            finalScale = [scaleFlip * size, size];
        }
        return {direction: finalDirection, scale: finalScale};
    }

    /**
     * Set the direction.
     * @param {!number} direction New direction.
     */
    setDirection (direction) { // used by compiler
        if (this.isStage) {
            return;
        }
        if (!isFinite(direction)) {
            return;
        }
        // Keep direction between -179 and +180.
        this.direction = MathUtil.wrapClamp(direction, -179, 180);
        if (this.renderer) {
            const {direction: renderedDirection, scale} = this._getRenderedDirectionAndScale();
            this.renderer.updateDrawableDirectionScale(this.drawableID, renderedDirection, scale);
            if (this.componentMembers) this.runtime.components.reposeMembers(this);
            if (this.visible) {
                this.emitVisualChange();
                this.runtime.requestRedraw();
            }
        }
        this.runtime.requestTargetsUpdate(this);
    }

    /**
     * Set draggability; i.e., whether it's able to be dragged in the player
     * @param {!boolean} draggable True if should be draggable.
     */
    setDraggable (draggable) {
        if (this.isStage) return;
        this.draggable = !!draggable;
        this.runtime.requestTargetsUpdate(this);
    }

    /**
     * @param {string} mode 'auto', 'pass' or 'block', see mouseMode
     */
    setMouseMode (mode) {
        if (this.isStage || !RenderedTarget.MOUSE_MODES.includes(mode)) return;
        this.mouseMode = mode;
        this.runtime.requestTargetsUpdate(this);
    }

    /**
     * @param {!boolean} clickable the old "set can be clicked" block: true stops the mouse, false lets it through
     */
    setClickable (clickable) {
        this.setMouseMode(clickable ? 'block' : 'pass');
    }

    /**
     * @returns {boolean} true if the mouse stops at this target: clicks find it and not what is behind it
     */
    blocksMouse () {
        return this.mouseMode !== 'pass';
    }

    /**
     * @returns {string[]} what mouseMode can be
     */
    static get MOUSE_MODES () {
        return ['auto', 'pass', 'block'];
    }

    /**
     * Set visibility; i.e., whether it's shown or hidden.
     * @param {!boolean} visible True if should be shown.
     */
    setVisible (visible) { // used by compiler
        if (this.isStage) {
            return;
        }
        this.visible = !!visible;
        if (this.renderer) {
            this.renderer.updateDrawableVisible(this.drawableID, this._effectiveVisible());
            // Hiding the root of a component hides all of it
            if (this.componentMembers) this.runtime.components.reposeMembers(this);
            if (this.visible) {
                this.emitVisualChange();
                this.runtime.requestRedraw();
            }
        }
        this.runtime.requestTargetsUpdate(this);
    }

    /**
     * Set size, as a percentage of the costume size.
     * @param {!number} size Size of rendered target, as % of costume size.
     */
    setSize (size) { // used by compiler
        if (this.isStage) {
            return;
        }
        if (this.renderer) {
            // Clamp to scales relative to costume and stage size.
            // See original ScratchSprite.as:setSize.
            const costumeSize = this.renderer.getCurrentSkinSize(this.drawableID);
            const origW = costumeSize[0];
            const origH = costumeSize[1];
            const fencing = this.runtime.runtimeOptions.fencing;
            const minScale = fencing ? Math.min(1, Math.max(5 / origW, 5 / origH)) : 0;
            const maxScale = fencing ? Math.min(
                (1.5 * this.runtime.stageWidth) / origW,
                (1.5 * this.runtime.stageHeight) / origH
            ) : Infinity;
            this.size = MathUtil.clamp(size / 100, minScale, maxScale) * 100;
            const {direction, scale} = this._getRenderedDirectionAndScale();
            this.renderer.updateDrawableDirectionScale(this.drawableID, direction, scale);
            if (this.componentMembers) this.runtime.components.reposeMembers(this);
            if (this.visible) {
                this.emitVisualChange();
                this.runtime.requestRedraw();
            }
        } else {
            // tw: setSize should update size even without a renderer
            // needed by tw-change-size-does-not-use-rounded-size.sb3 test
            this.size = size;
        }
        this.runtime.requestTargetsUpdate(this);
    }

    /**
     * Set a particular graphic effect value.
     * @param {!string} effectName Name of effect (see `RenderedTarget.prototype.effects`).
     * @param {!number} value Numerical magnitude of effect.
     */
    setEffect (effectName, value) { // used by compiler
        if (!Object.prototype.hasOwnProperty.call(this.effects, effectName)) return;
        this.effects[effectName] = value;
        if (this.renderer) {
            this.renderer.updateDrawableEffect(this.drawableID, effectName, value);
            if (this.visible) {
                this.emitVisualChange();
                this.runtime.requestRedraw();
            }
        }
    }

    /**
     * Clear all graphic effects on this rendered target.
     */
    clearEffects () { // used by compiler
        for (const effectName in this.effects) {
            if (!Object.prototype.hasOwnProperty.call(this.effects, effectName)) continue;
            this.effects[effectName] = 0;
        }
        if (this.renderer) {
            for (const effectName in this.effects) {
                if (!Object.prototype.hasOwnProperty.call(this.effects, effectName)) continue;
                this.renderer.updateDrawableEffect(this.drawableID, effectName, 0);
            }
            if (this.visible) {
                this.emitVisualChange();
                this.runtime.requestRedraw();
            }
        }
    }

    /**
     * Set the current costume.
     * @param {number} index New index of costume.
     */
    setCostume (index) {
        // Keep the costume index within possible values.
        index = Math.round(index);
        if (index === Infinity || index === -Infinity || !index) {
            index = 0;
        }

        this.currentCostume = MathUtil.wrapClamp(
            index, 0, this.sprite.costumes.length - 1
        );
        if (this.renderer) {
            const costume = this.sprite.costumes[this.currentCostume];
            this.renderer.updateDrawableSkinId(this.drawableID, costume.skinId);

            if (this.visible) {
                this.emitVisualChange();
                this.runtime.requestRedraw();
            }
        }
        // Every backdrop has its own 3D environment
        if (this.isStage && this.runtime.scene3D) this.runtime.scene3D.onBackdropChanged();
        this.runtime.requestTargetsUpdate(this);
    }

    /**
     * Add a costume, taking care to avoid duplicate names.
     * @param {!object} costumeObject Object representing the costume.
     * @param {?int} index Index at which to add costume
     */
    addCostume (costumeObject, index) {
        if (typeof index === 'number' && !isNaN(index)) {
            this.sprite.addCostumeAt(costumeObject, index);
        } else {
            this.sprite.addCostumeAt(costumeObject, this.sprite.costumes.length);
        }
    }

    /**
     * Rename a costume, taking care to avoid duplicate names.
     * @param {int} costumeIndex - the index of the costume to be renamed.
     * @param {string} newName - the desired new name of the costume (will be modified if already in use).
     */
    renameCostume (costumeIndex, newName) {
        const usedNames = this.sprite.costumes
            .filter((costume, index) => costumeIndex !== index)
            .map(costume => costume.name);
        const oldName = this.getCostumes()[costumeIndex].name;
        const newUnusedName = StringUtil.unusedName(newName, usedNames);
        this.getCostumes()[costumeIndex].name = newUnusedName;

        if (this.isStage) {
            // Since this is a backdrop, go through all targets and
            // update any blocks referencing the old backdrop name
            const targets = this.runtime.targets;
            for (let i = 0; i < targets.length; i++) {
                const currTarget = targets[i];
                currTarget.blocks.updateAssetName(oldName, newUnusedName, 'backdrop');
            }
        } else {
            this.blocks.updateAssetName(oldName, newUnusedName, 'costume');
        }

    }

    /**
     * Delete a costume by index.
     * @param {number} index Costume index to be deleted
     * @return {?object} The costume that was deleted or null
     * if the index was out of bounds of the costumes list or
     * this target only has one costume.
     */
    deleteCostume (index) {
        const originalCostumeCount = this.sprite.costumes.length;
        if (originalCostumeCount === 1) return null;

        if (index < 0 || index >= originalCostumeCount) {
            return null;
        }

        const deletedCostume = this.sprite.deleteCostumeAt(index);

        if (index === this.currentCostume && index === originalCostumeCount - 1) {
            this.setCostume(index - 1);
        } else if (index < this.currentCostume) {
            this.setCostume(this.currentCostume - 1);
        } else {
            this.setCostume(this.currentCostume);
        }

        this.runtime.requestTargetsUpdate(this);
        return deletedCostume;
    }

    /**
     * Add a sound, taking care to avoid duplicate names.
     * @param {!object} soundObject Object representing the sound.
     * @param {?int} index Index at which to add costume
     */
    addSound (soundObject, index) {
        const usedNames = this.sprite.sounds.map(sound => sound.name);
        soundObject.name = StringUtil.unusedName(soundObject.name, usedNames);
        if (typeof index === 'number' && !isNaN(index)) {
            this.sprite.sounds.splice(index, 0, soundObject);
        } else {
            this.sprite.sounds.push(soundObject);
        }
    }

    /**
     * Rename a sound, taking care to avoid duplicate names.
     * @param {int} soundIndex - the index of the sound to be renamed.
     * @param {string} newName - the desired new name of the sound (will be modified if already in use).
     */
    renameSound (soundIndex, newName) {
        const usedNames = this.sprite.sounds
            .filter((sound, index) => soundIndex !== index)
            .map(sound => sound.name);
        const oldName = this.sprite.sounds[soundIndex].name;
        const newUnusedName = StringUtil.unusedName(newName, usedNames);
        this.sprite.sounds[soundIndex].name = newUnusedName;
        this.blocks.updateAssetName(oldName, newUnusedName, 'sound');
    }

    /**
     * Delete a sound by index.
     * @param {number} index Sound index to be deleted
     * @return {object} The deleted sound object, or null if no sound was deleted.
     */
    deleteSound (index) {
        // Make sure the sound index is not out of bounds
        if (index < 0 || index >= this.sprite.sounds.length) {
            return null;
        }
        // Delete the sound at the given index
        const deletedSound = this.sprite.sounds.splice(index, 1)[0];
        this.runtime.requestTargetsUpdate(this);
        return deletedSound;
    }

    /**
     * Update the rotation style.
     * @param {!string} rotationStyle New rotation style.
     */
    setRotationStyle (rotationStyle) { // used by compiler
        if (rotationStyle === RenderedTarget.ROTATION_STYLE_NONE) {
            this.rotationStyle = RenderedTarget.ROTATION_STYLE_NONE;
        } else if (rotationStyle === RenderedTarget.ROTATION_STYLE_ALL_AROUND) {
            this.rotationStyle = RenderedTarget.ROTATION_STYLE_ALL_AROUND;
        } else if (rotationStyle === RenderedTarget.ROTATION_STYLE_LEFT_RIGHT) {
            this.rotationStyle = RenderedTarget.ROTATION_STYLE_LEFT_RIGHT;
        }
        if (this.renderer) {
            const {direction, scale} = this._getRenderedDirectionAndScale();
            this.renderer.updateDrawableDirectionScale(this.drawableID, direction, scale);
            if (this.componentMembers) this.runtime.components.reposeMembers(this);
            if (this.visible) {
                this.emitVisualChange();
                this.runtime.requestRedraw();
            }
        }
        this.runtime.requestTargetsUpdate(this);
    }

    /**
     * Get a costume index of this rendered target, by name of the costume.
     * @param {?string} costumeName Name of a costume.
     * @return {number} Index of the named costume, or -1 if not present.
     */
    getCostumeIndexByName (costumeName) {
        const costumes = this.getCostumes();
        for (let i = 0; i < costumes.length; i++) {
            if (costumes[i].name === costumeName) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Get a costume of this rendered target by id.
     * @return {object} current costume
     */
    getCurrentCostume () {
        return this.getCostumes()[this.currentCostume];
    }

    /**
     * Get full costume list
     * @return {object[]} list of costumes
     */
    getCostumes () { // used by compiler
        return this.sprite.costumes;
    }

    /**
     * Reorder costume list by moving costume at costumeIndex to newIndex.
     * @param {!number} costumeIndex Index of the costume to move.
     * @param {!number} newIndex New index for that costume.
     * @returns {boolean} If a change occurred (i.e. if the indices do not match)
     */
    reorderCostume (costumeIndex, newIndex) {
        newIndex = MathUtil.clamp(newIndex, 0, this.sprite.costumes.length - 1);
        costumeIndex = MathUtil.clamp(costumeIndex, 0, this.sprite.costumes.length - 1);

        if (newIndex === costumeIndex) return false;

        const currentCostume = this.getCurrentCostume();
        const costume = this.sprite.costumes[costumeIndex];

        // Use the sprite method for deleting costumes because setCostume is handled manually
        this.sprite.deleteCostumeAt(costumeIndex);

        this.addCostume(costume, newIndex);
        this.currentCostume = this.getCostumeIndexByName(currentCostume.name);
        return true;
    }

    /**
     * Reorder sound list by moving sound at soundIndex to newIndex.
     * @param {!number} soundIndex Index of the sound to move.
     * @param {!number} newIndex New index for that sound.
     * @returns {boolean} If a change occurred (i.e. if the indices do not match)
     */
    reorderSound (soundIndex, newIndex) {
        newIndex = MathUtil.clamp(newIndex, 0, this.sprite.sounds.length - 1);
        soundIndex = MathUtil.clamp(soundIndex, 0, this.sprite.sounds.length - 1);

        if (newIndex === soundIndex) return false;

        const sound = this.sprite.sounds[soundIndex];
        this.deleteSound(soundIndex);
        this.addSound(sound, newIndex);
        return true;
    }

    /**
     * Get full sound list
     * @return {object[]} list of sounds
     */
    getSounds () {
        return this.sprite.sounds;
    }

    /**
     * Update all drawable properties for this rendered target.
     * Use when a batch has changed, e.g., when the drawable is first created.
     */
    updateAllDrawableProperties () {
        if (this.renderer) {
            const {direction, scale} = this._getRenderedDirectionAndScale();
            this.renderer.updateDrawablePosition(this.drawableID, this._renderedPosition());
            this.renderer.updateDrawableDirectionScale(this.drawableID, direction, scale);
            this.renderer.updateDrawableVisible(this.drawableID, this._effectiveVisible());
            if (this.componentMembers) this.runtime.components.reposeMembers(this);

            const costume = this.getCostumes()[this.currentCostume];
            this.renderer.updateDrawableSkinId(this.drawableID, costume.skinId);

            for (const effectName in this.effects) {
                if (!Object.prototype.hasOwnProperty.call(this.effects, effectName)) continue;
                this.renderer.updateDrawableEffect(this.drawableID, effectName, this.effects[effectName]);
            }

            if (this.visible) {
                this.emitVisualChange();
                this.runtime.requestRedraw();
            }
        }
        this.runtime.requestTargetsUpdate(this);
    }

    /**
     * Return the human-readable name for this rendered target, e.g., the sprite's name.
     * @override
     * @returns {string} Human-readable name.
     */
    getName () {
        // Instances of components have names of their own (engine/components.js)
        return this.instanceName || this.sprite.name;
    }

    /**
     * Return whether this rendered target is a sprite (not a clone, not the stage).
     * @return {boolean} True if not a clone and not the stage.
     */
    isSprite () {
        return !this.isStage && this.isOriginal;
    }

    /**
     * @param {string} property a property of the "[property] of [sprite]" block
     * @returns {*} its value, or undefined if sprites of this kind don't have it (then it is a variable name)
     */
    getAttribute (property) {
        switch (property) {
        case 'x position': return this.x;
        case 'y position': return this.y;
        case 'direction': return this.direction;
        case 'costume #': return this.currentCostume + 1;
        case 'costume name': return this.getCostumes()[this.currentCostume].name;
        case 'size': return this.size;
        case 'volume': return this.volume;
        }
    }

    /**
     * @returns {{x: number, y: number}} where the target appears on the 2D stage. 3D sprites give where they are
     * drawn, so that 2D blocks such as "go to" and "distance to" follow them.
     */
    getStagePosition () {
        const [x, y] = this._renderedPosition();
        return {x, y};
    }

    /**
     * Return the rendered target's tight bounding box.
     * Includes top, left, bottom, right attributes in Scratch coordinates.
     * @return {?object} Tight bounding box, or null.
     */
    getBounds () {
        if (this.renderer) {
            return this.runtime.renderer.getBounds(this.drawableID);
        }
        return null;
    }

    /**
     * Return the bounding box around a slice of the top 8px of the rendered target.
     * Includes top, left, bottom, right attributes in Scratch coordinates.
     * @return {?object} Tight bounding box, or null.
     */
    getBoundsForBubble () {
        if (this.renderer) {
            return this.runtime.renderer.getBoundsForBubble(this.drawableID);
        }
        return null;
    }

    /**
     * Return whether this target is touching the mouse, an edge, or a sprite.
     * @param {string} requestedObject an id for mouse or edge, or a sprite name.
     * @return {boolean} True if the sprite is touching the object.
     */
    isTouchingObject (requestedObject) { // used by compiler
        if (requestedObject === '_mouse_') {
            if (!this.runtime.ioDevices.mouse) return false;
            const mouseX = this.runtime.ioDevices.mouse.getClientX();
            const mouseY = this.runtime.ioDevices.mouse.getClientY();
            return this.isTouchingPoint(mouseX, mouseY);
        } else if (requestedObject === '_edge_') {
            return this.isTouchingEdge();
        }
        return this.isTouchingSprite(requestedObject);
    }

    /**
     * Return whether touching a point.
     * @param {number} x X coordinate of test point.
     * @param {number} y Y coordinate of test point.
     * @return {boolean} True iff the rendered target is touching the point.
     */
    isTouchingPoint (x, y) {
        if (this.renderer) {
            return this.renderer.drawableTouching(this.drawableID, x, y);
        }
        return false;
    }

    /**
     * Return whether touching a stage edge.
     * @return {boolean} True iff the rendered target is touching the stage edge.
     */
    isTouchingEdge () {
        if (this.renderer) {
            const stageWidth = this.runtime.stageWidth;
            const stageHeight = this.runtime.stageHeight;
            const bounds = this.getBounds();
            if (bounds.left < -stageWidth / 2 ||
                bounds.right > stageWidth / 2 ||
                bounds.top > stageHeight / 2 ||
                bounds.bottom < -stageHeight / 2) {
                return true;
            }
        }
        return false;
    }

    /**
     * Return whether touching any of a named sprite's clones.
     * @param {string} spriteName Name of the sprite.
     * @return {boolean} True iff touching a clone of the sprite.
     */
    isTouchingSprite (spriteName) {
        spriteName = Cast.toString(spriteName);
        const firstClone = this.runtime.getSpriteTargetByName(spriteName);
        // 2D and 3D sprites never touch each other
        if (!firstClone || !this.renderer || firstClone.is3D) {
            return false;
        }
        // Filter out dragging targets. This means a sprite that is being dragged
        // can detect other sprites using touching <sprite>, but cannot be detected
        // by other sprites while it is being dragged. This matches Scratch 2.0 behavior.
        const drawableCandidates = firstClone.sprite.clones.filter(clone => !clone.dragging)
            .map(clone => clone.drawableID);
        return this.renderer.isTouchingDrawables(
            this.drawableID, drawableCandidates);
    }

    /**
     * Return whether touching a color.
     * @param {Array.<number>} rgb [r,g,b], values between 0-255.
     * @return {Promise.<boolean>} True iff the rendered target is touching the color.
     */
    isTouchingColor (rgb) { // used by compiler
        if (this.renderer) {
            return this.renderer.isTouchingColor(this.drawableID, rgb);
        }
        return false;
    }

    /**
     * Return whether rendered target's color is touching a color.
     * @param {object} targetRgb {Array.<number>} [r,g,b], values between 0-255.
     * @param {object} maskRgb {Array.<number>} [r,g,b], values between 0-255.
     * @return {Promise.<boolean>} True iff the color is touching the color.
     */
    colorIsTouchingColor (targetRgb, maskRgb) { // used by compiler
        if (this.renderer) {
            return this.renderer.isTouchingColor(
                this.drawableID,
                targetRgb,
                maskRgb
            );
        }
        return false;
    }

    getLayerOrder () {
        if (this.renderer) {
            return this.renderer.getDrawableOrder(this.drawableID);
        }
        return null;
    }

    /**
     * Move to the front layer.
     */
    goToFront () { // This should only ever be used for sprites // used by compiler
        if (this.renderer) {
            // Let the renderer re-order the sprite based on its knowledge
            // of what layers are present
            this.renderer.setDrawableOrder(this.drawableID, Infinity, StageLayering.SPRITE_LAYER);
        }

        this.runtime.setExecutablePosition(this, Infinity);
    }

    /**
     * Move to the back layer.
     */
    goToBack () { // This should only ever be used for sprites // used by compiler
        if (this.renderer) {
            // Let the renderer re-order the sprite based on its knowledge
            // of what layers are present
            this.renderer.setDrawableOrder(this.drawableID, -Infinity, StageLayering.SPRITE_LAYER, false);
        }

        this.runtime.setExecutablePosition(this, -Infinity);
    }

    /**
     * Move forward a number of layers.
     * @param {number} nLayers How many layers to go forward.
     */
    goForwardLayers (nLayers) { // used by compiler
        if (this.renderer) {
            this.renderer.setDrawableOrder(this.drawableID, nLayers, StageLayering.SPRITE_LAYER, true);
        }

        this.runtime.moveExecutable(this, nLayers);
    }

    /**
     * Move backward a number of layers.
     * @param {number} nLayers How many layers to go backward.
     */
    goBackwardLayers (nLayers) { // used by compiler
        if (this.renderer) {
            this.renderer.setDrawableOrder(this.drawableID, -nLayers, StageLayering.SPRITE_LAYER, true);
        }

        this.runtime.moveExecutable(this, -nLayers);
    }

    /**
     * Move behind some other rendered target.
     * @param {!RenderedTarget} other Other rendered target to move behind.
     */
    goBehindOther (other) {
        if (this.renderer) {
            const otherLayer = this.renderer.setDrawableOrder(
                other.drawableID, 0, StageLayering.SPRITE_LAYER, true);
            this.renderer.setDrawableOrder(this.drawableID, otherLayer, StageLayering.SPRITE_LAYER);
        }

        const executionPosition = this.runtime.executableTargets.indexOf(other);
        this.runtime.setExecutablePosition(this, executionPosition);
    }

    /**
     * Keep a desired position within a fence.
     * @param {number} newX New desired X position.
     * @param {number} newY New desired Y position.
     * @param {object=} optFence Optional fence with left, right, top bottom.
     * @return {Array.<number>} Fenced X and Y coordinates.
     */
    keepInFence (newX, newY, optFence) {
        let fence = optFence;
        if (!fence) {
            fence = {
                left: -this.runtime.stageWidth / 2,
                right: this.runtime.stageWidth / 2,
                top: this.runtime.stageHeight / 2,
                bottom: -this.runtime.stageHeight / 2
            };
        }
        const bounds = this.getBounds();
        if (!bounds) return;
        // Adjust the known bounds to the target position.
        bounds.left += (newX - this.x);
        bounds.right += (newX - this.x);
        bounds.top += (newY - this.y);
        bounds.bottom += (newY - this.y);
        // Find how far we need to move the target position.
        let dx = 0;
        let dy = 0;
        if (bounds.left < fence.left) {
            dx += fence.left - bounds.left;
        }
        if (bounds.right > fence.right) {
            dx += fence.right - bounds.right;
        }
        if (bounds.top > fence.top) {
            dy += fence.top - bounds.top;
        }
        if (bounds.bottom < fence.bottom) {
            dy += fence.bottom - bounds.bottom;
        }
        return [newX + dx, newY + dy];
    }

    /**
     * Make a clone, copying any run-time properties.
     * If we've hit the global clone limit, returns null.
     * @return {RenderedTarget} New clone.
     */
    makeClone () {
        if (!this.runtime.clonesAvailable() || this.isStage) {
            return null; // Hit max clone limit, or this is the stage.
        }
        this.runtime.changeCloneCounter(1);
        const newClone = this.sprite.createClone();
        // Copy all properties.
        newClone.x = this.x;
        newClone.y = this.y;
        newClone.direction = this.direction;
        newClone.draggable = this.draggable;
        newClone.mouseMode = this.mouseMode;
        newClone.visible = this.visible;
        newClone.size = this.size;
        newClone.currentCostume = this.currentCostume;
        newClone.rotationStyle = this.rotationStyle;
        newClone.effects = Clone.simple(this.effects);
        newClone.variables = this.duplicateVariables();
        // A clone of an instance of a component is that instance, with the same property values
        if (this.instanceName) newClone.instanceName = this.instanceName;
        if (this.componentOwner) {
            newClone.componentOwner = this.componentOwner;
            newClone.memberKey = this.memberKey;
        }
        if (this.componentProps) newClone.componentProps = Object.assign({}, this.componentProps);
        newClone._edgeActivatedHatValues = Clone.simple(this._edgeActivatedHatValues);
        newClone.initDrawable(StageLayering.SPRITE_LAYER);
        newClone.updateAllDrawableProperties();
        return newClone;
    }

    /**
     * Make a duplicate using a duplicate sprite.
     * @return {RenderedTarget} New clone.
     */
    duplicate () {
        return this.sprite.duplicate().then(newSprite => {
            const newTarget = newSprite.createClone();
            // Copy all properties.
            // @todo refactor with clone methods
            newTarget.x = (Math.random() - 0.5) * 400 / 2;
            newTarget.y = (Math.random() - 0.5) * 300 / 2;
            newTarget.direction = this.direction;
            newTarget.draggable = this.draggable;
            newTarget.mouseMode = this.mouseMode;
            newTarget.visible = this.visible;
            newTarget.size = this.size;
            newTarget.currentCostume = this.currentCostume;
            newTarget.rotationStyle = this.rotationStyle;
            newTarget.effects = JSON.parse(JSON.stringify(this.effects));
            newTarget.variables = this.duplicateVariables(newTarget.blocks);
            newTarget.updateAllDrawableProperties();
            return newTarget;
        });
    }

    /**
     * Called when the project receives a "green flag."
     * For a rendered target, this clears graphic effects.
     */
    onGreenFlag () {
        this.clearEffects();
    }

    /**
     * Called when the project receives a "stop all"
     * Stop all sounds and clear graphic effects.
     */
    onStopAll () {
        this.clearEffects();
    }

    /**
     * Post/edit sprite info.
     * @param {object} data An object with sprite info data to set.
     */
    postSpriteInfo (data) {
        const force = Object.prototype.hasOwnProperty.call(data, 'force') ? data.force : null;
        const isXChanged = Object.prototype.hasOwnProperty.call(data, 'x');
        const isYChanged = Object.prototype.hasOwnProperty.call(data, 'y');
        if (isXChanged || isYChanged) {
            let x = isXChanged ? data.x : this.x;
            let y = isYChanged ? data.y : this.y;
            // Dragging on the stage gives places on the stage; the fields of the sprite info are in the component
            if (force && this.componentOwner) [x, y] = this.stageToLocal(x, y);
            this.setXY(x, y, force);
        }
        if (Object.prototype.hasOwnProperty.call(data, 'direction')) {
            this.setDirection(data.direction);
        }
        if (Object.prototype.hasOwnProperty.call(data, 'draggable')) {
            this.setDraggable(data.draggable);
        }
        if (Object.prototype.hasOwnProperty.call(data, 'mouseMode')) {
            this.setMouseMode(data.mouseMode);
        }
        if (Object.prototype.hasOwnProperty.call(data, 'rotationStyle')) {
            this.setRotationStyle(data.rotationStyle);
        }
        if (Object.prototype.hasOwnProperty.call(data, 'visible')) {
            this.setVisible(data.visible);
        }
        if (Object.prototype.hasOwnProperty.call(data, 'size')) {
            this.setSize(data.size);
        }
    }

    /**
     * Put the sprite into the drag state. While in effect, setXY must be forced
     */
    startDrag () {
        this.dragging = true;
    }

    /**
     * Remove the sprite from the drag state.
     */
    stopDrag () {
        this.dragging = false;
    }


    /**
     * Serialize sprite info, used when emitting events about the sprite
     * @returns {object} Sprite data as a simple object
     */
    toJSON () {
        const costumes = this.getCostumes();
        return {
            id: this.id,
            name: this.getName(),
            isStage: this.isStage,
            x: this.x,
            y: this.y,
            size: this.size,
            direction: this.direction,
            draggable: this.draggable,
            mouseMode: this.mouseMode,
            currentCostume: this.currentCostume,
            costume: costumes[this.currentCostume],
            costumeCount: costumes.length,
            visible: this.visible,
            rotationStyle: this.rotationStyle,
            comments: this.comments,
            blocks: this.blocks._blocks,
            variables: this.variables,
            costumes: costumes,
            sounds: this.getSounds(),
            textToSpeechLanguage: this.textToSpeechLanguage,
            tempo: this.tempo,
            volume: this.volume,
            videoTransparency: this.videoTransparency,
            videoState: this.videoState,
            // Instances of components (engine/components.js)
            componentId: this.sprite.component ? this.sprite.component.id : null,
            componentName: this.sprite.component ? this.sprite.name : null,
            componentProps: this.sprite.component ? this.sprite.component.props : null,
            componentValues: this.sprite.component ? this.runtime.components.propsOf(this) : null,
            componentOverrides: this.sprite.component ? Object.keys(this.componentProps || {}) : null,
            // A member of an instance of a component: the id of the instance
            componentOwnerId: this.componentOwner ? this.componentOwner.id : null,
            // The instance on the page of a component (not part of the project)
            componentPreview: !!this.isPreview

        };
    }

    /**
     * Dispose, destroying any run-time properties.
     */
    dispose () {
        if (!this.isOriginal) {
            this.runtime.changeCloneCounter(-1);
        }
        this.runtime.stopForTarget(this);
        this.runtime.removeExecutable(this);
        this.sprite.removeClone(this);
        if (this.renderer && this.drawableID !== null) {
            this.renderer.destroyDrawable(this.drawableID, this.isStage ?
                StageLayering.BACKGROUND_LAYER :
                StageLayering.SPRITE_LAYER);
            if (this.visible) {
                this.emitVisualChange();
                this.runtime.requestRedraw();
            }
        }
    }
}

module.exports = RenderedTarget;

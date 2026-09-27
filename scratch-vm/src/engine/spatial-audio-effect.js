// 3D sound (ROADMAP.md 6.8): sounds of 3D sprites come from where the sprite is, heard from the current camera.
//
// This is one more effect in scratch-audio's effect chain (after pan, pitch and volume), so that everything else
// about sounds stays the same. It uses a Web Audio PannerNode in the audio engine's own AudioContext; three.js's
// PositionalAudio would need an AudioContext of its own. It follows scratch-audio's Effect interface (see
// scratch-audio/src/effects/Effect.js) without extending it, since the audio engine comes from the GUI.
//
// The effect's value is {x, y, z, distance} (see Target3D.spatial3d), or null for sounds that aren't 3D: then it
// isn't connected at all.

/**
 * @param {object} node an AudioNode or AudioListener
 * @param {string} name name of one of its AudioParams, e.g. 'positionX'
 * @param {number} value
 */
const setAudioParam = (node, name, value) => {
    const param = node[name];
    if (param && typeof param === 'object' && 'value' in param) param.value = value;
};

class SpatialAudioEffect {
    /**
     * @param {AudioEngine} audioEngine
     * @param {EffectChain} audioPlayer the chain this effect is in
     * @param {?object} lastEffect the effect after this one in the chain
     */
    constructor (audioEngine, audioPlayer, lastEffect) {
        this.audioEngine = audioEngine;
        this.audioPlayer = audioPlayer;
        this.lastEffect = lastEffect;
        this.value = this.DEFAULT_VALUE;
        this.initialized = false;
        this.inputNode = null;
        this.outputNode = null;
        this.target = null;
        this._lastPatch = -Infinity;
    }

    get name () {
        return 'spatial3d';
    }

    get DEFAULT_VALUE () {
        return null;
    }

    get _isPatch () {
        return this.initialized && this.value !== null;
    }

    getInputNode () {
        if (this._isPatch) return this.inputNode;
        return this.target.getInputNode();
    }

    initialize () {
        const panner = this.audioEngine.audioContext.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.rolloffFactor = 1;
        this.inputNode = panner;
        this.outputNode = panner;
        this.initialized = true;
    }

    /**
     * @param {?{x: number, y: number, z: number, distance: number}} value where the sound comes from, and within
     * what distance it plays at full volume
     */
    _set (value) {
        this.value = value && typeof value === 'object' ? value : null;
        if (!this.value) return;
        const panner = this.outputNode;
        setAudioParam(panner, 'positionX', this.value.x);
        setAudioParam(panner, 'positionY', this.value.y);
        setAudioParam(panner, 'positionZ', this.value.z);
        if (!panner.positionX && panner.setPosition) panner.setPosition(this.value.x, this.value.y, this.value.z);
        panner.refDistance = Math.max(0.01, this.value.distance || 1);
    }

    set (value) {
        if (!this.initialized) this.initialize();
        const wasPatch = this._isPatch;
        if (wasPatch) this._lastPatch = this.audioEngine.currentTime;
        this._set(value);
        if (this._isPatch !== wasPatch && this.target !== null) this.connect(this.target);
    }

    update () {}

    clear () {
        this.set(this.DEFAULT_VALUE);
    }

    connect (target) {
        this.target = target;
        if (this.outputNode !== null) this.outputNode.disconnect();
        if (this._isPatch) this.outputNode.connect(target.getInputNode());
        if (this.lastEffect === null) {
            if (this.audioPlayer !== null) this.audioPlayer.connect(this);
        } else {
            this.lastEffect.connect(this);
        }
    }

    dispose () {
        if (this.outputNode) this.outputNode.disconnect();
        this.inputNode = null;
        this.outputNode = null;
        this.target = null;
        this.initialized = false;
    }
}

SpatialAudioEffect.setAudioParam = setAudioParam;

module.exports = SpatialAudioEffect;

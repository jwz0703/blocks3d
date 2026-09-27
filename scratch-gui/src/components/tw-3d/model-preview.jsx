import bindAll from 'lodash.bindall';
import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import VM from 'scratch-vm';

import {build3DObject} from '../../lib/tw-3d-thumbnail';

import styles from './model-preview.css';

const FOV = 35;
// Same view as the thumbnails: from the front-right, a little from above
const DEFAULT_YAW = Math.atan2(1, 1.4);
const DEFAULT_PITCH = Math.atan2(0.75, Math.hypot(1, 1.4));
const MAX_PITCH = (Math.PI / 2) - 0.01;
const ORBIT_SPEED = 0.01;
const ZOOM_SPEED = 0.0015;
const SPEEDS = [0.25, 0.5, 1, 1.5, 2];

/**
 * @param {object} model {shape} or {file}
 * @returns {string} what the model is made from; the view is framed again when it changes
 */
const sourceKey = model => (model.file ? `file:${model.file}` : `shape:${model.shape}`);

/**
 * @param {number} seconds time in seconds
 * @returns {string} seconds with two decimals
 */
const formatTime = seconds => seconds.toFixed(2);

/**
 * Live view of a model in the Models tab: drag to turn it around, scroll to zoom, and play its animations.
 * Only a preview: it doesn't change the sprite or what the sprite plays.
 */
class ModelPreview extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleClipClick',
            'handleDoubleClick',
            'handleLoop',
            'handlePlayPause',
            'handlePointerDown',
            'handlePointerMove',
            'handlePointerUp',
            'handleResetView',
            'handleScrub',
            'handleSpeed',
            'handleWheel',
            'setCanvas',
            'tick'
        ]);
        this.state = {
            loading: true,
            missing: false,
            clips: [],
            // Name of the animation shown, or null for the model's normal pose
            clipName: null,
            playing: false,
            loop: true,
            speed: 1,
            time: 0
        };
        this.view = {yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH, distance: 1, radius: 1};
        this.built = null;
        this.mixer = null;
        this.dirty = true;
    }
    componentDidMount () {
        const THREE = this.props.vm.runtime.scene3D.THREE;
        this.THREE = THREE;
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            alpha: true,
            antialias: true
        });
        this.renderer.setClearColor(0x000000, 0);
        this.scene = new THREE.Scene();
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8d8d8d, 1.2));
        const sun = new THREE.DirectionalLight(0xffffff, 1.6);
        sun.position.set(3, 5, 4);
        this.scene.add(sun);
        this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 1000);
        this.center = new THREE.Vector3();

        this.canvas.addEventListener('wheel', this.handleWheel, {passive: false});
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.canvas);
        this.resize();

        this.lastTime = performance.now();
        this.frame = requestAnimationFrame(this.tick);
        this.load(true);
    }
    componentDidUpdate (prevProps) {
        const sourceChanged = sourceKey(prevProps.model) !== sourceKey(this.props.model) ||
            prevProps.fileVersion !== this.props.fileVersion;
        if (sourceChanged || JSON.stringify(prevProps.material) !== JSON.stringify(this.props.material)) {
            this.load(sourceChanged);
        }
    }
    componentWillUnmount () {
        this.unmounted = true;
        cancelAnimationFrame(this.frame);
        this.resizeObserver.disconnect();
        this.canvas.removeEventListener('wheel', this.handleWheel);
        this.removeObject();
        this.renderer.dispose();
        this.renderer.forceContextLoss();
    }
    /**
     * Build the model again, after it or the material changed.
     * @param {boolean} reframe true when it is another model: frame it and forget the animation shown
     */
    async load (reframe) {
        const token = {};
        this.loadToken = token;
        if (reframe) {
            this.setState({loading: true, missing: false, clips: [], clipName: null, playing: false, time: 0});
        }
        let built = null;
        try {
            built = await build3DObject(this.props.vm.runtime.scene3D, this.props.model, Object.assign(
                {color: '#ffffff', opacity: 1, texture: ''}, this.props.material));
        } catch (error) {
            // eslint-disable-next-line no-console
            console.warn('3D: could not preview model', error);
        }
        if (this.unmounted || this.loadToken !== token) {
            if (built) built.dispose();
            return;
        }
        this.removeObject();
        if (!built) {
            this.setState({loading: false, missing: true, clips: []});
            this.dirty = true;
            return;
        }
        this.built = built;
        this.scene.add(built.object);
        const clips = built.source ? this.props.vm.runtime.scene3D.getModelAnimations(built.source) : [];
        this.mixer = clips.length ? new this.THREE.AnimationMixer(built.object) : null;
        if (reframe) this.frameObject();
        const clipName = clips.some(clip => clip.name === this.state.clipName) ? this.state.clipName : null;
        this.setState({loading: false, missing: false, clips, clipName}, () => this.pose());
    }
    removeObject () {
        if (!this.built) return;
        if (this.mixer) {
            this.mixer.stopAllAction();
            this.mixer.uncacheRoot(this.built.object);
            this.mixer = null;
        }
        this.scene.remove(this.built.object);
        this.built.dispose();
        this.built = null;
    }
    /**
     * Point the orbit at the model so that it fills the view, in its normal pose.
     */
    frameObject () {
        const THREE = this.THREE;
        const box = new THREE.Box3().setFromObject(this.built.object);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const radius = sphere.radius > 0 && Number.isFinite(sphere.radius) ? sphere.radius : 1;
        this.center.copy(Number.isFinite(sphere.center.x) ? sphere.center : new THREE.Vector3());
        this.view = {
            yaw: DEFAULT_YAW,
            pitch: DEFAULT_PITCH,
            radius,
            distance: this.defaultDistance(radius)
        };
        this.dirty = true;
    }
    defaultDistance (radius) {
        return radius / Math.sin(this.THREE.MathUtils.degToRad(FOV / 2)) * 1.1;
    }
    resize () {
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        if (!width || !height) return;
        this.renderer.setPixelRatio(window.devicePixelRatio || 1);
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.dirty = true;
    }
    /**
     * @returns {?THREE.AnimationClip} the animation shown
     */
    getClip () {
        return this.state.clips.find(clip => clip.name === this.state.clipName) || null;
    }
    /**
     * Show the model where the animation is, or in its normal pose.
     */
    pose () {
        if (!this.mixer) return;
        const clip = this.getClip();
        if (!clip) {
            this.mixer.stopAllAction();
            this.mixer.update(0);
            this.dirty = true;
            return;
        }
        const action = this.mixer.clipAction(clip);
        if (!action.isRunning()) {
            this.mixer.stopAllAction();
            action.setLoop(this.THREE.LoopRepeat, Infinity);
            action.play();
        }
        const duration = clip.duration;
        let time = this.state.time;
        time = this.state.loop && duration > 0 ?
            ((time % duration) + duration) % duration :
            Math.max(0, Math.min(duration - 1e-4, time));
        action.time = time;
        this.mixer.update(0);
        this.dirty = true;
    }
    tick (now) {
        this.frame = requestAnimationFrame(this.tick);
        const delta = Math.min(0.1, (now - this.lastTime) / 1000);
        this.lastTime = now;
        const clip = this.state.playing && this.getClip();
        if (clip) {
            let time = this.state.time + (delta * this.state.speed);
            let playing = true;
            if (this.state.loop) {
                time = clip.duration > 0 ? time % clip.duration : 0;
            } else if (time >= clip.duration) {
                // Play once stays at the end, like the blocks
                time = clip.duration;
                playing = false;
            }
            this.setState({time, playing}, () => this.pose());
        }
        if (!this.dirty) return;
        this.dirty = false;
        const {yaw, pitch, distance, radius} = this.view;
        const cosPitch = Math.cos(pitch);
        this.camera.position.set(
            this.center.x + (Math.sin(yaw) * cosPitch * distance),
            this.center.y + (Math.sin(pitch) * distance),
            this.center.z + (Math.cos(yaw) * cosPitch * distance)
        );
        this.camera.near = Math.max(radius / 1000, distance - (radius * 10)) || 0.01;
        this.camera.far = distance + (radius * 10);
        this.camera.updateProjectionMatrix();
        this.camera.lookAt(this.center);
        this.renderer.render(this.scene, this.camera);
    }
    handlePointerDown (e) {
        if (e.button !== 0) return;
        this.drag = {x: e.clientX, y: e.clientY};
        this.canvas.setPointerCapture(e.pointerId);
    }
    handlePointerMove (e) {
        if (!this.drag) return;
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        this.drag = {x: e.clientX, y: e.clientY};
        this.view.yaw -= dx * ORBIT_SPEED;
        this.view.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.view.pitch + (dy * ORBIT_SPEED)));
        this.dirty = true;
    }
    handlePointerUp (e) {
        if (!this.drag) return;
        this.drag = null;
        if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    }
    handleWheel (e) {
        e.preventDefault();
        const {radius} = this.view;
        const distance = this.view.distance * Math.exp(e.deltaY * ZOOM_SPEED);
        this.view.distance = Math.max(radius * 0.2, Math.min(radius * 50, distance));
        this.dirty = true;
    }
    handleDoubleClick () {
        this.handleResetView();
    }
    handleResetView () {
        this.view.yaw = DEFAULT_YAW;
        this.view.pitch = DEFAULT_PITCH;
        this.view.distance = this.defaultDistance(this.view.radius);
        this.dirty = true;
    }
    handleClipClick (e) {
        // The first row, without a name, is the model's normal pose
        const name = 'name' in e.currentTarget.dataset ? e.currentTarget.dataset.name : null;
        if (name === null) {
            this.setState({clipName: null, playing: false, time: 0}, () => this.pose());
            return;
        }
        if (name === this.state.clipName) {
            this.handlePlayPause();
            return;
        }
        this.setState({clipName: name, time: 0, playing: true}, () => this.pose());
    }
    handlePlayPause () {
        const clip = this.getClip();
        if (!clip) return;
        if (this.state.playing) {
            this.setState({playing: false});
            return;
        }
        // Playing once from the end starts it over
        const time = !this.state.loop && this.state.time >= clip.duration ? 0 : this.state.time;
        this.setState({playing: true, time});
    }
    handleScrub (e) {
        this.setState({time: Number(e.target.value), playing: false}, () => this.pose());
    }
    handleLoop (e) {
        this.setState({loop: e.target.checked});
    }
    handleSpeed (e) {
        this.setState({speed: Number(e.target.value)});
    }
    setCanvas (canvas) {
        this.canvas = canvas;
    }
    renderAnimations () {
        const {clips, clipName, playing, loop, speed, time, loading} = this.state;
        if (loading || !this.props.model.file) return null;
        const clip = this.getClip();
        return (
            <div className={styles.animations}>
                <div className={styles.sectionTitle}>{'動畫'}</div>
                {clips.length ? (
                    <React.Fragment>
                        <p className={styles.hint}>
                            {'點一下預覽。預覽不會改變角色；在程式裡用「播放動畫」積木，填名稱或編號。'}
                        </p>
                        <ul className={styles.clipList}>
                            <li>
                                <button
                                    className={classNames(styles.clip, {[styles.clipSelected]: clipName === null})}
                                    onClick={this.handleClipClick}
                                >
                                    <span className={styles.clipIndex} />
                                    <span className={styles.clipName}>{'（原本的姿勢）'}</span>
                                </button>
                            </li>
                            {clips.map((item, index) => (
                                <li key={`${index}:${item.name}`}>
                                    <button
                                        className={classNames(styles.clip, {
                                            [styles.clipSelected]: item.name === clipName
                                        })}
                                        data-name={item.name}
                                        title={item.name}
                                        onClick={this.handleClipClick}
                                    >
                                        <span className={styles.clipIndex}>{index + 1}</span>
                                        <span className={styles.clipName}>{item.name || '（沒有名稱）'}</span>
                                        <span className={styles.clipDuration}>{`${formatTime(item.duration)} 秒`}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                        <div className={styles.transport}>
                            <button
                                className={styles.playButton}
                                disabled={!clip}
                                title={playing ? '暫停' : '播放'}
                                onClick={this.handlePlayPause}
                            >
                                {playing ? '❚❚' : '▶'}
                            </button>
                            <input
                                className={styles.timeline}
                                disabled={!clip}
                                max={clip ? clip.duration : 0}
                                min="0"
                                step="0.01"
                                type="range"
                                value={clip ? Math.min(time, clip.duration) : 0}
                                onChange={this.handleScrub}
                            />
                            <span className={styles.time}>
                                {clip ?
                                    `${formatTime(Math.min(time, clip.duration))} / ${formatTime(clip.duration)}` :
                                    ''}
                            </span>
                        </div>
                        <div className={styles.options}>
                            <label className={styles.option}>
                                <input
                                    checked={loop}
                                    type="checkbox"
                                    onChange={this.handleLoop}
                                />
                                {'重複播放'}
                            </label>
                            <label className={styles.option}>
                                {'速度'}
                                <select
                                    className={styles.speed}
                                    value={speed}
                                    onChange={this.handleSpeed}
                                >
                                    {SPEEDS.map(value => (
                                        <option
                                            key={value}
                                            value={value}
                                        >
                                            {`${value}×`}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>
                    </React.Fragment>
                ) : (
                    <p className={styles.hint}>{'這個模型沒有動畫。'}</p>
                )}
            </div>
        );
    }
    render () {
        return (
            <React.Fragment>
                <div className={styles.viewport}>
                    <canvas
                        className={styles.canvas}
                        ref={this.setCanvas}
                        onDoubleClick={this.handleDoubleClick}
                        onPointerCancel={this.handlePointerUp}
                        onPointerDown={this.handlePointerDown}
                        onPointerMove={this.handlePointerMove}
                        onPointerUp={this.handlePointerUp}
                    />
                    {this.state.loading || this.state.missing ? (
                        <div className={styles.status}>
                            {this.state.loading ? '載入中…' : '找不到模型檔'}
                        </div>
                    ) : null}
                    <div className={styles.help}>{'拖曳旋轉 · 滾輪縮放 · 雙擊重設'}</div>
                    <button
                        className={styles.resetButton}
                        title="重設視角"
                        onClick={this.handleResetView}
                    >
                        {'⟲'}
                    </button>
                </div>
                {this.renderAnimations()}
            </React.Fragment>
        );
    }
}

ModelPreview.propTypes = {
    // Changes when the model's file might have changed
    fileVersion: PropTypes.number,
    material: PropTypes.shape({
        color: PropTypes.string,
        opacity: PropTypes.number,
        texture: PropTypes.string
    }),
    model: PropTypes.shape({
        name: PropTypes.string,
        shape: PropTypes.string,
        file: PropTypes.string
    }).isRequired,
    vm: PropTypes.instanceOf(VM).isRequired
};

export default ModelPreview;

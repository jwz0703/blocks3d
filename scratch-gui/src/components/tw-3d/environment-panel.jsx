import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';

import {sunFromAngles, sunToAngles} from 'scratch-vm/src/engine/scene-3d-environment';

import Input from '../forms/input.jsx';
import BufferedInputHOC from '../forms/buffered-input-hoc.jsx';

import styles from './environment-panel.css';

const BufferedInput = BufferedInputHOC(Input);

// Files that can be skies or lighting: equirectangular images
const SKY_FILE = /\.(hdr|exr|png|jpe?g|webp)$/i;

// Big HDRIs are slow to load and to turn into lighting
const LARGE_SKY_FILE = 8 * 1024 * 1024;

const SKY_TYPES = [
    {value: 'procedural', name: '程序天空'},
    {value: 'gradient', name: '漸層'},
    {value: 'color', name: '純色'},
    {value: 'hdri', name: 'HDRI / 全景圖'},
    {value: '2d', name: '2D 背景'}
];

const LIGHTING_TYPES = [
    {value: 'sky', name: '跟著天空'},
    {value: 'room', name: '攝影棚（不需要檔案）'},
    {value: 'hdri', name: 'HDRI / 全景圖'},
    {value: 'none', name: '無（只有環境光和太陽）'}
];

const TONE_MAPPINGS = [
    {value: 'neutral', name: '中性（保留原色）'},
    {value: 'agx', name: 'AgX'},
    {value: 'aces', name: 'ACES（電影感）'},
    {value: 'none', name: '無'}
];

/**
 * The environment of a backdrop in the Environment tab: sky, sun, lighting, fog and tone mapping. For a 2D backdrop
 * (its picture behind the scene), the settings fold up so that the paint editor below has room.
 */
class EnvironmentPanel extends React.Component {
    constructor (props) {
        super(props);
        this.state = {
            expanded: false
        };
        this.handleToggleExpanded = this.handleToggleExpanded.bind(this);
        this.handleUploadClick = this.handleUploadClick.bind(this);
        this.handleUpload = this.handleUpload.bind(this);
        this.setFileInput = input => {
            this.fileInput = input;
        };
        this.handlers = {};
    }
    /**
     * @param {string} key a stable name for the handler
     * @param {function(Event): object} makeChanges event → partial environment
     * @returns {function(Event): void} handler that calls onChange, the same one every render
     */
    handler (key, makeChanges) {
        if (!this.handlers[key]) {
            this.handlers[key] = e => {
                const changes = this.handlers[key].makeChanges(e);
                if (changes) this.props.onChange(changes);
            };
        }
        this.handlers[key].makeChanges = makeChanges;
        return this.handlers[key];
    }
    handleToggleExpanded () {
        this.setState(state => ({expanded: !state.expanded}));
    }
    handleUploadClick (e) {
        this.uploadFor = e.currentTarget.dataset.for;
        this.fileInput.click();
    }
    handleUpload (e) {
        const file = e.target.files[0];
        // Allow picking the same file again
        e.target.value = '';
        if (!file) return;
        if (file.size > LARGE_SKY_FILE) {
            // eslint-disable-next-line no-alert
            alert('這張圖很大，載入和產生照明會比較慢。建議使用 1K–2K 解析度的 HDRI。');
        }
        this.props.onUploadSkyFile(file, this.uploadFor);
    }
    renderSelect (key, value, options, makeChanges) {
        return (
            <select
                className={styles.select}
                value={value}
                onChange={this.handler(key, makeChanges)}
            >
                {options.map(option => (
                    <option
                        key={option.value}
                        value={option.value}
                    >
                        {option.name}
                    </option>
                ))}
            </select>
        );
    }
    renderColor (key, value, makeChanges) {
        return (
            <input
                className={styles.colorInput}
                type="color"
                value={value}
                onChange={this.handler(key, makeChanges)}
            />
        );
    }
    renderRange (key, value, min, max, step, makeChanges, format) {
        return (
            <React.Fragment>
                <input
                    className={styles.range}
                    max={max}
                    min={min}
                    step={step}
                    type="range"
                    value={value}
                    onChange={this.handler(key, makeChanges)}
                />
                <span className={styles.value}>{format ? format(value) : value}</span>
            </React.Fragment>
        );
    }
    renderField (label, control) {
        return (
            <label className={styles.field}>
                <span className={styles.fieldLabel}>{label}</span>
                {control}
            </label>
        );
    }
    renderFileSelect (key, value, section) {
        const files = this.props.fileNames.filter(name => SKY_FILE.test(name));
        const options = value && !files.includes(value) ? [value, ...files] : files;
        return (
            <div className={styles.fileRow}>
                <select
                    className={styles.select}
                    value={value}
                    onChange={this.handler(key, e => ({[section]: {file: e.target.value}}))}
                >
                    <option value="">{options.length ? '選擇檔案…' : '檔案分頁裡沒有圖片'}</option>
                    {options.map(file => (
                        <option
                            key={file}
                            value={file}
                        >
                            {files.includes(file) ? file : `${file}（找不到檔案）`}
                        </option>
                    ))}
                </select>
                <button
                    className={styles.button}
                    data-for={section}
                    onClick={this.handleUploadClick}
                >
                    {'上傳'}
                </button>
            </div>
        );
    }
    renderSky (env) {
        const sky = env.sky;
        return (
            <React.Fragment>
                {this.renderField('天空', this.renderSelect('skyType', sky.type, SKY_TYPES,
                    e => ({sky: {type: e.target.value}})))}
                {sky.type === 'color' ? this.renderField('顏色', this.renderColor('skyColor', sky.color,
                    e => ({sky: {color: e.target.value}}))) : null}
                {sky.type === 'gradient' ? (
                    <React.Fragment>
                        {this.renderField('上方', this.renderColor('skyTop', sky.top,
                            e => ({sky: {top: e.target.value}})))}
                        {this.renderField('下方', this.renderColor('skyBottom', sky.bottom,
                            e => ({sky: {bottom: e.target.value}})))}
                    </React.Fragment>
                ) : null}
                {sky.type === 'procedural' ? this.renderField('雲量', this.renderRange('clouds', sky.clouds,
                    0, 100, 1, e => ({sky: {clouds: Number(e.target.value)}}), v => `${v}%`)) : null}
                {sky.type === 'hdri' ? (
                    <React.Fragment>
                        {this.renderField('檔案', this.renderFileSelect('skyFile', sky.file, 'sky'))}
                        {this.renderField('旋轉', this.renderRange('skyRotation', sky.rotation, -180, 180, 1,
                            e => ({sky: {rotation: Number(e.target.value)}}), v => `${v}°`))}
                    </React.Fragment>
                ) : null}
                {['procedural', 'gradient', 'hdri'].includes(sky.type) ? this.renderField('模糊',
                    this.renderRange('skyBlur', sky.blur, 0, 100, 1, e => ({sky: {blur: Number(e.target.value)}}),
                        v => `${v}%`)) : null}
                {sky.type === '2d' ? (
                    <p className={styles.hint}>{'背景的圖畫在 3D 場景後面，可以在下面的繪圖編輯器修改。'}</p>
                ) : null}
            </React.Fragment>
        );
    }
    renderDetails (env) {
        const angles = sunToAngles(env.sun);
        const sun = {elevation: Math.round(angles.elevation), azimuth: Math.round(angles.azimuth)};
        const lighting = env.lighting;
        const skyLights = ['procedural', 'gradient', 'hdri'].includes(env.sky.type);
        return (
            <React.Fragment>
                <div className={styles.sectionTitle}>{'太陽'}</div>
                {this.renderField('高度', this.renderRange('sunElevation', sun.elevation, -20, 90, 1,
                    e => ({sun: sunFromAngles(Number(e.target.value), sun.azimuth)}), v => `${v}°`))}
                {this.renderField('方位', this.renderRange('sunAzimuth', sun.azimuth, -180, 180, 1,
                    e => ({sun: sunFromAngles(sun.elevation, Number(e.target.value))}), v => `${v}°`))}
                {this.renderField('強度', this.renderRange('sunIntensity', env.sun.intensity, 0, 5, 0.1,
                    e => ({sun: {intensity: Number(e.target.value)}})))}
                {this.renderField('顏色', this.renderColor('sunColor', env.sun.color,
                    e => ({sun: {color: e.target.value}})))}
                <label className={styles.field}>
                    <span className={styles.fieldLabel}>{'陰影'}</span>
                    <input
                        checked={env.sun.shadows}
                        type="checkbox"
                        onChange={this.handler('shadows', e => ({sun: {shadows: e.target.checked}}))}
                    />
                </label>

                <div className={styles.sectionTitle}>{'照明'}</div>
                {this.renderField('環境照明', this.renderSelect('lightingType', lighting.type, LIGHTING_TYPES,
                    e => ({lighting: {type: e.target.value}})))}
                {lighting.type === 'sky' && !skyLights ? (
                    <p className={styles.hint}>{'這種天空不能拿來照明，改用攝影棚照明。'}</p>
                ) : null}
                {lighting.type === 'hdri' ? (
                    <React.Fragment>
                        {this.renderField('檔案', this.renderFileSelect('lightingFile', lighting.file, 'lighting'))}
                        {this.renderField('旋轉', this.renderRange('lightingRotation', lighting.rotation, -180, 180,
                            1, e => ({lighting: {rotation: Number(e.target.value)}}), v => `${v}°`))}
                    </React.Fragment>
                ) : null}
                {lighting.type === 'none' ? null : this.renderField('強度', this.renderRange('lightingIntensity',
                    lighting.intensity, 0, 3, 0.05, e => ({lighting: {intensity: Number(e.target.value)}})))}
                {this.renderField('環境光', this.renderRange('ambient', env.ambient.intensity, 0, 2, 0.05,
                    e => ({ambient: {intensity: Number(e.target.value)}})))}
                {this.renderField('色調映射', this.renderSelect('toneMapping', env.toneMapping, TONE_MAPPINGS,
                    e => ({toneMapping: e.target.value})))}
                {this.renderField('曝光', this.renderRange('exposure', env.exposure, 0, 3, 0.05,
                    e => ({exposure: Number(e.target.value)})))}

                <div className={styles.sectionTitle}>{'霧'}</div>
                <label className={styles.field}>
                    <span className={styles.fieldLabel}>{'開啟'}</span>
                    <input
                        checked={env.fog.enabled}
                        type="checkbox"
                        onChange={this.handler('fog', e => ({fog: {enabled: e.target.checked}}))}
                    />
                </label>
                {env.fog.enabled ? (
                    <React.Fragment>
                        {this.renderField('顏色', this.renderColor('fogColor', env.fog.color,
                            e => ({fog: {color: e.target.value}})))}
                        {this.renderField('開始', this.renderRange('fogNear', env.fog.near, 0, 200, 1,
                            e => ({fog: {near: Number(e.target.value)}})))}
                        {this.renderField('結束', this.renderRange('fogFar', env.fog.far, 1, 500, 1,
                            e => ({fog: {far: Number(e.target.value)}})))}
                    </React.Fragment>
                ) : null}
            </React.Fragment>
        );
    }
    render () {
        const env = this.props.environment;
        const is2D = env.sky.type === '2d';
        const expanded = !is2D || this.state.expanded;
        return (
            <div className={classNames(styles.panel, {[styles.compact]: is2D})}>
                <div className={styles.form}>
                    {is2D ? null : this.renderField('名稱', (
                        <BufferedInput
                            className={styles.nameInput}
                            type="text"
                            value={this.props.name}
                            onSubmit={this.props.onRename}
                        />
                    ))}
                    {this.renderSky(env)}
                    {is2D ? (
                        <button
                            className={styles.expand}
                            onClick={this.handleToggleExpanded}
                        >
                            {expanded ? '收起太陽、照明和霧 ▴' : '太陽、照明和霧 ▾'}
                        </button>
                    ) : null}
                    {expanded ? this.renderDetails(env) : null}
                </div>
                <input
                    accept=".hdr,.exr,.png,.jpg,.jpeg,.webp"
                    ref={this.setFileInput}
                    style={{display: 'none'}}
                    type="file"
                    onChange={this.handleUpload}
                />
            </div>
        );
    }
}

EnvironmentPanel.propTypes = {
    environment: PropTypes.shape({
        sky: PropTypes.object,
        lighting: PropTypes.object,
        ambient: PropTypes.object,
        sun: PropTypes.object,
        fog: PropTypes.object,
        toneMapping: PropTypes.string,
        exposure: PropTypes.number
    }).isRequired,
    fileNames: PropTypes.arrayOf(PropTypes.string).isRequired,
    name: PropTypes.string,
    onChange: PropTypes.func.isRequired,
    onRename: PropTypes.func.isRequired,
    onUploadSkyFile: PropTypes.func.isRequired
};

export {
    EnvironmentPanel as default,
    SKY_TYPES
};

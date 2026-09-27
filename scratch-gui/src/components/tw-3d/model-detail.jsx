import PropTypes from 'prop-types';
import React from 'react';
import VM from 'scratch-vm';

import Input from '../forms/input.jsx';
import BufferedInputHOC from '../forms/buffered-input-hoc.jsx';
import ModelPreview from './model-preview.jsx';
import {SHAPES} from './shapes.js';

import styles from './model-detail.css';

const CANVAS_PREFIX = 'canvas:';

const BufferedInput = BufferedInputHOC(Input);

/**
 * @param {object} model {shape} or {file}
 * @returns {string} value of the source <select>
 */
const sourceValue = model => (model.file ? `file:${model.file}` : `shape:${model.shape}`);

/**
 * Right side of the Models tab: the selected model and the sprite's material.
 */
class ModelDetail extends React.Component {
    constructor (props) {
        super(props);
        this.handleSource = this.handleSource.bind(this);
        this.handleColor = this.handleColor.bind(this);
        this.handleOpacity = this.handleOpacity.bind(this);
        this.handleTexture = this.handleTexture.bind(this);
    }
    handleSource (e) {
        const [type, ...rest] = e.target.value.split(':');
        const value = rest.join(':');
        this.props.onChangeSource(type === 'file' ? {file: value} : {shape: value});
    }
    handleColor (e) {
        this.props.onChangeMaterial({color: e.target.value});
    }
    handleOpacity (e) {
        this.props.onChangeMaterial({opacity: Number(e.target.value) / 100});
    }
    handleTexture (e) {
        this.props.onChangeMaterial({texture: e.target.value});
    }
    render () {
        const {model, material, modelFiles, imageFiles, canvasSpriteNames, fileVersion, vm} = this.props;
        // A file that was removed from the Files tab stays selectable, so the select shows what is used
        const files = model.file && !modelFiles.includes(model.file) ? [model.file, ...modelFiles] : modelFiles;
        // Canvas sprites are "canvas:" and their name, see the VM's Scene3D
        const canvasTextures = canvasSpriteNames.map(name => `${CANVAS_PREFIX}${name}`);
        const available = [...imageFiles, ...canvasTextures];
        const textures = material.texture && !available.includes(material.texture) ?
            [material.texture, ...available] :
            available;
        const textureLabel = texture => {
            if (texture.startsWith(CANVAS_PREFIX)) {
                const name = texture.slice(CANVAS_PREFIX.length);
                return canvasTextures.includes(texture) ? `畫布角色：${name}` : `畫布角色：${name}（找不到角色）`;
            }
            return imageFiles.includes(texture) ? texture : `${texture}（找不到檔案）`;
        };
        return (
            <div className={styles.detail}>
                <ModelPreview
                    fileVersion={fileVersion}
                    material={material}
                    model={model}
                    vm={vm}
                />
                <div className={styles.form}>
                    <div className={styles.sectionTitle}>{'模型'}</div>
                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>{'名稱'}</span>
                        <BufferedInput
                            className={styles.fieldControl}
                            type="text"
                            value={model.name}
                            onSubmit={this.props.onRename}
                        />
                    </label>
                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>{'來源'}</span>
                        <select
                            className={styles.select}
                            value={sourceValue(model)}
                            onChange={this.handleSource}
                        >
                            <optgroup label="基本形狀">
                                {SHAPES.map(({shape, name}) => (
                                    <option
                                        key={shape}
                                        value={`shape:${shape}`}
                                    >
                                        {name}
                                    </option>
                                ))}
                            </optgroup>
                            {files.length ? (
                                <optgroup label="檔案分頁">
                                    {files.map(file => (
                                        <option
                                            key={file}
                                            value={`file:${file}`}
                                        >
                                            {modelFiles.includes(file) ? file : `${file}（找不到檔案）`}
                                        </option>
                                    ))}
                                </optgroup>
                            ) : null}
                        </select>
                    </label>

                    <div className={styles.sectionTitle}>{'材質'}</div>
                    <p className={styles.hint}>{'材質套用在這個角色的所有模型上。模型檔保留原本的顏色，除非顏色不是白色。'}</p>
                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>{'顏色'}</span>
                        <input
                            className={styles.colorInput}
                            type="color"
                            value={material.color}
                            onChange={this.handleColor}
                        />
                    </label>
                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>{'透明度'}</span>
                        <input
                            className={styles.range}
                            max="100"
                            min="0"
                            type="range"
                            value={Math.round(material.opacity * 100)}
                            onChange={this.handleOpacity}
                        />
                        <span className={styles.opacityValue}>{`${Math.round(material.opacity * 100)}%`}</span>
                    </label>
                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>{'貼圖'}</span>
                        <select
                            className={styles.select}
                            value={material.texture}
                            onChange={this.handleTexture}
                        >
                            <option value="">{'無'}</option>
                            {textures.map(file => (
                                <option
                                    key={file}
                                    value={file}
                                >
                                    {textureLabel(file)}
                                </option>
                            ))}
                        </select>
                    </label>
                    {available.length ? null : (
                        <p className={styles.hint}>{'把圖片上傳到檔案分頁，或新增畫布角色，就能當作貼圖。'}</p>
                    )}
                </div>
            </div>
        );
    }
}

ModelDetail.propTypes = {
    canvasSpriteNames: PropTypes.arrayOf(PropTypes.string).isRequired,
    fileVersion: PropTypes.number,
    imageFiles: PropTypes.arrayOf(PropTypes.string).isRequired,
    material: PropTypes.shape({
        color: PropTypes.string,
        opacity: PropTypes.number,
        texture: PropTypes.string
    }).isRequired,
    model: PropTypes.shape({
        name: PropTypes.string,
        shape: PropTypes.string,
        file: PropTypes.string
    }).isRequired,
    modelFiles: PropTypes.arrayOf(PropTypes.string).isRequired,
    onChangeMaterial: PropTypes.func.isRequired,
    onChangeSource: PropTypes.func.isRequired,
    onRename: PropTypes.func.isRequired,
    vm: PropTypes.instanceOf(VM).isRequired
};

export default ModelDetail;

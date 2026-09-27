import PropTypes from 'prop-types';
import React from 'react';
import VM from 'scratch-vm';

import Box from '../box/box.jsx';
import Modal from '../../containers/modal.jsx';
import ModelThumbnail from './model-thumbnail.jsx';
import {SHAPES, MODEL_FILE, DEFAULT_SHAPE_COLOR, modelNameFromFile} from './shapes.js';

import styles from './add-3d-sprite-modal.css';
import cameraIcon from './icon--camera.svg';

const SHAPE_MATERIAL = {color: DEFAULT_SHAPE_COLOR};

/**
 * Pick what a new 3D sprite (or a new model of one) shows:
 * a basic shape, an uploaded model, or a model in the Files tab. New sprites can also be cameras.
 */
class Add3DSpriteModal extends React.Component {
    constructor (props) {
        super(props);
        this.handleFilesChanged = this.handleFilesChanged.bind(this);
        this.handleUploadClick = this.handleUploadClick.bind(this);
        this.handleUpload = this.handleUpload.bind(this);
        this.setFileInput = input => {
            this.fileInput = input;
        };
        this.state = {
            files: this.getModelFiles(),
            fileVersion: 0
        };
    }
    componentDidMount () {
        this.props.vm.runtime.fileManager.on('change', this.handleFilesChanged);
    }
    componentWillUnmount () {
        this.props.vm.runtime.fileManager.removeListener('change', this.handleFilesChanged);
    }
    getModelFiles () {
        return this.props.vm.runtime.fileManager.getFileNames().filter(name => MODEL_FILE.test(name));
    }
    handleFilesChanged () {
        this.setState(state => ({
            files: this.getModelFiles(),
            fileVersion: state.fileVersion + 1
        }));
    }
    handleUploadClick () {
        this.fileInput.click();
    }
    handleUpload (e) {
        const files = Array.from(e.target.files);
        // Allow picking the same file again
        e.target.value = '';
        if (files.length) this.props.onUploadModels(files);
    }
    render () {
        const {vm, onAddCamera, onAddShape, onChooseFile, onClose} = this.props;
        return (
            <Modal
                className={styles.modalContent}
                contentLabel={this.props.title}
                id="add3DSpriteModal"
                onRequestClose={onClose}
            >
                <Box className={styles.body}>
                    <div className={styles.sectionTitle}>{'基本形狀'}</div>
                    <div className={styles.grid}>
                        {SHAPES.map(({shape, name}) => (
                            <button
                                key={shape}
                                className={styles.tile}
                                onClick={() => onAddShape(shape, name)} // eslint-disable-line react/jsx-no-bind
                            >
                                <ModelThumbnail
                                    className={styles.thumbnail}
                                    material={SHAPE_MATERIAL}
                                    model={{shape}}
                                    vm={vm}
                                />
                                <span className={styles.tileName}>{name}</span>
                            </button>
                        ))}
                    </div>

                    {onAddCamera ? (
                        <React.Fragment>
                            <div className={styles.sectionTitle}>{'相機'}</div>
                            <div className={styles.grid}>
                                <button
                                    className={styles.tile}
                                    onClick={onAddCamera}
                                >
                                    <img
                                        alt=""
                                        className={styles.thumbnail}
                                        draggable={false}
                                        src={cameraIcon}
                                    />
                                    <span className={styles.tileName}>{'相機'}</span>
                                </button>
                            </div>
                            <p className={styles.hint}>
                                {'舞台顯示「目前的相機」看到的畫面。可以有好幾台相機，用「切換相機到」積木切換。'}
                            </p>
                        </React.Fragment>
                    ) : null}

                    <div className={styles.sectionTitle}>{'上傳模型'}</div>
                    <button
                        className={styles.uploadButton}
                        onClick={this.handleUploadClick}
                    >
                        {'上傳 GLB / GLTF'}
                    </button>
                    <input
                        accept=".glb,.gltf"
                        multiple
                        ref={this.setFileInput}
                        style={{display: 'none'}}
                        type="file"
                        onChange={this.handleUpload}
                    />
                    <p className={styles.hint}>
                        {'模型檔會存進檔案分頁。.gltf 用到的其他檔案（.bin、貼圖）也要一起上傳到檔案分頁。'}
                    </p>

                    <div className={styles.sectionTitle}>{'從檔案分頁選取'}</div>
                    {this.state.files.length ? (
                        <div className={styles.grid}>
                            {this.state.files.map(fileName => (
                                <button
                                    key={fileName}
                                    className={styles.tile}
                                    title={fileName}
                                    onClick={() => onChooseFile(fileName)} // eslint-disable-line react/jsx-no-bind
                                >
                                    <ModelThumbnail
                                        className={styles.thumbnail}
                                        fileVersion={this.state.fileVersion}
                                        model={{file: fileName}}
                                        vm={vm}
                                    />
                                    <span className={styles.tileName}>{modelNameFromFile(fileName)}</span>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <p className={styles.hint}>{'檔案分頁裡還沒有 .glb 或 .gltf 模型。'}</p>
                    )}
                </Box>
            </Modal>
        );
    }
}

Add3DSpriteModal.propTypes = {
    title: PropTypes.string,
    onAddCamera: PropTypes.func,
    onAddShape: PropTypes.func.isRequired,
    onChooseFile: PropTypes.func.isRequired,
    onClose: PropTypes.func.isRequired,
    onUploadModels: PropTypes.func.isRequired,
    vm: PropTypes.instanceOf(VM).isRequired
};

Add3DSpriteModal.defaultProps = {
    title: '新增 3D 角色'
};

export default Add3DSpriteModal;

import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import VM from 'scratch-vm';

import AssetPanel from '../components/asset-panel/asset-panel.jsx';
import Add3DSpriteModal from '../components/tw-3d/add-3d-sprite-modal.jsx';
import ModelDetail from '../components/tw-3d/model-detail.jsx';
import {SHAPES, MODEL_FILE, modelNameFromFile} from '../components/tw-3d/shapes.js';
import {getFileKind} from '../components/tw-file-tab/file-kind.js';
import DragConstants from '../lib/drag-constants';
import get3DThumbnail from '../lib/tw-3d-thumbnail';
import {setRestore} from '../reducers/restore-deletion';
import log from '../lib/log';

import icon3D from '../components/action-menu/icon--3d.svg';
import fileUploadIcon from '../components/action-menu/icon--file-upload.svg';

/**
 * @param {object} model {shape} or {file}
 * @returns {string} short description shown under the model's name
 */
const describeModel = model => {
    if (model.file) return model.file;
    const shape = SHAPES.find(item => item.shape === model.shape);
    return shape ? shape.name : model.shape;
};

/**
 * The Models tab, shown instead of Costumes for 3D sprites: the sprite's models and its material.
 */
class ModelTab extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleAddModelClick',
            'handleAddShape',
            'handleChangeMaterial',
            'handleChangeSource',
            'handleChooseFile',
            'handleCloseModal',
            'handleDeleteModel',
            'handleDrop',
            'handleDuplicateModel',
            'handleFilesChanged',
            'handleRename',
            'handleSelectModel',
            'handleUploadClick',
            'handleUploadInput',
            'handleUploadModels',
            'setFileInput'
        ]);
        this.state = {
            modalVisible: false,
            fileVersion: 0,
            // Thumbnail data URLs by the key of get3DThumbnail's arguments
            thumbnails: {}
        };
    }
    componentDidMount () {
        this.props.vm.runtime.fileManager.on('change', this.handleFilesChanged);
    }
    componentWillUnmount () {
        this.props.vm.runtime.fileManager.removeListener('change', this.handleFilesChanged);
        this.unmounted = true;
    }
    handleFilesChanged () {
        this.setState(state => ({fileVersion: state.fileVersion + 1}));
    }
    getFileNames (kind) {
        return this.props.vm.runtime.fileManager.getFileNames().filter(name => getFileKind(name) === kind);
    }
    /**
     * @param {object} model model of the sprite
     * @param {object} material material of the sprite
     * @returns {?string} thumbnail, or null while it is rendered
     */
    getThumbnail (model, material) {
        const key = JSON.stringify([model, material, this.state.fileVersion]);
        if (Object.prototype.hasOwnProperty.call(this.state.thumbnails, key)) {
            return this.state.thumbnails[key];
        }
        get3DThumbnail(this.props.vm, model, material).then(url => {
            if (this.unmounted) return;
            this.setState(state => ({thumbnails: Object.assign({}, state.thumbnails, {[key]: url})}));
        });
        return null;
    }
    handleSelectModel (index) {
        this.props.vm.postSpriteInfo({currentModel: index});
    }
    handleDeleteModel (index) {
        const restore = this.props.vm.deleteModel3D(index);
        if (restore) {
            this.props.dispatchUpdateRestore({restoreFun: restore, deletedItem: 'Model'});
        }
    }
    handleDuplicateModel (index) {
        const newIndex = this.props.vm.duplicateModel3D(index);
        if (newIndex !== -1) this.handleSelectModel(newIndex);
    }
    handleDrop (dropInfo) {
        if (dropInfo.dragType === DragConstants.MODEL) {
            this.props.vm.reorderModel3D(this.props.editingTarget, dropInfo.index, dropInfo.newIndex);
        }
    }
    handleRename (name) {
        this.props.vm.renameModel3D(this.props.target.currentModel, name);
    }
    handleChangeSource (source) {
        this.props.vm.setModelSource3D(this.props.target.currentModel, source);
    }
    handleChangeMaterial (changes) {
        this.props.vm.postSpriteInfo({material: changes});
    }
    handleAddModelClick () {
        this.setState({modalVisible: true});
    }
    handleCloseModal () {
        this.setState({modalVisible: false});
    }
    addModel (model) {
        this.setState({modalVisible: false});
        const index = this.props.vm.addModel3D(model);
        if (index !== -1) this.handleSelectModel(index);
    }
    handleAddShape (shape, name) {
        this.addModel({name, shape});
    }
    handleChooseFile (fileName) {
        this.addModel({name: modelNameFromFile(fileName), file: fileName});
    }
    handleUploadClick () {
        this.fileInput.click();
    }
    handleUploadInput (e) {
        const files = Array.from(e.target.files);
        e.target.value = '';
        this.handleUploadModels(files);
    }
    async handleUploadModels (files) {
        const fileManager = this.props.vm.runtime.fileManager;
        try {
            for (const file of files) {
                const savedName = fileManager.addFile(file.name, await file.arrayBuffer());
                if (MODEL_FILE.test(savedName)) this.handleChooseFile(savedName);
            }
        } catch (err) {
            log.error(err);
            alert(`無法讀取檔案：${err}`); // eslint-disable-line no-alert
        }
        this.setState({modalVisible: false});
    }
    setFileInput (input) {
        this.fileInput = input;
    }
    render () {
        const {target, vm} = this.props;
        if (!target || target.kind !== '3d') return null;
        const models = target.models || [];
        const material = target.material;
        const items = models.map(model => ({
            name: model.name,
            url: this.getThumbnail(model, material) || '',
            details: describeModel(model),
            dragPayload: model
        }));
        const selected = models[target.currentModel];
        return (
            <AssetPanel
                buttons={[
                    {
                        title: '新增模型',
                        img: icon3D,
                        onClick: this.handleAddModelClick
                    },
                    {
                        title: '上傳 GLB / GLTF',
                        img: fileUploadIcon,
                        onClick: this.handleUploadClick,
                        fileAccept: '.glb, .gltf',
                        fileChange: this.handleUploadInput,
                        fileInput: this.setFileInput,
                        fileMultiple: true
                    },
                    {
                        title: '新增模型',
                        img: icon3D,
                        onClick: this.handleAddModelClick
                    }
                ]}
                dragType={DragConstants.MODEL}
                isRtl={this.props.isRtl}
                items={items}
                selectedItemIndex={target.currentModel}
                onDeleteClick={models.length > 1 ? this.handleDeleteModel : null}
                onDrop={this.handleDrop}
                onDuplicateClick={this.handleDuplicateModel}
                onItemClick={this.handleSelectModel}
            >
                {selected ? (
                    <ModelDetail
                        canvasSpriteNames={this.props.canvasSpriteNames}
                        fileVersion={this.state.fileVersion}
                        imageFiles={this.getFileNames('image')}
                        material={material}
                        model={selected}
                        modelFiles={this.getFileNames('model')}
                        vm={vm}
                        onChangeMaterial={this.handleChangeMaterial}
                        onChangeSource={this.handleChangeSource}
                        onRename={this.handleRename}
                    />
                ) : null}
                {this.state.modalVisible ? (
                    <Add3DSpriteModal
                        title="新增模型"
                        vm={vm}
                        onAddShape={this.handleAddShape}
                        onChooseFile={this.handleChooseFile}
                        onClose={this.handleCloseModal}
                        onUploadModels={this.handleUploadModels}
                    />
                ) : null}
            </AssetPanel>
        );
    }
}

ModelTab.propTypes = {
    canvasSpriteNames: PropTypes.arrayOf(PropTypes.string).isRequired,
    dispatchUpdateRestore: PropTypes.func.isRequired,
    editingTarget: PropTypes.string,
    isRtl: PropTypes.bool,
    target: PropTypes.shape({
        kind: PropTypes.string,
        models: PropTypes.arrayOf(PropTypes.object),
        currentModel: PropTypes.number,
        material: PropTypes.object
    }),
    vm: PropTypes.instanceOf(VM).isRequired
};

const mapStateToProps = state => ({
    canvasSpriteNames: Object.values(state.scratchGui.targets.sprites)
        .filter(sprite => sprite.kind === 'canvas')
        .map(sprite => sprite.name),
    editingTarget: state.scratchGui.targets.editingTarget,
    isRtl: state.locales.isRtl,
    target: state.scratchGui.targets.sprites[state.scratchGui.targets.editingTarget]
});

const mapDispatchToProps = dispatch => ({
    dispatchUpdateRestore: restoreState => dispatch(setRestore(restoreState))
});

export default connect(mapStateToProps, mapDispatchToProps)(ModelTab);

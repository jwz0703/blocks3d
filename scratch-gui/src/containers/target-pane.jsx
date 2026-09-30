import bindAll from 'lodash.bindall';
import React from 'react';
import PropTypes from 'prop-types';
import {connect} from 'react-redux';
import {intlShape, injectIntl} from 'react-intl';

import {
    openSpriteLibrary,
    closeSpriteLibrary
} from '../reducers/modals';
import {activateTab, COSTUMES_TAB_INDEX, BLOCKS_TAB_INDEX} from '../reducers/editor-tab';
import {setReceivedBlocks} from '../reducers/hovered-target';
import {showStandardAlert, closeAlertWithId} from '../reducers/alerts';
import {setRestore} from '../reducers/restore-deletion';
import DragConstants from '../lib/drag-constants';
import TargetPaneComponent from '../components/target-pane/target-pane.jsx';
import {getSpriteLibrary} from '../lib/libraries/tw-async-libraries';
import {handleFileUpload, spriteUpload} from '../lib/file-uploader.js';
import sharedMessages from '../lib/shared-messages';
import {emptySprite} from '../lib/empty-assets';
import {highlightTarget} from '../reducers/targets';
import {fetchSprite, fetchCode} from '../lib/backpack-api';
import randomizeSpritePosition from '../lib/randomize-sprite-position';
import downloadBlob from '../lib/download-blob';
import log from '../lib/log';
import {placeInViewport} from '../lib/backpack/code-payload.js';
import Add3DSpriteModal from '../components/tw-3d/add-3d-sprite-modal.jsx';
import {DEFAULT_SHAPE_COLOR, MODEL_FILE, modelNameFromFile} from '../components/tw-3d/shapes.js';

class TargetPane extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleActivateBlocksTab',
            'handleAdd3DShape',
            'handleAddCamera',
            'handleChoose3DModelFile',
            'handleClose3DSpriteModal',
            'handleNewCanvasSprite',
            'handleOpen3DSpriteModal',
            'handleUpload3DModels',
            'handleBlockDragEnd',
            'handleChangeSprite3D',
            'handleChangeSpriteRotationStyle',
            'handleChangeSpriteDirection',
            'handleChangeSpriteName',
            'handleChangeSpriteSize',
            'handleChangeSpriteVisibility',
            'handleChangeSpriteX',
            'handleChangeSpriteY',
            'handleDeleteSprite',
            'handleDrop',
            'handleDuplicateSprite',
            'handleExportSprite',
            'handleNewSprite',
            'handleSelectSprite',
            'handleSurpriseSpriteClick',
            'handlePaintSpriteClick',
            'handleFileUploadClick',
            'handleSpriteUpload',
            'handleComponentFile',
            'setFileInput'
        ]);
        this.state = {
            add3DSpriteVisible: false
        };
    }
    componentDidMount () {
        this.props.vm.addListener('BLOCK_DRAG_END', this.handleBlockDragEnd);
    }
    componentWillUnmount () {
        this.props.vm.removeListener('BLOCK_DRAG_END', this.handleBlockDragEnd);
    }
    handleChangeSprite3D (data) {
        this.props.vm.postSpriteInfo(data);
    }
    handleChangeSpriteDirection (direction) {
        this.props.vm.postSpriteInfo({direction});
    }
    handleChangeSpriteRotationStyle (rotationStyle) {
        this.props.vm.postSpriteInfo({rotationStyle});
    }
    handleChangeSpriteName (name) {
        this.props.vm.renameSprite(this.props.editingTarget, name);
    }
    handleChangeSpriteSize (size) {
        this.props.vm.postSpriteInfo({size});
    }
    handleChangeSpriteVisibility (visible) {
        this.props.vm.postSpriteInfo({visible});
    }
    handleChangeSpriteX (x) {
        this.props.vm.postSpriteInfo({x});
    }
    handleChangeSpriteY (y) {
        this.props.vm.postSpriteInfo({y});
    }
    handleDeleteSprite (id) {
        const restoreSprite = this.props.vm.deleteSprite(id);
        const restoreFun = () => restoreSprite().then(this.handleActivateBlocksTab);

        this.props.dispatchUpdateRestore({
            restoreFun: restoreFun,
            deletedItem: 'Sprite'
        });

    }
    handleDuplicateSprite (id) {
        this.props.vm.duplicateSprite(id);
    }
    handleExportSprite (id) {
        const spriteName = this.props.vm.runtime.getTargetById(id).getName();
        const saveLink = document.createElement('a');
        document.body.appendChild(saveLink);

        this.props.vm.exportSprite(id).then(content => {
            downloadBlob(`${spriteName}.sprite3`, content);
        });
    }
    handleSelectSprite (id) {
        this.props.vm.setEditingTarget(id);
        if (this.props.stage && id !== this.props.stage.id) {
            this.props.onHighlightTarget(id);
        }
    }
    async handleSurpriseSpriteClick () {
        const spriteLibraryContent = await getSpriteLibrary();
        const surpriseSprites = spriteLibraryContent.filter(sprite =>
            (sprite.tags.indexOf('letters') === -1) && (sprite.tags.indexOf('numbers') === -1)
        );
        const item = surpriseSprites[Math.floor(Math.random() * surpriseSprites.length)];
        randomizeSpritePosition(item);
        this.props.vm.addSprite(JSON.stringify(item))
            .then(this.handleActivateBlocksTab);
    }
    handlePaintSpriteClick () {
        const formatMessage = this.props.intl.formatMessage;
        const emptyItem = emptySprite(
            formatMessage(sharedMessages.sprite, {index: 1}),
            formatMessage(sharedMessages.pop),
            formatMessage(sharedMessages.costume, {index: 1})
        );
        this.props.vm.addSprite(JSON.stringify(emptyItem)).then(() => {
            setTimeout(() => { // Wait for targets update to propagate before tab switching
                this.props.onActivateTab(COSTUMES_TAB_INDEX);
            });
        });
    }
    handleNewCanvasSprite () {
        this.props.vm.addCanvasSprite()
            .then(this.handleActivateBlocksTab)
            .catch(err => {
                log.error(err);
            });
    }
    handleOpen3DSpriteModal () {
        this.setState({add3DSpriteVisible: true});
    }
    handleClose3DSpriteModal () {
        this.setState({add3DSpriteVisible: false});
    }
    add3DSprite (options) {
        this.setState({add3DSpriteVisible: false});
        return this.props.vm.addSprite3D(options)
            .then(this.handleActivateBlocksTab)
            .catch(err => {
                log.error(err);
            });
    }
    handleAddCamera () {
        this.setState({add3DSpriteVisible: false});
        return this.props.vm.addCamera()
            .then(this.handleActivateBlocksTab)
            .catch(err => {
                log.error(err);
            });
    }
    handleAdd3DShape (shape, name) {
        return this.add3DSprite({
            name,
            models: [{name, shape}],
            material: {color: DEFAULT_SHAPE_COLOR}
        });
    }
    handleChoose3DModelFile (fileName) {
        const name = modelNameFromFile(fileName);
        return this.add3DSprite({
            name,
            models: [{name, file: fileName}],
            // Models keep their own colors
            material: {color: '#ffffff'}
        });
    }
    async handleUpload3DModels (files) {
        const fileManager = this.props.vm.runtime.fileManager;
        const modelFiles = [];
        try {
            // Files that .gltf models use (buffers, textures) can be uploaded together with them
            for (const file of files) {
                const savedName = fileManager.addFile(file.name, await file.arrayBuffer());
                if (MODEL_FILE.test(savedName)) modelFiles.push(savedName);
            }
        } catch (err) {
            log.error(err);
            alert(`無法讀取檔案：${err}`); // eslint-disable-line no-alert
        }
        if (modelFiles.length === 0) {
            this.handleClose3DSpriteModal();
            return;
        }
        for (const fileName of modelFiles) {
            await this.handleChoose3DModelFile(fileName);
        }
    }
    handleActivateBlocksTab () {
        this.props.onActivateTab(BLOCKS_TAB_INDEX);
    }
    handleNewSprite (spriteJSONString) {
        return this.props.vm.addSprite(spriteJSONString)
            .then(this.handleActivateBlocksTab)
            .catch(err => {
                log.error(err);
            });
    }
    handleFileUploadClick () {
        this.fileInput.click();
    }
    handleSpriteUpload (e) {
        const vm = this.props.vm;
        this.props.onShowImporting();
        handleFileUpload(e.target, (buffer, fileType, fileName, fileIndex, fileCount) => {
            spriteUpload(buffer, fileType, fileName, vm, newSprite => {
                // A component (.3dsc) is added as a component, after telling what is in it
                vm.isComponentFile(newSprite).then(isComponent => {
                    if (isComponent) return this.handleComponentFile(newSprite);
                    return this.handleNewSprite(newSprite);
                })
                    .then(() => {
                        if (fileIndex === fileCount - 1) {
                            this.props.onCloseImporting();
                        }
                    })
                    .catch(this.props.onCloseImporting);
            }, this.props.onCloseImporting);
        }, this.props.onCloseImporting);
    }
    /**
     * @param {Uint8Array} bytes a .3dsc file
     * @returns {Promise} resolves when it is added (or not, if the user says no)
     */
    async handleComponentFile (bytes) {
        const vm = this.props.vm;
        const info = await vm.describeComponentFile(bytes);
        const list = (title, items) => (items.length ? `\n${title}：${items.join('、')}` : '');
        // eslint-disable-next-line no-alert
        const ok = window.confirm(`加入元件「${info.name}」？${list('屬性', info.props)}${list('輸入', info.inputs)}` +
            `${list('輸出', info.outputs)}${list('裡面的元件', info.components)}${list('用到的擴充', info.extensions)}\n` +
            '元件用自己的變數，不會讀專案的資料。');
        if (ok) await vm.importComponent(bytes);
    }
    setFileInput (input) {
        this.fileInput = input;
    }
    handleBlockDragEnd (blocks) {
        if (this.props.hoveredTarget.sprite && this.props.hoveredTarget.sprite !== this.props.editingTarget) {
            this.shareBlocks(blocks, this.props.hoveredTarget.sprite, this.props.editingTarget);
            this.props.onReceivedBlocks(true);
        }
    }
    shareBlocks (payload, targetId, optFromTargetId) {
        // Position the top-level block based on the scroll position.
        const centered = placeInViewport(payload, this.props.workspaceMetrics.targets[targetId], this.props.isRtl);
        return this.props.vm.shareBlocksToTarget(centered, targetId, optFromTargetId);
    }
    handleDrop (dragInfo) {
        const {sprite: targetId} = this.props.hoveredTarget;
        if (dragInfo.dragType === DragConstants.SPRITE) {
            // The list only shows some targets (members of components are inside their component), so the indexes
            // of the list are turned into indexes of the runtime's targets
            const {vm, sprites} = this.props;
            const scope = vm.runtime.components.editScope;
            const visible = Object.keys(sprites)
                .filter(id => (sprites[id].componentOwnerId || null) === (scope ? scope.id : null));
            const indexOf = id => vm.runtime.targets.findIndex(target => target.id === id);
            const from = indexOf(visible[dragInfo.index]);
            const to = indexOf(visible[dragInfo.newIndex]);
            if (from >= 0 && to >= 0) this.props.vm.reorderTarget(from, to);
        } else if (dragInfo.dragType === DragConstants.BACKPACK_SPRITE) {
            // TODO storage does not have a way of loading zips right now, and may never need it.
            // So for now just grab the zip manually.
            fetchSprite(dragInfo.payload.bodyUrl)
                .then(sprite3Zip => this.props.vm.addSprite(sprite3Zip));
        } else if (targetId) {
            // Something is being dragged over one of the sprite tiles or the backdrop.
            // Dropping assets like sounds and costumes duplicate the asset on the
            // hovered target. Shared costumes also become the current costume on that target.
            // However, dropping does not switch the editing target or activate that editor tab.
            // This is based on 2.0 behavior, but seems like it keeps confusing switching to a minimum.
            // it allows the user to share multiple things without switching back and forth.
            if (dragInfo.dragType === DragConstants.COSTUME) {
                this.props.vm.shareCostumeToTarget(dragInfo.index, targetId);
            } else if (targetId && dragInfo.dragType === DragConstants.SOUND) {
                this.props.vm.shareSoundToTarget(dragInfo.index, targetId);
            } else if (dragInfo.dragType === DragConstants.BACKPACK_COSTUME) {
                // In scratch 2, this only creates a new sprite from the costume.
                // We may be able to handle both kinds of drops, depending on where
                // the drop happens. For now, just add the costume.
                this.props.vm.addCostume(dragInfo.payload.body, {
                    name: dragInfo.payload.name
                }, targetId);
            } else if (dragInfo.dragType === DragConstants.BACKPACK_SOUND) {
                this.props.vm.addSound({
                    md5: dragInfo.payload.body,
                    name: dragInfo.payload.name
                }, targetId);
            } else if (dragInfo.dragType === DragConstants.BACKPACK_CODE) {
                fetchCode(dragInfo.payload.bodyUrl)
                    .then(blocks => this.shareBlocks(blocks, targetId))
                    .then(() => this.props.vm.refreshWorkspace());
            }
        }
    }
    render () {
        /* eslint-disable no-unused-vars */
        const {
            dispatchUpdateRestore,
            isRtl,
            onActivateTab,
            onCloseImporting,
            onHighlightTarget,
            onReceivedBlocks,
            onShowImporting,
            workspaceMetrics,
            ...componentProps
        } = this.props;
        /* eslint-enable no-unused-vars */
        return (
            <React.Fragment>
                <TargetPaneComponent
                    {...componentProps}
                    fileInputRef={this.setFileInput}
                    onNew3DSpriteClick={this.handleOpen3DSpriteModal}
                    onNewCanvasSpriteClick={this.handleNewCanvasSprite}
                    onActivateBlocksTab={this.handleActivateBlocksTab}
                    onChangeSprite3D={this.handleChangeSprite3D}
                    onChangeSpriteDirection={this.handleChangeSpriteDirection}
                    onChangeSpriteName={this.handleChangeSpriteName}
                    onChangeSpriteRotationStyle={this.handleChangeSpriteRotationStyle}
                    onChangeSpriteSize={this.handleChangeSpriteSize}
                    onChangeSpriteVisibility={this.handleChangeSpriteVisibility}
                    onChangeSpriteX={this.handleChangeSpriteX}
                    onChangeSpriteY={this.handleChangeSpriteY}
                    onDeleteSprite={this.handleDeleteSprite}
                    onDrop={this.handleDrop}
                    onDuplicateSprite={this.handleDuplicateSprite}
                    onExportSprite={this.handleExportSprite}
                    onFileUploadClick={this.handleFileUploadClick}
                    onPaintSpriteClick={this.handlePaintSpriteClick}
                    onSelectSprite={this.handleSelectSprite}
                    onSpriteUpload={this.handleSpriteUpload}
                    onSurpriseSpriteClick={this.handleSurpriseSpriteClick}
                />
                {this.state.add3DSpriteVisible ? (
                    <Add3DSpriteModal
                        vm={this.props.vm}
                        onAddCamera={this.handleAddCamera}
                        onAddShape={this.handleAdd3DShape}
                        onChooseFile={this.handleChoose3DModelFile}
                        onClose={this.handleClose3DSpriteModal}
                        onUploadModels={this.handleUpload3DModels}
                    />
                ) : null}
            </React.Fragment>
        );
    }
}

const {
    onSelectSprite, // eslint-disable-line no-unused-vars
    onActivateBlocksTab, // eslint-disable-line no-unused-vars
    ...targetPaneProps
} = TargetPaneComponent.propTypes;

TargetPane.propTypes = {
    intl: intlShape.isRequired,
    onCloseImporting: PropTypes.func,
    onShowImporting: PropTypes.func,
    ...targetPaneProps
};

const mapStateToProps = state => ({
    editingTarget: state.scratchGui.targets.editingTarget,
    hoveredTarget: state.scratchGui.hoveredTarget,
    isRtl: state.locales.isRtl,
    spriteLibraryVisible: state.scratchGui.modals.spriteLibrary,
    sprites: state.scratchGui.targets.sprites,
    stage: state.scratchGui.targets.stage,
    raiseSprites: state.scratchGui.blockDrag,
    workspaceMetrics: state.scratchGui.workspaceMetrics
});

const mapDispatchToProps = dispatch => ({
    onNewSpriteClick: e => {
        e.preventDefault();
        dispatch(openSpriteLibrary());
    },
    onRequestCloseSpriteLibrary: () => {
        dispatch(closeSpriteLibrary());
    },
    onActivateTab: tabIndex => {
        dispatch(activateTab(tabIndex));
    },
    onReceivedBlocks: receivedBlocks => {
        dispatch(setReceivedBlocks(receivedBlocks));
    },
    dispatchUpdateRestore: restoreState => {
        dispatch(setRestore(restoreState));
    },
    onHighlightTarget: id => {
        dispatch(highlightTarget(id));
    },
    onCloseImporting: () => dispatch(closeAlertWithId('importingAsset')),
    onShowImporting: () => dispatch(showStandardAlert('importingAsset'))
});

export default injectIntl(connect(
    mapStateToProps,
    mapDispatchToProps
)(TargetPane));

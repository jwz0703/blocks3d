import PropTypes from 'prop-types';
import React from 'react';
import bindAll from 'lodash.bindall';
import {defineMessages, intlShape, injectIntl} from 'react-intl';
import VM from 'scratch-vm';

import AssetPanel from '../components/asset-panel/asset-panel.jsx';
import EnvironmentPanel from '../components/tw-3d/environment-panel.jsx';
import {askBackdropKind, renderBackdropKindModal} from '../components/tw-3d/backdrop-kind-modal.jsx';
import {BACKDROP_UPLOAD_ACCEPT, fileInputOf, uploadBackdropFiles} from '../lib/tw-sky-backdrop';
import {getSkyPack} from 'scratch-vm/src/engine/scene-3d-sky-packs';
import PaintEditorWrapper from './paint-editor-wrapper.jsx';
import SvgCodeEditor from '../components/tw-svg-code-editor/svg-code-editor.jsx';
import codeStyles from '../components/tw-svg-code-editor/svg-code-editor.css';
import getEnvironmentPreview from '../lib/tw-environment-preview';
import getCostumeUrl from '../lib/get-costume-url';
import log from '../lib/log';
import {connect} from 'react-redux';
import {handleFileUpload, costumeUpload} from '../lib/file-uploader.js';
import errorBoundaryHOC from '../lib/error-boundary-hoc.jsx';
import DragConstants from '../lib/drag-constants';
import {emptyCostume} from '../lib/empty-assets';
import sharedMessages from '../lib/shared-messages';
import downloadBlob from '../lib/download-blob';

import {
    openCostumeLibrary,
    openBackdropLibrary
} from '../reducers/modals';

import {
    activateTab,
    SOUNDS_TAB_INDEX
} from '../reducers/editor-tab';

import {setRestore} from '../reducers/restore-deletion';
import {showStandardAlert, closeAlertWithId} from '../reducers/alerts';

import addLibraryBackdropIcon from '../components/asset-panel/icon--add-backdrop-lib.svg';
import addLibraryCostumeIcon from '../components/asset-panel/icon--add-costume-lib.svg';
import fileUploadIcon from '../components/action-menu/icon--file-upload.svg';
import paintIcon from '../components/action-menu/icon--paint.svg';
import surpriseIcon from '../components/action-menu/icon--surprise.svg';
import searchIcon from '../components/action-menu/icon--search.svg';

import {getCostumeLibrary, getBackdropLibrary} from '../lib/libraries/tw-async-libraries';

import styles from '../components/tw-3d/environment-panel.css';

let messages = defineMessages({
    addLibraryBackdropMsg: {
        defaultMessage: 'Choose a Backdrop',
        description: 'Button to add a backdrop in the editor tab',
        id: 'gui.costumeTab.addBackdropFromLibrary'
    },
    addLibraryCostumeMsg: {
        defaultMessage: 'Choose a Costume',
        description: 'Button to add a costume in the editor tab',
        id: 'gui.costumeTab.addCostumeFromLibrary'
    },
    addBlankCostumeMsg: {
        defaultMessage: 'Paint',
        description: 'Button to add a blank costume in the editor tab',
        id: 'gui.costumeTab.addBlankCostume'
    },
    addSurpriseCostumeMsg: {
        defaultMessage: 'Surprise',
        description: 'Button to add a surprise costume in the editor tab',
        id: 'gui.costumeTab.addSurpriseCostume'
    },
    addFileBackdropMsg: {
        defaultMessage: 'Upload Backdrop',
        description: 'Button to add a backdrop by uploading a file in the editor tab',
        id: 'gui.costumeTab.addFileBackdrop'
    },
    addFileCostumeMsg: {
        defaultMessage: 'Upload Costume',
        description: 'Button to add a costume by uploading a file in the editor tab',
        id: 'gui.costumeTab.addFileCostume'
    }
});

messages = {...messages, ...sharedMessages};

class CostumeTab extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleShowPaint',
            'handleShowCode',
            'handleSelectCostume',
            'handleDeleteCostume',
            'handleDuplicateCostume',
            'handleExportCostume',
            'handleNewCostume',
            'handleNewBlankCostume',
            'handleSurpriseCostume',
            'handleSurpriseBackdrop',
            'handleFileUploadClick',
            'handleCostumeUpload',
            'handleDrop',
            'handleChangeEnvironment',
            'handleFilesChanged',
            'handleRenameBackdrop',
            'handleUploadSkyFile',
            'setFileInput'
        ]);
        const {
            editingTarget,
            sprites,
            stage
        } = props;
        const target = editingTarget && sprites[editingTarget] ? sprites[editingTarget] : stage;
        if (target && target.currentCostume) {
            this.state = {selectedCostumeIndex: target.currentCostume};
        } else {
            this.state = {selectedCostumeIndex: 0};
        }
        this.state.fileVersion = 0;
    }
    componentDidMount () {
        // Skies can be files in the Files tab
        this.props.vm.runtime.fileManager.on('change', this.handleFilesChanged);
    }
    componentWillReceiveProps (nextProps) {
        const {
            editingTarget,
            sprites,
            stage
        } = nextProps;

        const target = editingTarget && sprites[editingTarget] ? sprites[editingTarget] : stage;
        if (!target || !target.costumes) {
            return;
        }

        if (this.props.editingTarget === editingTarget) {
            // If costumes have been added or removed, change costumes to the editing target's
            // current costume.
            const oldTarget = this.props.sprites[editingTarget] ?
                this.props.sprites[editingTarget] : this.props.stage;
            // @todo: Find and switch to the index of the costume that is new. This is blocked by
            // https://github.com/LLK/scratch-vm/issues/967
            // Right now, you can land on the wrong costume if a costume changing script is running.
            if (oldTarget.costumeCount !== target.costumeCount) {
                this.setState({selectedCostumeIndex: target.currentCostume});
            }
        } else {
            // If switching editing targets, update the costume index
            this.setState({selectedCostumeIndex: target.currentCostume});
        }
    }
    componentWillUnmount () {
        this.props.vm.runtime.fileManager.removeListener('change', this.handleFilesChanged);
    }
    handleFilesChanged () {
        this.setState(state => ({fileVersion: state.fileVersion + 1}));
    }
    handleChangeEnvironment (changes) {
        this.props.vm.setEnvironment3D(changes, this.state.selectedCostumeIndex);
    }
    handleRenameBackdrop (name) {
        this.props.vm.renameCostume(this.state.selectedCostumeIndex, name);
    }
    async handleUploadSkyFile (file, section) {
        try {
            const savedName = this.props.vm.runtime.fileManager.addFile(file.name, await file.arrayBuffer());
            this.handleChangeEnvironment(section === 'lighting' ?
                {lighting: {type: 'hdri', file: savedName}} :
                {sky: {file: savedName}});
        } catch (err) {
            log.error(err);
            alert(`無法讀取檔案：${err}`); // eslint-disable-line no-alert
        }
    }
    handleSelectCostume (costumeIndex) {
        this.props.vm.editingTarget.setCostume(costumeIndex);
        this.setState({selectedCostumeIndex: costumeIndex});
    }
    handleDeleteCostume (costumeIndex) {
        const restoreCostumeFun = this.props.vm.deleteCostume(costumeIndex);
        this.props.dispatchUpdateRestore({
            restoreFun: restoreCostumeFun,
            deletedItem: 'Costume'
        });
    }
    handleDuplicateCostume (costumeIndex) {
        this.props.vm.duplicateCostume(costumeIndex);
    }
    handleExportCostume (costumeIndex) {
        const item = this.props.vm.editingTarget.sprite.costumes[costumeIndex];
        const blob = new Blob([
            this.props.vm.getExportedCostume(item)
        ], {type: item.asset.assetType.contentType});
        downloadBlob(`${item.name}.${item.asset.dataFormat}`, blob);
    }
    handleNewCostume (costume, fromCostumeLibrary, targetId) {
        const costumes = Array.isArray(costume) ? costume : [costume];

        return Promise.all(costumes.map(c => {
            if (fromCostumeLibrary) {
                return this.props.vm.addCostumeFromLibrary(c.md5, c);
            }
            // If targetId is falsy, VM should default it to editingTarget.id
            // However, targetId should be provided to prevent #5876,
            // if making new costume takes a while
            return this.props.vm.addCostume(c.md5, c, targetId);
        }));
    }
    handleNewBlankCostume () {
        const name = this.props.vm.editingTarget.isStage ?
            this.props.intl.formatMessage(messages.backdrop, {index: 1}) :
            this.props.intl.formatMessage(messages.costume, {index: 1});
        this.handleNewCostume(emptyCostume(name));
    }
    async handleSurpriseCostume () {
        const costumeLibraryContent = await getCostumeLibrary();
        const item = costumeLibraryContent[Math.floor(Math.random() * costumeLibraryContent.length)];
        const vmCostume = {
            name: item.name,
            md5: item.md5ext,
            rotationCenterX: item.rotationCenterX,
            rotationCenterY: item.rotationCenterY,
            bitmapResolution: item.bitmapResolution,
            skinId: null
        };
        this.handleNewCostume(vmCostume, true /* fromCostumeLibrary */);
    }
    async handleSurpriseBackdrop () {
        const backdropLibraryContent = await getBackdropLibrary();
        const item = backdropLibraryContent[Math.floor(Math.random() * backdropLibraryContent.length)];
        const vmCostume = {
            name: item.name,
            md5: item.md5ext,
            rotationCenterX: item.rotationCenterX,
            rotationCenterY: item.rotationCenterY,
            bitmapResolution: item.bitmapResolution,
            skinId: null
        };
        this.handleNewCostume(vmCostume);
    }
    handleCostumeUpload (e) {
        if (this.props.vm.editingTarget.isStage) {
            // Images can be 2D backdrops or HDRI skies
            const files = Array.from(e.target.files);
            e.target.value = null;
            uploadBackdropFiles(this.props.vm, files, images => askBackdropKind(this, images),
                flats => this.uploadCostumes(fileInputOf(flats)));
            return;
        }
        this.uploadCostumes(e.target);
    }
    /**
     * @param {object} fileInput a file <input>, or something like one with its files
     */
    uploadCostumes (fileInput) {
        const vm = this.props.vm;
        const targetId = this.props.vm.editingTarget.id;
        this.props.onShowImporting();
        handleFileUpload(fileInput, (buffer, fileType, fileName, fileIndex, fileCount) => {
            costumeUpload(buffer, fileType, vm, vmCostumes => {
                vmCostumes.forEach((costume, i) => {
                    costume.name = `${fileName}${i ? i + 1 : ''}`;
                });
                this.handleNewCostume(vmCostumes, false, targetId).then(() => {
                    if (fileIndex === fileCount - 1) {
                        this.props.onCloseImporting();
                    }
                });
            }, this.props.onCloseImporting);
        }, this.props.onCloseImporting);
    }
    handleFileUploadClick () {
        this.fileInput.click();
    }
    handleDrop (dropInfo) {
        if (dropInfo.dragType === DragConstants.COSTUME) {
            const sprite = this.props.vm.editingTarget.sprite;
            const activeCostume = sprite.costumes[this.state.selectedCostumeIndex];
            this.props.vm.reorderCostume(this.props.vm.editingTarget.id,
                dropInfo.index, dropInfo.newIndex);
            this.setState({selectedCostumeIndex: sprite.costumes.indexOf(activeCostume)});
        } else if (dropInfo.dragType === DragConstants.BACKPACK_COSTUME) {
            this.props.vm.addCostume(dropInfo.payload.body, {
                name: dropInfo.payload.name
            });
        } else if (dropInfo.dragType === DragConstants.BACKPACK_SOUND) {
            this.props.onActivateSoundsTab();
            this.props.vm.addSound({
                md5: dropInfo.payload.body,
                name: dropInfo.payload.name
            });
        }
    }
    setFileInput (input) {
        this.fileInput = input;
    }
    formatCostumeDetails (size, optResolution) {
        // If no resolution is given, assume that the costume is an SVG
        const resolution = optResolution ? optResolution : 1;
        // Convert size to stage units by dividing by resolution
        // Round up width and height for scratch-flash compatibility
        // https://github.com/LLK/scratch-flash/blob/9fbac92ef3d09ceca0c0782f8a08deaa79e4df69/src/ui/media/MediaInfo.as#L224-L237
        return `${Math.ceil(size[0] / resolution)} x ${Math.ceil(size[1] / resolution)}`;
    }
    handleShowPaint () {
        this.setState({codeMode: false});
    }
    handleShowCode () {
        this.setState({codeMode: true});
    }
    render () {
        const {
            dispatchUpdateRestore, // eslint-disable-line no-unused-vars
            intl,
            isRtl,
            onNewLibraryBackdropClick,
            onNewLibraryCostumeClick,
            vm
        } = this.props;

        if (!vm.editingTarget) {
            return null;
        }

        const isStage = vm.editingTarget.isStage;
        const target = vm.editingTarget.sprite;

        const addLibraryMessage = isStage ? messages.addLibraryBackdropMsg : messages.addLibraryCostumeMsg;
        const addFileMessage = isStage ? messages.addFileBackdropMsg : messages.addFileCostumeMsg;
        const addSurpriseFunc = isStage ? this.handleSurpriseBackdrop : this.handleSurpriseCostume;
        const addLibraryFunc = isStage ? onNewLibraryBackdropClick : onNewLibraryCostumeClick;
        const addLibraryIcon = isStage ? addLibraryBackdropIcon : addLibraryCostumeIcon;

        const costumeData = target.costumes ? target.costumes.map(costume => {
            const item = {
                name: costume.name,
                asset: costume.asset,
                details: costume.size ? this.formatCostumeDetails(costume.size, costume.bitmapResolution) : null,
                dragPayload: costume
            };
            // Backdrops are environments: the ones with a 3D sky show it instead of their (blank) picture. Stage items
            // always have a url, since the folders addon keeps the old one when an item has none.
            if (isStage && costume.environment && costume.environment.sky.type !== '2d') {
                const pack = getSkyPack(costume.environment.sky.type);
                item.url = getEnvironmentPreview(costume.environment, vm) || '';
                item.details = pack ? pack.name : null;
            } else if (isStage && costume.asset) {
                item.url = getCostumeUrl(costume.asset);
            }
            return item;
        }) : [];
        const selectedIndex = this.state.selectedCostumeIndex;
        const environment = isStage && target.costumes && target.costumes[selectedIndex] ?
            vm.getEnvironment3D(selectedIndex) :
            null;
        // SVG costumes can be edited as code (bindings of any attribute), see ROADMAP.md 階段 10
        const selectedCostume = target.costumes && target.costumes[selectedIndex];
        const isSvg = !!selectedCostume && selectedCostume.dataFormat === 'svg';
        const codeMode = isSvg && this.state.codeMode;
        const paintEditor = target.costumes ? (
            <div className={codeStyles.costumeEditor}>
                {isSvg ? (
                    <div className={codeStyles.modeSwitch}>
                        <button
                            className={codeMode ? null : codeStyles.modeOn}
                            onClick={this.handleShowPaint}
                        >{'繪圖'}</button>
                        <button
                            className={codeMode ? codeStyles.modeOn : null}
                            onClick={this.handleShowCode}
                        >{'SVG 程式碼'}</button>
                    </div>
                ) : null}
                {codeMode ? (
                    <SvgCodeEditor
                        costumeIndex={selectedIndex}
                        key={`${vm.editingTarget.id}:${selectedIndex}`}
                        targetId={vm.editingTarget.id}
                        vm={vm}
                    />
                ) : (
                    <PaintEditorWrapper
                        selectedCostumeIndex={this.state.selectedCostumeIndex}
                    />
                )}
            </div>
        ) : null;
        return (
            <AssetPanel
                buttons={[
                    {
                        title: intl.formatMessage(addLibraryMessage),
                        img: addLibraryIcon,
                        onClick: addLibraryFunc
                    },
                    {
                        title: intl.formatMessage(addFileMessage),
                        img: fileUploadIcon,
                        onClick: this.handleFileUploadClick,
                        fileAccept: isStage ?
                            BACKDROP_UPLOAD_ACCEPT :
                            '.svg, .png, .bmp, .jpg, .jpeg, .jfif, .webp, .gif',
                        fileChange: this.handleCostumeUpload,
                        fileInput: this.setFileInput,
                        fileMultiple: true
                    },
                    {
                        title: intl.formatMessage(messages.addSurpriseCostumeMsg),
                        img: surpriseIcon,
                        onClick: addSurpriseFunc
                    },
                    {
                        title: intl.formatMessage(messages.addBlankCostumeMsg),
                        img: paintIcon,
                        onClick: this.handleNewBlankCostume
                    },
                    {
                        title: intl.formatMessage(addLibraryMessage),
                        img: searchIcon,
                        onClick: addLibraryFunc
                    }
                ]}
                dragType={DragConstants.COSTUME}
                isRtl={isRtl}
                items={costumeData}
                selectedItemIndex={this.state.selectedCostumeIndex}
                onDeleteClick={target && target.costumes && target.costumes.length > 1 ?
                    this.handleDeleteCostume : null}
                onDrop={this.handleDrop}
                onDuplicateClick={this.handleDuplicateCostume}
                onExportClick={this.handleExportCostume}
                onItemClick={this.handleSelectCostume}
            >
                {environment ? (
                    <div className={styles.environment}>
                        <EnvironmentPanel
                            environment={environment}
                            fileNames={vm.runtime.fileManager.getFileNames()}
                            name={target.costumes[selectedIndex].name}
                            onChange={this.handleChangeEnvironment}
                            onRename={this.handleRenameBackdrop}
                            onUploadSkyFile={this.handleUploadSkyFile}
                        />
                        {environment.sky.type === '2d' ? paintEditor : null}
                    </div>
                ) : paintEditor}
                {renderBackdropKindModal(this)}
            </AssetPanel>
        );
    }
}

CostumeTab.propTypes = {
    dispatchUpdateRestore: PropTypes.func,
    editingTarget: PropTypes.string,
    intl: intlShape,
    isRtl: PropTypes.bool,
    onActivateSoundsTab: PropTypes.func.isRequired,
    onCloseImporting: PropTypes.func.isRequired,
    onNewLibraryBackdropClick: PropTypes.func.isRequired,
    onNewLibraryCostumeClick: PropTypes.func.isRequired,
    onShowImporting: PropTypes.func.isRequired,
    sprites: PropTypes.shape({
        id: PropTypes.shape({
            costumes: PropTypes.arrayOf(PropTypes.shape({
                url: PropTypes.string,
                name: PropTypes.string.isRequired,
                skinId: PropTypes.number
            }))
        })
    }),
    stage: PropTypes.shape({
        sounds: PropTypes.arrayOf(PropTypes.shape({
            name: PropTypes.string.isRequired
        }))
    }),
    vm: PropTypes.instanceOf(VM)
};

const mapStateToProps = state => ({
    editingTarget: state.scratchGui.targets.editingTarget,
    isRtl: state.locales.isRtl,
    sprites: state.scratchGui.targets.sprites,
    stage: state.scratchGui.targets.stage,
    dragging: state.scratchGui.assetDrag.dragging
});

const mapDispatchToProps = dispatch => ({
    onActivateSoundsTab: () => dispatch(activateTab(SOUNDS_TAB_INDEX)),
    onNewLibraryBackdropClick: e => {
        e.preventDefault();
        dispatch(openBackdropLibrary());
    },
    onNewLibraryCostumeClick: e => {
        e.preventDefault();
        dispatch(openCostumeLibrary());
    },
    dispatchUpdateRestore: restoreState => {
        dispatch(setRestore(restoreState));
    },
    onCloseImporting: () => dispatch(closeAlertWithId('importingAsset')),
    onShowImporting: () => dispatch(showStandardAlert('importingAsset'))
});

export default errorBoundaryHOC('Costume Tab')(
    injectIntl(connect(
        mapStateToProps,
        mapDispatchToProps
    )(CostumeTab))
);

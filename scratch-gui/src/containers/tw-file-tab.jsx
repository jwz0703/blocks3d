import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import VM from 'scratch-vm';

import AssetPanel from '../components/asset-panel/asset-panel.jsx';
import FileDetail from '../components/tw-file-tab/file-detail.jsx';
import {getFileKind} from '../components/tw-file-tab/file-kind.js';
import SoundEditorNotSupported from '../components/tw-sound-editor-not-supported/sound-editor-not-supported.jsx';
import RecordModal from './record-modal.jsx';
import SoundEditor from './sound-editor.jsx';
import SoundLibrary from './sound-library.jsx';
import DragConstants from '../lib/drag-constants';
import downloadBlob from '../lib/download-blob';
import {soundUpload} from '../lib/file-uploader.js';
import SharedAudioContext from '../lib/audio/shared-audio-context.js';
import {activateTab, COSTUMES_TAB_INDEX} from '../reducers/editor-tab';
import {closeSoundLibrary, openSoundLibrary, openSoundRecorder} from '../reducers/modals';
import {setRestore} from '../reducers/restore-deletion';
import {showStandardAlert, closeAlertWithId} from '../reducers/alerts';

import fileUploadIcon from '../components/action-menu/icon--file-upload.svg';
import soundIcon from '../components/asset-panel/icon--sound.svg';
import soundIconRtl from '../components/asset-panel/icon--sound-rtl.svg';
import addSoundFromLibraryIcon from '../components/asset-panel/icon--add-sound-lib.svg';
import addSoundFromRecordingIcon from '../components/asset-panel/icon--add-sound-record.svg';
import fileIcon from '../components/tw-file-tab/icon--file.svg';
import textIcon from '../components/tw-file-tab/icon--text.svg';
import modelIcon from '../components/tw-file-tab/icon--model.svg';

/**
 * @param {number} bytes File size
 * @returns {string} Human readable size
 */
const formatSize = bytes => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

/**
 * Uploaded audio becomes a sound of the current sprite instead of a project file.
 * @param {File} file File picked or dropped by the user
 * @returns {boolean} True if the file is audio
 */
const isAudioUpload = file => file.type.startsWith('audio/') || getFileKind(file.name) === 'audio';

/**
 * @param {string} name File name
 * @returns {string} Name without the extension, like the Sounds tab used to do
 */
const stripExtension = name => {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.substring(0, dot) : name;
};

/**
 * Project files plus the editing target's sounds. The list shows sounds first, then files;
 * "item index" below means the position in that combined list.
 */
class FileTab extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleChange',
            'handleSelectItem',
            'handleDeleteItem',
            'handleDeleteSelected',
            'handleDuplicateItem',
            'handleExportItem',
            'handleExportSelected',
            'handleRenameFile',
            'handleFileUploadClick',
            'handleFileUpload',
            'handleNewSound',
            'handleReorder',
            'handleDragOver',
            'handleDragLeave',
            'handleDropFiles',
            'setFileInput'
        ]);
        this.state = {
            // Either {type: 'sound', index} or {type: 'file', index}
            selected: {type: 'file', index: 0},
            isDraggingOver: false
        };
        /** @type {Map<string, string>} image thumbnails by md5/name */
        this.objectURLs = new Map();
    }

    componentDidMount () {
        this.props.vm.runtime.fileManager.on('change', this.handleChange);
    }

    componentWillReceiveProps (nextProps) {
        // Sounds belong to the editing target, so a new target means a new list
        if (nextProps.editingTarget !== this.props.editingTarget && this.state.selected.type === 'sound') {
            this.setState({selected: {type: 'file', index: 0}});
        }
    }

    componentWillUnmount () {
        this.props.vm.runtime.fileManager.removeListener('change', this.handleChange);
        for (const url of this.objectURLs.values()) {
            URL.revokeObjectURL(url);
        }
        this.objectURLs.clear();
    }

    get fileManager () {
        return this.props.vm.runtime.fileManager;
    }

    getSounds () {
        const target = this.props.vm.editingTarget;
        return (target && target.sprite.sounds) || [];
    }

    /**
     * @param {number} itemIndex Index in the combined list
     * @returns {object} What it points to: {type: 'sound' or 'file', index}
     */
    resolveItem (itemIndex) {
        const soundCount = this.getSounds().length;
        if (itemIndex < soundCount) return {type: 'sound', index: itemIndex};
        return {type: 'file', index: itemIndex - soundCount};
    }

    /**
     * Keeps the selection pointing at something that exists.
     * @returns {?object} Selected item like resolveItem() returns, or null if the list is empty
     */
    getSelected () {
        const soundCount = this.getSounds().length;
        const fileCount = this.fileManager.getFileNames().length;
        const {type, index} = this.state.selected;
        if (type === 'sound' && soundCount > 0) return {type, index: Math.min(index, soundCount - 1)};
        if (type === 'file' && fileCount > 0) return {type, index: Math.min(index, fileCount - 1)};
        if (fileCount > 0) return {type: 'file', index: 0};
        if (soundCount > 0) return {type: 'sound', index: soundCount - 1};
        return null;
    }

    handleChange () {
        this.forceUpdate();
    }

    handleSelectItem (itemIndex) {
        this.setState({selected: this.resolveItem(itemIndex)});
    }

    handleDeleteItem (itemIndex) {
        const {type, index} = this.resolveItem(itemIndex);
        if (type === 'sound') {
            const restoreFun = this.props.vm.deleteSound(index);
            this.props.dispatchUpdateRestore({restoreFun, deletedItem: 'Sound'});
            const selected = this.state.selected;
            if (selected.type === 'sound' && index <= selected.index) {
                this.setState({selected: {type: 'sound', index: Math.max(0, selected.index - 1)}});
            }
            return;
        }
        const name = this.fileManager.getFileNames()[index];
        if (typeof name === 'string') {
            this.fileManager.deleteFile(name);
        }
    }

    handleDuplicateItem (itemIndex) {
        const {type, index} = this.resolveItem(itemIndex);
        if (type === 'sound') {
            this.props.vm.duplicateSound(index).then(() => {
                this.setState({selected: {type: 'sound', index: index + 1}});
            });
            return;
        }
        const file = this.fileManager.getFiles()[index];
        if (file) {
            const newName = this.fileManager.addFile(file.name, file.data.slice().buffer);
            this.setState({selected: {type: 'file', index: this.fileManager.getFileNames().indexOf(newName)}});
        }
    }

    handleExportItem (itemIndex) {
        const {type, index} = this.resolveItem(itemIndex);
        if (type === 'sound') {
            const item = this.getSounds()[index];
            if (item) {
                const blob = new Blob([item.asset.data], {type: item.asset.assetType.contentType});
                downloadBlob(`${item.name}.${item.asset.dataFormat}`, blob);
            }
            return;
        }
        const file = this.fileManager.getFiles()[index];
        if (file) {
            downloadBlob(file.name, new Blob([file.data], {type: this.fileManager.getMimeType(file.name)}));
        }
    }

    getSelectedItemIndex () {
        const selected = this.getSelected();
        if (!selected) return -1;
        return selected.type === 'sound' ? selected.index : this.getSounds().length + selected.index;
    }

    handleDeleteSelected () {
        this.handleDeleteItem(this.getSelectedItemIndex());
    }

    handleExportSelected () {
        this.handleExportItem(this.getSelectedItemIndex());
    }

    handleRenameFile (newName) {
        const selected = this.getSelected();
        if (!selected || selected.type !== 'file') return;
        const oldName = this.fileManager.getFileNames()[selected.index];
        if (typeof oldName === 'string' && newName) {
            this.fileManager.renameFile(oldName, newName);
        }
    }

    /**
     * Selects the last sound, which is where new sounds go.
     */
    handleNewSound () {
        this.setState({selected: {type: 'sound', index: Math.max(0, this.getSounds().length - 1)}});
    }

    handleFileUploadClick () {
        this.fileInput.click();
    }

    /**
     * @param {File[]} files Files picked or dropped by the user
     */
    addFiles (files) {
        if (files.length === 0) return;
        const audioFiles = files.filter(isAudioUpload);
        const otherFiles = files.filter(file => !isAudioUpload(file));
        if (audioFiles.length > 0) {
            this.addSounds(audioFiles);
        }
        if (otherFiles.length === 0) return;
        Promise.all(otherFiles.map(file => file.arrayBuffer().then(buffer => ({name: file.name, buffer}))))
            .then(results => {
                let lastIndex = -1;
                for (const {name, buffer} of results) {
                    const finalName = this.fileManager.addFile(name, buffer);
                    lastIndex = this.fileManager.getFileNames().indexOf(finalName);
                }
                if (lastIndex !== -1 && audioFiles.length === 0) {
                    this.setState({selected: {type: 'file', index: lastIndex}});
                }
            })
            .catch(err => {
                // eslint-disable-next-line no-console
                console.error(err);
                // eslint-disable-next-line no-alert
                alert(`無法讀取檔案：${err}`);
            });
    }

    /**
     * Adds audio files to the editing target as sounds, one after another to keep their order.
     * @param {File[]} files Audio files
     */
    addSounds (files) {
        const vm = this.props.vm;
        if (!vm.editingTarget) return;
        const targetId = vm.editingTarget.id;
        const storage = vm.runtime.storage;
        this.props.onShowImporting();
        files.reduce((previous, file) => previous.then(() => file.arrayBuffer()
            .then(buffer => new Promise((resolve, reject) => {
                soundUpload(buffer, file.type, storage, newSound => {
                    newSound.name = stripExtension(file.name);
                    vm.addSound(newSound, targetId).then(resolve, reject);
                }, reject);
            }))
            .then(() => this.handleNewSound())
            .catch(err => {
                // eslint-disable-next-line no-console
                console.error(err);
                // eslint-disable-next-line no-alert
                alert(`無法匯入音效「${file.name}」：${err}`);
            })
        ), Promise.resolve())
            .then(this.props.onCloseImporting);
    }

    handleFileUpload (e) {
        const input = e.target;
        this.addFiles(Array.from(input.files));
        // Allow uploading the same file again
        input.value = null;
    }

    handleReorder (dropInfo) {
        const vm = this.props.vm;
        const soundCount = this.getSounds().length;
        if (dropInfo.dragType === DragConstants.SOUND) {
            // Sounds only move among sounds
            const newIndex = Math.min(dropInfo.newIndex, soundCount - 1);
            const sounds = this.getSounds();
            const selected = this.getSelected();
            const activeSound = selected && selected.type === 'sound' ? sounds[selected.index] : null;
            vm.reorderSound(vm.editingTarget.id, dropInfo.index, newIndex);
            if (activeSound) {
                this.setState({selected: {type: 'sound', index: this.getSounds().indexOf(activeSound)}});
            }
        } else if (dropInfo.dragType === DragConstants.FILE) {
            // Files only move among files
            const index = dropInfo.index - soundCount;
            const newIndex = Math.max(0, dropInfo.newIndex - soundCount);
            const selected = this.getSelected();
            const names = this.fileManager.getFileNames();
            const selectedName = selected && selected.type === 'file' ? names[selected.index] : null;
            this.fileManager.moveFile(index, newIndex);
            if (selectedName !== null) {
                this.setState({selected: {type: 'file', index: this.fileManager.getFileNames().indexOf(selectedName)}});
            }
        } else if (dropInfo.dragType === DragConstants.BACKPACK_SOUND) {
            vm.addSound({
                md5: dropInfo.payload.body,
                name: dropInfo.payload.name
            }).then(this.handleNewSound);
        } else if (dropInfo.dragType === DragConstants.BACKPACK_COSTUME) {
            this.props.onActivateCostumesTab();
            vm.addCostume(dropInfo.payload.body, {
                name: dropInfo.payload.name
            });
        }
    }

    isFileDrag (e) {
        return e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    }

    handleDragOver (e) {
        if (!this.isFileDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        if (!this.state.isDraggingOver) {
            this.setState({isDraggingOver: true});
        }
    }

    handleDragLeave (e) {
        // Ignore leaving into a child element
        if (e.currentTarget.contains(e.relatedTarget)) return;
        this.setState({isDraggingOver: false});
    }

    handleDropFiles (e) {
        if (!this.isFileDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        this.setState({isDraggingOver: false});
        this.addFiles(Array.from(e.dataTransfer.files));
    }

    setFileInput (input) {
        this.fileInput = input;
    }

    getThumbnail (file) {
        const kind = getFileKind(file.name);
        if (kind === 'image') {
            const key = `${file.md5}/${file.name.toLowerCase()}`;
            let url = this.objectURLs.get(key);
            if (!url) {
                url = URL.createObjectURL(new Blob([file.data], {type: this.fileManager.getMimeType(file.name)}));
                this.objectURLs.set(key, url);
            }
            return url;
        }
        if (kind === 'model') return modelIcon;
        if (kind === 'text') return textIcon;
        return fileIcon;
    }

    pruneThumbnails (files) {
        const keys = new Set(files.map(file => `${file.md5}/${file.name.toLowerCase()}`));
        for (const [key, url] of this.objectURLs) {
            if (!keys.has(key)) {
                URL.revokeObjectURL(url);
                this.objectURLs.delete(key);
            }
        }
    }

    renderDetail (files, selected) {
        if (selected && selected.type === 'sound') {
            const isSupported = !!(this.props.vm.runtime.audioEngine && new SharedAudioContext());
            return isSupported ? <SoundEditor soundIndex={selected.index} /> : <SoundEditorNotSupported />;
        }
        const selectedFile = selected ? files[selected.index] : null;
        return (
            <FileDetail
                file={selectedFile ? {
                    ...selectedFile,
                    mimeType: this.fileManager.getMimeType(selectedFile.name),
                    sizeText: formatSize(selectedFile.size),
                    thumbnail: this.getThumbnail(selectedFile)
                } : null}
                isDraggingOver={this.state.isDraggingOver}
                onDelete={this.handleDeleteSelected}
                onDownload={this.handleExportSelected}
                onRename={this.handleRenameFile}
                onUpload={this.handleFileUploadClick}
            />
        );
    }

    render () {
        const {isRtl, vm} = this.props;
        if (!vm.editingTarget) {
            return null;
        }
        const files = this.fileManager.getFiles();
        this.pruneThumbnails(files);
        const soundItems = this.getSounds().map(sound => ({
            url: isRtl ? soundIconRtl : soundIcon,
            name: sound.name,
            details: (sound.sampleCount / sound.rate).toFixed(2),
            dragPayload: sound,
            dragType: DragConstants.SOUND
        }));
        const fileItems = files.map(file => ({
            url: this.getThumbnail(file),
            name: file.name,
            details: formatSize(file.size)
        }));
        const items = soundItems.concat(fileItems);
        const selected = this.getSelected();

        return (
            <div
                style={{display: 'flex', flexGrow: 1, minWidth: 0}}
                onDragLeave={this.handleDragLeave}
                onDragOver={this.handleDragOver}
                onDrop={this.handleDropFiles}
            >
                <AssetPanel
                    buttons={[{
                        title: '上傳檔案（音檔會變成音效）',
                        img: fileUploadIcon,
                        // ActionMenu only makes file inputs for its extra buttons, so this one is below
                        onClick: this.handleFileUploadClick
                    }, {
                        title: '選擇音效',
                        img: addSoundFromLibraryIcon,
                        onClick: this.props.onNewSoundFromLibraryClick
                    }, {
                        title: '錄音',
                        img: addSoundFromRecordingIcon,
                        onClick: this.props.onNewSoundFromRecordingClick
                    }]}
                    dragType={DragConstants.FILE}
                    isRtl={isRtl}
                    items={items}
                    selectedItemIndex={this.getSelectedItemIndex()}
                    onDeleteClick={this.handleDeleteItem}
                    onDrop={this.handleReorder}
                    onDuplicateClick={this.handleDuplicateItem}
                    onExportClick={this.handleExportItem}
                    onItemClick={this.handleSelectItem}
                >
                    {this.renderDetail(files, selected)}
                    {this.props.soundRecorderVisible ? (
                        <RecordModal
                            onNewSound={this.handleNewSound}
                        />
                    ) : null}
                    {this.props.soundLibraryVisible ? (
                        <SoundLibrary
                            vm={vm}
                            onNewSound={this.handleNewSound}
                            onRequestClose={this.props.onRequestCloseSoundLibrary}
                        />
                    ) : null}
                </AssetPanel>
                <input
                    multiple
                    ref={this.setFileInput}
                    style={{display: 'none'}}
                    type="file"
                    onChange={this.handleFileUpload}
                />
            </div>
        );
    }
}

FileTab.propTypes = {
    dispatchUpdateRestore: PropTypes.func.isRequired,
    editingTarget: PropTypes.string,
    isRtl: PropTypes.bool,
    onActivateCostumesTab: PropTypes.func.isRequired,
    onCloseImporting: PropTypes.func.isRequired,
    onNewSoundFromLibraryClick: PropTypes.func.isRequired,
    onNewSoundFromRecordingClick: PropTypes.func.isRequired,
    onRequestCloseSoundLibrary: PropTypes.func.isRequired,
    onShowImporting: PropTypes.func.isRequired,
    soundLibraryVisible: PropTypes.bool,
    soundRecorderVisible: PropTypes.bool,
    vm: PropTypes.instanceOf(VM).isRequired
};

const mapStateToProps = state => ({
    editingTarget: state.scratchGui.targets.editingTarget,
    isRtl: state.locales.isRtl,
    // Not used directly, but they make the list update when sounds change
    sprites: state.scratchGui.targets.sprites,
    stage: state.scratchGui.targets.stage,
    soundLibraryVisible: state.scratchGui.modals.soundLibrary,
    soundRecorderVisible: state.scratchGui.modals.soundRecorder
});

const mapDispatchToProps = dispatch => ({
    dispatchUpdateRestore: restoreState => dispatch(setRestore(restoreState)),
    onActivateCostumesTab: () => dispatch(activateTab(COSTUMES_TAB_INDEX)),
    onCloseImporting: () => dispatch(closeAlertWithId('importingAsset')),
    onNewSoundFromLibraryClick: e => {
        e.preventDefault();
        dispatch(openSoundLibrary());
    },
    onNewSoundFromRecordingClick: () => dispatch(openSoundRecorder()),
    onRequestCloseSoundLibrary: () => dispatch(closeSoundLibrary()),
    onShowImporting: () => dispatch(showStandardAlert('importingAsset'))
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(FileTab);

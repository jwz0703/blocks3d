import bindAll from 'lodash.bindall';
import omit from 'lodash.omit';
import PropTypes from 'prop-types';
import React from 'react';
import {intlShape, injectIntl} from 'react-intl';

import {connect} from 'react-redux';
import {openBackdropLibrary} from '../reducers/modals';
import {activateTab, COSTUMES_TAB_INDEX} from '../reducers/editor-tab';
import {showStandardAlert, closeAlertWithId} from '../reducers/alerts';
import {setHoveredSprite} from '../reducers/hovered-target';
import DragConstants from '../lib/drag-constants';
import DropAreaHOC from '../lib/drop-area-hoc.jsx';
import ThrottledPropertyHOC from '../lib/throttled-property-hoc.jsx';
import {emptyCostume} from '../lib/empty-assets';
import sharedMessages from '../lib/shared-messages';
import {fetchCode} from '../lib/backpack-api';
import {getEventXY} from '../lib/touch-utils';

import StageSelectorComponent from '../components/stage-selector/stage-selector.jsx';

import {getBackdropLibrary} from '../lib/libraries/tw-async-libraries';
import getEnvironmentPreview from '../lib/tw-environment-preview';
import {handleFileUpload, costumeUpload} from '../lib/file-uploader.js';
import {fileInputOf, uploadBackdropFiles} from '../lib/tw-sky-backdrop';
import {askBackdropKind, renderBackdropKindModal} from '../components/tw-3d/backdrop-kind-modal.jsx';
import {placeInViewport} from '../lib/backpack/code-payload.js';

const dragTypes = [
    DragConstants.COSTUME,
    DragConstants.SOUND,
    DragConstants.BACKPACK_COSTUME,
    DragConstants.BACKPACK_SOUND,
    DragConstants.BACKPACK_CODE
];

const DroppableThrottledStage = DropAreaHOC(dragTypes)(
    ThrottledPropertyHOC('url', 500)(StageSelectorComponent)
);

class StageSelector extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleClick',
            'handleNewBackdrop',
            'handleSurpriseBackdrop',
            'handleEmptyBackdrop',
            'addBackdropFromLibraryItem',
            'handleFileUploadClick',
            'handleBackdropUpload',
            'handleMouseEnter',
            'handleMouseLeave',
            'handleTouchEnd',
            'handleDrop',
            'setFileInput',
            'setRef'
        ]);
        this.state = {backdropKindPrompt: null};
    }
    componentDidMount () {
        document.addEventListener('touchend', this.handleTouchEnd);
    }
    componentWillUnmount () {
        document.removeEventListener('touchend', this.handleTouchEnd);
    }
    handleTouchEnd (e) {
        const {x, y} = getEventXY(e);
        const {top, left, bottom, right} = this.ref.getBoundingClientRect();
        if (x >= left && x <= right && y >= top && y <= bottom) {
            this.handleMouseEnter();
        }
    }
    addBackdropFromLibraryItem (item, shouldActivateTab = true) {
        const vmBackdrop = {
            name: item.name,
            md5: item.md5ext,
            rotationCenterX: item.rotationCenterX,
            rotationCenterY: item.rotationCenterY,
            bitmapResolution: item.bitmapResolution,
            skinId: null
        };
        this.handleNewBackdrop(vmBackdrop, shouldActivateTab);
    }
    handleClick () {
        this.props.onSelect(this.props.id);
    }
    handleNewBackdrop (backdrops_, shouldActivateTab = true) {
        const backdrops = Array.isArray(backdrops_) ? backdrops_ : [backdrops_];
        return Promise.all(backdrops.map(backdrop =>
            this.props.vm.addBackdrop(backdrop.md5, backdrop)
        )).then(() => {
            if (shouldActivateTab) {
                return this.props.onActivateTab(COSTUMES_TAB_INDEX);
            }
        });
    }
    async handleSurpriseBackdrop (e) {
        e.stopPropagation(); // Prevent click from falling through to selecting stage.
        const backdropLibraryContent = await getBackdropLibrary();
        // @todo should this not add a backdrop you already have?
        const item = backdropLibraryContent[Math.floor(Math.random() * backdropLibraryContent.length)];
        this.addBackdropFromLibraryItem(item, false);
    }
    handleEmptyBackdrop (e) {
        e.stopPropagation(); // Prevent click from falling through to stage selector, select it manually below
        this.props.vm.setEditingTarget(this.props.id);
        this.handleNewBackdrop(emptyCostume(this.props.intl.formatMessage(sharedMessages.backdrop, {index: 1})));
    }
    handleBackdropUpload (e) {
        // Images can be 2D backdrops or HDRI skies
        const files = Array.from(e.target.files);
        e.target.value = null;
        uploadBackdropFiles(this.props.vm, files, images => askBackdropKind(this, images),
            flats => this.uploadBackdrops(fileInputOf(flats))).then(added => {
            if (!added) return;
            this.props.vm.setEditingTarget(this.props.id);
            this.props.onActivateTab(COSTUMES_TAB_INDEX);
        });
    }
    /**
     * @param {object} fileInput a file <input>, or something like one with its files
     */
    uploadBackdrops (fileInput) {
        const vm = this.props.vm;
        this.props.onShowImporting();
        handleFileUpload(fileInput, (buffer, fileType, fileName, fileIndex, fileCount) => {
            costumeUpload(buffer, fileType, vm, vmCostumes => {
                this.props.vm.setEditingTarget(this.props.id);
                vmCostumes.forEach((costume, i) => {
                    costume.name = `${fileName}${i ? i + 1 : ''}`;
                });
                this.handleNewBackdrop(vmCostumes).then(() => {
                    if (fileIndex === fileCount - 1) {
                        this.props.onCloseImporting();
                    }
                });
            }, this.props.onCloseImporting);
        }, this.props.onCloseImporting);
    }
    handleFileUploadClick (e) {
        e.stopPropagation(); // Prevent click from selecting the stage, that is handled manually in backdrop upload
        this.fileInput.click();
    }
    handleMouseEnter () {
        this.props.dispatchSetHoveredSprite(this.props.id);
    }
    handleMouseLeave () {
        this.props.dispatchSetHoveredSprite(null);
    }
    handleDrop (dragInfo) {
        if (dragInfo.dragType === DragConstants.COSTUME) {
            this.props.vm.shareCostumeToTarget(dragInfo.index, this.props.id);
        } else if (dragInfo.dragType === DragConstants.SOUND) {
            this.props.vm.shareSoundToTarget(dragInfo.index, this.props.id);
        } else if (dragInfo.dragType === DragConstants.BACKPACK_COSTUME) {
            this.props.vm.addCostume(dragInfo.payload.body, {
                name: dragInfo.payload.name
            }, this.props.id);
        } else if (dragInfo.dragType === DragConstants.BACKPACK_SOUND) {
            this.props.vm.addSound({
                md5: dragInfo.payload.body,
                name: dragInfo.payload.name
            }, this.props.id);
        } else if (dragInfo.dragType === DragConstants.BACKPACK_CODE) {
            fetchCode(dragInfo.payload.bodyUrl)
                .then(payload => {
                    const centered = placeInViewport(
                        payload,
                        this.props.workspaceMetrics.targets[this.props.id],
                        this.props.isRtl
                    );
                    this.props.vm.shareBlocksToTarget(centered, this.props.id);
                    this.props.vm.refreshWorkspace();
                });
        }
    }
    setFileInput (input) {
        this.fileInput = input;
    }
    setRef (ref) {
        this.ref = ref;
    }
    render () {
        const componentProps = omit(this.props, [
            'asset', 'dispatchSetHoveredSprite', 'id', 'intl',
            'onActivateTab', 'onSelect', 'onShowImporting', 'onCloseImporting',
            'isRtl', 'workspaceMetrics'
        ]);
        return (
            <React.Fragment>
                <DroppableThrottledStage
                    componentRef={this.setRef}
                    fileInputRef={this.setFileInput}
                    onBackdropFileUpload={this.handleBackdropUpload}
                    onBackdropFileUploadClick={this.handleFileUploadClick}
                    onClick={this.handleClick}
                    onDrop={this.handleDrop}
                    onEmptyBackdropClick={this.handleEmptyBackdrop}
                    onMouseEnter={this.handleMouseEnter}
                    onMouseLeave={this.handleMouseLeave}
                    onSurpriseBackdropClick={this.handleSurpriseBackdrop}
                    {...componentProps}
                />
                {renderBackdropKindModal(this)}
            </React.Fragment>
        );
    }
}
StageSelector.propTypes = {
    ...StageSelectorComponent.propTypes,
    environment: PropTypes.object, // eslint-disable-line react/forbid-prop-types
    id: PropTypes.string,
    intl: intlShape.isRequired,
    isRtl: PropTypes.bool,
    onCloseImporting: PropTypes.func,
    onSelect: PropTypes.func,
    onShowImporting: PropTypes.func,
    workspaceMetrics: PropTypes.shape({
        targets: PropTypes.object
    })
};

const mapStateToProps = (state, {asset, environment, id}) => ({
    isRtl: state.locales.isRtl,
    // A backdrop with a 3D sky shows the sky; its own picture is blank
    url: (environment && getEnvironmentPreview(environment, state.scratchGui.vm)) || (asset && asset.encodeDataURI()),
    vm: state.scratchGui.vm,
    receivedBlocks: state.scratchGui.hoveredTarget.receivedBlocks &&
            state.scratchGui.hoveredTarget.sprite === id,
    raised: state.scratchGui.blockDrag,
    workspaceMetrics: state.scratchGui.workspaceMetrics
});

const mapDispatchToProps = dispatch => ({
    onNewBackdropClick: e => {
        e.stopPropagation();
        dispatch(openBackdropLibrary());
    },
    onActivateTab: tabIndex => {
        dispatch(activateTab(tabIndex));
    },
    dispatchSetHoveredSprite: spriteId => {
        dispatch(setHoveredSprite(spriteId));
    },
    onCloseImporting: () => dispatch(closeAlertWithId('importingAsset')),
    onShowImporting: () => dispatch(showStandardAlert('importingAsset'))
});

export default injectIntl(connect(
    mapStateToProps,
    mapDispatchToProps
)(StageSelector));

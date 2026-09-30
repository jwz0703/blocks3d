import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';

import {setHoveredSprite} from '../reducers/hovered-target';
import {updateAssetDrag} from '../reducers/asset-drag';
import VM from 'scratch-vm';
import getCostumeUrl from '../lib/get-costume-url';
import boundCostumeURL from '../lib/tw-bound-costume-url';
import multiSelect from '../lib/tw-sprite-multiselect';
import downloadBlob from '../lib/download-blob';
import get3DThumbnail from '../lib/tw-3d-thumbnail';
import DragRecognizer from '../lib/drag-recognizer';
import {getEventXY} from '../lib/touch-utils';

import SpriteSelectorItemComponent from '../components/sprite-selector-item/sprite-selector-item.jsx';

class SpriteSelectorItem extends React.PureComponent {
    constructor (props) {
        super(props);
        bindAll(this, [
            'getCostumeData',
            'setRef',
            'handleClick',
            'handleDelete',
            'handleDuplicate',
            'handleExport',
            'handleRename',
            'handleMouseEnter',
            'handleMouseLeave',
            'handleMouseDown',
            'handleDragEnd',
            'handleDrag',
            'handleTouchEnd',
            'handleMakeComponent',
            'handleAddInstance',
            'handleEditComponent',
            'handleExportComponent',
            'handleUnpackComponent',
            'handleDeleteComponent',
            'handleEnterComponent',
            'handleMultiSelectChange'
        ]);

        this.dragRecognizer = new DragRecognizer({
            onDrag: this.handleDrag,
            onDragEnd: this.handleDragEnd
        });
        this.state = {
            thumbnail3D: null,
            multiSelected: multiSelect.has(props.id),
            multiSelectCount: multiSelect.ids().length
        };
    }
    componentDidMount () {
        document.addEventListener('touchend', this.handleTouchEnd);
        this.update3DThumbnail();
        this.stopListening = multiSelect.listen(this.handleMultiSelectChange);
    }
    componentDidUpdate (prevProps) {
        if (prevProps.model3D !== this.props.model3D) {
            this.update3DThumbnail();
        }
    }
    componentWillUnmount () {
        document.removeEventListener('touchend', this.handleTouchEnd);
        if (this.stopListening) this.stopListening();
        this.dragRecognizer.reset();
        this.unmounted = true;
    }
    handleMultiSelectChange () {
        this.setState({multiSelected: multiSelect.has(this.props.id), multiSelectCount: multiSelect.ids().length});
    }
    update3DThumbnail () {
        const key = this.props.model3D;
        if (!key) return;
        const {model, material} = JSON.parse(key);
        get3DThumbnail(this.props.vm, model, material).then(url => {
            // Keep the last thumbnail while a newer one renders, and ignore stale results
            if (this.unmounted || this.props.model3D !== key || !url) return;
            this.setState({thumbnail3D: url});
        });
    }
    getCostumeData () {
        if (this.props.costumeURL) return this.props.costumeURL;
        if (this.props.model3D && this.state.thumbnail3D) return this.state.thumbnail3D;
        // Costumes with SVG bindings show the values of this sprite or instance (ROADMAP.md 階段 10)
        const bound = boundCostumeURL(this.props.vm, this.props.id);
        if (bound) return bound;
        if (!this.props.asset) return null;

        return getCostumeUrl(this.props.asset);
    }
    handleDragEnd () {
        if (this.props.dragging) {
            this.props.onDrag({
                img: null,
                currentOffset: null,
                dragging: false,
                dragType: null,
                index: null
            });
        }
        setTimeout(() => {
            this.noClick = false;
        });
    }
    handleDrag (currentOffset) {
        this.props.onDrag({
            img: this.getCostumeData(),
            currentOffset: currentOffset,
            dragging: true,
            dragType: this.props.dragType,
            index: this.props.index,
            payload: this.props.dragPayload
        });
        this.noClick = true;
    }
    handleTouchEnd (e) {
        const {x, y} = getEventXY(e);
        const {top, left, bottom, right} = this.ref.getBoundingClientRect();
        if (x >= left && x <= right && y >= top && y <= bottom) {
            this.handleMouseEnter();
        }
    }
    handleMouseDown (e) {
        this.dragRecognizer.start(e);
    }
    handleClick (e) {
        e.preventDefault();
        // Shift-click picks sprites to make one component of them
        if (e.shiftKey && this.props.onDuplicateButtonClick) {
            multiSelect.toggle(this.props.id);
            return;
        }
        multiSelect.clear();
        if (!this.noClick) {
            this.props.onClick(this.props.id);
        }
    }
    handleDelete (e) {
        e.stopPropagation(); // To prevent from bubbling back to handleClick
        this.props.onDeleteButtonClick(this.props.id);
    }
    handleDuplicate (e) {
        e.stopPropagation(); // To prevent from bubbling back to handleClick
        this.props.onDuplicateButtonClick(this.props.id);
    }
    handleExport (e) {
        e.stopPropagation();
        this.props.onExportButtonClick(this.props.id);
    }
    handleRename (e) {
        e.stopPropagation();
        this.props.onRenameButtonClick(this.props.id);
    }
    // Components (ROADMAP.md 階段 10)
    target () {
        return this.props.vm.runtime.getTargetById(this.props.id);
    }
    canMakeComponent () {
        const target = this.target();
        if (!target || target.isStage || target.componentOwner || target.is3D || target.isCamera || target.isCanvas) {
            return false;
        }
        // Several sprites picked with shift-click (instances of components too) make one component together
        if (this.state.multiSelectCount > 1 && this.state.multiSelected) return true;
        return !target.sprite.component;
    }
    handleMakeComponent (e) {
        e.stopPropagation();
        const ids = this.state.multiSelected && this.state.multiSelectCount > 1 ? multiSelect.ids() : [this.props.id];
        multiSelect.clear();
        this.props.vm.makeComponentFrom(ids);
    }
    handleEnterComponent (e) {
        e.stopPropagation();
        this.props.vm.enterComponent(this.props.id);
    }
    handleAddInstance (e) {
        e.stopPropagation();
        this.props.vm.addComponentInstance(this.props.id);
    }
    handleEditComponent (e) {
        e.stopPropagation();
        const target = this.target();
        if (!target) return;
        // eslint-disable-next-line no-alert
        const name = window.prompt('元件的新名稱：', target.sprite.name);
        if (name) this.props.vm.renameComponent(this.props.id, name);
    }
    handleExportComponent (e) {
        e.stopPropagation();
        const target = this.target();
        if (!target) return;
        this.props.vm.exportComponent(this.props.id).then(content => {
            downloadBlob(`${target.sprite.name}.3dsc`, content);
        });
    }
    handleUnpackComponent (e) {
        e.stopPropagation();
        this.props.vm.unpackComponent(this.props.id);
    }
    handleDeleteComponent (e) {
        e.stopPropagation();
        const target = this.target();
        if (!target) return;
        const usage = this.props.vm.getComponentUsage(this.props.id);
        // eslint-disable-next-line no-alert
        const ok = window.confirm(`刪除元件「${target.sprite.name}」和它的 ${usage.instances} 個實體？\n` +
            `其他角色裡有 ${usage.blocks} 個積木用到它，會留著但變成灰色、不會動作。`);
        if (ok) this.props.vm.deleteComponent(this.props.id);
    }
    handleMouseLeave () {
        this.props.dispatchSetHoveredSprite(null);
    }
    handleMouseEnter () {
        this.props.dispatchSetHoveredSprite(this.props.id);
    }
    setRef (component) {
        // Access the DOM node using .elem because it is going through ContextMenuTrigger
        this.ref = component && component.elem;
    }
    render () {
        const {
            /* eslint-disable no-unused-vars */
            asset,
            id,
            index,
            onClick,
            onDeleteButtonClick,
            onDuplicateButtonClick,
            onExportButtonClick,
            onRenameButtonClick,
            dragPayload,
            receivedBlocks,
            costumeURL,
            model3D,
            vm,
            /* eslint-enable no-unused-vars */
            ...props
        } = this.props;
        const componentName = this.props.componentName;
        return (
            <SpriteSelectorItemComponent
                componentRef={this.setRef}
                costumeURL={this.getCostumeData()}
                preventContextMenu={this.dragRecognizer.gestureInProgress()}
                onClick={this.handleClick}
                onDeleteButtonClick={onDeleteButtonClick ? this.handleDelete : null}
                onDuplicateButtonClick={onDuplicateButtonClick ? this.handleDuplicate : null}
                onExportButtonClick={onExportButtonClick ? this.handleExport : null}
                onRenameButtonClick={onRenameButtonClick ? this.handleRename : null}
                componentName={componentName}
                onAddInstance={componentName ? this.handleAddInstance : null}
                onDeleteComponent={componentName ? this.handleDeleteComponent : null}
                onEditComponent={componentName ? this.handleEditComponent : null}
                onMakeComponent={onDuplicateButtonClick && this.canMakeComponent() ? this.handleMakeComponent : null}
                onExportComponent={componentName ? this.handleExportComponent : null}
                onUnpackComponent={componentName ? this.handleUnpackComponent : null}
                onEnterComponent={componentName && onDuplicateButtonClick ? this.handleEnterComponent : null}
                multiSelected={this.state.multiSelected}
                multiSelectCount={this.state.multiSelectCount}
                onMouseDown={this.handleMouseDown}
                onMouseEnter={this.handleMouseEnter}
                onMouseLeave={this.handleMouseLeave}
                {...props}
            />
        );
    }
}

SpriteSelectorItem.propTypes = {
    // eslint-disable-next-line react/forbid-prop-types
    asset: PropTypes.any,
    // Name of the component the sprite is an instance of
    componentName: PropTypes.string,
    costumeURL: PropTypes.string,
    dispatchSetHoveredSprite: PropTypes.func.isRequired,
    // eslint-disable-next-line react/forbid-prop-types
    dragPayload: PropTypes.any,
    dragType: PropTypes.string,
    dragging: PropTypes.bool,
    // eslint-disable-next-line react/forbid-prop-types
    id: PropTypes.any,
    index: PropTypes.number,
    // JSON of {model, material} for 3D sprites; the thumbnail is rendered from it
    model3D: PropTypes.string,
    // eslint-disable-next-line react/forbid-prop-types
    name: PropTypes.any,
    onClick: PropTypes.func,
    onDeleteButtonClick: PropTypes.func,
    onRenameButtonClick: PropTypes.func,
    onDrag: PropTypes.func.isRequired,
    onDuplicateButtonClick: PropTypes.func,
    onExportButtonClick: PropTypes.func,
    receivedBlocks: PropTypes.bool.isRequired,
    selected: PropTypes.bool,
    vm: PropTypes.instanceOf(VM).isRequired
};

const mapStateToProps = (state, {id}) => ({
    dragging: state.scratchGui.assetDrag.dragging,
    receivedBlocks: state.scratchGui.hoveredTarget.receivedBlocks &&
            state.scratchGui.hoveredTarget.sprite === id,
    vm: state.scratchGui.vm
});
const mapDispatchToProps = dispatch => ({
    dispatchSetHoveredSprite: spriteId => {
        dispatch(setHoveredSprite(spriteId));
    },
    onDrag: data => dispatch(updateAssetDrag(data))
});

const ConnectedComponent = connect(
    mapStateToProps,
    mapDispatchToProps
)(SpriteSelectorItem);

export default ConnectedComponent;

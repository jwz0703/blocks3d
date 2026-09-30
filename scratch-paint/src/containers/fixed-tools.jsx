import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';

import FixedToolsComponent from '../components/fixed-tools/fixed-tools.jsx';

import {changeMode} from '../reducers/modes';
import {changeFormat} from '../reducers/format';
import {clearSelectedItems, setSelectedItems} from '../reducers/selected-items';
import {deactivateEyeDropper} from '../reducers/eye-dropper';
import {setTextEditTarget} from '../reducers/text-edit-target';
import {setLayout} from '../reducers/layout';

import {clearSelection, getSelectedLeafItems, getSelectedRootItems, setItemSelection} from '../helper/selection';
import {
    exportBindings, groupForBinding, hasBinding, isCodeObject, setBinding, setCodeObjectMarkup, toCodeObject
} from '../helper/bindings';
import {bringToFront, sendBackward, sendToBack, bringForward} from '../helper/order';
import {groupSelection, ungroupSelection} from '../helper/group';

import Formats, {isBitmap, isVector} from '../lib/format';
import bindAll from 'lodash.bindall';

class FixedTools extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleSendBackward',
            'handleSendForward',
            'handleSendToBack',
            'handleSendToFront',
            'handleSetSelectedItems',
            'handleGroup',
            'handleUngroup',
            'handleChangeBinding',
            'handleChangeAnchor',
            'handleChangeBindingMarkup',
            'handleMakeCodeObject'
        ]);
    }
    bindingItem () {
        if (!isVector(this.props.format)) return null;
        const items = getSelectedRootItems();
        return items.length === 1 ? items[0] : null;
    }
    changeBinding (key, value) {
        const item = this.bindingItem();
        if (!item || isCodeObject(item)) return;
        if (key !== 'anchor' && !(value && value.trim()) && !hasBinding(item)) return;
        // Bindings are kept on a <g>, so a single shape is put in a group first
        const group = groupForBinding(item);
        setBinding(group, key, value);
        if (group !== item) {
            clearSelection(this.props.clearSelectedItems);
            setItemSelection(group, true);
            this.handleSetSelectedItems();
        }
        this.props.onUpdateImage();
    }
    handleChangeBinding (key, value) {
        this.changeBinding(key, value);
    }
    handleChangeAnchor (anchor) {
        this.changeBinding('anchor', anchor);
    }
    handleChangeBindingMarkup (markup) {
        const item = this.bindingItem();
        if (!item || !isCodeObject(item)) return;
        setCodeObjectMarkup(item, markup);
        // Its size may have changed: the selection box follows
        clearSelection(this.props.clearSelectedItems);
        setItemSelection(item, true);
        this.handleSetSelectedItems();
        this.props.onUpdateImage();
    }
    handleMakeCodeObject () {
        const item = this.bindingItem();
        if (!item) return;
        const codeObject = toCodeObject(item, exportBindings);
        if (!codeObject) return;
        clearSelection(this.props.clearSelectedItems);
        setItemSelection(codeObject, true);
        this.handleSetSelectedItems();
        this.props.onUpdateImage();
    }
    handleGroup () {
        groupSelection(this.props.clearSelectedItems, this.handleSetSelectedItems, this.props.onUpdateImage);
    }
    handleUngroup () {
        ungroupSelection(this.props.clearSelectedItems, this.handleSetSelectedItems, this.props.onUpdateImage);
    }
    handleSendBackward () {
        sendBackward(this.props.onUpdateImage);
    }
    handleSendForward () {
        bringForward(this.props.onUpdateImage);
    }
    handleSendToBack () {
        sendToBack(this.props.onUpdateImage);
    }
    handleSendToFront () {
        bringToFront(this.props.onUpdateImage);
    }
    handleSetSelectedItems () {
        this.props.setSelectedItems(this.props.format);
    }
    render () {
        const bindingItem = this.bindingItem();
        return (
            <FixedToolsComponent
                binding={bindingItem ? (bindingItem.data.bind || null) : null}
                bindingItem={bindingItem}
                bindingMarkup={isCodeObject(bindingItem) ? bindingItem.data.codeBinding : null}
                canRedo={this.props.canRedo}
                canUndo={this.props.canUndo}
                name={this.props.name}
                onChangeAnchor={this.handleChangeAnchor}
                onChangeBinding={this.handleChangeBinding}
                onChangeBindingMarkup={this.handleChangeBindingMarkup}
                onMakeCodeObject={this.handleMakeCodeObject}
                onGroup={this.handleGroup}
                onRedo={this.props.onRedo}
                onSendBackward={this.handleSendBackward}
                onSendForward={this.handleSendForward}
                onSendToBack={this.handleSendToBack}
                onSendToFront={this.handleSendToFront}
                onUndo={this.props.onUndo}
                onUngroup={this.handleUngroup}
                onUpdateImage={this.props.onUpdateImage}
                onUpdateName={this.props.onUpdateName}
                width={this.props.width}
            />
        );
    }
}

FixedTools.propTypes = {
    canRedo: PropTypes.func.isRequired,
    canUndo: PropTypes.func.isRequired,
    clearSelectedItems: PropTypes.func.isRequired,
    format: PropTypes.oneOf(Object.keys(Formats)),
    name: PropTypes.string,
    onRedo: PropTypes.func.isRequired,
    onUndo: PropTypes.func.isRequired,
    onUpdateImage: PropTypes.func.isRequired,
    onUpdateName: PropTypes.func.isRequired,
    setSelectedItems: PropTypes.func.isRequired,
    width: PropTypes.number
};

const mapStateToProps = state => ({
    changeColorToEyeDropper: state.scratchPaint.color.eyeDropper.callback,
    format: state.scratchPaint.format,
    isEyeDropping: state.scratchPaint.color.eyeDropper.active,
    mode: state.scratchPaint.mode,
    pasteOffset: state.scratchPaint.clipboard.pasteOffset,
    previousTool: state.scratchPaint.color.eyeDropper.previousTool,
    selectedItems: state.scratchPaint.selectedItems,
    // The binding panel shows what the last change did
    undoState: state.scratchPaint.undo,
    viewBounds: state.scratchPaint.viewBounds
});
const mapDispatchToProps = dispatch => ({
    changeMode: mode => {
        dispatch(changeMode(mode));
    },
    clearSelectedItems: () => {
        dispatch(clearSelectedItems());
    },
    handleSwitchToBitmap: () => {
        dispatch(changeFormat(Formats.BITMAP));
    },
    handleSwitchToVector: () => {
        dispatch(changeFormat(Formats.VECTOR));
    },
    removeTextEditTarget: () => {
        dispatch(setTextEditTarget());
    },
    setLayout: layout => {
        dispatch(setLayout(layout));
    },
    setSelectedItems: format => {
        dispatch(setSelectedItems(getSelectedLeafItems(), isBitmap(format)));
    },
    onDeactivateEyeDropper: () => {
        // set redux values to default for eye dropper reducer
        dispatch(deactivateEyeDropper());
    }
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(FixedTools);

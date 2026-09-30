import PropTypes from 'prop-types';
import React from 'react';
import bindAll from 'lodash.bindall';
import VM from 'scratch-vm';
import PaintEditor from '../lib/tw-scratch-paint';
import {inlineSvgFonts, sanitizeSvg} from '@turbowarp/scratch-svg-renderer';
import ErrorBoundaryHOC from '../lib/error-boundary-hoc.jsx';
import {openFontsModal} from '../reducers/modals';
import {readPath} from 'scratch-vm/src/engine/svg-bindings';

import {connect} from 'react-redux';
import {Theme} from '../lib/themes/index.js';

class PaintEditorWrapper extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleUpdateImage',
            'handleUpdateName',
            'handleUpdateFonts',
            'fontInlineFn',
            'readBinding'
        ]);
        this.state = {
            fonts: this.props.vm.runtime.fontManager.getFonts()
        };
    }
    componentDidMount () {
        this.props.vm.runtime.fontManager.on('change', this.handleUpdateFonts);
    }
    shouldComponentUpdate (nextProps, nextState) {
        return this.props.imageId !== nextProps.imageId ||
            this.props.rtl !== nextProps.rtl ||
            this.props.name !== nextProps.name ||
            this.props.theme !== nextProps.theme ||
            this.props.customStageSize !== nextProps.customStageSize ||
            this.state.fonts !== nextState.fonts;
    }
    componentWillUnmount () {
        this.props.vm.runtime.fontManager.off('change', this.handleUpdateFonts);
    }
    handleUpdateFonts () {
        this.setState({
            fonts: this.props.vm.runtime.fontManager.getFonts()
        });
    }
    handleUpdateName (name) {
        this.props.vm.renameCostume(this.props.selectedCostumeIndex, name);
    }
    handleUpdateImage (isVector, image, rotationCenterX, rotationCenterY) {
        if (isVector) {
            this.props.vm.updateSvg(
                this.props.selectedCostumeIndex,
                image,
                rotationCenterX,
                rotationCenterY);
        } else {
            this.props.vm.updateBitmap(
                this.props.selectedCostumeIndex,
                image,
                rotationCenterX,
                rotationCenterY,
                2 /* bitmapResolution */);
        }
    }
    /**
     * @param {object} node a path of a binding expression (`分數`, `self.hp`; a component's `文字` is one of its root)
     * @returns {*} its value for the sprite being edited: the paint editor draws bound elements with it, like the
     * stage does
     */
    readBinding (node) {
        const target = this.props.vm.editingTarget;
        return target ? readPath(target, node) : '';
    }
    fontInlineFn (svgString) {
        return inlineSvgFonts(svgString, this.props.vm.renderer.customFonts);
    }
    render () {
        if (!this.props.imageId) return null;
        const {
            selectedCostumeIndex,
            vm,
            ...componentProps
        } = this.props;
        const costume = vm.getCostume(selectedCostumeIndex);
        return (
            <PaintEditor
                {...componentProps}
                image={this.props.imageFormat === 'svg' ? sanitizeSvg.sanitizeSvgText(costume) : costume}
                onUpdateImage={this.handleUpdateImage}
                onUpdateName={this.handleUpdateName}
                fontInlineFn={this.fontInlineFn}
                readBinding={this.readBinding}
                theme={this.props.theme.isDark() ? 'dark' : 'light'}
                customFonts={this.state.fonts}
                width={this.props.customStageSize.width}
                height={this.props.customStageSize.height}
            />
        );
    }
}

PaintEditorWrapper.propTypes = {
    customStageSize: PropTypes.shape({
        width: PropTypes.number,
        height: PropTypes.number
    }),
    onManageFonts: PropTypes.func.isRequired,
    imageFormat: PropTypes.string.isRequired,
    imageId: PropTypes.string.isRequired,
    theme: PropTypes.instanceOf(Theme),
    name: PropTypes.string,
    rotationCenterX: PropTypes.number,
    rotationCenterY: PropTypes.number,
    rtl: PropTypes.bool,
    selectedCostumeIndex: PropTypes.number.isRequired,
    vm: PropTypes.instanceOf(VM)
};

const mapStateToProps = (state, {selectedCostumeIndex}) => {
    const targetId = state.scratchGui.vm.editingTarget.id;
    const sprite = state.scratchGui.vm.editingTarget.sprite;
    // Make sure the costume index doesn't go out of range.
    const index = selectedCostumeIndex < sprite.costumes.length ?
        selectedCostumeIndex : sprite.costumes.length - 1;
    const costume = state.scratchGui.vm.editingTarget.sprite.costumes[index];
    return {
        customStageSize: state.scratchGui.customStageSize,
        name: costume && costume.name,
        rotationCenterX: costume && costume.rotationCenterX,
        rotationCenterY: costume && costume.rotationCenterY,
        imageFormat: costume && costume.dataFormat,
        imageId: targetId && `${targetId}${costume.skinId}`,
        rtl: state.locales.isRtl,
        selectedCostumeIndex: index,
        theme: state.scratchGui.theme.theme,
        vm: state.scratchGui.vm,
        zoomLevelId: targetId
    };
};

const mapDispatchToProps = dispatch => ({
    onManageFonts: () => dispatch(openFontsModal())
});

export default ErrorBoundaryHOC('paint')(connect(
    mapStateToProps,
    mapDispatchToProps
)(PaintEditorWrapper));

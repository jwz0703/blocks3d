import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import {setStageDisplayWidth} from '../reducers/stage-size';
import {getStageDimensions} from '../lib/screen-utils';
import {STAGE_DISPLAY_SIZES} from '../lib/layout-constants';
import styles from '../components/gui/gui.css';

const MIN_STAGE_WIDTH = 240;
// Keep at least this much room for the code area
const MIN_EDITOR_WIDTH = 400;
// Keep at least this much vertical room for the menu bar, stage header and sprite pane
const MIN_NON_STAGE_HEIGHT = 260;
// Stage column padding (2 * $space) + stage border (2 * 1px)
const STAGE_COLUMN_CHROME = 18;

class StageResizer extends React.Component {
    constructor (props) {
        super(props);
        this.handlePointerDown = this.handlePointerDown.bind(this);
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.endDrag = this.endDrag.bind(this);
        this.setRef = this.setRef.bind(this);
        this.dragging = false;
        this.frame = null;
    }
    componentWillUnmount () {
        this.endDrag();
    }
    setRef (el) {
        this.el = el;
    }
    handlePointerDown (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        const {customStageSize, stageSize, stageDisplayWidth} = this.props;
        this.startX = e.clientX;
        this.startWidth = getStageDimensions(stageSize, customStageSize, false, stageDisplayWidth).width;
        this.dragging = true;
        this.el.setPointerCapture(e.pointerId);
        this.el.addEventListener('pointermove', this.handlePointerMove);
        this.el.addEventListener('pointerup', this.endDrag);
        this.el.addEventListener('pointercancel', this.endDrag);
        this.el.addEventListener('lostpointercapture', this.endDrag);
        document.body.style.cursor = 'col-resize';
    }
    handlePointerMove (e) {
        // A missed pointerup leaves no buttons pressed; end the drag instead of following the mouse
        if (e.buttons === 0) {
            this.endDrag(e);
            return;
        }
        const {customStageSize, isRtl} = this.props;
        const delta = isRtl ? e.clientX - this.startX : this.startX - e.clientX;
        const aspect = customStageSize.width / customStageSize.height;
        const maxWidth = Math.max(MIN_STAGE_WIDTH, Math.min(
            window.innerWidth - MIN_EDITOR_WIDTH - STAGE_COLUMN_CHROME,
            (window.innerHeight - MIN_NON_STAGE_HEIGHT) * aspect
        ));
        const width = Math.round(Math.min(maxWidth, Math.max(MIN_STAGE_WIDTH, this.startWidth + delta)));
        if (width === this.props.stageDisplayWidth) return;
        this.props.onSetWidth(width);
        if (this.frame === null) {
            this.frame = requestAnimationFrame(() => {
                this.frame = null;
                // Blockly and the renderer only resize on window resize
                window.dispatchEvent(new Event('resize'));
            });
        }
    }
    endDrag (e) {
        if (!this.dragging) return;
        this.dragging = false;
        if (e && this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
        this.el.removeEventListener('pointermove', this.handlePointerMove);
        this.el.removeEventListener('pointerup', this.endDrag);
        this.el.removeEventListener('pointercancel', this.endDrag);
        this.el.removeEventListener('lostpointercapture', this.endDrag);
        document.body.style.cursor = '';
    }
    render () {
        return (
            <div
                className={styles.stageResizer}
                ref={this.setRef}
                onPointerDown={this.handlePointerDown}
            />
        );
    }
}

StageResizer.propTypes = {
    customStageSize: PropTypes.shape({
        width: PropTypes.number,
        height: PropTypes.number
    }),
    isRtl: PropTypes.bool,
    onSetWidth: PropTypes.func,
    stageDisplayWidth: PropTypes.number,
    stageSize: PropTypes.oneOf(Object.keys(STAGE_DISPLAY_SIZES)).isRequired
};

const mapStateToProps = state => ({
    customStageSize: state.scratchGui.customStageSize,
    isRtl: state.locales.isRtl,
    stageDisplayWidth: state.scratchGui.stageSize.stageDisplayWidth
});

const mapDispatchToProps = dispatch => ({
    onSetWidth: width => dispatch(setStageDisplayWidth(width))
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(StageResizer);

import PropTypes from 'prop-types';
import React from 'react';
import bindAll from 'lodash.bindall';
import VM from 'scratch-vm';
import {STAGE_SIZE_MODES} from '../lib/layout-constants';
import {setFullScreen} from '../reducers/mode';
import {openSettingsModal} from '../reducers/modals';

import {connect} from 'react-redux';

import StageHeaderComponent from '../components/stage-header/stage-header.jsx';

// eslint-disable-next-line react/prefer-stateless-function
class StageHeader extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleKeyPress'
        ]);
    }
    componentDidMount () {
        document.addEventListener('keydown', this.handleKeyPress);
    }
    componentWillUnmount () {
        document.removeEventListener('keydown', this.handleKeyPress);
    }
    handleKeyPress (event) {
        if (event.key === 'Escape' && this.props.isFullScreen) {
            this.props.onSetStageUnFullScreen();
        }
    }
    render () {
        const {
            ...props
        } = this.props;
        return (
            <StageHeaderComponent
                {...props}
                onKeyPress={this.handleKeyPress}
            />
        );
    }
}

StageHeader.propTypes = {
    isFullScreen: PropTypes.bool.isRequired,
    // tw: update when dimensions or isWindowFullScreen changes
    isWindowFullScreen: PropTypes.bool.isRequired,
    customStageSize: PropTypes.shape({
        width: PropTypes.number.isRequired,
        height: PropTypes.number.isRequired
    }).isRequired,
    dimensions: PropTypes.arrayOf(PropTypes.number),
    isPlayerOnly: PropTypes.bool,
    onSetStageUnFullScreen: PropTypes.func.isRequired,
    onOpenSettings: PropTypes.func.isRequired,
    // tw: replace showBranding
    isEmbedded: PropTypes.bool.isRequired,
    stageSizeMode: PropTypes.oneOf(Object.keys(STAGE_SIZE_MODES)).isRequired,
    vm: PropTypes.instanceOf(VM).isRequired
};

const mapStateToProps = state => ({
    customStageSize: state.scratchGui.customStageSize,
    stageSizeMode: state.scratchGui.stageSize.stageSize,
    stageDisplayWidth: state.scratchGui.stageSize.stageDisplayWidth,
    // tw: replace showBranding
    isEmbedded: state.scratchGui.mode.isEmbedded,
    isFullScreen: state.scratchGui.mode.isFullScreen,
    // tw: update when dimensions or isWindowFullScreen changes
    isWindowFullScreen: state.scratchGui.tw.isWindowFullScreen,
    dimensions: state.scratchGui.tw.dimensions,
    isPlayerOnly: state.scratchGui.mode.isPlayerOnly
});

const mapDispatchToProps = dispatch => ({
    onSetStageFullScreen: () => dispatch(setFullScreen(true)),
    onSetStageUnFullScreen: () => dispatch(setFullScreen(false)),
    onOpenSettings: () => dispatch(openSettingsModal())
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(StageHeader);

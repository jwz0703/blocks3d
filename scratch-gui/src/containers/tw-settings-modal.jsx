import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, intlShape} from 'react-intl';
import bindAll from 'lodash.bindall';
import {connect} from 'react-redux';
import {closeSettingsModal} from '../reducers/modals';
import SettingsModalComponent from '../components/tw-settings-modal/settings-modal.jsx';

const messages = defineMessages({
    newFramerate: {
        defaultMessage: 'New framerate:',
        description: 'Prompt shown to choose a new framerate',
        id: 'tw.menuBar.newFramerate'
    }
});

class UsernameModal extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleFramerateChange',
            'handleCustomizeFramerate',
            'handleInterpolationChange',
            'handleWarpTimerChange',
            'handleScreenSettingsChange',
            'handleDisableCompilerChange',
            'handleStoreProjectOptions'
        ]);
    }
    handleFramerateChange (e) {
        this.props.vm.setFramerate(e.target.checked ? 30 : 60);
    }
    async handleCustomizeFramerate () {
        // prompt() returns Promise in desktop app
        // eslint-disable-next-line no-alert
        const newFramerate = await prompt(this.props.intl.formatMessage(messages.newFramerate), this.props.framerate);
        const parsed = parseFloat(newFramerate);
        if (isFinite(parsed)) {
            this.props.vm.setFramerate(parsed);
        }
    }
    handleInterpolationChange (e) {
        this.props.vm.setInterpolation(e.target.checked);
    }
    handleWarpTimerChange (e) {
        this.props.vm.setCompilerOptions({
            warpTimer: e.target.checked
        });
    }
    handleDisableCompilerChange (e) {
        this.props.vm.setCompilerOptions({
            enabled: !e.target.checked
        });
    }
    handleScreenSettingsChange (settings) {
        this.props.vm.setScreenSettings(settings);
    }
    handleStoreProjectOptions () {
        this.props.vm.storeProjectOptions();
    }
    render () {
        const {
            /* eslint-disable no-unused-vars */
            onClose,
            vm,
            /* eslint-enable no-unused-vars */
            ...props
        } = this.props;
        return (
            <SettingsModalComponent
                onClose={this.props.onClose}
                onFramerateChange={this.handleFramerateChange}
                onCustomizeFramerate={this.handleCustomizeFramerate}
                onInterpolationChange={this.handleInterpolationChange}
                onWarpTimerChange={this.handleWarpTimerChange}
                onScreenSettingsChange={this.handleScreenSettingsChange}
                onDisableCompilerChange={this.handleDisableCompilerChange}
                onStoreProjectOptions={this.handleStoreProjectOptions}
                {...props}
            />
        );
    }
}

UsernameModal.propTypes = {
    intl: intlShape,
    onClose: PropTypes.func,
    vm: PropTypes.shape({
        setFramerate: PropTypes.func,
        setCompilerOptions: PropTypes.func,
        setInterpolation: PropTypes.func,
        setRuntimeOptions: PropTypes.func,
        setScreenSettings: PropTypes.func,
        storeProjectOptions: PropTypes.func
    }),
    isEmbedded: PropTypes.bool,
    framerate: PropTypes.number,
    interpolation: PropTypes.bool,
    warpTimer: PropTypes.bool,
    screenSettings: PropTypes.shape({
        mode: PropTypes.string,
        width: PropTypes.number,
        height: PropTypes.number,
        renderScale: PropTypes.number,
        shadows: PropTypes.string
    }),
    disableCompiler: PropTypes.bool
};

const mapStateToProps = state => ({
    vm: state.scratchGui.vm,
    isEmbedded: state.scratchGui.mode.isEmbedded,
    framerate: state.scratchGui.tw.framerate,
    interpolation: state.scratchGui.tw.interpolation,
    warpTimer: state.scratchGui.tw.compilerOptions.warpTimer,
    screenSettings: state.scratchGui.screen.settings,
    disableCompiler: !state.scratchGui.tw.compilerOptions.enabled
});

const mapDispatchToProps = dispatch => ({
    onClose: () => dispatch(closeSettingsModal())
});

export default injectIntl(connect(
    mapStateToProps,
    mapDispatchToProps
)(UsernameModal));

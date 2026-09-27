import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';

import {PREVIEW_ASPECTS, setPreviewAspect} from '../reducers/screen';
import styles from '../components/stage-header/stage-header.css';

/* eslint-disable react/jsx-no-literals */
const LABELS = {
    '16:9': '16:9',
    '4:3': '4:3',
    '21:9': '21:9',
    '9:16': '9:16 直式'
};

/**
 * Screen shape to preview the stage on in the editor, for projects whose stage follows the shape of the screen
 * (ROADMAP.md 7.5). Like Unity's Game view aspect menu. Full screen uses the window instead.
 */
class ScreenAspectPicker extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['handleChange']);
    }
    handleChange (e) {
        this.props.onChange(e.target.value);
    }
    render () {
        if (this.props.mode === 'fixed') return null;
        return (
            <select
                className={styles.aspectSelect}
                value={this.props.previewAspect}
                title="預覽的螢幕比例"
                onChange={this.handleChange}
            >
                {PREVIEW_ASPECTS.map(preset => (
                    <option
                        key={preset.id}
                        value={preset.id}
                    >
                        {LABELS[preset.id] || preset.id}
                    </option>
                ))}
            </select>
        );
    }
}

ScreenAspectPicker.propTypes = {
    mode: PropTypes.string,
    previewAspect: PropTypes.string,
    onChange: PropTypes.func
};

const mapStateToProps = state => ({
    mode: state.scratchGui.screen.settings.mode,
    previewAspect: state.scratchGui.screen.previewAspect
});

const mapDispatchToProps = dispatch => ({
    onChange: previewAspect => dispatch(setPreviewAspect(previewAspect))
});

export default connect(mapStateToProps, mapDispatchToProps)(ScreenAspectPicker);

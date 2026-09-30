import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';

import Box from '../box/box.jsx';
import Modal from '../../containers/modal.jsx';
import promptStyles from '../prompt/prompt.css';
import styles from './property-prompt.css';

const TYPES = [
    ['string', '文字'],
    ['number', '數字'],
    ['boolean', '是 / 否'],
    ['color', '顏色'],
    ['menu', '選單'],
    ['costume', '造型'],
    ['sprite', '角色'],
    ['sound', '音效']
];

/**
 * 新屬性: like 「建立一個變數」, for a property of a component (ROADMAP.md 階段 10): its name, type and default value.
 */
class PropertyPrompt extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['handleChange', 'handleKeyPress', 'handleOk']);
        this.state = {name: '', type: 'string', default: '', options: ''};
    }
    handleChange (e) {
        this.setState({[e.target.name]: e.target.value});
    }
    handleKeyPress (e) {
        if (e.key === 'Enter') this.handleOk();
    }
    handleOk () {
        const name = this.state.name.trim();
        if (!name) return;
        const prop = {name, type: this.state.type, default: this.state.default};
        if (prop.type === 'boolean') prop.default = /^(true|是|1)$/i.test(this.state.default.trim());
        if (prop.type === 'menu') {
            prop.options = this.state.options.split(',').map(o => o.trim())
                .filter(Boolean);
            if (!prop.default && prop.options.length) prop.default = prop.options[0];
        }
        this.props.onOk(prop);
    }
    render () {
        return (
            <Modal
                className={promptStyles.modalContent}
                contentLabel="新屬性"
                id="propertyPrompt"
                onRequestClose={this.props.onCancel}
            >
                <Box className={promptStyles.body}>
                    <Box className={promptStyles.label}>{'屬性名稱：'}</Box>
                    <Box>
                        <input
                            autoFocus
                            className={promptStyles.variableNameTextInput}
                            name="name"
                            value={this.state.name}
                            onChange={this.handleChange}
                            onKeyPress={this.handleKeyPress}
                        />
                    </Box>
                    <div className={styles.types}>
                        {TYPES.map(([type, label]) => (
                            <label key={type}>
                                <input
                                    checked={this.state.type === type}
                                    name="type"
                                    type="radio"
                                    value={type}
                                    onChange={this.handleChange}
                                />
                                {label}
                            </label>
                        ))}
                    </div>
                    {this.state.type === 'menu' ? (
                        <React.Fragment>
                            <div className={styles.smallLabel}>{'選項（用逗號分開）：'}</div>
                            <input
                                className={promptStyles.variableNameTextInput}
                                name="options"
                                value={this.state.options}
                                onChange={this.handleChange}
                                onKeyPress={this.handleKeyPress}
                            />
                        </React.Fragment>
                    ) : null}
                    <div className={styles.smallLabel}>{'預設值（每個實體可以改）：'}</div>
                    <input
                        className={promptStyles.variableNameTextInput}
                        name="default"
                        placeholder={this.state.type === 'boolean' ? '是 / 否' : ''}
                        value={this.state.default}
                        onChange={this.handleChange}
                        onKeyPress={this.handleKeyPress}
                    />
                    <Box className={promptStyles.buttonRow}>
                        <button
                            className={promptStyles.cancelButton}
                            onClick={this.props.onCancel}
                        >{'取消'}</button>
                        <button
                            className={promptStyles.okButton}
                            onClick={this.handleOk}
                        >{'確定'}</button>
                    </Box>
                </Box>
            </Modal>
        );
    }
}

PropertyPrompt.propTypes = {
    onCancel: PropTypes.func.isRequired,
    onOk: PropTypes.func.isRequired
};

export default PropertyPrompt;

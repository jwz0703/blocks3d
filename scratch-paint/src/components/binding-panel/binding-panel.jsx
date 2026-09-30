import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';

import BufferedInputHOC from '../forms/buffered-input-hoc.jsx';
import Input from '../forms/input.jsx';
import {parse, parseTemplate, checkBinding} from 'scratch-vm/src/util/b3-expression';
import {BIND_KEYS, hasExpression, isForbiddenAttribute, parseMarkup} from '../../helper/bindings';
import styles from './binding-panel.css';

const BufferedInput = BufferedInputHOC(Input);

const LABELS = {
    'x': '位移 x',
    'y': '位移 y',
    'rotate': '旋轉',
    'scale-x': '縮放 x',
    'scale-y': '縮放 y',
    'fill': '填色',
    'stroke': '外框色',
    'opacity': '透明度',
    'visible': '顯示'
};

const PLACEHOLDERS = {
    'x': '例如 self.dx',
    'rotate': '角度',
    'scale-x': '例如 值 / 最大值',
    'fill': '例如 hp < 30 ? "#f00" : "#0c0"',
    'opacity': '0 ~ 1',
    'visible': '例如 分數 > 0'
};

// Names of attributes in the panel of a code object
const ATTRIBUTE_LABELS = {
    'x': 'x',
    'y': 'y',
    'width': '寬',
    'height': '高',
    'rx': '圓角 x',
    'ry': '圓角 y',
    'cx': '中心 x',
    'cy': '中心 y',
    'r': '半徑',
    'fill': '填色',
    'fill-opacity': '填色透明度',
    'stroke': '外框色',
    'stroke-width': '外框粗細',
    'stroke-opacity': '外框透明度',
    'opacity': '透明度',
    'font-size': '字級',
    'font-family': '字型',
    'text-anchor': '對齊',
    'transform': '變形',
    'd': '路徑',
    'points': '點'
};

// Attributes that can be added to a code object, suggested in the list
const SUGGESTED = ['x', 'y', 'width', 'height', 'rx', 'fill', 'fill-opacity', 'stroke', 'stroke-width',
    'stroke-opacity', 'opacity', 'font-size', 'text-anchor', 'visibility', 'transform', 'data-bind-visible'];

/**
 * @param {string} source
 * @returns {?string} what is wrong with an expression
 */
const errorOf = source => {
    if (!source || !source.trim()) return null;
    try {
        const error = checkBinding(parse(source));
        return error ? error.message : null;
    } catch (e) {
        return e.message;
    }
};

/**
 * @param {string} text an attribute or text, with {expressions} in it
 * @returns {?string} what is wrong with it
 */
const templateError = text => {
    if (!hasExpression(text)) return null;
    try {
        const parts = parseTemplate(text);
        for (const part of parts || []) {
            if (typeof part === 'string') continue;
            const error = checkBinding(part.tree);
            if (error) return error.message;
        }
        return null;
    } catch (e) {
        return e.message;
    }
};

/**
 * @param {Element} element
 * @returns {boolean} true if its text can be edited here (no elements in it)
 */
const hasPlainText = element => ['text', 'tspan'].includes(element.localName) && element.children.length === 0;

const ANCHORS = [0, 0.5, 1];

/**
 * A row of the panel: a name and a value (a fixed value, or with {expressions} in it)
 * @param {object} props
 * @returns {React.ReactElement} the row
 */
const ValueRow = props => {
    const error = props.error;
    return (
        <React.Fragment>
            <div className={styles.row}>
                <span
                    className={styles.name}
                    title={props.title || props.label}
                >{props.label}</span>
                <BufferedInput
                    className={classNames(styles.input, {
                        [styles.bound]: props.bound && !error,
                        [styles.errorInput]: error
                    })}
                    placeholder={props.placeholder || ''}
                    type="text"
                    value={props.value}
                    onSubmit={props.onSubmit}
                />
            </div>
            {error ? <div className={styles.error}>{error}</div> : null}
        </React.Fragment>
    );
};

ValueRow.propTypes = {
    bound: PropTypes.bool,
    error: PropTypes.string,
    label: PropTypes.string.isRequired,
    onSubmit: PropTypes.func.isRequired,
    placeholder: PropTypes.string,
    title: PropTypes.string,
    value: PropTypes.string.isRequired
};

/**
 * The attributes and text of a code object (helper/bindings.js), each a fixed value or with {expressions} in it
 */
class CodeObjectPanel extends React.Component {
    constructor (props) {
        super(props);
        this.state = {newName: '', newValue: ''};
        this.handleNewName = e => this.setState({newName: e.target.value});
        this.handleNewValue = e => this.setState({newValue: e.target.value});
        this.handleAdd = this.handleAdd.bind(this);
        this.handleAddKey = e => {
            if (e.key === 'Enter') this.handleAdd();
        };
    }
    element () {
        return parseMarkup(this.props.markup);
    }
    change (fn) {
        const element = this.element();
        if (!element) return;
        fn(element);
        const markup = new XMLSerializer().serializeToString(element)
            .replace(/ xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, '')
            .replace(/ xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink"/, '');
        if (markup !== this.props.markup) this.props.onChangeMarkup(markup);
    }
    handleAttribute (name, value) {
        this.change(element => {
            // An empty value takes the attribute away
            if (value === '') element.removeAttribute(name);
            else element.setAttribute(name, value);
        });
    }
    handleText (value) {
        this.change(element => {
            element.textContent = value;
        });
    }
    handleAdd () {
        const name = this.state.newName.trim();
        if (!/^[A-Za-z_][\w.:-]*$/.test(name) || isForbiddenAttribute(name) || /^xmlns/.test(name)) return;
        this.handleAttribute(name, this.state.newValue);
        this.setState({newName: '', newValue: ''});
    }
    render () {
        const element = this.element();
        if (!element) {
            return <div className={styles.hint}>{'這個物件的 SVG 讀不懂，請到「SVG 程式碼」修改。'}</div>;
        }
        const attributes = Array.from(element.attributes)
            .filter(attribute => !/^xmlns/.test(attribute.name) && attribute.name !== 'data-code-binding');
        const names = attributes.map(attribute => attribute.name);
        const plainText = hasPlainText(element);
        return (
            <React.Fragment>
                <div className={styles.subtitle}>
                    {`程式碼物件 <${element.localName}>：拖曳、旋轉、縮放整個物件；下面每一格可以寫固定值，` +
                        '或在 { } 裡寫運算式綁定。'}
                </div>
                {plainText ? (
                    <ValueRow
                        bound={hasExpression(element.textContent)}
                        error={templateError(element.textContent)}
                        label="文字"
                        placeholder="例如 分數：{分數:00000}"
                        value={element.textContent}
                        // eslint-disable-next-line react/jsx-no-bind
                        onSubmit={value => this.handleText(value)}
                    />
                ) : null}
                {attributes.map(attribute => (
                    <ValueRow
                        bound={hasExpression(attribute.value)}
                        error={templateError(attribute.value)}
                        key={attribute.name}
                        label={ATTRIBUTE_LABELS[attribute.name] || attribute.name}
                        title={attribute.name}
                        value={attribute.value}
                        // eslint-disable-next-line react/jsx-no-bind
                        onSubmit={value => this.handleAttribute(attribute.name, value)}
                    />
                ))}
                <div className={styles.addRow}>
                    <input
                        className={styles.input}
                        list="tw-binding-attributes"
                        placeholder="新屬性"
                        value={this.state.newName}
                        onChange={this.handleNewName}
                        onKeyDown={this.handleAddKey}
                    />
                    <datalist id="tw-binding-attributes">
                        {SUGGESTED.filter(name => !names.includes(name)).map(name => (
                            <option
                                key={name}
                                value={name}
                            >{ATTRIBUTE_LABELS[name] || name}</option>
                        ))}
                    </datalist>
                    <input
                        className={styles.input}
                        placeholder="值或 {運算式}"
                        value={this.state.newValue}
                        onChange={this.handleNewValue}
                        onKeyDown={this.handleAddKey}
                    />
                    <button
                        className={styles.addButton}
                        onClick={this.handleAdd}
                    >{'加入'}</button>
                </div>
                <div className={styles.hint}>
                    {'清空一格就拿掉那個屬性。運算式：全域變數（元件裡是元件自己的變數和屬性）、self.、+ - * /、條件 ? a : b、min max clamp…；' +
                        '{分數:00000} 補零。子元素的綁定在「SVG 程式碼」裡改。'}
                </div>
            </React.Fragment>
        );
    }
}

CodeObjectPanel.propTypes = {
    markup: PropTypes.string.isRequired,
    onChangeMarkup: PropTypes.func.isRequired
};

const BindingPanel = props => {
    if (!props.item) {
        return (
            <div className={styles.panel}>
                <div className={styles.title}>{'綁定'}</div>
                <div className={styles.hint}>
                    {'選取一個物件（或一個群組），它的位置、旋轉、縮放、顏色、透明度、顯示就可以跟著變數或屬性變；' +
                        '轉成程式碼物件後，任何屬性（寬、高、文字…）都可以綁定。'}
                </div>
            </div>
        );
    }
    if (typeof props.markup === 'string') {
        return (
            <div className={styles.panel}>
                <div className={styles.title}>{'綁定'}</div>
                <CodeObjectPanel
                    markup={props.markup}
                    onChangeMarkup={props.onChangeMarkup}
                />
            </div>
        );
    }
    const bind = props.bind || {};
    const anchor = bind.anchor || [0.5, 0.5];
    return (
        <div className={styles.panel}>
            <div className={styles.title}>{'綁定'}</div>
            <div className={styles.row}>
                <span>{'錨點'}</span>
                <div className={styles.anchors}>
                    {ANCHORS.map(ay => ANCHORS.map(ax => (
                        <button
                            className={classNames(styles.anchor, {
                                [styles.anchorOn]: anchor[0] === ax && anchor[1] === ay
                            })}
                            key={`${ax} ${ay}`}
                            title={`${ax} ${ay}`}
                            // eslint-disable-next-line react/jsx-no-bind
                            onClick={() => props.onChangeAnchor([ax, ay])}
                        />
                    )))}
                </div>
            </div>
            {BIND_KEYS.map(key => {
                const value = bind[key] || '';
                return (
                    <ValueRow
                        bound={!!value}
                        error={errorOf(value)}
                        key={key}
                        label={LABELS[key]}
                        placeholder={PLACEHOLDERS[key]}
                        value={value}
                        // eslint-disable-next-line react/jsx-no-bind
                        onSubmit={text => props.onChange(key, text)}
                    />
                );
            })}
            <div className={styles.hint}>
                {'空的欄位不綁定。可以寫固定值或運算式：全域變數（元件裡是元件自己的變數和屬性）、self.、+ - * /、條件 ? a : b、min max clamp…'}
            </div>
            <button
                className={styles.convertButton}
                onClick={props.onMakeCodeObject}
            >{'轉成程式碼物件（綁定寬、高、文字等任何屬性）'}</button>
        </div>
    );
};

BindingPanel.propTypes = {
    bind: PropTypes.object, // eslint-disable-line react/forbid-prop-types
    item: PropTypes.object, // eslint-disable-line react/forbid-prop-types
    markup: PropTypes.string,
    onChange: PropTypes.func.isRequired,
    onChangeAnchor: PropTypes.func.isRequired,
    onChangeMarkup: PropTypes.func.isRequired,
    onMakeCodeObject: PropTypes.func.isRequired
};

export default BindingPanel;

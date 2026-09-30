import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';

import {scanSvgBindings} from 'scratch-vm/src/util/svg-binding-scan';
import {pathsOf} from 'scratch-vm/src/util/b3-expression';
import {Template, readPath} from 'scratch-vm/src/engine/svg-bindings';

import {formatSvg, needsFormat} from './format-svg';
import styles from './svg-code-editor.css';

const SAVE_DELAY = 400;

/**
 * @param {string} name a variable path as written, e.g. "self.hp"
 * @returns {object} it as a path node of an expression
 */
const pathNode = name => {
    const match = /^(self|prop|local)\.(.+)$/.exec(name);
    return match ? {scope: match[1], name: match[2], text: name} : {scope: 'global', name, text: name};
};

/**
 * @param {string} text the SVG
 * @returns {?{message: string, line: number}} what is wrong with the SVG as XML
 */
const xmlError = text => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const error = doc.getElementsByTagName('parsererror')[0];
    if (error) {
        const message = error.textContent.replace(/^This page contains the following errors:/, '')
            .replace(/Below is a rendering of the page up to the first error\.?$/, '')
            .trim();
        const match = /line (\d+)/i.exec(message);
        return {message: `SVG 寫錯了：${message}`, line: match ? Number(match[1]) : 0};
    }
    if (!doc.documentElement || doc.documentElement.localName !== 'svg') {
        return {message: '最外層要是 <svg>', line: 1};
    }
    return null;
};

/**
 * The SVG of a costume as code: bindings of any attribute, a preview with the values of the variables (test values
 * while the project isn't running), mistakes on their lines. Valid SVG is saved into the costume as it is typed.
 */
class SvgCodeEditor extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleChange',
            'handleFormat',
            'handleScroll',
            'handleTestValue',
            'handleErrorClick',
            'refresh',
            'setTextarea',
            'setGutter'
        ]);
        const original = props.vm.getCostume(props.costumeIndex) || '';
        // SVG from the paint editor is one long line; lay it out so it can be edited
        const text = needsFormat(original) && !xmlError(original) ? formatSvg(original) : original;
        this.state = Object.assign({text, testValues: {}, preview: null}, this.analyze(text));
        this.saveTimeout = text === original ? null : setTimeout(() => this.save(), SAVE_DELAY);
    }
    componentDidMount () {
        this.updatePreview();
        // Values of variables change while the project runs
        this.interval = setInterval(this.refresh, 500);
    }
    componentWillUnmount () {
        clearInterval(this.interval);
        this.flush();
    }
    analyze (text) {
        const errors = [];
        const xml = xmlError(text);
        if (xml) errors.push(xml);
        let vars = [];
        try {
            const scan = scanSvgBindings(text);
            errors.push(...scan.errors);
            const names = [];
            for (const binding of scan.bindings) {
                for (const tree of binding.trees) {
                    for (const node of pathsOf(tree)) {
                        if (!names.includes(node.text)) names.push(node.text);
                    }
                }
            }
            vars = names;
        } catch (e) {
            errors.push({message: String(e && e.message), line: 0});
        }
        return {errors, vars, xmlOk: !xml};
    }
    target () {
        return this.props.vm.runtime.getTargetById(this.props.targetId);
    }
    running () {
        return this.props.vm.runtime.isGameRunning();
    }
    read (node) {
        const target = this.target();
        if (!this.running() && Object.prototype.hasOwnProperty.call(this.state.testValues, node.text)) {
            const value = this.state.testValues[node.text];
            return value === '' || isNaN(Number(value)) ? value : Number(value);
        }
        return target ? readPath(target, node) : '';
    }
    updatePreview () {
        if (!this.state.xmlOk) return;
        let svg;
        try {
            const template = new Template(this.state.text);
            svg = template.bound ? template.render(template.evaluate(node => this.read(node), null)) : this.state.text;
        } catch (e) {
            return;
        }
        const preview = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
        if (preview !== this.state.preview) this.setState({preview});
    }
    refresh () {
        this.updatePreview();
        this.forceUpdate();
    }
    save () {
        this.saveTimeout = null;
        if (!this.state.xmlOk) return;
        const vm = this.props.vm;
        const target = this.target();
        if (!target) return;
        const costume = target.getCostumes()[this.props.costumeIndex];
        if (!costume || this.state.text === vm.getCostume(this.props.costumeIndex)) return;
        // The rotation center stays where it is
        vm.updateSvg(this.props.costumeIndex, this.state.text, costume.rotationCenterX, costume.rotationCenterY);
    }
    flush () {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.save();
        }
    }
    handleChange (e) {
        const text = e.target.value;
        this.setState(Object.assign({text}, this.analyze(text)), () => this.updatePreview());
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => this.save(), SAVE_DELAY);
    }
    handleFormat () {
        if (!this.state.xmlOk) return;
        const text = formatSvg(this.state.text);
        if (text === this.state.text) return;
        this.setState(Object.assign({text}, this.analyze(text)), () => this.updatePreview());
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => this.save(), SAVE_DELAY);
    }
    handleScroll () {
        if (this.gutter && this.textarea) this.gutter.scrollTop = this.textarea.scrollTop;
    }
    handleTestValue (e) {
        const name = e.target.dataset.name;
        const testValues = Object.assign({}, this.state.testValues, {[name]: e.target.value});
        this.setState({testValues}, () => this.updatePreview());
    }
    handleErrorClick (e) {
        const line = Number(e.currentTarget.dataset.line);
        if (!line || !this.textarea) return;
        const lines = this.state.text.split('\n');
        let offset = 0;
        for (let i = 0; i < line - 1 && i < lines.length; i++) offset += lines[i].length + 1;
        this.textarea.focus();
        this.textarea.setSelectionRange(offset, offset + (lines[line - 1] || '').length);
    }
    setTextarea (el) {
        this.textarea = el;
    }
    setGutter (el) {
        this.gutter = el;
    }
    render () {
        const {text, errors, vars, preview, testValues} = this.state;
        const lineCount = text.split('\n').length;
        const errorLines = new Set(errors.map(e => e.line));
        const running = this.running();
        const target = this.target();
        const gutter = [];
        for (let i = 1; i <= lineCount; i++) {
            gutter.push(
                <span
                    className={errorLines.has(i) ? styles.gutterError : null}
                    key={i}
                >{`${i}\n`}</span>
            );
        }
        return (
            <div className={styles.editor}>
                <div className={styles.codeColumn}>
                    <button
                        className={styles.formatButton}
                        disabled={!this.state.xmlOk}
                        title={'一個標籤一行、加縮排'}
                        type="button"
                        onClick={this.handleFormat}
                    >{'自動排版'}</button>
                    <div className={styles.code}>
                        <div
                            className={styles.gutter}
                            ref={this.setGutter}
                        >{gutter}</div>
                        <textarea
                            className={styles.textarea}
                            ref={this.setTextarea}
                            spellCheck={false}
                            value={text}
                            onChange={this.handleChange}
                            onScroll={this.handleScroll}
                        />
                    </div>
                    {errors.length ? (
                        <div className={styles.errors}>
                            {errors.map((error, i) => (
                                <div
                                    className={styles.error}
                                    data-line={error.line}
                                    key={i}
                                    onClick={this.handleErrorClick}
                                >
                                    {error.line ? `第 ${error.line} 行：${error.message}` : error.message}
                                </div>
                            ))}
                            {!this.state.xmlOk && preview ? (
                                <div className={styles.hint}>{'預覽維持上一次成功的結果，造型也還沒存。'}</div>
                            ) : null}
                        </div>
                    ) : null}
                </div>
                <div className={styles.previewColumn}>
                    <div className={styles.heading}>{'預覽'}</div>
                    <div className={styles.preview}>
                        {preview ? (
                            <img
                                alt=""
                                className={styles.previewImage}
                                draggable={false}
                                src={preview}
                            />
                        ) : null}
                    </div>
                    <div className={styles.heading}>{running ? '用到的變數（專案在跑，用實際的值）' : '用到的變數（測試值）'}</div>
                    <div className={styles.vars}>
                        {vars.length ? vars.map(name => {
                            const actual = target ? readPath(target, pathNode(name)) : '';
                            const shown = typeof actual === 'object' ? JSON.stringify(actual) : String(actual);
                            return (
                                <label
                                    className={styles.var}
                                    key={name}
                                >
                                    <span
                                        className={styles.varName}
                                        title={name}
                                    >{name}</span>
                                    <input
                                        className={styles.varInput}
                                        data-name={name}
                                        disabled={running}
                                        placeholder={shown}
                                        value={running ? shown : (testValues[name] || '')}
                                        onChange={this.handleTestValue}
                                    />
                                </label>
                            );
                        }) : (
                            <div className={styles.hint}>
                                {'還沒有綁定。在文字或屬性裡寫 {變數}，例如 height="{min(燃料, 100) / 10}"。'}
                            </div>
                        )}
                    </div>
                    <div className={styles.hint}>
                        {'空的測試值用現在的值。{分數:00000} 補零、{時間:0.0} 小數、{比例:0%} 百分比；{{ 是大括號。不能綁 href、on…、style。'}
                    </div>
                </div>
            </div>
        );
    }
}

SvgCodeEditor.propTypes = {
    costumeIndex: PropTypes.number.isRequired,
    targetId: PropTypes.string.isRequired,
    vm: PropTypes.shape({
        getCostume: PropTypes.func,
        updateSvg: PropTypes.func,
        runtime: PropTypes.object // eslint-disable-line react/forbid-prop-types
    }).isRequired
};

export default SvgCodeEditor;

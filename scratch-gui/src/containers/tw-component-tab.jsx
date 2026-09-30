/* eslint-disable react/jsx-no-bind */
import bindAll from 'lodash.bindall';
import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';

import styles from '../components/tw-component-tab/component-tab.css';

const TYPES = [
    ['string', '文字'],
    ['number', '數字'],
    ['boolean', '真假'],
    ['color', '顏色'],
    ['menu', '選單']
];

/**
 * @param {string} type the type of a property
 * @returns {Array<Array<string>>} the types to pick from: the usual ones, and this one if it is another
 */
const typeOptions = type => (TYPES.some(item => item[0] === type) ? TYPES : TYPES.concat([[type, type]]));

/**
 * @param {string} proccode words and %s / %b of an output
 * @param {Array<{id: string, name: string}>} params its arguments
 * @param {object} values by id of the argument
 * @returns {string} the words with the values in place of the arguments, "被點擊 次數 [7] 開啟 [true]"
 */
const fillOutput = (proccode, params, values) => {
    let index = 0;
    return proccode.replace(/(^|[^\\])%[snb]/g, (match, before) => {
        const param = params[index++];
        const value = param ? values[param.id] : '';
        return `${before}[${typeof value === 'boolean' ? (value ? '真' : '假') : String(value)}]`;
    }).replace(/\\%/g, '%');
};

/**
 * @param {string} proccode words and %s / %b of a custom block
 * @returns {string} the words with ( ) for the arguments
 */
const label = proccode => proccode.replace(/(^|[^\\])%[snb]/g, '$1( )').replace(/\\%/g, '%');

/**
 * An editor for one value of a property: a text, a number, a switch, a color or a menu.
 * @param {object} props {prop: its definition, value, options: the menu if it has one, onChange(value)}
 * @returns {object} the editor
 */
const ValueInput = ({prop, value, options, onChange}) => {
    if (prop.type === 'boolean') {
        return (
            <select
                className={styles.field}
                value={String(!!value)}
                onChange={e => onChange(e.target.value === 'true')}
            >
                <option value="true">{'是'}</option>
                <option value="false">{'否'}</option>
            </select>
        );
    }
    if (options) {
        const current = String(value);
        const list = options.includes(current) ? options : [current].concat(options);
        return (
            <select
                className={styles.field}
                value={current}
                onChange={e => onChange(e.target.value)}
            >
                {list.map(item => (
                    <option
                        key={item}
                        value={item}
                    >{item}</option>
                ))}
            </select>
        );
    }
    if (prop.type === 'color') {
        return (
            <input
                className={styles.color}
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : '#000000'}
                onChange={e => onChange(e.target.value)}
            />
        );
    }
    return (
        <input
            className={styles.field}
            defaultValue={String(value)}
            key={String(value)}
            type={prop.type === 'number' ? 'number' : 'text'}
            onBlur={e => {
                if (e.target.value !== String(value)) onChange(e.target.value);
            }}
            onKeyDown={e => {
                if (e.key === 'Enter') e.target.blur();
            }}
        />
    );
};

ValueInput.propTypes = {
    onChange: PropTypes.func.isRequired,
    options: PropTypes.arrayOf(PropTypes.string),
    prop: PropTypes.shape({type: PropTypes.string}).isRequired,
    value: PropTypes.oneOfType([PropTypes.string, PropTypes.number, PropTypes.bool])
};

/**
 * The 元件 tab (ROADMAP.md 階段 10). For an instance of a component in the project: the values of its properties
 * (the ones that are not the default). On the page of a component: the properties of the component (name, type,
 * default value) with the values the test uses, the inputs to try and the log of what it says, and starting it again.
 */
class ComponentTab extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['refresh', 'handleOutput', 'handleClearLog', 'handleReset', 'handleAddProp', 'handleName',
            'handleNewType']);
        this.state = {log: [], inputs: {}, results: {}, newName: '', newType: 'string'};
    }
    componentDidMount () {
        const {vm} = this.props;
        vm.on('targetsUpdate', this.refresh);
        vm.on('componentPageChanged', this.refresh);
        vm.runtime.on('COMPONENT_OUTPUT', this.handleOutput);
    }
    componentWillUnmount () {
        const {vm} = this.props;
        vm.removeListener('targetsUpdate', this.refresh);
        vm.removeListener('componentPageChanged', this.refresh);
        vm.runtime.removeListener('COMPONENT_OUTPUT', this.handleOutput);
    }
    refresh () {
        this.forceUpdate();
    }
    handleOutput ({instance, output, args}) {
        const page = this.props.vm.runtime.components.page;
        if (!page || instance !== page.preview) return;
        const now = new Date();
        const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
            .map(n => String(n).padStart(2, '0')).join(':');
        this.setState(state => ({
            log: state.log.concat([{time, text: fillOutput(output.proccode, output.params, args)}]).slice(-200)
        }));
    }
    handleClearLog () {
        this.setState({log: []});
    }
    handleReset () {
        this.props.vm.resetComponentPage();
        this.setState({log: [], results: {}});
    }
    handleName (e) {
        this.setState({newName: e.target.value});
    }
    handleNewType (e) {
        this.setState({newType: e.target.value});
    }
    handleAddProp () {
        const name = this.state.newName.trim();
        const preview = this.props.vm.runtime.components.page.preview;
        if (!name) return;
        if (!this.props.vm.editComponentProp(preview.id, 'add', {name, type: this.state.newType})) {
            // eslint-disable-next-line no-alert
            window.alert(`已經有叫「${name}」的屬性了`);
            return;
        }
        this.setState({newName: ''});
    }
    runInput (input) {
        const values = this.state.inputs[input.id] || {};
        const call = {};
        input.argumentIds.forEach((id, index) => {
            const raw = values[id];
            const type = (input.proccode.match(/(^|[^\\])%[snb]/g) || [])[index];
            call[id] = type && type.endsWith('b') ? raw === true : (typeof raw === 'undefined' ? '' : raw);
        });
        this.props.vm.runComponentInput(input.id, call).then(result => {
            if (input.returns) {
                this.setState(state => ({results: Object.assign({}, state.results, {[input.id]: result})}));
            }
        });
    }
    setInput (inputId, argumentId, value) {
        this.setState(state => ({
            inputs: Object.assign({}, state.inputs, {
                [inputId]: Object.assign({}, state.inputs[inputId], {[argumentId]: value})
            })
        }));
    }
    optionsOf (prop, target) {
        switch (prop.type) {
        case 'menu': return prop.options || [];
        case 'costume': return target ? target.getCostumes().map(c => c.name) : [];
        case 'sound': return target ? target.getSounds().map(s => s.name) : [];
        case 'sprite': return this.props.vm.runtime.targets.filter(t => t.isOriginal && !t.isStage && !t.isPreview)
            .map(t => t.getName());
        default: return null;
        }
    }
    renderInstanceValues (holder) {
        const {vm} = this.props;
        const components = vm.runtime.components;
        const props = holder.sprite.component.props;
        return (
            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                    {`「${holder.getName()}」的屬性值`}
                    <span className={styles.sectionNote}>
                        {`元件「${holder.sprite.name}」的每個實體各有一份；和預設值一樣的不會存進檔案`}
                    </span>
                </h3>
                {props.length ? (
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>{'屬性'}</th>
                                <th>{'值'}</th>
                                <th>{'預設'}</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {props.map(prop => {
                                const value = components.getProp(holder, prop.name);
                                const bound = holder.propBindings && holder.propBindings.has(prop.name);
                                return (
                                    <tr key={prop.name}>
                                        <td>{prop.name}</td>
                                        <td>
                                            {bound ? (
                                                <span
                                                    className={styles.result}
                                                    title="這個屬性綁在外面元件的屬性上，值由外面給"
                                                >{`${holder.propBindings.get(prop.name)}`}</span>
                                            ) : (
                                                <ValueInput
                                                    options={this.optionsOf(prop, holder)}
                                                    prop={prop}
                                                    value={value}
                                                    onChange={v => vm.setComponentProp(holder.id, prop.name, v)}
                                                />
                                            )}
                                        </td>
                                        <td className={styles.result}>{String(prop.default)}</td>
                                        <td>
                                            {value !== prop.default && !bound ? (
                                                <button
                                                    className={styles.button}
                                                    onClick={() => vm.setComponentProp(holder.id, prop.name)}
                                                >{'回到預設'}</button>
                                            ) : null}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                ) : (
                    <div className={styles.empty}>
                        {'這個元件還沒有屬性。進入元件（右鍵「進入元件」）後可以新增。'}
                    </div>
                )}
            </div>
        );
    }
    renderInputs (preview, info) {
        return (
            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                    {'輸入'}
                    <span className={styles.sectionNote}>{'外面的積木可以呼叫的（公開的自訂積木）；在這裡試試看'}</span>
                </h3>
                {info.inputs.length ? info.inputs.map(input => {
                    const values = this.state.inputs[input.id] || {};
                    const types = (input.proccode.match(/(^|[^\\])%[snb]/g) || []).map(m => m.slice(-1));
                    return (
                        <div
                            className={styles.inputRow}
                            key={input.id}
                        >
                            <span className={styles.inputLabel}>{label(input.proccode)}</span>
                            {input.argumentIds.map((id, index) => (
                                <label
                                    className={styles.arg}
                                    key={id}
                                >
                                    {input.argumentNames[index]}
                                    {types[index] === 'b' ? (
                                        <input
                                            checked={values[id] === true}
                                            type="checkbox"
                                            onChange={e => this.setInput(input.id, id, e.target.checked)}
                                        />
                                    ) : (
                                        <input
                                            className={styles.field}
                                            type="text"
                                            value={typeof values[id] === 'undefined' ? '' : String(values[id])}
                                            onChange={e => this.setInput(input.id, id, e.target.value)}
                                        />
                                    )}
                                </label>
                            ))}
                            <button
                                className={classNames(styles.button, styles.buttonPrimary)}
                                onClick={() => this.runInput(input)}
                            >{input.returns ? '取值' : '執行'}</button>
                            {input.returns && typeof this.state.results[input.id] !== 'undefined' ? (
                                <span className={styles.result}>{`→ ${String(this.state.results[input.id])}`}</span>
                            ) : null}
                        </div>
                    );
                }) : (
                    <div className={styles.empty}>
                        {'沒有輸入。在「建立一個積木」選「輸入」，或右鍵自訂積木的定義選「公開給其他角色」。'}
                    </div>
                )}
            </div>
        );
    }
    renderOutputs (info) {
        return (
            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                    {'輸出紀錄'}
                    <span className={styles.sectionNote}>
                        {info.outputs.length ? `這個元件會說：${info.outputs.map(o => label(o.proccode)).join('、')}` :
                            '還沒有輸出。在「元件」分類按「建立一個輸出」。'}
                    </span>
                    <span className={styles.spacer} />
                    <button
                        className={styles.button}
                        onClick={this.handleClearLog}
                    >{'清除'}</button>
                </h3>
                <div className={styles.log}>
                    {this.state.log.length ? this.state.log.map((line, index) => (
                        <div
                            className={styles.logLine}
                            key={index}
                        >
                            <span className={styles.logTime}>{line.time}</span>
                            {line.text}
                        </div>
                    )) : <div className={styles.empty}>{'（還沒有輸出）'}</div>}
                </div>
            </div>
        );
    }
    renderProps (preview) {
        const {vm} = this.props;
        const components = vm.runtime.components;
        const props = preview.sprite.component.props;
        const edit = (name, action, value) => vm.editComponentProp(preview.id, action, name, value);
        return (
            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                    {'屬性'}
                    <span className={styles.sectionNote}>
                        {'元件的變數（元件裡的 global.名稱），開放給外面設定。預設值存在元件裡；測試值只有這一頁用'}
                    </span>
                </h3>
                {props.length ? (
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>{'名稱'}</th>
                                <th>{'類型'}</th>
                                <th>{'預設值'}</th>
                                <th>{'測試值'}</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {props.map(prop => (
                                <tr key={prop.name}>
                                    <td>
                                        <input
                                            className={styles.field}
                                            defaultValue={prop.name}
                                            key={prop.name}
                                            onBlur={e => {
                                                const name = e.target.value.trim();
                                                if (name && name !== prop.name && !edit(prop.name, 'rename', name)) {
                                                    e.target.value = prop.name;
                                                }
                                            }}
                                        />
                                    </td>
                                    <td>
                                        <select
                                            className={styles.field}
                                            value={prop.type}
                                            onChange={e => edit(prop.name, 'update', {type: e.target.value})}
                                        >
                                            {typeOptions(prop.type).map(([value, text]) => (
                                                <option
                                                    key={value}
                                                    value={value}
                                                >{text}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td>
                                        <ValueInput
                                            options={this.optionsOf(prop, preview)}
                                            prop={prop}
                                            value={prop.default}
                                            onChange={v => edit(prop.name, 'update', {default: v})}
                                        />
                                    </td>
                                    <td>
                                        <ValueInput
                                            options={this.optionsOf(prop, preview)}
                                            prop={prop}
                                            value={components.getProp(preview, prop.name)}
                                            onChange={v => vm.setComponentProp(preview.id, prop.name, v)}
                                        />
                                    </td>
                                    <td>
                                        <button
                                            className={classNames(styles.button, styles.buttonDanger)}
                                            title="刪掉這個屬性（用它的積木會留著，但什麼也不做）"
                                            onClick={() => edit(prop.name, 'remove')}
                                        >{'刪除'}</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : <div className={styles.empty}>{'還沒有屬性。'}</div>}
                <div className={styles.addRow}>
                    <input
                        className={styles.field}
                        placeholder="新屬性的名稱"
                        value={this.state.newName}
                        onChange={this.handleName}
                        onKeyDown={e => {
                            if (e.key === 'Enter') this.handleAddProp();
                        }}
                    />
                    <select
                        className={styles.field}
                        style={{width: '5rem'}}
                        value={this.state.newType}
                        onChange={this.handleNewType}
                    >
                        {TYPES.map(([value, text]) => (
                            <option
                                key={value}
                                value={value}
                            >{text}</option>
                        ))}
                    </select>
                    <button
                        className={styles.button}
                        onClick={this.handleAddProp}
                    >{'新增屬性'}</button>
                </div>
            </div>
        );
    }
    render () {
        const {vm} = this.props;
        const components = vm.runtime.components;
        const page = components.page;
        if (page) {
            const preview = page.preview;
            const info = vm.getComponentInterface(preview.id);
            return (
                <div className={styles.tab}>
                    <div className={styles.section}>
                        <h3 className={styles.sectionTitle}>
                            {`元件「${preview.sprite.name}」的測試`}
                            <span className={styles.sectionNote}>
                                {'這一頁的元件是一份不存檔的複本，專案不會動；它在原點，按綠旗會重新開始'}
                            </span>
                            <span className={styles.spacer} />
                            <button
                                className={classNames(styles.button, styles.buttonPrimary)}
                                onClick={this.handleReset}
                            >{'重設'}</button>
                        </h3>
                    </div>
                    {this.renderInputs(preview, info)}
                    {this.renderOutputs(info)}
                    {this.renderProps(preview)}
                </div>
            );
        }
        const holder = components.holderOf(vm.editingTarget);
        if (!holder) return <div className={styles.tab}><div className={styles.empty}>{'這個角色不是元件'}</div></div>;
        return <div className={styles.tab}>{this.renderInstanceValues(holder)}</div>;
    }
}

ComponentTab.propTypes = {
    vm: PropTypes.object.isRequired // eslint-disable-line react/forbid-prop-types
};

export default ComponentTab;

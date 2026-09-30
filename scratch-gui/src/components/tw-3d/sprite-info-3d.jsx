import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import Popover from 'react-popover';

import Box from '../box/box.jsx';
import Input from '../forms/input.jsx';
import BufferedInputHOC from '../forms/buffered-input-hoc.jsx';
import ToggleButtons from '../toggle-buttons/toggle-buttons.jsx';
import RotationPicker from './rotation-picker.jsx';

import styles from './sprite-info-3d.css';

import showIcon from '!../../lib/tw-recolor/build!../sprite-info/icon--show.svg';
import hideIcon from '!../../lib/tw-recolor/build!../sprite-info/icon--hide.svg';

const BufferedInput = BufferedInputHOC(Input);

const AXES = ['x', 'y', 'z'];

/**
 * 3D units are small (a basic shape is 1 wide), so values are shown with 2 decimals.
 * @param {number} value value to show
 * @returns {number} rounded value
 */
const round = value => Math.round((Number(value) || 0) * 100) / 100;

const ROTATION_FIELDS = ['rotationX', 'rotationY', 'rotationZ'];

// What the mouse does at the sprite (RenderedTarget.mouseMode in the VM)
const MOUSE_MODE_TITLES = {
    auto: '滑鼠：自動判斷。有點擊或滑鼠積木、或看得見且參與碰撞的角色會擋住滑鼠；其他（例如不參與碰撞的裝飾）讓滑鼠穿過',
    pass: '滑鼠：穿過。點擊和滑鼠會穿過這個角色，找到後面的角色；它自己的點擊和滑鼠積木不會觸發',
    block: '滑鼠：停在。這個角色可以被點擊，也會擋住後面的角色'
};

const FIELDS = ['x', 'y', 'z', 'rotationX', 'rotationY', 'rotationZ', 'scaleX', 'scaleY', 'scaleZ', 'fov'];

/**
 * The sprite info panel of 3D sprites: name, position, rotation, scale, visibility and what the mouse does at it.
 * Camera sprites have a field of view instead of scale, visibility and the mouse, and can be made the current camera.
 */
class SpriteInfo3D extends React.Component {
    constructor (props) {
        super(props);
        this.state = {
            // Scale all axes together
            scaleLocked: true,
            // The rotation dial, opened by focusing a rotation input
            rotationPopoverOpen: false,
            rotationAxis: 'rotationY'
        };
        this.handleCloseRotationPopover = this.handleCloseRotationPopover.bind(this);
        this.handleSelectRotationAxis = this.handleSelectRotationAxis.bind(this);
        this.handleChangeRotation = this.handleChangeRotation.bind(this);
        this.handleFocusField = {};
        for (const field of ROTATION_FIELDS) {
            this.handleFocusField[field] = () => this.setState({rotationPopoverOpen: true, rotationAxis: field});
        }
        this.handleToggleLock = this.handleToggleLock.bind(this);
        this.handleClickVisible = this.handleClickVisible.bind(this);
        this.handleClickNotVisible = this.handleClickNotVisible.bind(this);
        this.handleChangeMouseMode = this.handleChangeMouseMode.bind(this);
        this.handleMakeActive = this.handleMakeActive.bind(this);
        this.handleSubmitField = {};
        for (const field of FIELDS) {
            this.handleSubmitField[field] = value => this.handleSubmit(field, value);
        }
    }
    shouldComponentUpdate (nextProps, nextState) {
        if (
            this.state !== nextState ||
            this.props.disabled !== nextProps.disabled ||
            this.props.name !== nextProps.name ||
            this.props.visible !== nextProps.visible ||
            this.props.mouseMode !== nextProps.mouseMode ||
            this.props.isCamera !== nextProps.isCamera ||
            this.props.active !== nextProps.active
        ) return true;
        // Only update when a shown (rounded) value changed
        return FIELDS.some(field => round(this.props[field]) !== round(nextProps[field]));
    }
    handleSubmit (field, value) {
        if (!Number.isFinite(value)) return;
        if (field.startsWith('scale') && this.state.scaleLocked) {
            const old = this.props[field];
            if (old === 0) {
                this.props.onChange({scaleX: value, scaleY: value, scaleZ: value});
                return;
            }
            const ratio = value / old;
            this.props.onChange({
                scaleX: this.props.scaleX * ratio,
                scaleY: this.props.scaleY * ratio,
                scaleZ: this.props.scaleZ * ratio
            });
            return;
        }
        this.props.onChange({[field]: value});
    }
    handleCloseRotationPopover () {
        this.setState({rotationPopoverOpen: false});
    }
    handleSelectRotationAxis (field) {
        this.setState({rotationAxis: field});
    }
    handleChangeRotation (field, value) {
        this.props.onChange({[field]: value});
    }
    handleMakeActive () {
        this.props.onChange({active: true});
    }
    handleToggleLock () {
        this.setState(state => ({scaleLocked: !state.scaleLocked}));
    }
    handleClickVisible (e) {
        e.preventDefault();
        this.props.onChange({visible: true});
    }
    handleClickNotVisible (e) {
        e.preventDefault();
        this.props.onChange({visible: false});
    }
    handleChangeMouseMode (e) {
        this.props.onChange({mouseMode: e.target.value});
    }
    renderVector (label, fields, extra) {
        return (
            <div className={styles.row}>
                <span className={styles.rowLabel}>{label}</span>
                {fields.map((field, i) => (
                    <label
                        className={styles.axis}
                        key={field}
                    >
                        <span className={classNames(styles.axisLabel, styles[`axis${AXES[i].toUpperCase()}`])}>
                            {AXES[i]}
                        </span>
                        <BufferedInput
                            disabled={this.props.disabled}
                            tabIndex="0"
                            type="number"
                            step="any"
                            value={this.props.disabled ? '' : round(this.props[field])}
                            onFocus={this.handleFocusField[field]}
                            onSubmit={this.handleSubmitField[field]}
                        />
                    </label>
                ))}
                {extra || <span className={styles.lockSpacer} />}
            </div>
        );
    }
    renderRotation () {
        return (
            <Popover
                body={
                    <RotationPicker
                        axis={this.state.rotationAxis}
                        rotationX={this.props.rotationX}
                        rotationY={this.props.rotationY}
                        rotationZ={this.props.rotationZ}
                        onChange={this.handleChangeRotation}
                        onSelectAxis={this.handleSelectRotationAxis}
                    />
                }
                isOpen={this.state.rotationPopoverOpen && !this.props.disabled}
                preferPlace="above"
                onOuterAction={this.handleCloseRotationPopover}
            >
                {this.renderVector('旋轉', ROTATION_FIELDS)}
            </Popover>
        );
    }
    renderCamera () {
        const {active, disabled} = this.props;
        return (
            <Box className={styles.spriteInfo}>
                <div className={styles.row}>
                    <span className={styles.rowLabel}>{'相機'}</span>
                    <BufferedInput
                        className={styles.nameInput}
                        disabled={disabled}
                        placeholder="名稱"
                        tabIndex="0"
                        type="text"
                        value={disabled ? '' : this.props.name}
                        onSubmit={this.props.onChangeName}
                    />
                    {active ? (
                        <span
                            className={styles.activeCamera}
                            title="舞台顯示這台相機看到的畫面"
                        >
                            {'目前的相機'}
                        </span>
                    ) : (
                        <button
                            className={styles.makeActive}
                            disabled={disabled}
                            title="讓舞台顯示這台相機看到的畫面"
                            onClick={this.handleMakeActive}
                        >
                            {'設為目前的相機'}
                        </button>
                    )}
                </div>
                {this.renderVector('位置', ['x', 'y', 'z'])}
                {this.renderRotation()}
                <div className={styles.row}>
                    <span className={styles.rowLabel}>{'視野'}</span>
                    <label className={styles.axis}>
                        <BufferedInput
                            disabled={disabled}
                            tabIndex="0"
                            type="number"
                            step="any"
                            min="1"
                            max="179"
                            value={disabled ? '' : round(this.props.fov)}
                            onSubmit={this.handleSubmitField.fov}
                        />
                    </label>
                    <span className={styles.unit}>{'度'}</span>
                    <span className={styles.fovSpacer} />
                </div>
            </Box>
        );
    }
    render () {
        const {disabled} = this.props;
        const mouseMode = this.props.mouseMode || 'auto';
        const lock = (
            <button
                className={classNames(styles.lock, {[styles.lockActive]: this.state.scaleLocked})}
                disabled={disabled}
                title={this.state.scaleLocked ? '等比例縮放：開' : '等比例縮放：關'}
                onClick={this.handleToggleLock}
            >
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    aria-hidden="true"
                >
                    <g
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                    >
                        <rect
                            x="2.5"
                            y="6.5"
                            width="9"
                            height="6"
                            rx="1"
                        />
                        <path
                            d={this.state.scaleLocked ?
                                'M4.5 6.5V4.5a2.5 2.5 0 0 1 5 0v2' :
                                'M4.5 6.5V4.5a2.5 2.5 0 0 1 5 0'}
                        />
                    </g>
                </svg>
            </button>
        );
        if (this.props.isCamera) return this.renderCamera();
        return (
            <Box className={styles.spriteInfo}>
                <div className={styles.row}>
                    <span className={styles.rowLabel}>{'角色'}</span>
                    <BufferedInput
                        className={styles.nameInput}
                        disabled={disabled}
                        placeholder="名稱"
                        tabIndex="0"
                        type="text"
                        value={disabled ? '' : this.props.name}
                        onSubmit={this.props.onChangeName}
                    />
                    <ToggleButtons
                        className={styles.visibility}
                        buttons={[
                            {
                                handleClick: this.handleClickVisible,
                                icon: showIcon,
                                isSelected: this.props.visible && !disabled,
                                title: '顯示角色'
                            },
                            {
                                handleClick: this.handleClickNotVisible,
                                icon: hideIcon,
                                isSelected: !this.props.visible && !disabled,
                                title: '隱藏角色'
                            }
                        ]}
                        disabled={disabled}
                    />
                    <select
                        className={styles.mouseMode}
                        disabled={disabled}
                        title={MOUSE_MODE_TITLES[mouseMode]}
                        value={mouseMode}
                        onChange={this.handleChangeMouseMode}
                    >
                        <option value="auto">{'滑鼠：自動'}</option>
                        <option value="pass">{'滑鼠：穿過'}</option>
                        <option value="block">{'滑鼠：停在'}</option>
                    </select>
                </div>
                {this.renderVector('位置', ['x', 'y', 'z'])}
                {this.renderRotation()}
                {this.renderVector('縮放', ['scaleX', 'scaleY', 'scaleZ'], lock)}
            </Box>
        );
    }
}

SpriteInfo3D.propTypes = {
    active: PropTypes.bool,
    disabled: PropTypes.bool,
    fov: PropTypes.number, // eslint-disable-line react/no-unused-prop-types
    isCamera: PropTypes.bool,
    mouseMode: PropTypes.oneOf(['auto', 'pass', 'block']),
    name: PropTypes.string,
    onChange: PropTypes.func.isRequired,
    onChangeName: PropTypes.func.isRequired,
    /* eslint-disable react/no-unused-prop-types */
    rotationX: PropTypes.number,
    rotationY: PropTypes.number,
    rotationZ: PropTypes.number,
    scaleX: PropTypes.number,
    scaleY: PropTypes.number,
    scaleZ: PropTypes.number,
    x: PropTypes.number,
    y: PropTypes.number,
    z: PropTypes.number,
    /* eslint-enable react/no-unused-prop-types */
    visible: PropTypes.bool
};

export default SpriteInfo3D;

import bindAll from 'lodash.bindall';
import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import ReactTooltip from 'react-tooltip';
import VM from 'scratch-vm';

import styles from '../components/tw-3d/stage-3d-toolbar.css';
import PerformancePanel from '../components/tw-3d/performance-panel.jsx';

/* eslint-disable react/jsx-no-literals */
// 16×16 line icons, drawn with the button's text color
const icon = paths => (
    <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        aria-hidden="true"
    >
        <g
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            {paths}
        </g>
    </svg>
);

const ICONS = {
    // Orbiting eye: the editor's free camera
    editorView: icon([
        <path
            key="a"
            d="M1.5 8s2.5-4.5 6.5-4.5 6.5 4.5 6.5 4.5-2.5 4.5-6.5 4.5S1.5 8 1.5 8z"
        />,
        <circle
            key="b"
            cx="8"
            cy="8"
            r="2"
        />
    ]),
    camera: icon([
        <rect
            key="a"
            x="1.5"
            y="4.5"
            width="9"
            height="7"
            rx="1"
        />,
        <path
            key="b"
            d="M10.5 7l4-2v6l-4-2"
        />
    ]),
    // Look from where the camera is
    lookFromCamera: icon([
        <rect
            key="a"
            x="1.5"
            y="4.5"
            width="9"
            height="7"
            rx="1"
        />,
        <path
            key="b"
            d="M10.5 7l4-2v6l-4-2"
        />,
        <circle
            key="c"
            cx="6"
            cy="8"
            r="1.25"
        />
    ]),
    // Move the camera here
    cameraHere: icon([
        <path
            key="a"
            d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3"
        />,
        <circle
            key="b"
            cx="8"
            cy="8"
            r="3"
        />
    ]),
    addCamera: icon([
        <rect
            key="a"
            x="1.5"
            y="4.5"
            width="9"
            height="7"
            rx="1"
        />,
        <path
            key="b"
            d="M10.5 7l4-2v6l-4-2M6 6v4M4 8h4"
        />
    ]),
    translate: icon(
        <path d="M8 1.5v13M1.5 8h13M6 3.5l2-2 2 2M6 12.5l2 2 2-2M3.5 6l-2 2 2 2M12.5 6l2 2-2 2" />
    ),
    rotate: icon(
        <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M12.5 1.5v3h-3" />
    ),
    scale: icon([
        <rect
            key="a"
            x="1.5"
            y="7.5"
            width="7"
            height="7"
        />,
        <path
            key="b"
            d="M8 8l6.5-6.5M10 1.5h4.5V6"
        />
    ]),
    grid: icon(
        <path d="M1.5 5.5h13M1.5 10.5h13M5.5 1.5v13M10.5 1.5v13" />
    ),
    // Wireframe cube: colliders
    colliders: icon(
        <path d="M8 1.5l5.5 3v7L8 14.5l-5.5-3v-7zM2.5 4.5L8 7.5l5.5-3M8 7.5v7" />
    ),
    // Speedometer: the performance panel
    stats: icon(
        <path d="M2.5 12a5.5 5.5 0 1 1 11 0M8 12l2.5-3.5M1.5 12h1M13.5 12h1" />
    )
};
/* eslint-enable react/jsx-no-literals */

const MODES = [
    {mode: 'translate', text: '移動', key: 'G'},
    {mode: 'rotate', text: '旋轉', key: 'R'},
    {mode: 'scale', text: '縮放', key: 'S'}
];

/**
 * Tools for editing 3D sprites on the stage, as icon buttons next to the green flag. Only shown in the editor, once
 * the project has something 3D.
 */
class Stage3DToolbar extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleEditorChanged',
            'handleToggleCamera',
            'handleToggleHelpers',
            'handleToggleColliders',
            'handleToggleStats',
            'handleResetCamera',
            'handleAlignCamera',
            'handleAddCamera'
        ]);
        this.handleSetMode = {};
        for (const {mode} of MODES) {
            this.handleSetMode[mode] = () => this.editor.setMode(mode);
        }
        this.state = this.editor.getState();
    }
    componentDidMount () {
        this.props.vm.on('SCENE3D_EDITOR_CHANGED', this.handleEditorChanged);
        // The stage might have become 3D before this mounted
        this.handleEditorChanged(this.editor.getState());
    }
    componentWillUnmount () {
        this.props.vm.removeListener('SCENE3D_EDITOR_CHANGED', this.handleEditorChanged);
    }
    get editor () {
        return this.props.vm.runtime.scene3D.editor;
    }
    handleEditorChanged (state) {
        this.setState(state);
    }
    handleToggleCamera () {
        this.editor.setUseEditorCamera(!this.state.useEditorCamera);
    }
    handleToggleHelpers () {
        this.editor.setHelpersVisible(!this.state.helpersVisible);
    }
    handleToggleColliders () {
        this.editor.setCollidersVisible(!this.state.collidersVisible);
    }
    handleToggleStats () {
        this.editor.setStatsVisible(!this.state.statsVisible);
    }
    handleResetCamera () {
        this.editor.resetCamera();
    }
    handleAlignCamera () {
        this.editor.alignCameraToView();
    }
    handleAddCamera () {
        // Where the stage looks from now, so that the view doesn't change
        const state = this.props.vm.runtime.scene3D.getCameraState();
        this.props.vm.addCamera({
            position: {x: state.x, y: state.y, z: state.z},
            rotation: {x: state.pitch, y: state.yaw, z: state.roll},
            fov: state.fov
        });
    }
    renderButton (key, title, onClick, selected) {
        // Styled like the tooltips of the "choose a sprite" menu, instead of the browser's slow title tooltip
        const tooltipId = `stage-3d-toolbar-${key}`;
        return (
            <React.Fragment key={key}>
                <button
                    aria-label={title}
                    className={classNames(styles.button, {[styles.selected]: selected})}
                    data-for={tooltipId}
                    data-tip={title}
                    onClick={onClick}
                >
                    {ICONS[key]}
                </button>
                <ReactTooltip
                    className={styles.tooltip}
                    effect="solid"
                    id={tooltipId}
                    place="bottom"
                />
            </React.Fragment>
        );
    }
    renderStatus () {
        if (!this.state.useEditorCamera || !this.state.modal) return null;
        return (
            <div className={styles.status}>
                {this.state.modal}
                <span className={styles.key}>
                    {'X / Y / Z 鎖定軸　Shift 鎖定平面　Ctrl 對齊　左鍵 / Enter 確定　右鍵 / Esc 取消'}
                </span>
            </div>
        );
    }
    render () {
        if (!this.state.available) return null;
        // On the stage: what the G / R / S transform is doing, and the performance panel
        if (this.props.overlay) {
            return (
                <React.Fragment>
                    {this.renderStatus()}
                    {this.state.statsVisible ? (
                        <PerformancePanel scene3D={this.props.vm.runtime.scene3D} />
                    ) : null}
                </React.Fragment>
            );
        }
        const editing = this.state.useEditorCamera;
        return (
            <div className={styles.toolbar}>
                <div className={styles.group}>
                    {this.renderButton(
                        editing ? 'editorView' : 'camera',
                        editing ?
                            '編輯視角（拖曳或觸控板兩指環繞、右鍵或 Shift 拖曳平移、滾輪或兩指捏合縮放）。' +
                            '按一下或滑鼠在舞台上按數字鍵盤 0 切換成目前的相機，按綠旗時也會切換' :
                            '目前的相機。按一下切換成編輯視角',
                        this.handleToggleCamera,
                        editing
                    )}
                    {editing ? this.renderButton(
                        'lookFromCamera',
                        '把編輯視角移到目前的相機的位置',
                        this.handleResetCamera
                    ) : null}
                    {editing ? this.renderButton(
                        'cameraHere',
                        '把目前的相機移到編輯視角的位置（Ctrl + Alt + 數字鍵盤 0）',
                        this.handleAlignCamera
                    ) : null}
                    {this.state.hasCamera ? null : this.renderButton(
                        'addCamera',
                        '沒有相機，舞台用預設相機。按一下在預設相機的位置新增一個相機角色',
                        this.handleAddCamera
                    )}
                </div>
                {editing ? (
                    <div className={styles.group}>
                        {MODES.map(({mode, text, key}) => this.renderButton(
                            mode,
                            `${text}（${key}）：滑鼠在舞台上按 ${key} 跟著滑鼠${text}，Alt + ${key} 重設`,
                            this.handleSetMode[mode],
                            this.state.mode === mode
                        ))}
                    </div>
                ) : null}
                <div className={styles.group}>
                    {editing ? this.renderButton(
                        'grid',
                        '顯示格線和座標軸',
                        this.handleToggleHelpers,
                        this.state.helpersVisible
                    ) : null}
                    {editing ? this.renderButton(
                        'colliders',
                        '顯示碰撞形狀（綠色：運動學、藍色：靜態、橘色：動態）。' +
                            '只有編輯視角看得到，執行中要看的話用物理分類的「顯示碰撞形狀」積木',
                        this.handleToggleColliders,
                        this.state.collidersVisible
                    ) : null}
                    {this.renderButton(
                        'stats',
                        '效能面板：每秒幀數、繪製次數、三角形和物件數量',
                        this.handleToggleStats,
                        this.state.statsVisible
                    )}
                </div>
            </div>
        );
    }
}

Stage3DToolbar.propTypes = {
    // Render the status of the G / R / S transform on the stage, instead of the buttons in the stage header
    overlay: PropTypes.bool,
    vm: PropTypes.instanceOf(VM).isRequired
};

const mapStateToProps = state => ({
    vm: state.scratchGui.vm
});

export default connect(mapStateToProps)(Stage3DToolbar);

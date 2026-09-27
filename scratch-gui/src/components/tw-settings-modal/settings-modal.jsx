import {defineMessages, FormattedMessage, intlShape, injectIntl} from 'react-intl';
import PropTypes from 'prop-types';
import React from 'react';
import classNames from 'classnames';
import bindAll from 'lodash.bindall';
import Box from '../box/box.jsx';
import Modal from '../../containers/modal.jsx';
import FancyCheckbox from '../tw-fancy-checkbox/checkbox.jsx';
import Input from '../forms/input.jsx';
import BufferedInputHOC from '../forms/buffered-input-hoc.jsx';
import DocumentationLink from '../tw-documentation-link/documentation-link.jsx';
import styles from './settings-modal.css';
import helpIcon from './help-icon.svg';
import {APP_NAME} from '../../lib/brand.js';

/* eslint-disable react/no-multi-comp */

const BufferedInput = BufferedInputHOC(Input);

const messages = defineMessages({
    title: {
        defaultMessage: 'Advanced Settings',
        description: 'Title of settings modal',
        id: 'tw.settingsModal.title'
    },
    help: {
        defaultMessage: 'Click for help',
        description: 'Hover text of help icon in settings',
        id: 'tw.settingsModal.help'
    }
});

const LearnMore = props => (
    <React.Fragment>
        {' '}
        <DocumentationLink {...props}>
            <FormattedMessage
                defaultMessage="Learn more."
                id="gui.alerts.cloudInfoLearnMore"
            />
        </DocumentationLink>
    </React.Fragment>
);

class UnwrappedSetting extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleClickHelp'
        ]);
        this.state = {
            helpVisible: false
        };
    }
    componentDidUpdate (prevProps) {
        if (this.props.active && !prevProps.active) {
            // eslint-disable-next-line react/no-did-update-set-state
            this.setState({
                helpVisible: true
            });
        }
    }
    handleClickHelp () {
        this.setState(prevState => ({
            helpVisible: !prevState.helpVisible
        }));
    }
    render () {
        return (
            <div
                className={classNames(styles.setting, {
                    [styles.active]: this.props.active
                })}
            >
                <div className={styles.label}>
                    {this.props.primary}
                    <button
                        className={styles.helpIcon}
                        onClick={this.handleClickHelp}
                        title={this.props.intl.formatMessage(messages.help)}
                    >
                        <img
                            src={helpIcon}
                            draggable={false}
                        />
                    </button>
                </div>
                {this.state.helpVisible && (
                    <div className={styles.detail}>
                        {this.props.help}
                        {this.props.slug && <LearnMore slug={this.props.slug} />}
                    </div>
                )}
                {this.props.secondary}
            </div>
        );
    }
}
UnwrappedSetting.propTypes = {
    intl: intlShape,
    active: PropTypes.bool,
    help: PropTypes.node,
    primary: PropTypes.node,
    secondary: PropTypes.node,
    slug: PropTypes.string
};
const Setting = injectIntl(UnwrappedSetting);

const BooleanSetting = ({value, onChange, label, ...props}) => (
    <Setting
        {...props}
        active={value}
        primary={
            <label className={styles.label}>
                <FancyCheckbox
                    className={styles.checkbox}
                    checked={value}
                    onChange={onChange}
                />
                {label}
            </label>
        }
    />
);
BooleanSetting.propTypes = {
    onChange: PropTypes.func.isRequired,
    value: PropTypes.bool.isRequired,
    label: PropTypes.node.isRequired
};

/* eslint-disable react/jsx-no-literals */
// my-turbowarp: projects run at 60 FPS; 30 saves battery on phones. Saved with the project.
const CustomFPS = props => (
    <BooleanSetting
        value={props.framerate === 30}
        onChange={props.onChange}
        label="30 FPS（省電）"
        help={
            <span>
                {`目前每秒 ${props.framerate || '螢幕更新率'} 幀，預設是 60。改成 30 可以在手機上省電，但畫面比較不流暢。` +
                    '幀率跟著專案存檔。「當每幀」的 dt、物理、動畫和相機跟隨都依時間計算，換幀率速度不變；' +
                    '「重複執行：移動 10 步」這類每幀移動固定距離的寫法，幀率越低就越慢。'}
                <a
                    onClick={props.onCustomizeFramerate}
                    tabIndex="0"
                >
                    設定其他幀率
                </a>
                。
            </span>
        }
        slug="custom-fps"
    />
);
/* eslint-enable react/jsx-no-literals */
CustomFPS.propTypes = {
    framerate: PropTypes.number,
    onChange: PropTypes.func,
    onCustomizeFramerate: PropTypes.func
};

const Interpolation = props => (
    <BooleanSetting
        {...props}
        label={
            <FormattedMessage
                defaultMessage="Interpolation"
                description="Interpolation setting"
                id="tw.settingsModal.interpolation"
            />
        }
        help={
            <FormattedMessage
                // eslint-disable-next-line max-len
                defaultMessage="Makes projects appear smoother by interpolating sprite motion. Interpolation should not be used on 3D projects, raytracers, pen projects, and laggy projects as interpolation will make them run slower without making them appear smoother."
                description="Interpolation setting help"
                id="tw.settingsModal.interpolationHelp"
            />
        }
        slug="interpolation"
    />
);

const WarpTimer = props => (
    <BooleanSetting
        {...props}
        label={
            <FormattedMessage
                defaultMessage="Warp Timer"
                description="Warp Timer setting"
                id="tw.settingsModal.warpTimer"
            />
        }
        help={
            <FormattedMessage
                // eslint-disable-next-line max-len
                defaultMessage="Makes scripts check if they are stuck in a long or infinite loop and run at a low framerate instead of getting stuck until the loop finishes. This fixes most crashes but has a significant performance impact, so it's only enabled by default in the editor."
                description="Warp Timer help"
                id="tw.settingsModal.warpTimerHelp"
            />
        }
        slug="warp-timer"
    />
);

const DisableCompiler = props => (
    <BooleanSetting
        {...props}
        label={
            <FormattedMessage
                defaultMessage="Disable Compiler"
                description="Disable Compiler setting"
                id="tw.settingsModal.disableCompiler"
            />
        }
        help={
            <FormattedMessage
                // eslint-disable-next-line max-len
                defaultMessage="Disables the {APP_NAME} compiler. You may want to enable this while editing projects so that scripts update immediately. Otherwise, you should never enable this."
                description="Disable Compiler help"
                id="tw.settingsModal.disableCompilerHelp"
                values={{
                    APP_NAME
                }}
            />
        }
        slug="disable-compiler"
    />
);

/* eslint-disable react/jsx-no-literals */
const SCREEN_MODES = [
    {value: 'height', label: '固定高度（寬度跟著螢幕）'},
    {value: 'width', label: '固定寬度（高度跟著螢幕，直式遊戲）'},
    {value: 'expand', label: '延伸（參考大小一定完整看得到）'},
    {value: 'fixed', label: '固定（補黑邊）'}
];
const RENDER_SCALES = [1, 0.75, 0.5, 0.25];
const SHADOW_QUALITIES = [
    {value: 'high', label: '高'},
    {value: 'low', label: '低'},
    {value: 'off', label: '關閉'}
];

// How the stage fits the screen (scratch-vm engine/screen.js, ROADMAP.md 7.5)
class ScreenSettings extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleModeChange',
            'handleWidthChange',
            'handleHeightChange',
            'handleRenderScaleChange',
            'handleShadowsChange'
        ]);
    }
    handleModeChange (e) {
        this.props.onScreenSettingsChange({mode: e.target.value});
    }
    handleWidthChange (value) {
        this.props.onScreenSettingsChange({width: value});
    }
    handleHeightChange (value) {
        this.props.onScreenSettingsChange({height: value});
    }
    handleRenderScaleChange (e) {
        this.props.onScreenSettingsChange({renderScale: Number(e.target.value)});
    }
    handleShadowsChange (e) {
        this.props.onScreenSettingsChange({shadows: e.target.value});
    }
    render () {
        const screenSettings = this.props.screenSettings;
        return (
            <React.Fragment>
                <Setting
                    active={screenSettings.mode !== 'fixed'}
                    primary={(
                        <div className={classNames(styles.label, styles.customStageSize)}>
                            <span>畫面模式：</span>
                            <select
                                className={styles.select}
                                value={screenSettings.mode}
                                onChange={this.handleModeChange}
                            >
                                {SCREEN_MODES.map(mode => (
                                    <option
                                        key={mode.value}
                                        value={mode.value}
                                    >
                                        {mode.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                    help={(
                        <span>
                            播放器會填滿整個視窗。「固定高度」時舞台的 y 永遠是參考高度的一半到負一半，x 的範圍跟著螢幕的長寬比變，
                            用「螢幕 [寬度]」和「當螢幕大小改變」排 HUD。3D 相機的垂直視野不變，寬螢幕看到更多左右兩側。
                            編輯器用舞台上方的選單預覽不同的螢幕比例。
                        </span>
                    )}
                />
                <Setting
                    active={screenSettings.width !== 480 || screenSettings.height !== 360}
                    primary={(
                        <div className={classNames(styles.label, styles.customStageSize)}>
                            <span>參考大小：</span>
                            <BufferedInput
                                value={screenSettings.width}
                                onSubmit={this.handleWidthChange}
                                className={styles.customStageSizeInput}
                                type="number"
                                min="1"
                                max="4096"
                                step="1"
                            />
                            <span>{'×'}</span>
                            <BufferedInput
                                value={screenSettings.height}
                                onSubmit={this.handleHeightChange}
                                className={styles.customStageSizeInput}
                                type="number"
                                min="1"
                                max="4096"
                                step="1"
                            />
                        </div>
                    )}
                    help={(
                        <span>
                            舞台的單位，不是像素：畫面永遠依螢幕的實際解析度繪製。新專案是 1280×720，大小 100% 的點陣造型在
                            720p 螢幕上是 1:1。對話框和監看器依這個大小等比例放大（480×360 是 1 倍）。
                        </span>
                    )}
                />
                <Setting
                    active={screenSettings.renderScale !== 1}
                    primary={(
                        <div className={classNames(styles.label, styles.customStageSize)}>
                            <span>渲染比例：</span>
                            <select
                                className={styles.select}
                                value={screenSettings.renderScale}
                                onChange={this.handleRenderScaleChange}
                            >
                                {RENDER_SCALES.map(scale => (
                                    <option
                                        key={scale}
                                        value={scale}
                                    >
                                        {`${Math.round(scale * 100)}%`}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                    help={(
                        <span>
                            畫面的解析度跟螢幕相比。降低可以換效能（例如手機），畫面會比較模糊。
                        </span>
                    )}
                />
                <Setting
                    active={screenSettings.shadows !== 'high'}
                    primary={(
                        <div className={classNames(styles.label, styles.customStageSize)}>
                            <span>陰影：</span>
                            <select
                                className={styles.select}
                                value={screenSettings.shadows}
                                onChange={this.handleShadowsChange}
                            >
                                {SHADOW_QUALITIES.map(quality => (
                                    <option
                                        key={quality.value}
                                        value={quality.value}
                                    >
                                        {quality.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                    help={(
                        <span>
                            3D 場景裡太陽光的陰影。「低」用比較小的陰影貼圖，「關閉」完全不畫陰影，手機上可以換效能。
                            環境裡的「陰影」關掉時，這裡設什麼都沒有陰影。
                        </span>
                    )}
                />
            </React.Fragment>
        );
    }
}

ScreenSettings.propTypes = {
    screenSettings: PropTypes.shape({
        mode: PropTypes.string,
        width: PropTypes.number,
        height: PropTypes.number,
        renderScale: PropTypes.number,
        shadows: PropTypes.string
    }),
    onScreenSettingsChange: PropTypes.func
};
/* eslint-enable react/jsx-no-literals */

const StoreProjectOptions = ({onStoreProjectOptions}) => (
    <div className={styles.setting}>
        <div>
            <button
                onClick={onStoreProjectOptions}
                className={styles.button}
            >
                <FormattedMessage
                    defaultMessage="Store settings in project"
                    description="Button in settings modal"
                    id="tw.settingsModal.storeProjectOptions"
                />
            </button>
            <p>
                <FormattedMessage
                    // eslint-disable-next-line max-len
                    defaultMessage="Stores the selected settings in the project so they will be automatically applied when {APP_NAME} loads this project. Warp timer and disable compiler will not be saved."
                    description="Help text for the store settings in project button"
                    id="tw.settingsModal.storeProjectOptionsHelp"
                    values={{
                        APP_NAME
                    }}
                />
            </p>
        </div>
    </div>
);
StoreProjectOptions.propTypes = {
    onStoreProjectOptions: PropTypes.func
};

const Header = props => (
    <div className={styles.header}>
        {props.children}
        <div className={styles.divider} />
    </div>
);
Header.propTypes = {
    children: PropTypes.node
};

const SettingsModalComponent = props => (
    <Modal
        className={styles.modalContent}
        onRequestClose={props.onClose}
        contentLabel={props.intl.formatMessage(messages.title)}
        id="settingsModal"
    >
        <Box className={styles.body}>
            <Header>
                <FormattedMessage
                    defaultMessage="Featured"
                    description="Settings modal section"
                    id="tw.settingsModal.featured"
                />
            </Header>
            <CustomFPS
                framerate={props.framerate}
                onChange={props.onFramerateChange}
                onCustomizeFramerate={props.onCustomizeFramerate}
            />
            <Interpolation
                value={props.interpolation}
                onChange={props.onInterpolationChange}
            />
            <WarpTimer
                value={props.warpTimer}
                onChange={props.onWarpTimerChange}
            />
            {!props.isEmbedded && (
                <React.Fragment>
                    <Header>
                        {'畫面'}
                    </Header>
                    <ScreenSettings
                        {...props}
                    />
                </React.Fragment>
            )}
            <Header>
                <FormattedMessage
                    defaultMessage="Danger Zone"
                    description="Settings modal section"
                    id="tw.settingsModal.dangerZone"
                />
            </Header>
            <DisableCompiler
                value={props.disableCompiler}
                onChange={props.onDisableCompilerChange}
            />
            {!props.isEmbedded && (
                <StoreProjectOptions
                    {...props}
                />
            )}
        </Box>
    </Modal>
);

SettingsModalComponent.propTypes = {
    intl: intlShape,
    onClose: PropTypes.func,
    isEmbedded: PropTypes.bool,
    framerate: PropTypes.number,
    onFramerateChange: PropTypes.func,
    onCustomizeFramerate: PropTypes.func,
    interpolation: PropTypes.bool,
    onInterpolationChange: PropTypes.func,
    warpTimer: PropTypes.bool,
    onWarpTimerChange: PropTypes.func,
    disableCompiler: PropTypes.bool,
    onDisableCompilerChange: PropTypes.func
};

export default injectIntl(SettingsModalComponent);

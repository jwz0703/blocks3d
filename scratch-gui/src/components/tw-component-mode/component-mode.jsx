/* eslint-disable react/no-multi-comp */
import bindAll from 'lodash.bindall';
import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';

import Box from '../box/box.jsx';
import ActionMenu from '../action-menu/action-menu.jsx';
import getCostumeUrl from '../../lib/get-costume-url';
import boundCostumeURL from '../../lib/tw-bound-costume-url';
import itemStyles from '../sprite-selector-item/sprite-selector-item.css';
import stageStyles from '../stage-selector/stage-selector.css';
import styles from './component-mode.css';
import backIcon from './icon--back.svg';
import componentIcon from './icon--component.svg';

/**
 * @param {VM} vm the VM
 * @returns {Array<string>} the names of the components whose pages are open, from the outside in
 */
const componentPath = vm => (vm.getComponentPage() ? vm.getComponentPage().path : []);

/**
 * @param {VM} vm the VM
 * @param {Target} target a sprite or instance
 * @returns {?string} a picture of its costume
 */
const costumeURL = (vm, target) => {
    const costume = target.getCostumes()[target.currentCostume];
    return boundCostumeURL(vm, target.id) || (costume && costume.asset ? getCostumeUrl(costume.asset) : null);
};

/**
 * The first tile of the sprite list in the component mode: back to where we came from (like a folder). Esc too.
 */
class ComponentBackTile extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['handleBack', 'handleKeyDown']);
    }
    componentDidMount () {
        document.addEventListener('keydown', this.handleKeyDown);
    }
    componentWillUnmount () {
        document.removeEventListener('keydown', this.handleKeyDown);
    }
    handleKeyDown (e) {
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        const active = document.activeElement;
        if (active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable)) return;
        if (document.querySelector('.ReactModal__Overlay')) return;
        this.handleBack();
    }
    handleBack () {
        this.props.vm.exitComponent(false);
    }
    render () {
        const path = componentPath(this.props.vm);
        const parent = path.length > 1 ? path[path.length - 2] : '專案';
        return (
            <div
                className={classNames(itemStyles.spriteSelectorItem, styles.back)}
                title={`回到${parent}（Esc）`}
                onClick={this.handleBack}
            >
                <div className={itemStyles.spriteImageOuter}>
                    <div className={itemStyles.spriteImageInner}>
                        <img
                            className={itemStyles.spriteImage}
                            draggable={false}
                            src={backIcon}
                        />
                    </div>
                </div>
                <div className={itemStyles.spriteInfo}>
                    <div className={itemStyles.spriteName}>{'返回'}</div>
                    <div className={itemStyles.spriteDetails}>{parent}</div>
                </div>
            </div>
        );
    }
}

ComponentBackTile.propTypes = {
    vm: PropTypes.shape({
        runtime: PropTypes.object, // eslint-disable-line react/forbid-prop-types
        exitComponent: PropTypes.func
    }).isRequired
};

/**
 * In the component mode, the component takes the place of the stage: its root, how many instances a change
 * affects, how the stage shows what is outside it, and a button to put other components in it.
 */
class ComponentRoot extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['handleClick', 'handleView', 'handlePutIn']);
    }
    handleClick () {
        const scope = this.props.vm.runtime.components.editScope;
        if (scope) this.props.onSelect(scope.id);
    }
    handleView (e) {
        e.stopPropagation();
        const {vm} = this.props;
        vm.setComponentView(vm.getComponentView() === 'surround' ? 'isolate' : 'surround');
    }
    handlePutIn (id) {
        if (!id || !this.props.vm.addComponentToEdited(id)) {
            // eslint-disable-next-line no-alert
            window.alert('這個元件不能放進來（元件不能包含自己）');
        }
    }
    render () {
        const {vm, selected} = this.props;
        const scope = vm.runtime.components.editScope;
        if (!scope) return null;
        const url = costumeURL(vm, scope);
        const instances = vm.runtime.components.instancesOf(scope.sprite).length;
        const components = vm.runtime.components;
        const others = Array.from(components.definitions.values())
            .filter(sprite => !components.contains(sprite, scope.sprite));
        const putIn = sprite => () => this.handlePutIn(sprite.component.id);
        return (
            <Box
                className={classNames(stageStyles.stageSelector, {[stageStyles.isSelected]: selected})}
                onClick={this.handleClick}
            >
                <div className={stageStyles.header}>
                    <div className={stageStyles.headerTitle}>{scope.sprite.name}</div>
                </div>
                {url ? (
                    <img
                        className={stageStyles.costumeCanvas}
                        draggable={false}
                        src={url}
                    />
                ) : null}
                <div className={stageStyles.label}>{'實體'}</div>
                <div
                    className={stageStyles.count}
                    title={`在這裡的修改會影響 ${instances} 個實體`}
                >{instances}</div>
                <label
                    className={styles.view}
                    onClick={this.handleView}
                >
                    <input
                        readOnly
                        checked={vm.getComponentView() === 'surround'}
                        type="checkbox"
                    />
                    {'顯示周圍'}
                </label>
                {others.length ? (
                    <ActionMenu
                        className={stageStyles.addButton}
                        img={componentIcon}
                        moreButtons={others.map(sprite => ({
                            title: `放入「${sprite.name}」`,
                            img: componentIcon,
                            onClick: putIn(sprite)
                        }))}
                        title={`放入「${others[0].name}」`}
                        tooltipPlace="left"
                        onClick={putIn(others[0])}
                    />
                ) : null}
            </Box>
        );
    }
}

ComponentRoot.propTypes = {
    onSelect: PropTypes.func.isRequired,
    selected: PropTypes.bool,
    vm: PropTypes.object.isRequired // eslint-disable-line react/forbid-prop-types
};

/**
 * Over the blocks of an instance outside the component mode: its blocks are the component's, and changing them
 * changes every instance, so it takes entering the component.
 */
class InstanceBlocksHint extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['handleUpdate', 'handleEnter']);
    }
    componentDidMount () {
        this.props.vm.on('targetsUpdate', this.handleUpdate);
        this.props.vm.on('workspaceUpdate', this.handleUpdate);
    }
    componentWillUnmount () {
        this.props.vm.removeListener('targetsUpdate', this.handleUpdate);
        this.props.vm.removeListener('workspaceUpdate', this.handleUpdate);
    }
    handleUpdate () {
        const target = this.target();
        const key = target ? `${target.id}:${!!this.props.vm.runtime.components.editScope}` : '';
        if (key !== this._key) {
            this._key = key;
            this.forceUpdate();
        }
    }
    handleEnter () {
        const target = this.target();
        if (target) this.props.vm.enterComponent(target.id);
    }
    target () {
        const {vm} = this.props;
        const target = vm.editingTarget;
        if (!target || !target.sprite || !target.sprite.component || vm.runtime.components.editScope) return null;
        return target;
    }
    render () {
        const target = this.target();
        if (!target) return null;
        return (
            <div className={styles.hintCover}>
                <div className={styles.hint}>
                    <div>{`「${target.getName()}」的積木在元件「${target.sprite.name}」裡`}</div>
                    <button
                        className={styles.hintButton}
                        onClick={this.handleEnter}
                    >{'進入元件'}</button>
                </div>
            </div>
        );
    }
}

InstanceBlocksHint.propTypes = {
    vm: PropTypes.shape({
        on: PropTypes.func,
        removeListener: PropTypes.func,
        editingTarget: PropTypes.object, // eslint-disable-line react/forbid-prop-types
        runtime: PropTypes.object, // eslint-disable-line react/forbid-prop-types
        enterComponent: PropTypes.func
    }).isRequired
};

export {
    ComponentBackTile,
    ComponentRoot,
    InstanceBlocksHint,
    componentPath
};

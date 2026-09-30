import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';

import DeleteButton from '../delete-button/delete-button.jsx';
import styles from './sprite-selector-item.css';
import {ContextMenuTrigger} from 'react-contextmenu';
import {DangerousMenuItem, ContextMenu, MenuItem} from '../context-menu/context-menu.jsx';
import {FormattedMessage} from 'react-intl';

// react-contextmenu requires unique id to match trigger and context menu
let contextMenuId = 0;

const SpriteSelectorItem = props => (
    <ContextMenuTrigger
        attributes={{
            className: classNames(props.className, styles.spriteSelectorItem, {
                [styles.isSelected]: props.selected,
                [styles.isInstance]: !!props.componentName,
                [styles.isMultiSelected]: props.multiSelected
            }),
            onClick: props.onClick,
            onDoubleClick: props.onEnterComponent,
            onMouseEnter: props.onMouseEnter,
            onMouseLeave: props.onMouseLeave,
            onMouseDown: props.onMouseDown,
            onTouchStart: props.onMouseDown
        }}
        disable={props.preventContextMenu}
        id={`${props.name}-${contextMenuId}`}
        ref={props.componentRef}
    >
        {typeof props.number === 'undefined' ? null : (
            <div className={styles.number}>{props.number}</div>
        )}
        {props.costumeURL ? (
            <div className={styles.spriteImageOuter}>
                <div className={styles.spriteImageInner}>
                    <img
                        className={styles.spriteImage}
                        draggable={false}
                        loading="lazy"
                        src={props.costumeURL}
                    />
                </div>
            </div>
        ) : null}
        <div className={styles.spriteInfo}>
            <div className={styles.spriteName}>{props.name}</div>
            {props.details || props.componentName ? (
                <div className={styles.spriteDetails}>{props.details || props.componentName}</div>
            ) : null}
        </div>
        {(props.selected && props.onDeleteButtonClick) ? (
            <DeleteButton
                className={styles.deleteButton}
                onClick={props.onDeleteButtonClick}
            />
        ) : null }
        {props.onDuplicateButtonClick || props.onDeleteButtonClick || props.onExportButtonClick ? (
            <ContextMenu id={`${props.name}-${contextMenuId++}`}>
                {props.onDuplicateButtonClick ? (
                    <MenuItem onClick={props.onDuplicateButtonClick}>
                        <FormattedMessage
                            defaultMessage="duplicate"
                            description="Menu item to duplicate in the right click menu"
                            id="gui.spriteSelectorItem.contextMenuDuplicate"
                        />
                    </MenuItem>
                ) : null}
                {props.onExportButtonClick ? (
                    <MenuItem onClick={props.onExportButtonClick}>
                        <FormattedMessage
                            defaultMessage="export"
                            description="Menu item to export the selected item"
                            id="gui.spriteSelectorItem.contextMenuExport"
                        />
                    </MenuItem>
                ) : null }
                {props.onRenameButtonClick ? (
                    <MenuItem onClick={props.onRenameButtonClick}>
                        <FormattedMessage
                            defaultMessage="rename"
                            description="Menu item to rename an item"
                            id="tw.spriteSelectorItem.rename"
                        />
                    </MenuItem>
                ) : null}
                {/* Components (ROADMAP.md 階段 10) */}
                {props.componentName && props.onEnterComponent ? (
                    <MenuItem onClick={props.onEnterComponent}>{'進入元件'}</MenuItem>
                ) : null}
                {props.onMakeComponent ? (
                    <MenuItem onClick={props.onMakeComponent}>
                        {props.multiSelectCount > 1 ? `把選取的 ${props.multiSelectCount} 個角色包成元件` : '包成元件'}
                    </MenuItem>
                ) : null}
                {props.componentName && props.onAddInstance ? (
                    <MenuItem onClick={props.onAddInstance}>{'再放一個'}</MenuItem>
                ) : null}
                {props.componentName && props.onEditComponent ? (
                    <MenuItem onClick={props.onEditComponent}>{'重新命名元件'}</MenuItem>
                ) : null}
                {props.componentName && props.onExportComponent ? (
                    <MenuItem onClick={props.onExportComponent}>{'匯出元件（.3dsc）'}</MenuItem>
                ) : null}
                {props.componentName && props.onUnpackComponent ? (
                    <MenuItem onClick={props.onUnpackComponent}>{'解除元件'}</MenuItem>
                ) : null}
                {props.componentName && props.onDeleteComponent ? (
                    <DangerousMenuItem onClick={props.onDeleteComponent}>{'刪除元件…'}</DangerousMenuItem>
                ) : null}
                {props.onDeleteButtonClick ? (
                    <DangerousMenuItem onClick={props.onDeleteButtonClick}>
                        <FormattedMessage
                            defaultMessage="delete"
                            description="Menu item to delete in the right click menu"
                            id="gui.spriteSelectorItem.contextMenuDelete"
                        />
                    </DangerousMenuItem>
                ) : null }
            </ContextMenu>
        ) : null}
    </ContextMenuTrigger>
);

SpriteSelectorItem.propTypes = {
    className: PropTypes.string,
    componentName: PropTypes.string,
    componentRef: PropTypes.func,
    costumeURL: PropTypes.string,
    details: PropTypes.string,
    // eslint-disable-next-line react/forbid-prop-types
    name: PropTypes.any,
    number: PropTypes.number,
    onClick: PropTypes.func,
    onAddInstance: PropTypes.func,
    onDeleteButtonClick: PropTypes.func,
    onDeleteComponent: PropTypes.func,
    onDuplicateButtonClick: PropTypes.func,
    onEditComponent: PropTypes.func,
    onExportButtonClick: PropTypes.func,
    onExportComponent: PropTypes.func,
    onEnterComponent: PropTypes.func,
    onMakeComponent: PropTypes.func,
    multiSelectCount: PropTypes.number,
    multiSelected: PropTypes.bool,
    onRenameButtonClick: PropTypes.func,
    onUnpackComponent: PropTypes.func,
    onMouseDown: PropTypes.func,
    onMouseEnter: PropTypes.func,
    onMouseLeave: PropTypes.func,
    preventContextMenu: PropTypes.bool,
    selected: PropTypes.bool.isRequired
};

export default SpriteSelectorItem;

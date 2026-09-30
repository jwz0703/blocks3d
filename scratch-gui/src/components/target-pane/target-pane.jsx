import PropTypes from 'prop-types';
import React from 'react';

import VM from 'scratch-vm';

import SpriteLibrary from '../../containers/sprite-library.jsx';
import SpriteSelectorComponent from '../sprite-selector/sprite-selector.jsx';
import StageSelector from '../../containers/stage-selector.jsx';
import {ComponentBackTile, ComponentRoot} from '../tw-component-mode/component-mode.jsx';
import {STAGE_DISPLAY_SIZES} from '../../lib/layout-constants';

import styles from './target-pane.css';

/*
 * Pane that contains the sprite selector, sprite info, stage selector,
 * and the new sprite, costume and backdrop buttons
 * @param {object} props Props for the component
 * @returns {React.Component} rendered component
 */
const TargetPane = ({
    editingTarget,
    fileInputRef,
    hoveredTarget,
    spriteLibraryVisible,
    onActivateBlocksTab,
    onChangeSprite3D,
    onChangeSpriteDirection,
    onChangeSpriteName,
    onChangeSpriteRotationStyle,
    onChangeSpriteSize,
    onChangeSpriteVisibility,
    onChangeSpriteX,
    onChangeSpriteY,
    onDeleteSprite,
    onDrop,
    onDuplicateSprite,
    onExportSprite,
    onFileUploadClick,
    onNew3DSpriteClick,
    onNewCanvasSpriteClick,
    onNewSpriteClick,
    onPaintSpriteClick,
    onRequestCloseSpriteLibrary,
    onSelectSprite,
    onSpriteUpload,
    onSurpriseSpriteClick,
    raiseSprites,
    stage,
    stageSize,
    sprites,
    vm,
    ...componentProps
}) => {
    // The component mode (ROADMAP.md 階段 10): the sprite list shows the members of the component being edited, and
    // its root takes the place of the stage. Outside it, members of components aren't listed.
    const scope = vm && vm.runtime.components ? vm.runtime.components.editScope : null;
    const scopeId = scope ? scope.id : null;
    const listIds = Object.keys(sprites).filter(id => (sprites[id].componentOwnerId || null) === scopeId);
    return (<div
        className={styles.targetPane}
        {...componentProps}
    >

        <SpriteSelectorComponent
            editingTarget={editingTarget}
            leadingItem={scope ? <ComponentBackTile vm={vm} /> : null}
            hoveredTarget={hoveredTarget}
            listIds={listIds}
            raised={raiseSprites}
            selectedId={editingTarget}
            spriteFileInput={fileInputRef}
            sprites={sprites}
            stageSize={stageSize}
            onChangeSprite3D={onChangeSprite3D}
            onChangeSpriteDirection={onChangeSpriteDirection}
            onChangeSpriteName={onChangeSpriteName}
            onChangeSpriteRotationStyle={onChangeSpriteRotationStyle}
            onChangeSpriteSize={onChangeSpriteSize}
            onChangeSpriteVisibility={onChangeSpriteVisibility}
            onChangeSpriteX={onChangeSpriteX}
            onChangeSpriteY={onChangeSpriteY}
            onDeleteSprite={onDeleteSprite}
            onDrop={onDrop}
            onDuplicateSprite={onDuplicateSprite}
            onExportSprite={onExportSprite}
            onFileUploadClick={onFileUploadClick}
            onNew3DSpriteClick={onNew3DSpriteClick}
            onNewCanvasSpriteClick={onNewCanvasSpriteClick}
            onNewSpriteClick={onNewSpriteClick}
            onPaintSpriteClick={onPaintSpriteClick}
            onSelectSprite={onSelectSprite}
            onSpriteUpload={onSpriteUpload}
            onSurpriseSpriteClick={onSurpriseSpriteClick}
        />
        <div className={styles.stageSelectorWrapper}>
            {scope ? (
                <ComponentRoot
                    selected={scope.id === editingTarget}
                    vm={vm}
                    onSelect={onSelectSprite}
                />
            ) : null}
            {!scope && stage.id && <StageSelector
                asset={
                    stage.costume &&
                    stage.costume.asset
                }
                backdropCount={stage.costumeCount}
                environment={stage.costume && stage.costume.environment}
                id={stage.id}
                selected={stage.id === editingTarget}
                onSelect={onSelectSprite}
            />}
            <div>
                {spriteLibraryVisible ? (
                    <SpriteLibrary
                        vm={vm}
                        onActivateBlocksTab={onActivateBlocksTab}
                        onRequestClose={onRequestCloseSpriteLibrary}
                    />
                ) : null}
            </div>
        </div>
    </div>);
};

const spriteShape = PropTypes.shape({
    costume: PropTypes.shape({
        // asset is defined in scratch-storage's Asset.js
        asset: PropTypes.object, // eslint-disable-line react/forbid-prop-types
        // The 3D environment of a backdrop, see the VM's scene-3d-environment.js
        environment: PropTypes.object, // eslint-disable-line react/forbid-prop-types
        url: PropTypes.string,
        name: PropTypes.string.isRequired,
        // The following are optional because costumes uploaded from disk
        // will not have these properties available
        bitmapResolution: PropTypes.number,
        rotationCenterX: PropTypes.number,
        rotationCenterY: PropTypes.number
    }),
    // The instance of a component this sprite is a member of
    componentOwnerId: PropTypes.string,
    costumeCount: PropTypes.number,
    direction: PropTypes.number,
    id: PropTypes.string,
    name: PropTypes.string,
    order: PropTypes.number,
    size: PropTypes.number,
    visibility: PropTypes.bool,
    x: PropTypes.number,
    y: PropTypes.number
});

TargetPane.propTypes = {
    editingTarget: PropTypes.string,
    extensionLibraryVisible: PropTypes.bool,
    fileInputRef: PropTypes.func,
    hoveredTarget: PropTypes.shape({
        hoveredSprite: PropTypes.string,
        receivedBlocks: PropTypes.bool
    }),
    onActivateBlocksTab: PropTypes.func.isRequired,
    onChangeSprite3D: PropTypes.func,
    onChangeSpriteDirection: PropTypes.func,
    onChangeSpriteName: PropTypes.func,
    onChangeSpriteRotationStyle: PropTypes.func,
    onChangeSpriteSize: PropTypes.func,
    onChangeSpriteVisibility: PropTypes.func,
    onChangeSpriteX: PropTypes.func,
    onChangeSpriteY: PropTypes.func,
    onDeleteSprite: PropTypes.func,
    onDrop: PropTypes.func,
    onDuplicateSprite: PropTypes.func,
    onExportSprite: PropTypes.func,
    onFileUploadClick: PropTypes.func,
    onNew3DSpriteClick: PropTypes.func,
    onNewCanvasSpriteClick: PropTypes.func,
    onNewSpriteClick: PropTypes.func,
    onPaintSpriteClick: PropTypes.func,
    onRequestCloseExtensionLibrary: PropTypes.func,
    onRequestCloseSpriteLibrary: PropTypes.func,
    onSelectSprite: PropTypes.func,
    onSpriteUpload: PropTypes.func,
    onSurpriseSpriteClick: PropTypes.func,
    raiseSprites: PropTypes.bool,
    spriteLibraryVisible: PropTypes.bool,
    sprites: PropTypes.objectOf(spriteShape),
    stage: spriteShape,
    stageSize: PropTypes.oneOf(Object.keys(STAGE_DISPLAY_SIZES)).isRequired,
    vm: PropTypes.instanceOf(VM)
};

export default TargetPane;

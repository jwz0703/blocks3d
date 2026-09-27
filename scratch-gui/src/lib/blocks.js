import LazyScratchBlocks from './tw-lazy-scratch-blocks';

/**
 * Connect scratch blocks with the vm
 * @param {VirtualMachine} vm - The scratch vm
 * @return {ScratchBlocks} ScratchBlocks connected with the vm
 */
export default function (vm) {
    const ScratchBlocks = LazyScratchBlocks.get();
    const jsonForMenuBlock = function (name, menuOptionsFn, colors, start) {
        return {
            message0: '%1',
            args0: [
                {
                    type: 'field_dropdown',
                    name: name,
                    options: function () {
                        return start.concat(menuOptionsFn());
                    }
                }
            ],
            inputsInline: true,
            output: 'String',
            colour: colors.secondary,
            colourSecondary: colors.secondary,
            colourTertiary: colors.tertiary,
            colourQuaternary: colors.quaternary,
            outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND
        };
    };

    const jsonForHatBlockMenu = function (hatName, name, menuOptionsFn, colors, start) {
        return {
            message0: hatName,
            args0: [
                {
                    type: 'field_dropdown',
                    name: name,
                    options: function () {
                        return start.concat(menuOptionsFn());
                    }
                }
            ],
            colour: colors.primary,
            colourSecondary: colors.secondary,
            colourTertiary: colors.tertiary,
            colourQuaternary: colors.quaternary,
            extensions: ['shape_hat']
        };
    };


    const jsonForSensingMenus = function (menuOptionsFn) {
        return {
            message0: ScratchBlocks.Msg.SENSING_OF,
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'PROPERTY',
                    options: function () {
                        return menuOptionsFn();
                    }

                },
                {
                    type: 'input_value',
                    name: 'OBJECT'
                }
            ],
            output: true,
            colour: ScratchBlocks.Colours.sensing.primary,
            colourSecondary: ScratchBlocks.Colours.sensing.secondary,
            colourTertiary: ScratchBlocks.Colours.sensing.tertiary,
            colourQuaternary: ScratchBlocks.Colours.sensing.quaternary,
            outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND
        };
    };

    const soundsMenu = function () {
        let menu = [['', '']];
        if (vm.editingTarget && vm.editingTarget.sprite.sounds.length > 0) {
            menu = vm.editingTarget.sprite.sounds.map(sound => [sound.name, sound.name]);
        }
        menu.push([
            ScratchBlocks.ScratchMsgs.translate('SOUND_RECORD', 'record...'),
            ScratchBlocks.recordSoundCallback
        ]);
        return menu;
    };

    const costumesMenu = function () {
        if (vm.editingTarget && vm.editingTarget.getCostumes().length > 0) {
            return vm.editingTarget.getCostumes().map(costume => [costume.name, costume.name]);
        }
        return [['', '']];
    };

    const backdropsMenu = function () {
        const next = ScratchBlocks.ScratchMsgs.translate('LOOKS_NEXTBACKDROP', 'next backdrop');
        const previous = ScratchBlocks.ScratchMsgs.translate('LOOKS_PREVIOUSBACKDROP', 'previous backdrop');
        const random = ScratchBlocks.ScratchMsgs.translate('LOOKS_RANDOMBACKDROP', 'random backdrop');
        if (vm.runtime.targets[0] && vm.runtime.targets[0].getCostumes().length > 0) {
            return vm.runtime.targets[0].getCostumes().map(costume => [costume.name, costume.name])
                .concat([[next, 'next backdrop'],
                    [previous, 'previous backdrop'],
                    [random, 'random backdrop']]);
        }
        return [['', '']];
    };

    const backdropNamesMenu = function () {
        const stage = vm.runtime.getTargetForStage();
        if (stage && stage.getCostumes().length > 0) {
            return stage.getCostumes().map(costume => [costume.name, costume.name]);
        }
        return [['', '']];
    };

    /**
     * @param {function(Target): boolean} [include] which sprites to list, besides the editing target
     * @returns {Array<Array<string>>} menu items of sprites
     */
    const spriteMenu = function (include) {
        const sprites = [];
        for (const targetId in vm.runtime.targets) {
            if (!Object.prototype.hasOwnProperty.call(vm.runtime.targets, targetId)) continue;
            if (vm.runtime.targets[targetId].isOriginal) {
                if (!vm.runtime.targets[targetId].isStage) {
                    if (vm.runtime.targets[targetId] === vm.editingTarget) {
                        continue;
                    }
                    if (include && !include(vm.runtime.targets[targetId])) continue;
                    sprites.push([vm.runtime.targets[targetId].sprite.name, vm.runtime.targets[targetId].sprite.name]);
                }
            }
        }
        return sprites;
    };

    const editingKind = () => vm.getTargetKind(vm.editingTarget);
    // Where to go, what to point at or measure the distance to: 2D sprites can use 3D sprites (where they are drawn
    // on the stage), but 3D sprites can't use 2D sprites, which aren't anywhere in the 3D scene.
    const reachableSpriteMenu = () => spriteMenu(target => editingKind() === '2d' || !!target.is3D);
    // 2D and 3D sprites never touch each other
    const sameKindSpriteMenu = () => spriteMenu(target => vm.getTargetKind(target) === editingKind());

    const cloneMenu = function () {
        if (vm.editingTarget && vm.editingTarget.isStage) {
            const menu = spriteMenu();
            if (menu.length === 0) {
                return [['', '']]; // Empty menu matches Scratch 2 behavior
            }
            return menu;
        }
        const myself = ScratchBlocks.ScratchMsgs.translate('CONTROL_CREATECLONEOF_MYSELF', 'myself');
        return [[myself, '_myself_']].concat(spriteMenu());
    };

    const soundColors = ScratchBlocks.Colours.sounds;

    const looksColors = ScratchBlocks.Colours.looks;

    const motionColors = ScratchBlocks.Colours.motion;

    const sensingColors = ScratchBlocks.Colours.sensing;

    const controlColors = ScratchBlocks.Colours.control;

    const eventColors = ScratchBlocks.Colours.event;

    ScratchBlocks.Blocks.sound_sounds_menu.init = function () {
        const json = jsonForMenuBlock('SOUND_MENU', soundsMenu, soundColors, []);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.looks_costume.init = function () {
        const json = jsonForMenuBlock('COSTUME', costumesMenu, looksColors, []);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.looks_backdrops.init = function () {
        const json = jsonForMenuBlock('BACKDROP', backdropsMenu, looksColors, []);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.event_whenbackdropswitchesto.init = function () {
        const json = jsonForHatBlockMenu(
            ScratchBlocks.Msg.EVENT_WHENBACKDROPSWITCHESTO,
            'BACKDROP', backdropNamesMenu, eventColors, []);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.motion_pointtowards_menu.init = function () {
        const random = ScratchBlocks.ScratchMsgs.translate('MOTION_POINTTOWARDS_RANDOM', 'random direction');
        const mouse = ScratchBlocks.ScratchMsgs.translate('MOTION_POINTTOWARDS_POINTER', 'mouse-pointer');
        const json = jsonForMenuBlock('TOWARDS', reachableSpriteMenu, motionColors, [
            [mouse, '_mouse_'],
            [random, '_random_']
        ]);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.motion_goto_menu.init = function () {
        const random = ScratchBlocks.ScratchMsgs.translate('MOTION_GOTO_RANDOM', 'random position');
        const mouse = ScratchBlocks.ScratchMsgs.translate('MOTION_GOTO_POINTER', 'mouse-pointer');
        const json = jsonForMenuBlock('TO', reachableSpriteMenu, motionColors, [
            [random, '_random_'],
            [mouse, '_mouse_']
        ]);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.motion_glideto_menu.init = function () {
        const random = ScratchBlocks.ScratchMsgs.translate('MOTION_GLIDETO_RANDOM', 'random position');
        const mouse = ScratchBlocks.ScratchMsgs.translate('MOTION_GLIDETO_POINTER', 'mouse-pointer');
        const json = jsonForMenuBlock('TO', reachableSpriteMenu, motionColors, [
            [random, '_random_'],
            [mouse, '_mouse_']
        ]);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.sensing_of_object_menu.init = function () {
        const stage = ScratchBlocks.ScratchMsgs.translate('SENSING_OF_STAGE', 'Stage');
        const json = jsonForMenuBlock('OBJECT', spriteMenu, sensingColors, [
            [stage, '_stage_']
        ]);
        this.jsonInit(json);
    };

    // What the "[property] of [sprite]" block shows for the properties of 3D sprites
    const attributeNames3D = {
        'x position': ScratchBlocks.Msg.SENSING_OF_XPOSITION,
        'y position': ScratchBlocks.Msg.SENSING_OF_YPOSITION,
        'z position': 'z 座標',
        'yaw': 'yaw',
        'pitch': 'pitch',
        'roll': 'roll',
        'model #': '模型編號',
        'model name': '模型名稱',
        'scale': '縮放',
        'opacity': '不透明度',
        'fov': '視野'
    };

    ScratchBlocks.Blocks.sensing_of.init = function () {
        const blockId = this.id;
        const blockType = this.type;

        // Get the sensing_of block from vm.
        let defaultSensingOfBlock;
        const blocks = vm.runtime.flyoutBlocks._blocks;
        Object.keys(blocks).forEach(id => {
            const block = blocks[id];
            if (id === blockType || (block && block.opcode === blockType)) {
                defaultSensingOfBlock = block;
            }
        });

        // Function that fills in menu for the first input in the sensing block.
        // Called every time it opens since it depends on the values in the other block input.
        const menuFn = function () {
            const stageOptions = [
                [ScratchBlocks.Msg.SENSING_OF_BACKDROPNUMBER, 'backdrop #'],
                [ScratchBlocks.Msg.SENSING_OF_BACKDROPNAME, 'backdrop name'],
                [ScratchBlocks.Msg.SENSING_OF_VOLUME, 'volume']
            ];
            const spriteOptions = [
                [ScratchBlocks.Msg.SENSING_OF_XPOSITION, 'x position'],
                [ScratchBlocks.Msg.SENSING_OF_YPOSITION, 'y position'],
                [ScratchBlocks.Msg.SENSING_OF_DIRECTION, 'direction'],
                [ScratchBlocks.Msg.SENSING_OF_COSTUMENUMBER, 'costume #'],
                [ScratchBlocks.Msg.SENSING_OF_COSTUMENAME, 'costume name'],
                [ScratchBlocks.Msg.SENSING_OF_SIZE, 'size'],
                [ScratchBlocks.Msg.SENSING_OF_VOLUME, 'volume']
            ];
            if (vm.editingTarget) {
                let lookupBlocks = vm.editingTarget.blocks;
                let sensingOfBlock = lookupBlocks.getBlock(blockId);

                // The block doesn't exist, but should be in the flyout. Look there.
                if (!sensingOfBlock) {
                    sensingOfBlock = vm.runtime.flyoutBlocks.getBlock(blockId) || defaultSensingOfBlock;
                    // If we still don't have a block, just return an empty list . This happens during
                    // scratch blocks construction.
                    if (!sensingOfBlock) {
                        return [['', '']];
                    }
                    // The block was in the flyout so look up future block info there.
                    lookupBlocks = vm.runtime.flyoutBlocks;
                }
                const sort = function (options) {
                    options.sort(ScratchBlocks.scratchBlocksUtils.compareStrings);
                };
                // Get all the stage variables (no lists) so we can add them to menu when the stage is selected.
                const stageVariableOptions = vm.runtime.getTargetForStage().getAllVariableNamesInScopeByType('');
                sort(stageVariableOptions);
                const stageVariableMenuItems = stageVariableOptions.map(variable => [variable, variable]);
                if (sensingOfBlock.inputs.OBJECT.shadow !== sensingOfBlock.inputs.OBJECT.block) {
                    // There's a block dropped on top of the menu. It'd be nice to evaluate it and
                    // return the correct list, but that is tricky. Scratch2 just returns stage options
                    // so just do that here too.
                    return stageOptions.concat(stageVariableMenuItems);
                }
                const menuBlock = lookupBlocks.getBlock(sensingOfBlock.inputs.OBJECT.shadow);
                const selectedItem = menuBlock.fields.OBJECT.value;
                if (selectedItem === '_stage_') {
                    return stageOptions.concat(stageVariableMenuItems);
                }
                // Get all the local variables (no lists) and add them to the menu.
                const target = vm.runtime.getSpriteTargetByName(selectedItem);
                let spriteVariableOptions = [];
                // The target should exist, but there are ways for it not to (e.g. #4203).
                if (target) {
                    spriteVariableOptions = target.getAllVariableNamesInScopeByType('', true);
                    sort(spriteVariableOptions);
                }
                const spriteVariableMenuItems = spriteVariableOptions.map(variable => [variable, variable]);
                const attributes = target && vm.getSpriteAttributes(vm.getTargetKind(target));
                if (attributes) {
                    return attributes
                        .map(attribute => [attributeNames3D[attribute] || attribute, attribute])
                        .concat(spriteVariableMenuItems);
                }
                return spriteOptions.concat(spriteVariableMenuItems);
            }
            return [['', '']];
        };

        const json = jsonForSensingMenus(menuFn);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.sensing_distancetomenu.init = function () {
        const mouse = ScratchBlocks.ScratchMsgs.translate('SENSING_DISTANCETO_POINTER', 'mouse-pointer');
        const json = jsonForMenuBlock('DISTANCETOMENU', reachableSpriteMenu, sensingColors, [
            [mouse, '_mouse_']
        ]);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.sensing_touchingobjectmenu.init = function () {
        const mouse = ScratchBlocks.ScratchMsgs.translate('SENSING_TOUCHINGOBJECT_POINTER', 'mouse-pointer');
        const edge = ScratchBlocks.ScratchMsgs.translate('SENSING_TOUCHINGOBJECT_EDGE', 'edge');
        const json = jsonForMenuBlock('TOUCHINGOBJECTMENU', sameKindSpriteMenu, sensingColors, [
            [mouse, '_mouse_'],
            [edge, '_edge_']
        ]);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.control_create_clone_of_menu.init = function () {
        const json = jsonForMenuBlock('CLONE_OPTION', cloneMenu, controlColors, []);
        this.jsonInit(json);
    };

    ScratchBlocks.VerticalFlyout.getCheckboxState = function (blockId) {
        const monitoredBlock = vm.runtime.monitorBlocks._blocks[blockId];
        return monitoredBlock ? monitoredBlock.isMonitored : false;
    };

    ScratchBlocks.FlyoutExtensionCategoryHeader.getExtensionState = function (extensionId) {
        if (vm.getPeripheralIsConnected(extensionId)) {
            return ScratchBlocks.StatusButtonState.READY;
        }
        return ScratchBlocks.StatusButtonState.NOT_READY;
    };

    ScratchBlocks.FieldNote.playNote_ = function (noteNum, extensionId) {
        vm.runtime.emit('PLAY_NOTE', noteNum, extensionId);
    };

    // Use a collator's compare instead of localeCompare which internally
    // creates a collator. Using this is a lot faster in browsers that create a
    // collator for every localeCompare call.
    const collator = new Intl.Collator([], {
        sensitivity: 'base',
        numeric: true
    });
    ScratchBlocks.scratchBlocksUtils.compareStrings = function (str1, str2) {
        return collator.compare(str1, str2);
    };

    // "log ()": prints its input to the browser console.
    ScratchBlocks.Blocks.looks_log = {
        init: function () {
            this.jsonInit({
                message0: 'log %1',
                args0: [
                    {
                        type: 'input_value',
                        name: 'MESSAGE'
                    }
                ],
                category: ScratchBlocks.Categories.looks,
                extensions: ['colours_looks', 'shape_statement']
            });
        }
    };

    // Key edge detection: true only in the first frame after the key went down / up.
    const keyBlock = (opcode, message, output) => {
        ScratchBlocks.Blocks[opcode] = {
            init: function () {
                this.jsonInit({
                    message0: message,
                    args0: [
                        {
                            type: 'input_value',
                            name: 'KEY_OPTION'
                        }
                    ],
                    category: ScratchBlocks.Categories.sensing,
                    extensions: ['colours_sensing', output]
                });
            }
        };
    };
    keyBlock('sensing_keyjustpressed', '%1 鍵剛按下？', 'output_boolean');
    keyBlock('sensing_keyjustreleased', '%1 鍵剛放開？', 'output_boolean');
    keyBlock('sensing_keyheldseconds', '%1 鍵按住秒數', 'output_number');

    // "for each frame" loop: runs its body once per frame. The "經過秒數" parameter
    // can be dragged out like a custom block parameter (see below).
    ScratchBlocks.Blocks.control_foreachframe = {
        init: function () {
            this.jsonInit({
                message0: '每幀重複執行 %1',
                message1: '%1',
                message2: '%1',
                lastDummyAlign2: 'RIGHT',
                args0: [
                    {
                        type: 'input_value',
                        name: 'DT'
                    }
                ],
                args1: [
                    {
                        type: 'input_statement',
                        name: 'SUBSTACK'
                    }
                ],
                args2: [
                    {
                        type: 'field_image',
                        src: `${ScratchBlocks.mainWorkspace.options.pathToMedia}repeat.svg`,
                        width: 24,
                        height: 24,
                        alt: '*',
                        flip_rtl: true
                    }
                ],
                category: ScratchBlocks.Categories.control,
                extensions: ['colours_control', 'shape_end']
            });
        }
    };
    ScratchBlocks.Blocks.control_foreachframe_deltatime = {
        init: function () {
            this.jsonInit({
                message0: '經過秒數',
                category: ScratchBlocks.Categories.control,
                extensions: ['colours_control', 'output_number']
            });
        }
    };

    // "for" loop: runs its body with i = FROM, FROM ± 1, ..., TO. The "i" parameter
    // can be dragged out like a custom block parameter (see below). A dragged-out
    // parameter reads the closest enclosing loop with the same name (as the VM does),
    // so loops placed inside each other get different names (i, j, k, ...).
    const FOR_RANGE_NAMES = ['i', 'j', 'k', 'l', 'm', 'n'];
    const forRangeName = function (loop) {
        const shadow = loop.getInputTargetBlock('VAR');
        return shadow ? shadow.getFieldValue('VALUE') : 'i';
    };
    // Loops whose body contains `block`, closest first.
    const enclosingForRanges = function (block) {
        const loops = [];
        let child = block;
        let parent = block.getParent();
        while (parent) {
            if (parent.type === 'control_for_range' && parent.getInputTargetBlock('SUBSTACK') === child) {
                loops.push(parent);
            }
            child = parent;
            parent = parent.getParent();
        }
        return loops;
    };
    const resolveForRange = function (reporter) {
        const name = reporter.getFieldValue('VALUE');
        return enclosingForRanges(reporter).find(loop => forRangeName(loop) === name) || null;
    };
    const renameForRange = function (loop, newName) {
        const body = loop.getInputTargetBlock('SUBSTACK');
        const references = body ? body.getDescendants(false).filter(block =>
            block.type === 'control_for_range_index' && !block.isShadow() && resolveForRange(block) === loop
        ) : [];
        const shadow = loop.getInputTargetBlock('VAR');
        if (shadow) shadow.setFieldValue(newName, 'VALUE');
        for (const reporter of references) {
            reporter.setFieldValue(newName, 'VALUE');
        }
    };
    // Give `loop` and the loops inside it names that are not used by a loop around them.
    const fixForRangeNames = function (loop) {
        const loops = [loop].concat(loop.getDescendants(false).filter(block =>
            block !== loop && block.type === 'control_for_range'
        ));
        for (const inner of loops) {
            const outerNames = enclosingForRanges(inner).map(forRangeName);
            if (outerNames.indexOf(forRangeName(inner)) === -1) continue;
            const innerNames = inner.getDescendants(false)
                .filter(block => block !== inner && block.type === 'control_for_range')
                .map(forRangeName);
            const taken = outerNames.concat(innerNames);
            let newName = FOR_RANGE_NAMES.find(name => taken.indexOf(name) === -1);
            for (let i = 2; !newName; i++) {
                if (taken.indexOf(`i${i}`) === -1) newName = `i${i}`;
            }
            renameForRange(inner, newName);
        }
    };
    ScratchBlocks.Blocks.control_for_range = {
        init: function () {
            this.jsonInit({
                message0: '讓 %1 從 %2 跑到 %3',
                message1: '%1',
                message2: '%1',
                lastDummyAlign2: 'RIGHT',
                args0: [
                    {
                        type: 'input_value',
                        name: 'VAR'
                    },
                    {
                        type: 'input_value',
                        name: 'FROM'
                    },
                    {
                        type: 'input_value',
                        name: 'TO'
                    }
                ],
                args1: [
                    {
                        type: 'input_statement',
                        name: 'SUBSTACK'
                    }
                ],
                args2: [
                    {
                        type: 'field_image',
                        src: `${ScratchBlocks.mainWorkspace.options.pathToMedia}repeat.svg`,
                        width: 24,
                        height: 24,
                        alt: '*',
                        flip_rtl: true
                    }
                ],
                category: ScratchBlocks.Categories.control,
                extensions: ['colours_control', 'shape_statement']
            });
        },
        onchange: function (e) {
            if (e.type !== ScratchBlocks.Events.BLOCK_MOVE || e.blockId !== this.id ||
                !e.newParentId || !e.recordUndo || this.isInFlyout || !this.workspace) {
                return;
            }
            const oldGroup = ScratchBlocks.Events.getGroup();
            ScratchBlocks.Events.setGroup(e.group || true);
            try {
                fixForRangeNames(this);
            } finally {
                ScratchBlocks.Events.setGroup(oldGroup);
            }
        },
        customContextMenu: function (options) {
            if (this.isInFlyout) return;
            options.push({
                text: '重新命名變數',
                enabled: true,
                callback: () => {
                    ScratchBlocks.prompt('新的名稱：', forRangeName(this), newName => {
                        newName = typeof newName === 'string' ? newName.trim() : '';
                        if (!newName || newName === forRangeName(this)) return;
                        ScratchBlocks.Events.setGroup(true);
                        try {
                            renameForRange(this, newName);
                        } finally {
                            ScratchBlocks.Events.setGroup(false);
                        }
                    }, ScratchBlocks.Msg.RENAME_VARIABLE_MODAL_TITLE, ScratchBlocks.BROADCAST_MESSAGE_VARIABLE_TYPE);
                }
            });
        }
    };
    ScratchBlocks.Blocks.control_for_range_index = {
        init: function () {
            this.jsonInit({
                message0: '%1',
                args0: [
                    {
                        type: 'field_label_serializable',
                        name: 'VALUE',
                        text: 'i'
                    }
                ],
                category: ScratchBlocks.Categories.control,
                extensions: ['colours_control', 'output_number']
            });
        }
    };

    // "摺疊區塊": a C block that only groups blocks to make scripts easier to read;
    // its body always runs once. The triangle (field OPEN, "TRUE" or "FALSE") hides
    // the body and turns the block into a comment-coloured stack block, and
    // right-click → 重新命名 changes its name (field NAME).
    const FOLD_TOGGLE_SIZE = 20;
    const FOLD_COMMENT_COLOURS = ['#FEF49C', '#FEE88C', '#BCA903'];
    const FOLD_COMMENT_TEXT = '#575E75';
    const FieldFoldToggle = function (value) {
        ScratchBlocks.FieldImage.call(this, '', FOLD_TOGGLE_SIZE, FOLD_TOGGLE_SIZE, '', false);
        this.setValue(value);
    };
    FieldFoldToggle.prototype = Object.create(ScratchBlocks.FieldImage.prototype);
    FieldFoldToggle.prototype.constructor = FieldFoldToggle;
    FieldFoldToggle.fromJson = options => new FieldFoldToggle(options.value);
    FieldFoldToggle.prototype.EDITABLE = true;
    FieldFoldToggle.prototype.SERIALIZABLE = true;
    FieldFoldToggle.prototype.CURSOR = 'pointer';
    FieldFoldToggle.prototype.init = function () {
        if (this.fieldGroup_) return;
        this.fieldGroup_ = ScratchBlocks.utils.createSvgElement('g', {}, null);
        if (!this.visible_) this.fieldGroup_.style.display = 'none';
        // Transparent box so the whole field is clickable, not only the triangle.
        ScratchBlocks.utils.createSvgElement('rect', {
            'width': FOLD_TOGGLE_SIZE,
            'height': FOLD_TOGGLE_SIZE,
            'fill-opacity': 0
        }, this.fieldGroup_);
        this.arrowElement_ = ScratchBlocks.utils.createSvgElement('path', {
            'stroke-width': 2,
            'stroke-linejoin': 'round'
        }, this.fieldGroup_);
        this.sourceBlock_.getSvgRoot().appendChild(this.fieldGroup_);
        this.updateEditable();
        this.updateArrow_();
        this.mouseDownWrapper_ = ScratchBlocks.bindEventWithChecks_(
            this.fieldGroup_, 'mousedown', this, this.onMouseDown_);
    };
    FieldFoldToggle.prototype.dispose = function () {
        ScratchBlocks.Field.prototype.dispose.call(this);
        this.arrowElement_ = null;
    };
    FieldFoldToggle.prototype.setTooltip = function () {};
    FieldFoldToggle.prototype.getText = function () {
        return '';
    };
    FieldFoldToggle.prototype.getValue = function () {
        return this.open_ ? 'TRUE' : 'FALSE';
    };
    FieldFoldToggle.prototype.setValue = function (newValue) {
        if (newValue === null || typeof newValue === 'undefined') return;
        const oldValue = this.getValue();
        this.open_ = String(newValue).toUpperCase() !== 'FALSE';
        if (!this.sourceBlock_ || oldValue === this.getValue()) return;
        if (ScratchBlocks.Events.isEnabled()) {
            ScratchBlocks.Events.fire(new ScratchBlocks.Events.BlockChange(
                this.sourceBlock_, 'field', this.name, oldValue, this.getValue()));
        }
        this.updateArrow_();
        if (this.sourceBlock_.updateFold_) this.sourceBlock_.updateFold_();
    };
    FieldFoldToggle.prototype.updateArrow_ = function () {
        if (!this.arrowElement_) return;
        const colour = this.open_ ? '#FFFFFF' : FOLD_COMMENT_TEXT;
        this.arrowElement_.setAttribute('d', this.open_ ? 'M5 7 L15 7 L10 14 Z' : 'M7 5 L14 10 L7 15 Z');
        this.arrowElement_.setAttribute('fill', colour);
        this.arrowElement_.setAttribute('stroke', colour);
    };
    FieldFoldToggle.prototype.showEditor_ = function () {
        if (!this.sourceBlock_ || this.sourceBlock_.isInFlyout) return;
        ScratchBlocks.Events.setGroup(true);
        try {
            this.setValue(this.open_ ? 'FALSE' : 'TRUE');
        } finally {
            ScratchBlocks.Events.setGroup(false);
        }
    };
    ScratchBlocks.Field.register('field_fold_toggle', FieldFoldToggle);

    ScratchBlocks.Blocks.control_fold = {
        init: function () {
            this.jsonInit({
                message0: '%1 %2',
                message1: '%1',
                args0: [
                    {
                        type: 'field_fold_toggle',
                        name: 'OPEN',
                        value: 'TRUE'
                    },
                    {
                        type: 'field_label_serializable',
                        name: 'NAME',
                        text: '摺疊區塊'
                    }
                ],
                args1: [
                    {
                        type: 'input_statement',
                        name: 'SUBSTACK'
                    }
                ],
                category: ScratchBlocks.Categories.control,
                extensions: ['colours_control', 'shape_statement']
            });
        },
        // Children can only be hidden once they are connected, so the state from
        // the OPEN field is applied here (and again whenever the field changes).
        initSvg: function () {
            ScratchBlocks.BlockSvg.prototype.initSvg.call(this);
            this.foldReady_ = true;
            this.updateFold_();
        },
        updateFold_: function () {
            if (!this.foldReady_) return;
            const open = this.getFieldValue('OPEN') !== 'FALSE';
            // collapsed_ keeps Blockly from re-enabling the hidden blocks' connections.
            this.collapsed_ = !open;
            const renderList = this.getInput('SUBSTACK').setVisible(open);
            // Insertion markers keep their grey colour.
            if (!this.isInsertionMarker()) {
                const control = ScratchBlocks.Colours.control;
                if (open) {
                    this.setColour(control.primary, control.secondary, control.tertiary, control.quaternary);
                } else {
                    this.setColour(...FOLD_COMMENT_COLOURS, FOLD_COMMENT_COLOURS[2]);
                }
                // setColour only repaints rendered blocks, and render() doesn't repaint,
                // so a block loaded closed would keep the Control colour.
                if (!this.rendered) this.updateColour();
            }
            const label = this.getField('NAME').textElement_;
            if (label) label.style.fill = open ? '' : FOLD_COMMENT_TEXT;
            if (this.rendered) {
                for (const block of renderList.length ? renderList : [this]) {
                    block.render();
                }
            }
        },
        // The OPEN field holds the state; XML's collapsed attribute is ignored.
        setCollapsed: function () {},
        toString: function () {
            return this.getFieldValue('NAME');
        },
        customContextMenu: function (options) {
            if (this.isInFlyout) return;
            options.push({
                text: '重新命名',
                enabled: true,
                callback: () => {
                    ScratchBlocks.prompt('新的名稱：', this.getFieldValue('NAME'), newName => {
                        newName = typeof newName === 'string' ? newName.trim() : '';
                        if (!newName || newName === this.getFieldValue('NAME')) return;
                        ScratchBlocks.Events.setGroup(true);
                        try {
                            this.setFieldValue(newName, 'NAME');
                        } finally {
                            ScratchBlocks.Events.setGroup(false);
                        }
                    }, '重新命名', ScratchBlocks.BROADCAST_MESSAGE_VARIABLE_TYPE);
                }
            });
        }
    };
    // Insertion markers are made with newBlock(), so copy the state to them.
    if (!ScratchBlocks.InsertionMarkerManager.prototype.createMarkerBlock_.twFold) {
        const createMarkerBlock = ScratchBlocks.InsertionMarkerManager.prototype.createMarkerBlock_;
        const patchedCreateMarkerBlock = function (sourceBlock) {
            const marker = createMarkerBlock.call(this, sourceBlock); // eslint-disable-line no-invalid-this
            if (sourceBlock.type === 'control_fold') {
                ScratchBlocks.Events.disable();
                try {
                    marker.setFieldValue(sourceBlock.getFieldValue('OPEN'), 'OPEN');
                } finally {
                    ScratchBlocks.Events.enable();
                }
            }
            return marker;
        };
        patchedCreateMarkerBlock.twFold = true;
        ScratchBlocks.InsertionMarkerManager.prototype.createMarkerBlock_ = patchedCreateMarkerBlock;
    }

    // Multi-line text field of the text block (data_text). Enter starts a new line; Ctrl/⌘+Enter, Tab or clicking
    // somewhere else finishes. Each line is a <tspan>, and the field grows with the text.
    const TEXTAREA_LINE_HEIGHT = 20;
    const TEXTAREA_PADDING_Y = 6;
    const TEXTAREA_PADDING_X = 8;
    const TEXTAREA_MAX_LINE_LENGTH = 80;
    const TEXTAREA_FONT = ['12pt', '"Helvetica Neue", Helvetica, sans-serif', '500'];
    const TEXTAREA_TEXT_COLOUR = '#575E75';
    const FieldTextArea = function (text) {
        ScratchBlocks.FieldTextInput.call(this, text);
    };
    FieldTextArea.prototype = Object.create(ScratchBlocks.FieldTextInput.prototype);
    FieldTextArea.prototype.constructor = FieldTextArea;
    FieldTextArea.fromJson = options => new FieldTextArea(options.text || '');
    FieldTextArea.prototype.init = function () {
        if (this.fieldGroup_) return;
        ScratchBlocks.FieldTextInput.prototype.init.call(this);
        // A white box with dark text, like the text fields of other blocks
        this.textElement_.setAttribute('class', 'blocklyText');
        this.textElement_.setAttribute('text-anchor', 'start');
        this.textElement_.style.fill = TEXTAREA_TEXT_COLOUR;
        if (this.box_) {
            this.box_.setAttribute('fill', '#FFFFFF');
            this.box_.setAttribute('rx', 4);
            this.box_.setAttribute('ry', 4);
        }
        this.render_();
    };
    FieldTextArea.prototype.lines_ = function () {
        return (this.text_ || '').split('\n');
    };
    FieldTextArea.prototype.render_ = function () {
        const lines = this.lines_();
        const height = Math.max(ScratchBlocks.BlockSvg.FIELD_HEIGHT,
            (lines.length * TEXTAREA_LINE_HEIGHT) + (2 * TEXTAREA_PADDING_Y));
        let width = 0;
        const element = this.textElement_;
        if (element) {
            while (element.firstChild) element.removeChild(element.firstChild);
            const top = (height - (lines.length * TEXTAREA_LINE_HEIGHT)) / 2;
            lines.forEach((line, i) => {
                if (line.length > TEXTAREA_MAX_LINE_LENGTH) {
                    line = `${line.substring(0, TEXTAREA_MAX_LINE_LENGTH - 1)}…`;
                }
                // Keep spaces, and give empty lines some width
                const shown = line.replace(/\s/g, ScratchBlocks.Field.NBSP) || ScratchBlocks.Field.NBSP;
                const tspan = ScratchBlocks.utils.createSvgElement('tspan', {
                    x: TEXTAREA_PADDING_X,
                    y: top + (TEXTAREA_LINE_HEIGHT * (i + 0.5))
                }, element);
                tspan.textContent = shown;
                width = Math.max(width, ScratchBlocks.scratchBlocksUtils.measureText(...TEXTAREA_FONT, shown));
            });
        }
        this.size_.width = Math.max(ScratchBlocks.BlockSvg.FIELD_WIDTH, width + (2 * TEXTAREA_PADDING_X));
        this.size_.height = height;
        if (this.box_) {
            this.box_.setAttribute('width', this.size_.width);
            this.box_.setAttribute('height', this.size_.height);
        }
    };
    FieldTextArea.prototype.showEditor_ = function () {
        this.workspace_ = this.sourceBlock_.workspace;
        ScratchBlocks.WidgetDiv.show(this, this.sourceBlock_.RTL, this.widgetDispose_(),
            this.widgetDisposeAnimationFinished_(), ScratchBlocks.FieldTextInput.ANIMATION_TIME);
        const div = ScratchBlocks.WidgetDiv.DIV;
        div.className += ' fieldTextInput';
        const textarea = document.createElement('textarea');
        textarea.className = 'blocklyHtmlInput';
        textarea.setAttribute('spellcheck', 'false');
        Object.assign(textarea.style, {
            resize: 'none',
            overflow: 'hidden',
            textAlign: 'left',
            whiteSpace: 'pre',
            fontSize: TEXTAREA_FONT[0],
            lineHeight: `${TEXTAREA_LINE_HEIGHT}px`,
            padding: `${TEXTAREA_PADDING_Y}px ${TEXTAREA_PADDING_X}px`,
            color: TEXTAREA_TEXT_COLOUR
        });
        ScratchBlocks.FieldTextInput.htmlInput_ = textarea;
        div.appendChild(textarea);
        textarea.value = textarea.defaultValue = this.text_;
        textarea.oldValue_ = null;
        this.validate_();
        this.resizeEditor_();
        textarea.focus();
        textarea.select();
        this.bindEvents_(textarea, false);
        div.style.transition = `box-shadow ${ScratchBlocks.FieldTextInput.ANIMATION_TIME}s`;
        div.style.boxShadow = `0px 0px 0px 4px ${ScratchBlocks.Colours.fieldShadow}`;
    };
    FieldTextArea.prototype.onHtmlInputKeyDown_ = function (e) {
        const textarea = ScratchBlocks.FieldTextInput.htmlInput_;
        if (e.keyCode === 13) {
            // Plain Enter is a new line
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                ScratchBlocks.WidgetDiv.hide();
            }
        } else if (e.keyCode === 27) {
            textarea.value = textarea.defaultValue;
            ScratchBlocks.WidgetDiv.hide();
        } else if (e.keyCode === 9) {
            e.preventDefault();
            ScratchBlocks.WidgetDiv.hide();
        }
    };
    FieldTextArea.prototype.resizeEditor_ = function () {
        const scale = this.sourceBlock_.workspace.scale;
        const div = ScratchBlocks.WidgetDiv.DIV;
        const size = this.getSize();
        const lines = (ScratchBlocks.FieldTextInput.htmlInput_ || {value: ''}).value.split('\n');
        const width = Math.max(size.width, ScratchBlocks.BlockSvg.FIELD_WIDTH_MIN_EDIT) + TEXTAREA_PADDING_X;
        const height = Math.max(size.height, (lines.length * TEXTAREA_LINE_HEIGHT) + (2 * TEXTAREA_PADDING_Y));
        div.style.width = `${width + 1}px`;
        div.style.height = `${height + 1}px`;
        div.style.transform = `scale(${scale})`;
        div.style.borderRadius = '4px';
        div.style.borderColor = this.sourceBlock_.getColourTertiary();
        const xy = this.getAbsoluteXY_();
        div.style.left = `${xy.x - (scale / 2)}px`;
        div.style.top = `${xy.y - (scale / 2)}px`;
    };
    ScratchBlocks.Field.register('field_textarea', FieldTextArea);

    // The text block: text that can have line breaks, with ${path} filled in (see scratch-vm util/data-path.js)
    ScratchBlocks.Blocks.data_text = {
        init: function () {
            this.jsonInit({
                message0: '%1',
                args0: [
                    {
                        type: 'field_textarea',
                        name: 'TEXT',
                        text: ''
                    }
                ],
                category: ScratchBlocks.Categories.data,
                extensions: ['colours_data', 'output_string']
            });
        }
    };

    // Clones have ids: "create clone of [sprite] with id ()" (empty: numbered 1, 2, 3...), and "when I start as a
    // clone (id)", whose id can be dragged out like a custom block parameter
    ScratchBlocks.Blocks.control_create_clone_of = {
        init: function () {
            this.jsonInit({
                message0: '建立 %1 的分身 id = %2',
                args0: [
                    {
                        type: 'input_value',
                        name: 'CLONE_OPTION'
                    },
                    {
                        type: 'input_value',
                        name: 'ID'
                    }
                ],
                category: ScratchBlocks.Categories.control,
                extensions: ['colours_control', 'shape_statement']
            });
        }
    };
    ScratchBlocks.Blocks.control_start_as_clone = {
        init: function () {
            this.jsonInit({
                message0: '當分身產生 %1',
                args0: [
                    {
                        type: 'input_value',
                        name: 'ID'
                    }
                ],
                category: ScratchBlocks.Categories.control,
                extensions: ['colours_control', 'shape_hat']
            });
        }
    };
    ScratchBlocks.Blocks.control_start_as_clone_id = {
        init: function () {
            this.jsonInit({
                message0: '%1',
                args0: [
                    {
                        type: 'field_label_serializable',
                        name: 'VALUE',
                        text: 'id'
                    }
                ],
                category: ScratchBlocks.Categories.control,
                extensions: ['colours_control', 'output_string']
            });
        }
    };

    // "when every frame [update / after update] (seconds)" (ROADMAP.md 6.6): the runtime runs these scripts in
    // order in every frame, see Runtime._runFramePhase in scratch-vm. The seconds since the last frame can be
    // dragged out, like in "for each frame".
    ScratchBlocks.Blocks.control_whenframe = {
        init: function () {
            this.jsonInit({
                message0: '當每幀 %1 %2',
                args0: [
                    {
                        type: 'field_dropdown',
                        name: 'PHASE',
                        options: [
                            ['更新', 'update'],
                            ['更新後', 'lateupdate']
                        ]
                    },
                    {
                        type: 'input_value',
                        name: 'DT'
                    }
                ],
                category: ScratchBlocks.Categories.control,
                extensions: ['colours_control', 'shape_hat']
            });
        }
    };

    // Calling a custom block of another sprite right away, like Snap!'s "tell" (ROADMAP.md 6.6, see
    // scratch-vm/src/engine/cross-call.js). The function menu lists the other sprite's custom blocks by the id of
    // their prototype block, which stays the same when they are renamed; their arguments follow, like on a custom
    // block, named by argument id.
    const ProcedureUtils = ScratchBlocks.ScratchBlocks.ProcedureUtils;
    const crossCallTarget = sprite => {
        if (sprite === '_stage_') return vm.runtime.getTargetForStage();
        if (sprite === '_myself_') return vm.editingTarget;
        return vm.runtime.getSpriteTargetByName(sprite);
    };
    const parseJSON = (text, fallback) => {
        try {
            const value = JSON.parse(text);
            return Array.isArray(value) ? value : fallback;
        } catch (e) {
            return fallback;
        }
    };
    /**
     * @param {?Target} target a sprite or the stage
     * @returns {Array<{id: string, proccode: string, argumentIds: string[], argumentNames: string[]}>} the custom
     * blocks of the target
     */
    const prototypesOf = target => {
        if (!target) return [];
        const blocks = target.blocks._blocks;
        return Object.values(blocks)
            .filter(block => block.opcode === 'procedures_prototype' && block.mutation &&
                blocks[block.parent] && blocks[block.parent].opcode === 'procedures_definition')
            .map(block => ({
                id: block.id,
                proccode: block.mutation.proccode,
                argumentIds: parseJSON(block.mutation.argumentids, []),
                argumentNames: parseJSON(block.mutation.argumentnames, [])
            }))
            .sort((a, b) => collator.compare(a.proccode, b.proccode));
    };
    const procedureLabel = proccode => proccode
        .replace(/(^|[^\\])%[snb]/g, '$1( )')
        .replace(/\\%/g, '%');
    const crossCallSpriteOptions = () => {
        const sprites = vm.runtime.targets
            .filter(target => target.isOriginal && !target.isStage)
            .map(target => target.getName())
            .sort(collator.compare)
            .map(name => [name, name]);
        return [['我自己', '_myself_'], ['舞台', '_stage_'], ...sprites];
    };
    const crossCallBlock = (type, tokens, output) => {
        ScratchBlocks.Blocks[type] = {
            init: function () {
                this.sprite_ = '_myself_';
                this.procCode_ = '';
                this.argumentIds_ = [];
                this.prototypeId_ = '';
                // Like custom blocks: only blocks made from the palette make their own shadows; loaded blocks have
                // them in their XML
                this.generateShadows_ = false;
                this.jsonInit({
                    category: ScratchBlocks.Categories.more,
                    extensions: ['colours_more', output ? 'output_string' : 'shape_statement']
                });
                this.updateDisplay_();
            },
            // The sprite is in the mutation too, since Blockly reads the mutation before the fields
            mutationToDom: function () {
                const container = document.createElement('mutation');
                container.setAttribute('sprite', this.sprite_);
                container.setAttribute('proccode', this.procCode_);
                container.setAttribute('argumentids', JSON.stringify(this.argumentIds_));
                container.setAttribute('prototypeid', this.prototypeId_);
                return container;
            },
            domToMutation: function (xmlElement) {
                this.sprite_ = xmlElement.getAttribute('sprite') || '_myself_';
                this.procCode_ = xmlElement.getAttribute('proccode') || '';
                this.argumentIds_ = parseJSON(xmlElement.getAttribute('argumentids'), []);
                this.prototypeId_ = xmlElement.getAttribute('prototypeid') || '';
                this.generateShadows_ = xmlElement.getAttribute('generateshadows') === 'true';
                this.updateDisplay_();
            },
            /**
             * @returns {?object} the custom block this block calls, as the other sprite has it now
             */
            getPrototype_: function () {
                const prototypes = prototypesOf(crossCallTarget(this.sprite_));
                return prototypes.find(prototype => prototype.id === this.prototypeId_) || null;
            },
            functionOptions_: function () {
                const options = prototypesOf(crossCallTarget(this.sprite_))
                    .map(prototype => [procedureLabel(prototype.proccode), prototype.id]);
                if (this.prototypeId_ && !options.some(option => option[1] === this.prototypeId_)) {
                    // A custom block that isn't there (any more) still shows its name
                    options.push([procedureLabel(this.procCode_) || '?', this.prototypeId_]);
                }
                return options.length ? options : [['（沒有自訂積木）', '']];
            },
            updateDisplay_: function () {
                const wasRendered = this.rendered;
                this.rendered = false;
                // Follows renames of the custom block and changes to its arguments
                const prototype = this.getPrototype_();
                let argumentNames = [];
                if (prototype) {
                    this.procCode_ = prototype.proccode;
                    this.argumentIds_ = prototype.argumentIds;
                    argumentNames = prototype.argumentNames;
                }
                const types = (this.procCode_.match(/(^|[^\\])%[snb]/g) || []).map(match => match.slice(-1));

                const connectionMap = ProcedureUtils.disconnectOldBlocks_.call(this);
                ProcedureUtils.removeAllInputs_.call(this);
                for (const token of tokens) {
                    if (token === 'SPRITE' || token === 'FUNCTION') {
                        const field = token === 'SPRITE' ?
                            new ScratchBlocks.FieldDropdown(crossCallSpriteOptions) :
                            new ScratchBlocks.FieldDropdown(() => this.functionOptions_());
                        this.appendDummyInput(`${token}_INPUT`).appendField(field, token);
                        // Not a change the VM needs to hear about
                        ScratchBlocks.Events.disable();
                        try {
                            field.setValue(token === 'SPRITE' ? this.sprite_ : this.prototypeId_);
                        } finally {
                            ScratchBlocks.Events.enable();
                        }
                    } else if (token === 'ID') {
                        const input = this.appendValueInput('ID');
                        ProcedureUtils.populateArgumentOnCaller_.call(this, 's', 0, connectionMap, 'ID', input);
                    } else {
                        this.appendDummyInput().appendField(token);
                    }
                }
                this.argumentIds_.forEach((id, index) => {
                    const argumentType = types[index] || 's';
                    const name = argumentNames[index];
                    if (name) this.appendDummyInput().appendField(`${name}:`);
                    const input = this.appendValueInput(id);
                    if (argumentType === 'b') input.setCheck('Boolean');
                    ProcedureUtils.populateArgumentOnCaller_.call(this, argumentType, index, connectionMap, id,
                        input);
                });
                ProcedureUtils.deleteShadows_.call(this, connectionMap);
                this.setInputsInline(true);

                this.rendered = wasRendered;
                if (wasRendered && !this.isInsertionMarker()) {
                    this.initSvg();
                    this.render();
                }
            },
            /**
             * Call another custom block: change the mutation and the arguments, and tell the VM.
             * @param {string} sprite the sprite's name, '_myself_' or '_stage_'
             * @param {string} prototypeId id of the custom block's prototype block
             */
            applyPrototype_: function (sprite, prototypeId) {
                const oldMutation = ScratchBlocks.Xml.domToText(this.mutationToDom());
                this.sprite_ = sprite;
                this.prototypeId_ = prototypeId;
                const prototype = this.getPrototype_();
                this.procCode_ = prototype ? prototype.proccode : '';
                this.argumentIds_ = prototype ? prototype.argumentIds : [];
                // New arguments get shadows, and the VM hears about them
                this.generateShadows_ = true;
                this.updateDisplay_();
                const newMutation = ScratchBlocks.Xml.domToText(this.mutationToDom());
                if (oldMutation !== newMutation && ScratchBlocks.Events.isEnabled()) {
                    ScratchBlocks.Events.fire(new ScratchBlocks.Events.BlockChange(
                        this, 'mutation', null, oldMutation, newMutation));
                }
            },
            onchange: function (event) {
                if (event.type !== ScratchBlocks.Events.CHANGE || event.blockId !== this.id ||
                    event.element !== 'field') {
                    return;
                }
                if (event.name === 'SPRITE' && event.newValue !== this.sprite_) {
                    // Another sprite: its first custom block
                    const prototypes = prototypesOf(crossCallTarget(event.newValue));
                    const first = prototypes.length ? prototypes[0].id : '';
                    const oldPrototypeId = this.prototypeId_;
                    this.applyPrototype_(event.newValue, first);
                    // The menu was made again with the new value, so the VM is told here
                    if (oldPrototypeId !== first && ScratchBlocks.Events.isEnabled()) {
                        ScratchBlocks.Events.fire(new ScratchBlocks.Events.BlockChange(
                            this, 'field', 'FUNCTION', oldPrototypeId, first));
                    }
                } else if (event.name === 'FUNCTION' && event.newValue !== this.prototypeId_) {
                    this.applyPrototype_(this.sprite_, event.newValue);
                }
            },
            attachShadow_: ProcedureUtils.attachShadow_,
            buildShadowDom_: ProcedureUtils.buildShadowDom_
        };
    };
    crossCallBlock('procedures_callsprite', ['呼叫', 'SPRITE', '的', 'FUNCTION'], false);
    crossCallBlock('procedures_callsprite_each', ['對每個', 'SPRITE', '呼叫', 'FUNCTION'], false);
    crossCallBlock('procedures_callsprite_id', ['對 id 為', 'ID', '的', 'SPRITE', '呼叫', 'FUNCTION'], false);
    crossCallBlock('procedures_callsprite_reporter', ['從', 'SPRITE', '呼叫', 'FUNCTION'], true);

    // Extension reporters used as ArgumentType.PARAMETER behave like custom block
    // parameters: they render as normal reporters and dragging one makes a copy.
    if (!ScratchBlocks.scratchBlocksUtils.isShadowArgumentReporter.twParameters) {
        const isShadowArgumentReporter = ScratchBlocks.scratchBlocksUtils.isShadowArgumentReporter;
        const patched = function (block) {
            return isShadowArgumentReporter(block) ||
                (block.isShadow() && patched.vm.runtime.isParameterReporter(block.type));
        };
        patched.twParameters = true;
        ScratchBlocks.scratchBlocksUtils.isShadowArgumentReporter = patched;
    }
    ScratchBlocks.scratchBlocksUtils.isShadowArgumentReporter.vm = vm;

    // Blocks wants to know if 3D CSS transforms are supported. The cross
    // section of browsers Scratch supports and browsers that support 3D CSS
    // transforms will make the return always true.
    //
    // Shortcutting to true lets us skip an expensive style recalculation when
    // first loading the Scratch editor.
    ScratchBlocks.utils.is3dSupported = function () {
        return true;
    };

    return ScratchBlocks;
}

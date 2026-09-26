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

    const spriteMenu = function () {
        const sprites = [];
        for (const targetId in vm.runtime.targets) {
            if (!Object.prototype.hasOwnProperty.call(vm.runtime.targets, targetId)) continue;
            if (vm.runtime.targets[targetId].isOriginal) {
                if (!vm.runtime.targets[targetId].isStage) {
                    if (vm.runtime.targets[targetId] === vm.editingTarget) {
                        continue;
                    }
                    sprites.push([vm.runtime.targets[targetId].sprite.name, vm.runtime.targets[targetId].sprite.name]);
                }
            }
        }
        return sprites;
    };

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
        const json = jsonForMenuBlock('TOWARDS', spriteMenu, motionColors, [
            [mouse, '_mouse_'],
            [random, '_random_']
        ]);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.motion_goto_menu.init = function () {
        const random = ScratchBlocks.ScratchMsgs.translate('MOTION_GOTO_RANDOM', 'random position');
        const mouse = ScratchBlocks.ScratchMsgs.translate('MOTION_GOTO_POINTER', 'mouse-pointer');
        const json = jsonForMenuBlock('TO', spriteMenu, motionColors, [
            [random, '_random_'],
            [mouse, '_mouse_']
        ]);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.motion_glideto_menu.init = function () {
        const random = ScratchBlocks.ScratchMsgs.translate('MOTION_GLIDETO_RANDOM', 'random position');
        const mouse = ScratchBlocks.ScratchMsgs.translate('MOTION_GLIDETO_POINTER', 'mouse-pointer');
        const json = jsonForMenuBlock('TO', spriteMenu, motionColors, [
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
                return spriteOptions.concat(spriteVariableMenuItems);
            }
            return [['', '']];
        };

        const json = jsonForSensingMenus(menuFn);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.sensing_distancetomenu.init = function () {
        const mouse = ScratchBlocks.ScratchMsgs.translate('SENSING_DISTANCETO_POINTER', 'mouse-pointer');
        const json = jsonForMenuBlock('DISTANCETOMENU', spriteMenu, sensingColors, [
            [mouse, '_mouse_']
        ]);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.sensing_touchingobjectmenu.init = function () {
        const mouse = ScratchBlocks.ScratchMsgs.translate('SENSING_TOUCHINGOBJECT_POINTER', 'mouse-pointer');
        const edge = ScratchBlocks.ScratchMsgs.translate('SENSING_TOUCHINGOBJECT_EDGE', 'edge');
        const json = jsonForMenuBlock('TOUCHINGOBJECTMENU', spriteMenu, sensingColors, [
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

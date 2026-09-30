/**
 * The blocks of the outputs of components (ROADMAP.md 階段 10, scratch-vm engine/components.js): a component says
 * something to the outside with "發出 [輸出] 次數: ( ) 開啟: < >", and the level around it hears it with
 * "當 [實體] 發出 [輸出]", whose arguments can be dragged out. Both are made from the output as the component has it,
 * so renaming, moving and adding arguments changes them; the arguments are named by the ids of the output's
 * arguments, which stay when they are renamed or moved. The VM knows the blocks by their opcodes (extensions/
 * tw_components), scratch-blocks gets the shapes from here.
 */

const COLORS = {
    colour: '#1f9e8f',
    colourSecondary: '#1b8a7d',
    colourTertiary: '#16756a',
    colourQuaternary: '#16756a'
};

const ANY = '_any_';

const parseJSON = (text, fallback) => {
    try {
        const value = JSON.parse(text);
        return Array.isArray(value) ? value : fallback;
    } catch (e) {
        return fallback;
    }
};

/**
 * @param {string} proccode words and %s / %b, like a custom block
 * @returns {string} what to show for it in a menu
 */
const outputLabel = proccode => proccode
    .replace(/(^|[^\\])%[snb]/g, '$1( )')
    .replace(/\\%/g, '%');

/**
 * @param {string} proccode words and %s / %b, like a custom block
 * @returns {string[]} the types ('s' or 'b') of its arguments
 */
const argumentTypesOf = proccode => (proccode.match(/(^|[^\\])%[snb]/g) || [])
    .map(match => (match.slice(-1) === 'b' ? 'b' : 's'));

/**
 * @param {VM} vm the VM
 * @returns {{outputsOfHolder: function(): Array<object>, outputsOfSprite: function(string): Array<object>,
 * senders: function(): Array<Array<string>>}} what the blocks ask the VM
 */
const componentQueries = vm => {
    const components = () => vm.runtime.components;
    return {
        // The outputs of the component that the sprite being edited is in
        outputsOfHolder: () => {
            const holder = components().holderOf(vm.editingTarget);
            return holder ? holder.sprite.component.outputs : [];
        },
        // The outputs of the component an instance (or "any instance") is of
        outputsOfSprite: name => {
            const definition = name ? components().definitionOf(name, vm.editingTarget) : null;
            return definition ? definition.component.outputs : [];
        },
        // [text, value] of the instances the sprite being edited can name, and "any instance" of each component
        senders: () => {
            const holder = components().holderOf(vm.editingTarget);
            const items = [];
            for (const definition of components().definitions.values()) {
                if (holder && components().contains(definition, holder.sprite)) continue;
                const instances = holder ?
                    components().membersOf(holder)
                        .filter(member => member.sprite === definition) :
                    components().instancesOf(definition)
                        .filter(instance => !instance.componentOwner);
                for (const instance of instances) items.push([instance.getName(), instance.getName()]);
                items.push([`任一個${definition.name}`, `${ANY}${definition.name}`]);
            }
            return items;
        }
    };
};

/**
 * Define the blocks of outputs in scratch-blocks.
 * @param {object} ScratchBlocks the scratch-blocks wrapper of lib/tw-lazy-scratch-blocks
 * @param {VM} vm the VM
 */
const defineComponentBlocks = (ScratchBlocks, vm) => {
    const ProcedureUtils = ScratchBlocks.ScratchBlocks.ProcedureUtils;
    const queries = componentQueries(vm);
    const quiet = fn => {
        // Not a change the VM needs to hear about
        ScratchBlocks.Events.disable();
        try {
            fn();
        } finally {
            ScratchBlocks.Events.enable();
        }
    };

    /**
     * The words of an output with its arguments as inputs in between, like a call of a custom block, the inputs named
     * by the ids of the arguments.
     * @param {object} block the block
     * @param {function(object, string, number, string)} populate puts something in an input: (input, type, index, id)
     */
    const appendWordsAndInputs = (block, populate) => {
        const parts = block.procCode_.split(/(?=[^\\]%[nbs])/).map(part => part.trim());
        let count = 0;
        for (const part of parts) {
            if (!part) continue;
            let text = part;
            if (part.startsWith('%')) {
                const type = part.charAt(1) === 'b' ? 'b' : 's';
                const id = block.argumentIds_[count];
                if (typeof id !== 'undefined') {
                    const input = block.appendValueInput(id);
                    if (type === 'b') input.setCheck('Boolean');
                    populate(input, type, count, id);
                }
                count++;
                text = part.substring(2).trim();
            }
            text = text.replace(/\\%/g, '%');
            if (text) block.appendDummyInput().appendField(new ScratchBlocks.FieldLabel(text));
        }
    };

    // A field that holds an id and doesn't show it (the value of a field is what it shows, so it is hidden)
    const hiddenField = value => {
        const field = new ScratchBlocks.FieldLabelSerializable('');
        field.getValue = () => value;
        field.setVisible(false);
        return field;
    };

    /**
     * Follow the output the block says: its words and arguments as the component has them now.
     * @param {object} block the block
     * @param {Array<object>} outputs the outputs the component has
     * @returns {?object} the output, if the component still has it
     */
    const refresh = (block, outputs) => {
        const output = outputs.find(o => o.id === block.port_) || null;
        if (output) {
            block.procCode_ = output.proccode;
            block.argumentIds_ = output.params.map(p => p.id);
            block.argumentNames_ = output.params.map(p => p.name);
        }
        return output;
    };

    const mutationOf = block => {
        const container = document.createElement('mutation');
        container.setAttribute('port', block.port_);
        container.setAttribute('proccode', block.procCode_);
        container.setAttribute('argumentids', JSON.stringify(block.argumentIds_));
        container.setAttribute('argumentnames', JSON.stringify(block.argumentNames_));
        if (block.sprite_ !== null) container.setAttribute('sprite', block.sprite_);
        return container;
    };

    const readMutation = (block, xml) => {
        block.port_ = xml.getAttribute('port') || '';
        block.procCode_ = xml.getAttribute('proccode') || '';
        block.argumentIds_ = parseJSON(xml.getAttribute('argumentids'), []);
        block.argumentNames_ = parseJSON(xml.getAttribute('argumentnames'), []);
        if (block.sprite_ !== null && xml.getAttribute('sprite') !== null) block.sprite_ = xml.getAttribute('sprite');
        block.generateShadows_ = xml.getAttribute('generateshadows') === 'true';
    };

    const rerender = (block, wasRendered) => {
        block.rendered = wasRendered;
        if (wasRendered && !block.isInsertionMarker()) {
            block.initSvg();
            block.render();
        }
    };

    // 發出 [輸出] 次數: ( ) 開啟: < >
    const emitBlock = (opcode, suffix) => {
        ScratchBlocks.Blocks[opcode] = {
            init: function () {
                this.sprite_ = null;
                this.port_ = '';
                this.procCode_ = '';
                this.argumentIds_ = [];
                this.argumentNames_ = [];
                this.generateShadows_ = false;
                this.jsonInit(Object.assign({extensions: ['shape_statement']}, COLORS));
                this.updateDisplay_();
            },
            mutationToDom: function () {
                return mutationOf(this);
            },
            domToMutation: function (xml) {
                readMutation(this, xml);
                this.updateDisplay_();
            },
            outputs_: function () {
                const outputs = queries.outputsOfHolder();
                return outputs;
            },
            updateDisplay_: function () {
                const wasRendered = this.rendered;
                this.rendered = false;
                refresh(this, this.outputs_());
                const connectionMap = ProcedureUtils.disconnectOldBlocks_.call(this);
                ProcedureUtils.removeAllInputs_.call(this);
                const row = this.appendDummyInput('PORT_INPUT')
                    .appendField('發出')
                    .appendField(hiddenField(this.port_), 'PORT');
                if (suffix) row.appendField(suffix);
                appendWordsAndInputs(this, (input, type, index, id) => {
                    ProcedureUtils.populateArgumentOnCaller_.call(this, type, index, connectionMap, id, input);
                });
                ProcedureUtils.deleteShadows_.call(this, connectionMap);
                this.setInputsInline(true);
                rerender(this, wasRendered);
            },
            customContextMenu: function (options) {
                if (this.workspace.isFlyout) return;
                const edit = ScratchBlocks.twEditOutput;
                if (!edit) return;
                options.push({
                    text: '編輯這個輸出',
                    enabled: true,
                    callback: () => edit(this.port_)
                });
            },
            attachShadow_: ProcedureUtils.attachShadow_,
            buildShadowDom_: ProcedureUtils.buildShadowDom_
        };
    };
    emitBlock('twcomp_emit', '');
    emitBlock('twcomp_emitAndWait', '並等待');

    // The arguments of an output as reporters in the hat: they show the name, and are named by the id
    ScratchBlocks.Blocks.twcomp_outputParam = {
        init: function () {
            this.port_ = '';
            this.param_ = '';
            this.paramName_ = '';
            this.paramType_ = 's';
            this.jsonInit(Object.assign({output: 'String', outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND}, COLORS));
            this.updateDisplay_();
        },
        mutationToDom: function () {
            const container = document.createElement('mutation');
            container.setAttribute('port', this.port_);
            container.setAttribute('param', this.param_);
            container.setAttribute('name', this.paramName_);
            container.setAttribute('ptype', this.paramType_);
            return container;
        },
        domToMutation: function (xml) {
            this.port_ = xml.getAttribute('port') || '';
            this.param_ = xml.getAttribute('param') || '';
            this.paramName_ = xml.getAttribute('name') || '';
            this.paramType_ = xml.getAttribute('ptype') === 'b' ? 'b' : 's';
            this.updateDisplay_();
        },
        updateDisplay_: function () {
            const wasRendered = this.rendered;
            this.rendered = false;
            while (this.inputList.length) this.removeInput(this.inputList[0].name);
            const boolean = this.paramType_ === 'b';
            this.setOutput(true, boolean ? 'Boolean' : null);
            this.setOutputShape(boolean ? ScratchBlocks.OUTPUT_SHAPE_HEXAGONAL : ScratchBlocks.OUTPUT_SHAPE_ROUND);
            // The value of a field is its text; these show the name and are the ids
            const label = (text, value) => {
                const field = new ScratchBlocks.FieldLabelSerializable(text);
                field.getValue = () => value;
                return field;
            };
            const port = label('', this.port_);
            port.setVisible(false);
            this.appendDummyInput()
                .appendField(label(this.paramName_, this.param_), 'PARAM')
                .appendField(port, 'PORT');
            rerender(this, wasRendered);
        }
    };

    // 當 [實體] 發出 [輸出] (次數) (開啟): a hat that has the arguments as reporters to drag out
    ScratchBlocks.Blocks.twcomp_whenOutput = {
        init: function () {
            this.sprite_ = '';
            this.port_ = '';
            this.procCode_ = '';
            this.argumentIds_ = [];
            this.argumentNames_ = [];
            this.generateShadows_ = false;
            this.jsonInit(Object.assign({extensions: ['shape_hat']}, COLORS));
            this.updateDisplay_();
        },
        mutationToDom: function () {
            return mutationOf(this);
        },
        domToMutation: function (xml) {
            readMutation(this, xml);
            this.updateDisplay_();
        },
        outputs_: function () {
            return queries.outputsOfSprite(this.sprite_);
        },
        // What a component inside says, the component says too: an output made from this one
        customContextMenu: function (options) {
            if (this.workspace.isFlyout || !this.sprite_ || this.sprite_.startsWith(ANY) || !this.port_) return;
            const forward = ScratchBlocks.twForwardOutput;
            if (!forward) return;
            options.push({
                text: '轉發成這個元件的輸出',
                enabled: true,
                callback: () => forward(this.sprite_, this.port_)
            });
        },
        // The shadow of an argument: a reporter with its name
        buildParamShadow_: function (index) {
            const id = this.argumentIds_[index];
            const type = argumentTypesOf(this.procCode_)[index] || 's';
            const escaped = String(this.argumentNames_[index] || '')
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;');
            return ScratchBlocks.Xml.textToDom(`<shadow type="twcomp_outputParam"><mutation ` +
                `port="${this.port_}" param="${id}" name="${escaped}" ptype="${type}"></mutation></shadow>`);
        },
        updateDisplay_: function () {
            const wasRendered = this.rendered;
            this.rendered = false;
            refresh(this, this.outputs_());
            const connectionMap = ProcedureUtils.disconnectOldBlocks_.call(this);
            ProcedureUtils.removeAllInputs_.call(this);
            const spriteField = new ScratchBlocks.FieldDropdown(() => {
                const items = queries.senders();
                if (this.sprite_ && !items.some(item => item[1] === this.sprite_)) {
                    items.push([this.sprite_.replace(ANY, '任一個'), this.sprite_]);
                }
                return items.length ? items : [['（沒有元件）', '']];
            });
            this.appendDummyInput('SPRITE_INPUT')
                .appendField('當')
                .appendField(spriteField, 'SPRITE')
                .appendField(hiddenField(this.port_), 'PORT');
            quiet(() => spriteField.setValue(this.sprite_));
            appendWordsAndInputs(this, (input, type, index, id) => {
                const old = connectionMap && connectionMap[id];
                if (old && old.block) {
                    old.block.outputConnection.connect(input.connection);
                    connectionMap[id] = null;
                }
                if (this.generateShadows_ || !old) {
                    input.connection.setShadowDom(this.buildParamShadow_(index));
                    if (this.generateShadows_ && !input.connection.targetBlock()) {
                        quiet(() => {
                            const shadow = ScratchBlocks.Xml.domToBlock(this.buildParamShadow_(index), this.workspace);
                            shadow.setShadow(true);
                            input.connection.connect(shadow.outputConnection);
                        });
                    }
                }
            });
            ProcedureUtils.deleteShadows_.call(this, connectionMap);
            this.setInputsInline(true);
            rerender(this, wasRendered);
        },
        onchange: function (event) {
            if (event.type !== ScratchBlocks.Events.CHANGE || event.blockId !== this.id ||
                event.element !== 'field' || event.name !== 'SPRITE' || event.newValue === this.sprite_) {
                return;
            }
            // Another instance: the same output, or the first one if it is another component
            const oldMutation = ScratchBlocks.Xml.domToText(this.mutationToDom());
            this.sprite_ = event.newValue;
            const outputs = this.outputs_();
            if (!outputs.some(o => o.id === this.port_)) this.port_ = outputs.length ? outputs[0].id : '';
            this.generateShadows_ = true;
            this.updateDisplay_();
            const newMutation = ScratchBlocks.Xml.domToText(this.mutationToDom());
            if (oldMutation !== newMutation && ScratchBlocks.Events.isEnabled()) {
                ScratchBlocks.Events.fire(new ScratchBlocks.Events.BlockChange(
                    this, 'mutation', null, oldMutation, newMutation));
            }
        }
    };
};

export {
    defineComponentBlocks,
    outputLabel,
    argumentTypesOf,
    COLORS
};

// Warnings on blocks whose timing is easy to get wrong (ROADMAP.md 6.6):
// - "when every frame" scripts that wait: while one waits, the sprite skips its per-frame script in every frame
// - calls to custom blocks of other sprites that wait: the caller (e.g. the whole game loop) waits with them

// Blocks that take more than one frame
const WAITING_BLOCKS = new Set([
    'control_wait',
    'control_wait_until',
    'control_forever',
    'control_foreachframe',
    'motion_glidesecstoxy',
    'motion_glideto',
    'motion3d_glidexyz',
    'motion3d_glidetoposition',
    'looks_sayforsecs',
    'looks_thinkforsecs',
    'looks3d_playanimationuntildone',
    'sound_playuntildone',
    'event_broadcastandwait',
    'sensing_askandwait'
]);

const CROSS_CALL_BLOCKS = new Set([
    'procedures_callsprite',
    'procedures_callsprite_each',
    'procedures_callsprite_id',
    'procedures_callsprite_reporter'
]);

const FRAME_HAT_WARNING = '這段每幀的程式裡有會等待的積木（等待、滑行、廣播並等待、重複無限次等）。' +
    '等待期間，這個角色每一幀的這段程式都會被跳過。隨時間進行的流程請寫成一般的程式。';
const CROSS_CALL_WARNING = '被呼叫的函式裡有會等待的積木：呼叫它的程式（例如整個遊戲迴圈）會一起停下來等。';

/**
 * @param {object} blocks the VM's blocks of a target
 * @param {string} topId a block of the target
 * @returns {boolean} true if the blocks from there on, or custom blocks they use, wait
 */
const vmScriptWaits = (blocks, topId) => {
    const seen = new Set();
    const pending = [topId];
    while (pending.length) {
        const id = pending.pop();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const block = blocks.getBlock(id);
        if (!block) continue;
        if (WAITING_BLOCKS.has(block.opcode)) return true;
        if (block.opcode === 'procedures_call' && block.mutation) {
            pending.push(blocks.getProcedureDefinition(block.mutation.proccode));
        }
        pending.push(block.next);
        for (const input of Object.values(block.inputs)) pending.push(input.block);
    }
    return false;
};

/**
 * @param {VirtualMachine} vm the VM, which has the blocks of every sprite
 * @param {object} block a cross-sprite call block of the workspace
 * @returns {boolean} true if the custom block it calls waits
 */
const calledProcedureWaits = (vm, block) => {
    const sprite = block.sprite_;
    let target;
    if (sprite === '_stage_') target = vm.runtime.getTargetForStage();
    else if (sprite === '_myself_') target = vm.editingTarget;
    else target = vm.runtime.getSpriteTargetByName(sprite);
    if (!target) return false;
    const prototype = target.blocks.getBlock(block.prototypeId_);
    const definition = prototype && target.blocks.getBlock(prototype.parent);
    return !!definition && vmScriptWaits(target.blocks, definition.next);
};

/**
 * Add or remove the warnings of every block in the workspace.
 * @param {ScratchBlocks.WorkspaceSvg} workspace the code area
 * @param {VirtualMachine} vm the VM, which has the blocks of every sprite
 */
const updateBlockHints = (workspace, vm) => {
    if (!workspace || (workspace.isDragging && workspace.isDragging())) return;
    for (const block of workspace.getAllBlocks()) {
        let warning = null;
        if (block.type === 'control_whenframe') {
            if (block.getDescendants(false).some(child => WAITING_BLOCKS.has(child.type))) warning = FRAME_HAT_WARNING;
        } else if (CROSS_CALL_BLOCKS.has(block.type)) {
            if (calledProcedureWaits(vm, block)) warning = CROSS_CALL_WARNING;
        } else {
            continue;
        }
        const current = block.warning ? block.warning.getText() : null;
        if (current !== warning) block.setWarningText(warning);
    }
};

export default updateBlockHints;

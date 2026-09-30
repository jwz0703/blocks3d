import {Template, readPath} from 'scratch-vm/src/engine/svg-bindings';

const cache = new Map();

/**
 * @param {VM} vm the VM
 * @param {string} targetId a sprite or instance
 * @returns {?string} a data URL of the target's costume with the values of its SVG bindings (see scratch-vm
 * engine/svg-bindings.js), or null if its costume has none
 */
const boundCostumeURL = (vm, targetId) => {
    const target = vm.runtime.getTargetById(targetId);
    if (!target || target.is3D || !target.getCostumes) return null;
    const costume = target.getCostumes()[target.currentCostume];
    const source = costume && costume.svgBindingSource;
    if (!source) return null;
    let template = cache.get(source);
    if (!template) {
        try {
            template = new Template(source);
        } catch (e) {
            return null;
        }
        if (cache.size > 50) cache.clear();
        cache.set(source, template);
    }
    if (!template.document || !template.bound) return null;
    const svg = template.render(template.evaluate(node => readPath(target, node), null));
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

export default boundCostumeURL;

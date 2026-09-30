import paper from '@turbowarp/paper';
import {isBoundsItem, getRootItem} from './item';
import {hoverBounds, hoverItem} from './guides';
import {isGroupChild} from './group';
import {sortItemsByZIndex} from './math';

/**
 * @param {!MouseEvent} event mouse event
 * @param {?object} hitOptions hit options to use
 * @param {?boolean} subselect Whether items within groups can be hovered. If false, the
 *    entire group should be hovered.
 * @return {paper.Item} the hovered item or null if there is none
 */
const getHoveredItem = function (event, hitOptions, subselect) {
    const oldMatch = hitOptions.match;
    hitOptions.match = hitResult => {
        if (hitResult.item.data && hitResult.item.data.noHover) return false;
        return oldMatch ? oldMatch(hitResult) : true;
    };
    const hitResults = paper.project.hitTestAll(event.point, hitOptions);
    if (hitResults.length === 0) {
        return null;
    }

    // Get highest z-index result
    let hitResult;
    for (const result of hitResults) {
        if (!hitResult || sortItemsByZIndex(hitResult.item, result.item) < 0) {
            hitResult = result;
        }
    }
    let item = hitResult.item;
    // If the hovered item is already selected, then there should be no hovered item.
    if (!item || item.selected) {
        return null;
    }
    // Parts of the picture of a code object (helper/bindings.js) can't be edited on their own: the whole of it
    let codeObject = null;
    for (let parent = item.parent; parent; parent = parent.parent) {
        if (parent.data && typeof parent.data.codeBinding === 'string') codeObject = parent;
    }
    if (codeObject) {
        if (subselect || codeObject.selected) return null;
        item = codeObject;
    }

    let hoverGuide;
    if (codeObject) {
        hoverGuide = hoverBounds(getRootItem(codeObject));
    } else if (isBoundsItem(item)) {
        hoverGuide = hoverBounds(item);
    } else if (!subselect && isGroupChild(item)) {
        hoverGuide = hoverBounds(getRootItem(item));
    } else {
        hoverGuide = hoverItem(item);
    }
    hoverGuide.data.hitResult = hitResult;

    return hoverGuide;
};

export {
    getHoveredItem
};

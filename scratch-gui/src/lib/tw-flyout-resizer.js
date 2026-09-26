// Lets the block palette (flyout) be resized by dragging its edge.
// Dragging it narrower than COLLAPSE_WIDTH hides it; clicking any category brings it back.

const STORAGE_KEY = 'tw:flyout-width';
const COLLAPSE_WIDTH = 60;
const MIN_WIDTH = 120;
const MIN_WORKSPACE_WIDTH = 150;
const HANDLE_WIDTH = 6;

const readStoredWidth = () => {
    try {
        const width = +localStorage.getItem(STORAGE_KEY);
        return width >= MIN_WIDTH ? width : null;
    } catch (e) {
        return null;
    }
};

const storeWidth = width => {
    try {
        localStorage.setItem(STORAGE_KEY, `${width}`);
    } catch (e) {
        // ignore
    }
};

/**
 * @param {*} ScratchBlocks scratch-blocks
 * @param {*} workspace The main workspace
 * @returns {function} Removes the resizer
 */
const installFlyoutResizer = (ScratchBlocks, workspace) => {
    const toolbox = workspace.getToolbox();
    const flyout = workspace.getFlyout();
    if (!toolbox || !flyout || workspace.horizontalLayout) return () => {};

    const rtl = workspace.RTL;
    const categoryWidth = toolbox.getWidth() - flyout.DEFAULT_WIDTH;
    const injectionDiv = workspace.getInjectionDiv();

    let width = flyout.DEFAULT_WIDTH;
    let lastOpenWidth = readStoredWidth() || width;
    const isCollapsed = () => width === 0;

    const handle = document.createElement('div');
    handle.className = 'tw-flyout-resizer';
    injectionDiv.appendChild(handle);

    const updateHandle = () => {
        const edge = `${categoryWidth + width}px`;
        handle.style.left = rtl ? '' : edge;
        handle.style.right = rtl ? edge : '';
    };

    const setWidth = newWidth => {
        width = newWidth;
        // Flyout.getWidth() returns DEFAULT_WIDTH, and the workspace is laid out after toolbox.width
        flyout.DEFAULT_WIDTH = width;
        toolbox.width = categoryWidth + width;
        flyout.setVisible(!isCollapsed());
        updateHandle();
        ScratchBlocks.svgResize(workspace);
    };

    const expand = () => {
        if (isCollapsed()) setWidth(lastOpenWidth);
    };

    // Rendering the toolbox always shows the flyout, so hide it again while collapsed.
    const originalShow = flyout.show;
    flyout.show = function (...args) {
        const result = originalShow.apply(this, args);
        if (isCollapsed()) this.setVisible(false);
        return result;
    };

    // Clicking a category (even the selected one) scrolls to it, which should reopen the flyout.
    const originalScrollToCategoryById = toolbox.scrollToCategoryById;
    toolbox.scrollToCategoryById = function (...args) {
        expand();
        return originalScrollToCategoryById.apply(this, args);
    };
    const originalScrollToCategoryByName = toolbox.scrollToCategoryByName;
    toolbox.scrollToCategoryByName = function (...args) {
        expand();
        return originalScrollToCategoryByName.apply(this, args);
    };

    let dragFrame = null;
    let pendingWidth = null;

    let dragging = false;
    // Assigned below; handlePointerMove and endDrag refer to each other
    let endDrag = null;

    const handlePointerMove = e => {
        // A missed pointerup leaves no buttons pressed; end the drag instead of following the mouse
        if (e.buttons === 0) {
            endDrag();
            return;
        }
        const rect = injectionDiv.getBoundingClientRect();
        const fromEdge = rtl ? rect.right - e.clientX : e.clientX - rect.left;
        const maxWidth = Math.max(MIN_WIDTH, rect.width - categoryWidth - MIN_WORKSPACE_WIDTH);
        let newWidth = Math.round(fromEdge - categoryWidth);
        if (newWidth < COLLAPSE_WIDTH) {
            newWidth = 0;
        } else {
            newWidth = Math.min(maxWidth, Math.max(MIN_WIDTH, newWidth));
        }
        pendingWidth = newWidth;
        if (dragFrame === null) {
            dragFrame = requestAnimationFrame(() => {
                dragFrame = null;
                if (pendingWidth !== width) setWidth(pendingWidth);
            });
        }
    };

    endDrag = e => {
        if (!dragging) return;
        dragging = false;
        if (e && handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
        handle.removeEventListener('pointermove', handlePointerMove);
        handle.removeEventListener('pointerup', endDrag);
        handle.removeEventListener('pointercancel', endDrag);
        handle.removeEventListener('lostpointercapture', endDrag);
        handle.classList.remove('tw-flyout-resizer-active');
        document.body.style.cursor = '';
        if (dragFrame !== null) {
            cancelAnimationFrame(dragFrame);
            dragFrame = null;
            if (pendingWidth !== width) setWidth(pendingWidth);
        }
        if (!isCollapsed()) {
            lastOpenWidth = width;
            storeWidth(width);
        }
    };

    const handlePointerDown = e => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        workspace.cancelCurrentGesture();
        ScratchBlocks.hideChaff();
        dragging = true;
        handle.setPointerCapture(e.pointerId);
        handle.addEventListener('pointermove', handlePointerMove);
        handle.addEventListener('pointerup', endDrag);
        handle.addEventListener('pointercancel', endDrag);
        handle.addEventListener('lostpointercapture', endDrag);
        handle.classList.add('tw-flyout-resizer-active');
        document.body.style.cursor = 'col-resize';
    };

    // Double click toggles between collapsed and open.
    const handleDoubleClick = () => {
        if (isCollapsed()) {
            expand();
        } else {
            setWidth(0);
        }
    };

    handle.addEventListener('pointerdown', handlePointerDown);
    handle.addEventListener('dblclick', handleDoubleClick);
    handle.style.width = `${HANDLE_WIDTH}px`;

    setWidth(lastOpenWidth);

    return () => {
        endDrag();
        if (dragFrame !== null) cancelAnimationFrame(dragFrame);
        document.body.style.cursor = '';
        handle.remove();
        flyout.show = originalShow;
        toolbox.scrollToCategoryById = originalScrollToCategoryById;
        toolbox.scrollToCategoryByName = originalScrollToCategoryByName;
    };
};

export default installFlyoutResizer;

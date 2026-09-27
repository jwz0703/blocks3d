// tw: player for projects exported with "Export as HTML" / "Export as ZIP".
// The page that loads this script sets window.TWStandaloneData first.
// This intentionally does not use the GUI so exported files only contain what is needed to run the project.

import '../lib/tw-polyfill';

import VM from 'scratch-vm';
import Renderer from 'scratch-render';
import AudioEngine from 'scratch-audio';
import ScratchStorage from '@turbowarp/scratch-storage';
import {BitmapAdapter as V2BitmapAdapter} from '@turbowarp/scratch-svg-renderer';
import {loadFonts} from 'scratch-render-fonts';
import VideoProvider from '../lib/video/video-provider';
import {getEventXY} from '../lib/touch-utils';

/**
 * @typedef StandaloneData
 * @property {string} project base64 encoded .3dsb
 * @property {string} [title]
 */

/** @type {StandaloneData} */
const data = window.TWStandaloneData || {};

/**
 * Fonts that could be used by security prompts, same as the editor.
 */
const SECURITY_CRITICAL_FONTS = [
    'Helvetica Neue',
    'Helvetica',
    'Arial'
];

const decodeBase64 = base64 => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
};

const projectData = data.project ? decodeBase64(data.project) : null;
// Free the big string, the ArrayBuffer is all we need from now on
data.project = null;

if (data.title) {
    document.title = data.title;
}

const style = document.createElement('style');
style.textContent = `
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
#app { position: relative; width: 100%; height: 100%; }
.tw-stage { position: absolute; overflow: hidden; }
.tw-stage canvas { display: block; width: 100%; height: 100%; touch-action: none; }
.tw-question {
    position: absolute; left: 0.5rem; right: 0.5rem; bottom: 0.5rem; box-sizing: border-box;
    padding: 0.5rem; border: 2px solid rgba(0, 0, 0, 0.15); border-radius: 0.5rem; background: #fff;
    font: 14px "Helvetica Neue", Helvetica, Arial, sans-serif; color: #575e75;
}
.tw-question-text { font-weight: bold; margin: 0 0 0.25rem 0.25rem; white-space: pre-wrap; word-break: break-word; }
.tw-question-row { display: flex; gap: 0.5rem; }
.tw-question input {
    flex: 1; min-width: 0; padding: 0.4rem 0.75rem; border: 1px solid #ccc; border-radius: 1rem;
    font: inherit; color: inherit; outline: none;
}
.tw-question input:focus { border-color: #855cd6; }
.tw-question button {
    width: 2rem; height: 2rem; padding: 0; border: 0; border-radius: 50%;
    background: #855cd6; color: #fff; font: bold 1rem sans-serif; cursor: pointer;
}
.tw-error { color: #fff; font: 16px sans-serif; padding: 1rem; white-space: pre-wrap; }
`;
document.head.appendChild(style);

const app = document.getElementById('app') || document.body;
const stageElement = document.createElement('div');
stageElement.className = 'tw-stage';
const canvas = document.createElement('canvas');
stageElement.appendChild(canvas);
app.appendChild(stageElement);

const vm = new VM();
window.vm = vm;
vm.attachStorage(new ScratchStorage());
vm.attachV2BitmapAdapter(new V2BitmapAdapter());
vm.setVideoProvider(new VideoProvider());
for (const font of SECURITY_CRITICAL_FONTS) {
    vm.runtime.fontManager.restrictFont(font);
}

const renderer = new Renderer(canvas);
vm.attachRenderer(renderer);
try {
    // scratch-audio unlocks itself on the first click, tap or key press
    vm.attachAudioEngine(new AudioEngine());
} catch (e) {
    // eslint-disable-next-line no-console
    console.error('Could not create scratch-audio', e);
}

// The stage fills the window: a stage that follows the shape of the screen (scratch-vm engine/screen.js) takes the
// window's shape, a fixed one keeps its own and gets black bars
let rect = canvas.getBoundingClientRect();
const layout = () => {
    vm.runtime.setViewportAspect(window.innerWidth / Math.max(1, window.innerHeight));
    const stageWidth = vm.runtime.stageWidth;
    const stageHeight = vm.runtime.stageHeight;
    const scale = Math.min(window.innerWidth / stageWidth, window.innerHeight / stageHeight);
    const width = Math.max(1, Math.floor(stageWidth * scale));
    const height = Math.max(1, Math.floor(stageHeight * scale));
    stageElement.style.width = `${width}px`;
    stageElement.style.height = `${height}px`;
    stageElement.style.left = `${Math.floor((window.innerWidth - width) / 2)}px`;
    stageElement.style.top = `${Math.floor((window.innerHeight - height) / 2)}px`;
    renderer.resize(width, height);
    rect = canvas.getBoundingClientRect();
    if (!vm.runtime.frameLoop.running) {
        renderer.draw();
    }
};
window.addEventListener('resize', layout);
vm.on('STAGE_SIZE_CHANGED', layout);
layout();

// Mouse and touch, same data as the editor's stage
const getScratchCoords = (x, y) => {
    const nativeSize = renderer.getNativeSize();
    return [
        (nativeSize[0] / rect.width) * (x - (rect.width / 2)),
        (nativeSize[1] / rect.height) * (y - (rect.height / 2))
    ];
};

let mouseDown = false;
let mouseDownPosition = null;
let mouseDownTimeout = null;
let drag = null;
const DRAG_THRESHOLD = 3;

const startDrag = (x, y) => {
    if (drag) return;
    const drawableId = renderer.pick(x, y);
    if (drawableId === -1) return;
    const targetId = vm.getTargetIdForDrawableId(drawableId);
    if (targetId === null) return;
    const target = vm.runtime.getTargetById(targetId);
    if (!target.draggable) return;
    target.goToFront();
    const [scratchX, scratchY] = getScratchCoords(x, y);
    vm.startDrag(targetId);
    drag = {
        targetId,
        offsetX: target.x - scratchX,
        offsetY: -(target.y + scratchY)
    };
};

const stopDrag = () => {
    vm.stopDrag(drag.targetId);
    drag = null;
};

const cancelMouseDownTimeout = () => {
    if (mouseDownTimeout !== null) {
        clearTimeout(mouseDownTimeout);
        mouseDownTimeout = null;
    }
};

const onMouseMove = e => {
    const {x, y} = getEventXY(e);
    const position = [x - rect.left, y - rect.top];
    if (mouseDown && !drag) {
        const distance = Math.hypot(position[0] - mouseDownPosition[0], position[1] - mouseDownPosition[1]);
        if (distance > DRAG_THRESHOLD) {
            cancelMouseDownTimeout();
            startDrag(...mouseDownPosition);
        }
    }
    if (mouseDown && drag) {
        const [scratchX, scratchY] = getScratchCoords(position[0], position[1]);
        vm.postSpriteInfo({
            x: scratchX + drag.offsetX,
            y: -(scratchY + drag.offsetY),
            force: true
        });
    }
    vm.postIOData('mouse', {
        x: position[0],
        y: position[1],
        canvasWidth: rect.width,
        canvasHeight: rect.height
    });
};

const onMouseUp = e => {
    const {x, y} = getEventXY(e);
    cancelMouseDownTimeout();
    const wasDragged = !!drag;
    if (drag) {
        stopDrag();
    }
    mouseDown = false;
    mouseDownPosition = null;
    vm.postIOData('mouse', {
        isDown: false,
        button: e.button,
        x: x - rect.left,
        y: y - rect.top,
        canvasWidth: rect.width,
        canvasHeight: rect.height,
        wasDragged
    });
};

const onMouseDown = e => {
    rect = canvas.getBoundingClientRect();
    const {x, y} = getEventXY(e);
    const position = [x - rect.left, y - rect.top];
    const isTouchEvent = window.TouchEvent && e instanceof TouchEvent;
    if (e.button === 0 || isTouchEvent) {
        mouseDown = true;
        mouseDownPosition = position;
        cancelMouseDownTimeout();
        mouseDownTimeout = setTimeout(() => startDrag(position[0], position[1]), 400);
    }
    vm.postIOData('mouse', {
        isDown: true,
        button: e.button,
        x: position[0],
        y: position[1],
        canvasWidth: rect.width,
        canvasHeight: rect.height
    });
    if (isTouchEvent) {
        // Don't scroll or zoom the page, but do blur the question input
        e.preventDefault();
        if (document.activeElement && document.activeElement.blur) {
            document.activeElement.blur();
        }
    }
};

document.addEventListener('mousemove', onMouseMove);
document.addEventListener('mouseup', onMouseUp);
document.addEventListener('touchmove', onMouseMove, {passive: false});
document.addEventListener('touchend', onMouseUp);
canvas.addEventListener('mousedown', onMouseDown);
canvas.addEventListener('touchstart', onMouseDown, {passive: false});
canvas.addEventListener('wheel', e => {
    vm.postIOData('mouseWheel', {
        deltaX: e.deltaX,
        deltaY: e.deltaY
    });
});
canvas.addEventListener('contextmenu', e => {
    if (vm.runtime.ioDevices.mouse.usesRightClickDown) {
        e.preventDefault();
    }
});

// Keyboard, same as the editor
const getKey = e => ((!e.key || e.key === 'Dead') ? e.keyCode : e.key);
document.addEventListener('keydown', e => {
    // Typing an answer is not a key press on the stage
    if (e.target !== document && e.target !== document.body) return;
    vm.postIOData('keyboard', {
        key: getKey(e),
        keyCode: e.keyCode,
        isDown: true
    });
    // Space, arrows, backspace, ' and / have browser shortcuts that would get in the way
    if (
        e.keyCode === 32 ||
        (e.keyCode >= 37 && e.keyCode <= 40) ||
        e.keyCode === 8 ||
        e.keyCode === 222 ||
        e.keyCode === 191
    ) {
        e.preventDefault();
    }
});
document.addEventListener('keyup', e => {
    vm.postIOData('keyboard', {
        key: getKey(e),
        keyCode: e.keyCode,
        isDown: false
    });
    if (e.target !== document && e.target !== document.body) {
        e.preventDefault();
    }
});

// "ask and wait"
let questionElement = null;
const hideQuestion = () => {
    if (questionElement) {
        questionElement.remove();
        questionElement = null;
    }
};
vm.runtime.on('QUESTION', question => {
    hideQuestion();
    if (question === null) return;

    questionElement = document.createElement('form');
    questionElement.className = 'tw-question';
    if (question) {
        const text = document.createElement('div');
        text.className = 'tw-question-text';
        text.textContent = question;
        questionElement.appendChild(text);
    }
    const row = document.createElement('div');
    row.className = 'tw-question-row';
    const input = document.createElement('input');
    input.type = 'text';
    const button = document.createElement('button');
    button.type = 'submit';
    button.textContent = '✓';
    button.setAttribute('aria-label', 'Answer');
    row.appendChild(input);
    row.appendChild(button);
    questionElement.appendChild(row);
    questionElement.addEventListener('submit', e => {
        e.preventDefault();
        const answer = input.value;
        hideQuestion();
        vm.runtime.emit('ANSWER', answer);
    });
    stageElement.appendChild(questionElement);
    input.focus();
});

const showError = error => {
    // eslint-disable-next-line no-console
    console.error(error);
    const element = document.createElement('div');
    element.className = 'tw-error';
    element.textContent = `Could not load project:\n${error}`;
    app.appendChild(element);
};

const run = async () => {
    if (!projectData) {
        throw new Error('No project data');
    }
    // Text rendering needs the fonts before the project's costumes are loaded
    await loadFonts();
    await vm.loadProject(projectData);
    layout();
    vm.start();
    vm.greenFlag();
};

run().catch(showError);

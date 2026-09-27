const {test} = require('tap');
const THREE = require('three');
const Editor3D = require('../../src/engine/scene-3d-editor');
const ModalTransform = require('../../src/engine/scene-3d-modal-transform');

const WIDTH = 480;
const HEIGHT = 360;
const CENTER = {x: WIDTH / 2, y: HEIGHT / 2};

// A camera looking at the origin, 10 units in front of it (and optionally above), on a stage at the top left of
// the page
const makeEditor = (height = 0) => {
    const camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 100);
    camera.position.set(0, height, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const editor = {
        THREE,
        camera,
        _canvas: {getBoundingClientRect: () => ({left: 0, top: 0, width: WIDTH, height: HEIGHT})},
        scene3D: {scene: new THREE.Scene()},
        changes: 0,
        _modalChanged () {
            this.changes++;
        }
    };
    editor._pointer = Editor3D.prototype._pointer.bind(editor);
    return editor;
};

const makeTarget = () => ({
    x: 0,
    y: 0,
    z: 0,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
    setXYZ (x, y, z) {
        Object.assign(this, {x, y, z});
    },
    setRotation (x, y, z) {
        Object.assign(this, {rotationX: x, rotationY: y, rotationZ: z});
    },
    setScale (x, y, z) {
        Object.assign(this, {scaleX: x, scaleY: y, scaleZ: z});
    }
});

const near = (t, actual, expected, message) => t.ok(Math.abs(actual - expected) < 1e-6,
    `${message}: expected ${expected}, got ${actual}`);

test('grab follows the pointer in the plane facing the camera', t => {
    const editor = makeEditor();
    const target = makeTarget();
    const modal = new ModalTransform(editor, 'grab', target, CENTER);
    modal.move({x: CENTER.x + 50, y: CENTER.y - 30}, false);
    t.ok(target.x > 0, 'right on screen is +x');
    t.ok(target.y > 0, 'up on screen is +y');
    near(t, target.z, 0, 'stays at the same depth');
    t.ok(editor.changes > 0);
    t.end();
});

test('grab locked to an axis, typed numbers, snapping and cancel', t => {
    const editor = makeEditor();
    const target = makeTarget();
    const modal = new ModalTransform(editor, 'grab', target, CENTER);
    modal.setConstraint('x', false);
    t.ok(editor.scene3D.scene.children.length > 0, 'shows the axis line');
    modal.move({x: CENTER.x + 50, y: CENTER.y - 30}, false);
    t.ok(target.x > 0);
    near(t, target.y, 0, 'y stays');

    modal.move({x: CENTER.x + 50, y: CENTER.y}, true);
    near(t, target.x, Math.round(target.x), 'ctrl snaps to whole units');

    for (const key of ['2', '.', '5', '-']) modal.input(key);
    near(t, target.x, -2.5, 'typed -2.5');
    modal.input('Backspace');
    near(t, target.x, -2, 'backspace removes the last digit');

    modal.cancel();
    t.same([target.x, target.y, target.z], [0, 0, 0], 'cancel puts it back');
    t.equal(editor.scene3D.scene.children.length, 0, 'removes the axis line');
    t.end();
});

test('pressing an axis again uses the local axis, and a third time unlocks', t => {
    const editor = makeEditor();
    const target = makeTarget();
    target.rotationY = 90;
    const modal = new ModalTransform(editor, 'grab', target, CENTER);
    modal.setConstraint('x', false);
    modal.setConstraint('x', false);
    t.ok(modal.local);
    modal.input('1');
    // Turned 90° around y, the sprite's own x points along world -z
    near(t, target.x, 0, 'x');
    near(t, target.z, -1, 'z');
    modal.setConstraint('x', false);
    t.equal(modal.axis, null);
    t.end();
});

test('shift + axis locks to the plane without that axis', t => {
    const editor = makeEditor(5);
    const target = makeTarget();
    const modal = new ModalTransform(editor, 'grab', target, CENTER);
    modal.setConstraint('y', true);
    t.equal(editor.scene3D.scene.children[0].children.length, 2, 'two axis lines');
    modal.move({x: CENTER.x + 40, y: CENTER.y + 40}, false);
    near(t, target.y, 0, 'y stays');
    t.ok(target.x > 0);
    t.ok(target.z > 0, 'down on screen comes toward the camera on the ground');
    t.match(modal.describe(), /XZ/);
    t.end();
});

test('rotate follows the pointer around the sprite', t => {
    const editor = makeEditor();
    const target = makeTarget();
    const modal = new ModalTransform(editor, 'rotate', target, {x: CENTER.x + 100, y: CENTER.y});
    // A quarter turn counterclockwise on screen, in steps so that the angle adds up
    modal.move({x: CENTER.x + 70, y: CENTER.y - 70}, false);
    modal.move({x: CENTER.x, y: CENTER.y - 100}, false);
    near(t, target.rotationZ, 90, 'counterclockwise facing the camera is +z roll');
    near(t, target.rotationX, 0, 'pitch');
    near(t, target.rotationY, 0, 'yaw');

    modal.setConstraint('y', false);
    modal.input('4');
    modal.input('5');
    near(t, target.rotationY, 45, 'typed 45 degrees around y');
    near(t, target.rotationZ, 0, 'roll back to 0');
    t.match(modal.describe(), /旋轉 Y（全域） \[45\]/);
    t.end();
});

test('scale by distance from the sprite, per axis, and switching transforms', t => {
    const editor = makeEditor();
    const target = makeTarget();
    const modal = new ModalTransform(editor, 'scale', target, {x: CENTER.x + 50, y: CENTER.y});
    modal.move({x: CENTER.x + 100, y: CENTER.y}, false);
    t.same([target.scaleX, target.scaleY, target.scaleZ], [2, 2, 2]);

    modal.setConstraint('z', false);
    t.same([target.scaleX, target.scaleY, target.scaleZ], [1, 1, 2], 'only z');
    modal.setConstraint('z', true);
    t.same([target.scaleX, target.scaleY, target.scaleZ], [2, 2, 1], 'all but z');

    modal.setType('grab');
    t.same([target.scaleX, target.scaleY, target.scaleZ], [2, 2, 1], 'scale stays after switching to grab');
    modal.cancel();
    t.same([target.scaleX, target.scaleY, target.scaleZ], [1, 1, 1], 'cancel undoes everything');
    t.end();
});

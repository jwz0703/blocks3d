const {test} = require('tap');
const VirtualMachine = require('../../src/virtual-machine');
const JoystickBlocks = require('../../src/extensions/tw_joystick');

// The joystick extension (ROADMAP.md 7.3). There is no DOM here, so fingers are what the overlay would report.

const setup = () => {
    const vm = new VirtualMachine();
    const joystick = new JoystickBlocks(vm.runtime);
    const keyboard = vm.runtime.ioDevices.keyboard;
    const press = (key, isDown) => keyboard.postData({key, isDown});
    return {vm, joystick, keyboard, press};
};

const value = (joystick, STICK, PART) => joystick.stickValue({STICK, PART});

test('joystick values from a finger', t => {
    const {joystick} = setup();
    joystick.setStick('left', 1, 0, true);
    t.equal(value(joystick, 'left', 'x'), 1);
    t.equal(value(joystick, 'left', 'y'), 0);
    t.equal(value(joystick, 'left', 'direction'), 90, 'right is 90, like sprites');
    t.equal(value(joystick, 'left', 'distance'), 1);
    joystick.setStick('left', 0, -1, true);
    t.equal(value(joystick, 'left', 'direction'), 180);
    t.ok(joystick.isPushed({STICK: 'left', DIRECTION: 'down'}));
    t.notOk(joystick.isPushed({STICK: 'left', DIRECTION: 'up'}));
    t.ok(joystick.isPushed({STICK: 'left', DIRECTION: 'any'}));

    joystick.setStick('left', 0.05, 0.05, true);
    t.equal(value(joystick, 'left', 'distance'), 0, 'dead zone');
    joystick.setStick('left', 0.5, 0, true);
    t.ok(value(joystick, 'left', 'x') > 0.4 && value(joystick, 'left', 'x') < 0.5, 'dead zone taken out smoothly');

    joystick.setStick('left', 1, 0, false);
    t.equal(value(joystick, 'left', 'x'), 0, 'back to the middle when let go');
    t.equal(value(joystick, 'right', 'x'), 0, 'the other joystick');
    t.end();
});

test('without a finger, the left joystick reads WASD and the arrow keys', t => {
    const {joystick, press} = setup();
    press('d', true);
    t.equal(value(joystick, 'left', 'x'), 1);
    press('w', true);
    t.equal(value(joystick, 'left', 'distance'), 1, 'diagonals are as far as straight directions');
    t.equal(value(joystick, 'left', 'direction'), 45);
    press('d', false);
    press('w', false);
    press('ArrowLeft', true);
    t.equal(value(joystick, 'left', 'x'), -1);
    t.equal(value(joystick, 'right', 'x'), 0, 'the right joystick has no keys');
    joystick.setStick('left', 0, 1, true);
    t.equal(value(joystick, 'left', 'x'), 0, 'a finger wins over keys');
    t.end();
});

test('joysticks and buttons press keys', t => {
    const {joystick, keyboard} = setup();
    joystick.setStick('left', 0, 1, true);
    t.ok(keyboard.getKeyIsDown('w'), 'left joystick presses WASD by default');
    joystick.setStick('left', -1, 0, true);
    t.notOk(keyboard.getKeyIsDown('w'));
    t.ok(keyboard.getKeyIsDown('a'));
    joystick.setStick('left', 0, 0, false);
    t.notOk(keyboard.getKeyIsDown('a'), 'released when let go');

    joystick.setStickAction({STICK: 'left', ACTION: 'arrows'});
    joystick.setStick('left', 0, 1, true);
    t.ok(keyboard.getKeyIsDown('up arrow'));
    t.notOk(keyboard.getKeyIsDown('w'));
    joystick.setStickAction({STICK: 'left', ACTION: 'none'});
    t.notOk(keyboard.getKeyIsDown('up arrow'), 'changing what it controls lets go of the keys');

    joystick.setButton('a', true);
    t.ok(keyboard.getKeyIsDown('space'), 'button A presses space by default');
    t.ok(joystick.isButtonPressed({BUTTON: 'a'}));
    joystick.setButton('a', false);
    t.notOk(keyboard.getKeyIsDown('space'));
    t.end();
});

test('buttons read their key', t => {
    const {joystick, press} = setup();
    t.notOk(joystick.isButtonPressed({BUTTON: 'a'}));
    press(' ', true);
    t.ok(joystick.isButtonPressed({BUTTON: 'a'}), 'space is button A');
    t.ok(joystick.whenButtonPressed({BUTTON: 'a'}));
    press(' ', false);
    joystick.setButtonKey({BUTTON: 'b', KEY: 'z'});
    press('z', true);
    t.ok(joystick.isButtonPressed({BUTTON: 'b'}));
    t.notOk(joystick.isButtonPressed({BUTTON: 'a'}));
    t.end();
});

test('when controls are shown', t => {
    const {vm, joystick} = setup();
    const shown = name => joystick._isShown(joystick.state.sticks[name] || joystick.state.buttons[name]);
    joystick.touchScreen = false;
    value(joystick, 'left', 'x');
    t.notOk(shown('left'), 'not without a touch screen');
    joystick.touchScreen = true;
    t.ok(shown('left'), 'once used on a touch screen');
    t.notOk(shown('right'), 'unused controls stay hidden');
    t.notOk(shown('a'));
    joystick.setShown({CONTROL: 'right', MODE: 'always'});
    t.ok(shown('right'));
    joystick.setShown({CONTROL: 'all', MODE: 'hidden'});
    t.notOk(shown('left'));

    vm.runtime.stopAll();
    t.notOk(shown('right'), 'back to hidden until used after stopping');
    t.equal(joystick.state.sticks.left.mode, 'auto');
    t.end();
});

test('stopping lets go of the keys that controls press', t => {
    const {vm, joystick, keyboard} = setup();
    joystick.setStick('left', 1, 0, true);
    joystick.setButton('a', true);
    t.ok(keyboard.getKeyIsDown('d'));
    vm.runtime.stopAll();
    t.notOk(keyboard.getKeyIsDown('d'));
    t.notOk(keyboard.getKeyIsDown('space'));
    t.end();
});

test('a joystick that controls the view turns the camera', t => {
    const {vm, joystick} = setup();
    const scene3D = vm.runtime.scene3D;
    joystick.setStickAction({STICK: 'right', ACTION: 'look'});
    joystick.setStick('right', 1, 0, true);
    vm.runtime.frameDelta = 0.1;
    joystick._frame();
    t.ok(scene3D.getCameraState().yaw < 0, 'pushed right turns right (negative yaw)');
    joystick.setStick('right', 0, 1, true);
    const pitch = scene3D.getCameraState().pitch;
    joystick._frame();
    t.ok(scene3D.getCameraState().pitch > pitch, 'pushed up looks up');
    t.end();
});

test('loaded from the extension library', t => {
    const vm = new VirtualMachine();
    t.ok(vm.extensionManager.isBuiltinExtension('joystick'));
    vm.extensionManager.loadExtensionIdSync('joystick');
    t.ok(vm.extensionManager.isExtensionLoaded('joystick'));
    t.end();
});

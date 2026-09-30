// ROADMAP.md 9: turning around any axis, the math blocks (twmath), and more physics: leaving collision out,
// colliding while hidden, collision groups, cylinders, turning bodies, how hard things hit, and damping.
const {test} = require('tap');
require('../fixtures/tw_mock_blob');
const fs = require('fs');
const pathUtil = require('path');
const VirtualMachine = require('../../src/virtual-machine');
const makeTestStorage = require('../fixtures/make-test-storage');
const {addScript} = require('../fixtures/tw-3d-scripts');

const sb3Fixture = fs.readFileSync(pathUtil.join(__dirname, '..', 'fixtures', 'tw-save-project-sb3.sb3'));

const round = n => Math.round(n * 1e3) / 1e3;

// "Ball" above the wide static "Floor" (its top at y = -0.5)
const makeVM = async () => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());
    await vm.loadProject(sb3Fixture);
    await vm.addSprite3D({name: 'Ball', models: [{name: 'ball', shape: 'sphere'}]});
    await vm.addSprite3D({name: 'Floor', models: [{name: 'cube', shape: 'cube'}]});
    const find = name => vm.runtime.targets.find(t => t.getName() === name);
    const ball = find('Ball');
    const floor = find('Floor');
    floor.setXYZ(0, -1, 0);
    floor.setScale(20, 1, 20);
    const physics = vm.runtime.scene3D.physics;
    await physics.load();
    return {vm, physics, ball, floor};
};

const call = (vm, opcode, args, target, thread) =>
    vm.runtime.getOpcodeFunction(opcode)(args, {target, thread, stackFrame: {}, yield: () => {}});

// Drop the ball from y = 3 onto the floor and let it settle
const drop = async (vm, physics, ball, floor, frames = 150) => {
    call(vm, 'physics3d_setbody', {BODY: 'static'}, floor);
    ball.setXYZ(0, 3, 0);
    await call(vm, 'physics3d_setbody', {BODY: 'dynamic'}, ball);
    vm.greenFlag();
    for (let i = 0; i < frames; i++) physics.step(1 / 60);
};

// Turning

test('turning around an axis of the world or of the sprite adds up', async t => {
    const {vm, ball} = await makeVM();
    const turn = (space, x, y, z, degrees) => call(vm, 'motion3d_rotatearound',
        {SPACE: space, X: x, Y: y, Z: z, DEGREES: degrees}, ball);
    ball.setRotation(0, 90, 0);
    turn('world', 0, 1, 0, 30);
    t.same([ball.rotationX, ball.rotationY, ball.rotationZ].map(round), [0, 120, 0], 'around the world\'s y: yaw');
    ball.setRotation(0, 90, 0);
    turn('local', 1, 0, 0, 20);
    t.same([ball.rotationX, ball.rotationY, ball.rotationZ].map(round), [20, 90, 0],
        'around its own x: pitch, whichever way it faces');
    ball.setRotation(0, 90, 0);
    turn('world', 2, 0, 0, 20);
    t.same([ball.rotationX, ball.rotationY, ball.rotationZ].map(round), [0, 90, 20],
        'around the world\'s x while facing along it: roll (the axis\'s length doesn\'t matter)');

    ball.setRotation(10, 20, 30);
    for (let i = 0; i < 12; i++) turn('world', 1, 2, 3, 30);
    t.same([ball.rotationX, ball.rotationY, ball.rotationZ].map(round), [10, 20, 30], 'a full turn comes back');
    turn('world', 0, 0, 0, 30);
    t.same([ball.rotationX, ball.rotationY, ball.rotationZ].map(round), [10, 20, 30], 'no axis: no turn');
    t.end();
});

test('turning around the world\'s axes when attached', async t => {
    const {vm, ball, floor} = await makeVM();
    floor.setScale(1, 1, 1);
    floor.setRotation(0, 90, 0);
    ball.setRotation(0, 0, 0);
    ball.setParent3D(floor);
    call(vm, 'motion3d_rotatearound', {SPACE: 'world', X: 0, Y: 0, Z: 1, DEGREES: 30}, ball);
    const pose = ball.getWorldPose();
    // Attaching keeps it facing the world's -z, so the world's z is its own: a roll. The parent's z would pitch it.
    t.same([pose.pitch, pose.yaw, pose.roll].map(round), [0, 0, 30], 'the world\'s z, not the parent\'s');
    t.end();
});

// Math

test('math blocks', async t => {
    const {vm, ball} = await makeVM();
    const math = (opcode, args) => call(vm, `twmath_${opcode}`, args, ball);
    t.equal(math('atan2', {Y: 1, X: -1}), 135);
    t.equal(math('atan2', {Y: -1, X: 0}), -90);
    t.equal(math('atan2', {Y: 0, X: 0}), 0);
    t.equal(math('clamp', {VALUE: 150, MIN: 0, MAX: 100}), 100);
    t.equal(math('clamp', {VALUE: -5, MIN: 100, MAX: 0}), 0, 'either order');
    t.equal(math('clamp', {VALUE: 'abc', MIN: 1, MAX: 2}), 1);
    t.equal(math('min', {A: 3, B: '-2'}), -2);
    t.equal(math('max', {A: 3, B: '-2'}), 3);
    t.equal(math('lerp', {A: 10, B: 20, T: 0.25}), 12.5);
    t.equal(math('lerp', {A: 0.1, B: 0.2, T: 0.1}), 0.11);
    t.end();
});

// Physics

test('sprites can leave collision out', async t => {
    const {vm, physics, ball, floor} = await makeVM();
    call(vm, 'physics3d_setcollide', {ON: 'off'}, floor);
    await drop(vm, physics, ball, floor, 60);
    t.ok(ball.y < -1, 'falls through the floor');
    t.equal(physics.getShape(floor), null, 'no collider');
    ball.setXYZ(0, -1, 0);
    t.equal(await call(vm, 'sensing3d_touching', {TARGET: 'Floor'}, ball), false, 'nothing touches it');
    t.equal(physics._bodies.has(floor), false, 'no body');
    t.end();
});

test('hidden sprites can collide', async t => {
    const {vm, physics, ball, floor} = await makeVM();
    floor.setVisible(false);
    call(vm, 'physics3d_setcollidehidden', {ON: 'on'}, floor);
    await drop(vm, physics, ball, floor);
    t.equal(Math.round(ball.y * 10) / 10, 0, 'lands on the invisible floor');
    ball.setXYZ(10, 0, 0);
    t.equal(vm.runtime.scene3D.pickTarget(0, -100), null, 'but the mouse doesn\'t find it');
    t.end();
});

test('collision groups', async t => {
    const {vm, physics, ball, floor} = await makeVM();
    call(vm, 'physics3d_setgroup', {GROUP: 2}, ball);
    call(vm, 'physics3d_setgroupscollide', {A: 2, B: 1, COLLIDE: 'no'}, ball);
    t.equal(physics.groupsCollide(1, 2), false, 'both ways');
    t.equal(physics.groupsCollide(2, 2), true);
    await drop(vm, physics, ball, floor, 60);
    t.ok(ball.y < -1, 'falls through a group it doesn\'t collide with');
    ball.setXYZ(0, -1, 0);
    t.equal(await call(vm, 'sensing3d_touching', {TARGET: 'Floor'}, ball), true, 'touching still sees it');

    call(vm, 'physics3d_setgroupscollide', {A: 1, B: 2, COLLIDE: 'yes'}, ball);
    ball.setXYZ(0, 3, 0);
    await call(vm, 'physics3d_setvelocity', {X: 0, Y: 0, Z: 0}, ball);
    for (let i = 0; i < 150; i++) physics.step(1 / 60);
    t.equal(Math.round(ball.y * 10) / 10, 0, 'lands once they collide again');
    t.end();
});

test('cylinders, damping, turning bodies, and how hard things hit', async t => {
    const {vm, physics, ball, floor} = await makeVM();
    call(vm, 'physics3d_setshape', {SHAPE: 'cylinder'}, ball);
    t.match(physics.getShape(ball).key, /^cylinder 0.5 0.5$/);

    const log = ball.lookupOrCreateVariable('log', 'log');
    log.value = '';
    addScript(ball, [{
        opcode: 'data_setvariableto',
        fields: {VARIABLE: {value: 'log', id: 'log'}},
        inputs: {VALUE: {
            opcode: 'operator_join',
            inputs: {
                STRING1: {opcode: 'physics3d_collision', fields: {INFO: 'sprite'}},
                STRING2: {
                    opcode: 'operator_round',
                    inputs: {NUM: {opcode: 'physics3d_collision', fields: {INFO: 'speed'}}}
                }
            }
        }}
    }], {opcode: 'physics3d_whencollisionstart', fields: {TARGET: '_any_'}});
    await drop(vm, physics, ball, floor, 90);
    for (let i = 0; i < 2; i++) vm.runtime._step();
    // Its bottom falls from 2.5 to -0.5: sqrt(2 * 9.81 * 3) = 7.7
    t.match(log.value, /^Floor[78]$/, 'the collision hat knows what it hit and how fast');
    t.ok(Math.abs(call(vm, 'physics3d_collision', {INFO: 'y'}, ball) + 0.5) < 0.1, 'and where');

    // Friction would stop a flat bottom turning on the floor
    call(vm, 'physics3d_setmaterial', {PROPERTY: 'friction', VALUE: 0}, ball);
    call(vm, 'physics3d_setmaterial', {PROPERTY: 'friction', VALUE: 0}, floor);
    await call(vm, 'physics3d_setangularvelocity', {X: 0, Y: 90, Z: 0}, ball);
    t.equal(Math.round(call(vm, 'physics3d_angularvelocity', {AXIS: 'y'}, ball)), 90, 'degrees per second');
    const yaw = ball.rotationY;
    for (let i = 0; i < 30; i++) physics.step(1 / 60);
    t.ok(ball.rotationY > yaw + 10, 'turns');

    call(vm, 'physics3d_setmaterial', {PROPERTY: 'angularDamping', VALUE: 5}, ball);
    for (let i = 0; i < 60; i++) physics.step(1 / 60);
    t.ok(call(vm, 'physics3d_angularvelocity', {AXIS: 'y'}, ball) < 5, 'damping slows it down');

    await call(vm, 'physics3d_applytorqueimpulse', {X: 0, Y: 1, Z: 0}, ball);
    t.ok(call(vm, 'physics3d_angularvelocity', {AXIS: 'y'}, ball) > 5, 'a twist');
    t.end();
});

test('the new physics settings and group rules are saved', async t => {
    const {vm, physics, ball, floor} = await makeVM();
    call(vm, 'physics3d_setcollide', {ON: 'off'}, floor);
    call(vm, 'physics3d_setcollidehidden', {ON: 'on'}, ball);
    call(vm, 'physics3d_setgroup', {GROUP: 5}, ball);
    call(vm, 'physics3d_setmaterial', {PROPERTY: 'linearDamping', VALUE: 0.5}, ball);
    call(vm, 'physics3d_setshape', {SHAPE: 'cylinder'}, ball);
    physics.setGroupsCollide(5, 3, false);
    const loaded = new VirtualMachine();
    loaded.attachStorage(makeTestStorage());
    await loaded.loadProject(await vm.saveProject3dsb('arraybuffer'));
    const find = name => loaded.runtime.targets.find(target => target.getName() === name);
    const settings = find('Ball').physics;
    t.same([settings.collideHidden, settings.group, settings.linearDamping, settings.shape],
        [true, 5, 0.5, 'cylinder']);
    t.equal(find('Floor').physics.collide, false);
    t.equal(loaded.runtime.scene3D.physics.groupsCollide(3, 5), false);
    t.equal(loaded.runtime.scene3D.physics.groupsCollide(3, 4), true);
    t.end();
});

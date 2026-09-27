// Game systems of 3D sprites (ROADMAP.md, stage 6): collision, clicks, attaching, animations, physics and 3D sound.
const {test} = require('tap');
require('../fixtures/tw_mock_blob');
const fs = require('fs');
const pathUtil = require('path');
const VirtualMachine = require('../../src/virtual-machine');
const SpatialAudioEffect = require('../../src/engine/spatial-audio-effect');
const makeTestStorage = require('../fixtures/make-test-storage');
const {addScript} = require('../fixtures/tw-3d-scripts');

// GLTFLoader reports progress with this browser class
if (typeof global.ProgressEvent === 'undefined') {
    global.ProgressEvent = class extends Event {
        constructor (type, init) {
            super(type);
            Object.assign(this, init);
        }
    };
}

const sb3Fixture = fs.readFileSync(pathUtil.join(__dirname, '..', 'fixtures', 'tw-save-project-sb3.sb3'));

const round = n => Math.round(n * 1e4) / 1e4;

// A project with the 2D sprite "Sprite1" and the 3D sprites "Box" and "Other". The camera is at (0, 0, 5), looking
// at the origin.
const makeVM = async () => {
    const vm = new VirtualMachine();
    vm.attachStorage(makeTestStorage());
    await vm.loadProject(sb3Fixture);
    await vm.addSprite3D({name: 'Box', models: [{name: 'cube', shape: 'cube'}]});
    await vm.addSprite3D({name: 'Other', models: [{name: 'ball', shape: 'sphere'}]});
    const find = name => vm.runtime.targets.find(t => t.getName() === name);
    const box = find('Box');
    const other = find('Other');
    box.setXYZ(0, 0, 0);
    other.setXYZ(5, 0, 0);
    return {vm, physics: vm.runtime.scene3D.physics, sprite: find('Sprite1'), box, other};
};

const call = (vm, opcode, args, target, stackFrame) =>
    vm.runtime.getOpcodeFunction(opcode)(args, {target, stackFrame: stackFrame || {}, yield: () => {}});

// 6.1 Collision

test('Rapier loads when a touching block first needs it', async t => {
    const {vm, physics, box, other} = await makeVM();
    t.notOk(physics.ready, 'not loaded for a project without collision blocks');
    other.setXYZ(0.9, 0, 0);
    const result = call(vm, 'sensing3d_touching', {TARGET: 'Other'}, box);
    t.ok(result && typeof result.then === 'function', 'the block waits the first time');
    t.equal(await result, true);
    t.ok(physics.ready);
    t.equal(call(vm, 'sensing3d_touching', {TARGET: 'Other'}, box), true, 'then answers right away');
    t.end();
});

test('touching uses the colliders where the sprites are now', async t => {
    const {vm, physics, box, other} = await makeVM();
    await physics.load();
    const touching = name => call(vm, 'sensing3d_touching', {TARGET: name}, box);

    other.setXYZ(0.9, 0, 0);
    t.equal(touching('Other'), true, 'a unit box and a unit ball overlap');
    other.setXYZ(1.1, 0, 0);
    t.equal(touching('Other'), false, 'moved away, seen right away');
    t.equal(touching('_any_'), false);

    box.setScale(3, 1, 1);
    t.equal(touching('Other'), true, 'scale makes the collider bigger');
    box.setScale(1, 1, 1);

    other.setXYZ(0.9, 0.9, 0);
    t.equal(touching('Other'), true, 'box corner inside the ball\'s bounding box');
    other.physics.shape = 'sphere';
    t.equal(touching('Other'), false, 'a sphere collider has no corners');

    other.setXYZ(0.9, 0, 0);
    other.setVisible(false);
    t.equal(touching('Other'), false, 'hidden sprites touch nothing');
    other.setVisible(true);

    const clone = other.makeClone();
    vm.runtime.addTarget(clone);
    other.setXYZ(10, 0, 0);
    clone.setXYZ(0, 0.9, 0);
    t.equal(touching('Other'), true, 'clones of the sprite count');
    t.equal(touching('_any_'), true);
    t.end();
});

test('raycasts report what they hit as an object', async t => {
    const {vm, box, other} = await makeVM();
    other.setXYZ(0, 0, -10);
    // Looking along -z from the origin: through the box it starts in, to the ball
    const hit = await call(vm, 'physics3d_raycast', {FROM: '_myself_', LENGTH: 100}, box);
    t.same({hit: hit.hit, sprite: hit.sprite, distance: round(hit.distance), z: round(hit.z)},
        {hit: true, sprite: 'Other', distance: 9.5, z: -9.5}, 'ignores the sprite it starts in');

    const miss = await call(vm, 'physics3d_raycast', {FROM: '_myself_', LENGTH: 5}, box);
    t.equal(miss.hit, false, 'too short');

    const down = await call(vm, 'physics3d_raycastfrom', {
        ORIGIN: '{"x": 0, "y": 10, "z": 0}',
        DIRECTION: {x: 0, y: -1, z: 0},
        LENGTH: 100
    }, box);
    t.same([down.sprite, round(down.y)], ['Box', 0.5], 'from a point, e.g. to find the ground');

    // The camera at (0, 0, 5) looks at the box
    const fromCamera = await call(vm, 'physics3d_raycast', {FROM: '_camera_', LENGTH: 100}, box);
    t.same([fromCamera.sprite, round(fromCamera.distance)], ['Box', 4.5]);
    t.end();
});

// 6.2 Clicks

test('clicking a 3D sprite runs its "when this sprite clicked" scripts', async t => {
    const {vm, physics, box, other} = await makeVM();
    await physics.load();
    const clicked = [];
    for (const target of [box, other]) {
        const variable = target.lookupOrCreateVariable(`clicked ${target.getName()}`, 'clicked');
        variable.value = 0;
        addScript(target, [{
            opcode: 'data_changevariableby',
            fields: {VARIABLE: {value: 'clicked', id: `clicked ${target.getName()}`}},
            inputs: {VALUE: 1}
        }], {opcode: 'event_whenthisspriteclicked'});
        clicked.push(variable);
    }
    const mouse = vm.runtime.ioDevices.mouse;
    const click = (x, y) => {
        mouse.postData({x, y, canvasWidth: 480, canvasHeight: 360, isDown: true});
        mouse.postData({x, y, canvasWidth: 480, canvasHeight: 360, isDown: false});
        for (let i = 0; i < 2; i++) vm.runtime._step();
    };
    click(240, 180);
    t.same(clicked.map(v => v.value), [1, 0], 'the middle of the stage is the box');
    click(20, 20);
    t.same(clicked.map(v => v.value), [1, 0], 'nothing in the corner');
    other.setXYZ(0, 0, 2);
    click(240, 180);
    t.same(clicked.map(v => v.value), [1, 1], 'the sprite in front gets the click');
    t.end();
});

test('hats for the mouse moving onto and off a sprite', async t => {
    const {vm, physics, box} = await makeVM();
    await physics.load();
    const log = box.lookupOrCreateVariable('log', 'log');
    log.value = '';
    const append = text => ({
        opcode: 'data_setvariableto',
        fields: {VARIABLE: {value: 'log', id: 'log'}},
        inputs: {VALUE: {
            opcode: 'operator_join',
            inputs: {STRING1: {opcode: 'data_variable', fields: {VARIABLE: {value: 'log', id: 'log'}}}, STRING2: text}
        }}
    });
    addScript(box, [append('in')], {opcode: 'event3d_whenmouseenter'});
    addScript(box, [append('out')], {opcode: 'event3d_whenmouseleave'});
    const mouse = vm.runtime.ioDevices.mouse;
    const move = (x, y) => {
        mouse.postData({x, y, canvasWidth: 480, canvasHeight: 360});
        for (let i = 0; i < 2; i++) vm.runtime._step();
    };
    move(10, 10);
    t.equal(log.value, '', 'nothing at the start while the mouse is elsewhere');
    move(240, 180);
    t.equal(log.value, 'in');
    move(245, 185);
    t.equal(log.value, 'in', 'once');
    move(10, 10);
    t.equal(log.value, 'inout');
    t.end();
});

// 6.3 Attaching

test('attached sprites move with their parent and keep where they are when attached', async t => {
    const {vm, box, other} = await makeVM();
    box.setXYZ(10, 0, 0);
    other.setXYZ(12, 1, 0);
    call(vm, 'motion3d_attachto', {TARGET: 'Box'}, other);
    t.equal(other.parent3D, box);
    t.same([other.x, other.y, other.z].map(round), [2, 1, 0], 'x, y, z are relative to the parent');
    t.same(Object.values(other.getWorldPosition()).map(round), [12, 1, 0], 'and it stays where it was');

    box.setRotation(0, 90, 0);
    box.setXYZ(0, 0, 0);
    // Turning left by 90 degrees takes +x to -z
    t.same(['x', 'y', 'z'].map(axis => round(call(vm, 'motion3d_worldcoordinate', {COORDINATE: axis}, other))),
        [0, 1, -2], 'turns and moves with the parent');
    t.equal(round(call(vm, 'motion3d_worldcoordinate', {COORDINATE: 'yaw'}, other)), 90);
    t.equal(call(vm, 'motion3d_parent', {}, other), 'Box');
    t.equal(round(call(vm, 'sensing3d_distanceto', {TARGET: 'Box'}, other)), round(Math.sqrt(5)),
        'distance is measured in the world');

    call(vm, 'motion3d_gotoworldxyz', {X: 3, Y: 3, Z: 3}, other);
    t.same(Object.values(other.getWorldPosition()).map(round), [3, 3, 3], 'go to a point in the world');

    call(vm, 'motion3d_detach', {}, other);
    t.equal(other.parent3D, null);
    t.same([other.x, other.y, other.z].map(round), [3, 3, 3], 'detaching keeps it where it is');
    t.end();
});

test('attaching can\'t make loops, and deleting a parent lets go', async t => {
    const {vm, box, other} = await makeVM();
    t.ok(other.setParent3D(box));
    t.notOk(box.setParent3D(other), 'the parent can\'t be attached to its child');
    t.notOk(other.setParent3D(other));

    const clone = box.makeClone();
    vm.runtime.addTarget(clone);
    clone.setXYZ(1, 2, 3);
    other.setParent3D(clone);
    other.setXYZ(1, 0, 0);
    vm.runtime.disposeTarget(clone);
    t.equal(other.parent3D, null, 'detached when the clone is deleted');
    t.same([other.x, other.y, other.z].map(round), [2, 2, 3], 'where it was in the world');
    t.end();
});

test('attaching is saved', async t => {
    const {vm, box, other} = await makeVM();
    box.setXYZ(5, 0, 0);
    other.setParent3D(box);
    other.setXYZ(1, 0, 0);
    const saved = await vm.saveProject3dsb('arraybuffer');
    const loaded = new VirtualMachine();
    loaded.attachStorage(makeTestStorage());
    await loaded.loadProject(saved);
    const find = name => loaded.runtime.targets.find(target => target.getName() === name);
    t.equal(find('Other').parent3D, find('Box'));
    t.same(Object.values(find('Other').getWorldPosition()).map(round), [6, 0, 0]);
    t.end();
});

// 6.4 Animations

/**
 * @returns {Uint8Array} a .gltf with the animation "slide" (1 second) and "spin" (2 seconds)
 */
const makeAnimatedModel = () => {
    const floats = new Float32Array([
        // slide: times, then positions
        0, 1,
        0, 0, 0, 2, 0, 0,
        // spin: times, then rotations (quaternions)
        0, 2,
        0, 0, 0, 1, 0, 1, 0, 0
    ]);
    const data = Buffer.from(floats.buffer);
    const view = (offset, count) => ({buffer: 0, byteOffset: offset * 4, byteLength: count * 4});
    const gltf = {
        asset: {version: '2.0'},
        scene: 0,
        scenes: [{nodes: [0]}],
        nodes: [{name: 'root'}],
        buffers: [{byteLength: data.length, uri: `data:application/octet-stream;base64,${data.toString('base64')}`}],
        bufferViews: [view(0, 2), view(2, 6), view(8, 2), view(10, 8)],
        accessors: [
            {bufferView: 0, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1]},
            {bufferView: 1, componentType: 5126, count: 2, type: 'VEC3'},
            {bufferView: 2, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [2]},
            {bufferView: 3, componentType: 5126, count: 2, type: 'VEC4'}
        ],
        animations: [
            {name: 'slide',
                samplers: [{input: 0, output: 1}],
                channels: [
                    {sampler: 0, target: {node: 0, path: 'translation'}}
                ]},
            {name: 'spin',
                samplers: [{input: 2, output: 3}],
                channels: [
                    {sampler: 0, target: {node: 0, path: 'rotation'}}
                ]}
        ]
    };
    return new TextEncoder().encode(JSON.stringify(gltf));
};

test('GLTF animations play, loop, change speed and can be waited for', async t => {
    const {vm, box} = await makeVM();
    const scene3D = vm.runtime.scene3D;
    vm.runtime.fileManager.addFile('robot.gltf', makeAnimatedModel());
    box.addModel({name: 'robot', file: 'robot.gltf'});
    box.setModel(1);
    const frame = seconds => {
        vm.runtime.frameDelta = seconds;
        scene3D._updateAnimations(seconds);
    };

    t.equal(scene3D.getAnimationClips(box), null, 'loading');
    await scene3D.getModel('robot.gltf');
    t.same(scene3D.getAnimationClips(box).map(clip => clip.name), ['slide', 'spin']);

    call(vm, 'looks3d_playanimation', {ANIMATION: 'slide', LOOP: 'once'}, box);
    t.equal(call(vm, 'looks3d_animationname', {}, box), 'slide');
    frame(0.5);
    t.equal(call(vm, 'looks3d_animationplaying', {}, box), true);
    frame(0.6);
    t.equal(call(vm, 'looks3d_animationplaying', {}, box), false, 'played once');
    t.equal(box.animation.time, 1, 'stays at the end');

    call(vm, 'looks3d_playanimation', {ANIMATION: 'spin', LOOP: 'loop'}, box);
    call(vm, 'looks3d_setanimationspeed', {SPEED: 2}, box);
    frame(3);
    t.equal(call(vm, 'looks3d_animationplaying', {}, box), true, 'loops forever');
    t.equal(box.animation.time, 6, 'twice as fast');

    const stackFrame = {};
    let yielded = 0;
    const util = {target: box, stackFrame, yield: () => yielded++};
    const untilDone = () => vm.runtime.getOpcodeFunction('looks3d_playanimationuntildone')({ANIMATION: '1'}, util);
    call(vm, 'looks3d_setanimationspeed', {SPEED: 1}, box);
    untilDone();
    t.equal(box.animation.name, '1', 'by number');
    t.equal(yielded, 1, 'waits');
    frame(0.9);
    untilDone();
    t.equal(yielded, 2);
    frame(0.2);
    untilDone();
    t.equal(yielded, 2, 'done');

    call(vm, 'looks3d_playanimation', {ANIMATION: 'nope', LOOP: 'loop'}, box);
    frame(0.1);
    t.equal(call(vm, 'looks3d_animationplaying', {}, box), false, 'missing animations don\'t play');

    call(vm, 'looks3d_playanimation', {ANIMATION: 'spin', LOOP: 'loop'}, box);
    call(vm, 'looks3d_stopanimation', {}, box);
    t.equal(box.animation, null);
    t.end();
});

test('GLTF meshes without a material aren\'t fully metallic, like in Blender', async t => {
    const {vm} = await makeVM();
    const positions = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
    const withMaterial = {
        asset: {version: '2.0'},
        scene: 0,
        scenes: [{nodes: [0, 1]}],
        nodes: [{mesh: 0}, {mesh: 1}],
        meshes: [
            {primitives: [{attributes: {POSITION: 0}}]},
            {primitives: [{attributes: {POSITION: 0}, material: 0}]}
        ],
        materials: [{pbrMetallicRoughness: {metallicFactor: 1, roughnessFactor: 0.2}}],
        buffers: [{
            byteLength: positions.length,
            uri: `data:application/octet-stream;base64,${positions.toString('base64')}`
        }],
        bufferViews: [{buffer: 0, byteOffset: 0, byteLength: positions.length}],
        accessors: [{bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0]}]
    };
    vm.runtime.fileManager.addFile('plain.gltf', new TextEncoder().encode(JSON.stringify(withMaterial)));
    const scene = await vm.runtime.scene3D.getModel('plain.gltf');
    const materials = [];
    scene.traverse(child => {
        if (child.isMesh) materials.push(child.material);
    });
    t.same(materials.map(material => [material.metalness, material.roughness]), [[0, 0.5], [1, 0.2]],
        'the default material is plastic; the file\'s own material stays as it is');
    t.end();
});

// 6.7 Physics

test('dynamic bodies fall, land on static ones and report collisions', async t => {
    const {vm, physics, box, other} = await makeVM();
    await physics.load();
    const log = box.lookupOrCreateVariable('log', 'log');
    log.value = '';
    addScript(box, [{
        opcode: 'data_setvariableto',
        fields: {VARIABLE: {value: 'log', id: 'log'}},
        inputs: {VALUE: 'landed'}
    }], {
        opcode: 'physics3d_whencollisionstart',
        fields: {TARGET: 'Other'}
    });

    // A wide floor, and the box above it
    other.setXYZ(0, -1, 0);
    other.setScale(20, 1, 20);
    other.physics.shape = 'box';
    call(vm, 'physics3d_setbody', {BODY: 'static'}, other);
    box.setXYZ(0, 3, 0);
    call(vm, 'physics3d_setbody', {BODY: 'dynamic'}, box);

    physics.step(1 / 60);
    t.equal(box.y, 3, 'nothing moves before the green flag');

    vm.greenFlag();
    for (let i = 0; i < 30; i++) physics.step(1 / 60);
    t.ok(box.y < 3 && box.y > 0, 'falls');
    t.ok(call(vm, 'physics3d_velocity', {AXIS: 'y'}, box) < 0, 'downwards');
    for (let i = 0; i < 120; i++) physics.step(1 / 60);
    t.equal(Math.round(box.y * 10) / 10, 0, 'lands on the floor (its top is at y = -0.5)');
    t.equal(Math.round(other.y * 10) / 10, -1, 'static bodies don\'t move');
    for (let i = 0; i < 2; i++) vm.runtime._step();
    t.equal(log.value, 'landed', 'the collision started a hat');

    await call(vm, 'physics3d_applyimpulse', {X: 0, Y: 5, Z: 0}, box);
    physics.step(1 / 60);
    t.ok(box.y > 0.02, 'jumps');

    await call(vm, 'physics3d_setvelocity', {X: 2, Y: 0, Z: 0}, box);
    t.equal(call(vm, 'physics3d_velocity', {AXIS: 'x'}, box), 2);

    box.setXYZ(0, 10, 0);
    physics.step(1 / 60);
    t.ok(box.y > 9.9, 'blocks can move dynamic bodies');

    vm.stopAll();
    const y = box.y;
    physics.step(1 / 60);
    t.equal(box.y, y, 'stopping stops everything');
    t.end();
});

test('gravity and physics settings are saved', async t => {
    const {vm, box} = await makeVM();
    call(vm, 'physics3d_setgravity', {X: 1, Y: -2, Z: 3}, box);
    t.equal(call(vm, 'physics3d_gravity', {AXIS: 'z'}, box), 3);
    call(vm, 'physics3d_setbody', {BODY: 'dynamic'}, box);
    call(vm, 'physics3d_setshape', {SHAPE: 'sphere'}, box);
    call(vm, 'physics3d_setmaterial', {PROPERTY: 'bounce', VALUE: 5}, box);
    const loaded = new VirtualMachine();
    loaded.attachStorage(makeTestStorage());
    await loaded.loadProject(await vm.saveProject3dsb('arraybuffer'));
    const loadedBox = loaded.runtime.targets.find(target => target.getName() === 'Box');
    t.same(loaded.runtime.scene3D.physics.gravity, {x: 1, y: -2, z: 3});
    t.same([loadedBox.physics.body, loadedBox.physics.shape, loadedBox.physics.bounce], ['dynamic', 'sphere', 1],
        'bounce is at most 1');
    t.ok(loaded.runtime.scene3D.physics._loading, 'projects with dynamic bodies load Rapier right away');
    t.end();
});

// 6.8 3D sound

/**
 * @returns {object} enough of an AudioContext for the spatial effect
 */
const fakeAudioContext = () => {
    const param = () => ({value: 0});
    const node = () => ({
        connect () {},
        disconnect () {},
        positionX: param(),
        positionY: param(),
        positionZ: param()
    });
    return {
        currentTime: 0,
        createPanner: node,
        createGain: node,
        listener: {
            positionX: param(),
            positionY: param(),
            positionZ: param(),
            forwardX: param(),
            forwardY: param(),
            forwardZ: param(),
            upX: param(),
            upY: param(),
            upZ: param()
        }
    };
};

test('sounds of 3D sprites come from where they are', async t => {
    const {vm, box, other, sprite} = await makeVM();
    box.setXYZ(1, 2, 3);
    t.same(box.spatial3d, {x: 1, y: 2, z: 3, distance: 5});
    other.setParent3D(box);
    other.setXYZ(1, 0, 0);
    t.same(other.spatial3d, {x: 2, y: 2, z: 3, distance: 5}, 'in the world');
    t.notOk('spatial3d' in sprite, '2D sprites have no 3D sound');
    call(vm, 'sound3d_setspatial', {STATE: 'off'}, box);
    t.equal(box.spatial3d, null);
    call(vm, 'sound3d_setspatial', {STATE: 'on'}, box);
    call(vm, 'sound3d_setsounddistance', {DISTANCE: 12}, box);
    t.equal(box.spatial3d.distance, 12);

    const audioEngine = {audioContext: fakeAudioContext(), effects: [], currentTime: 0};
    vm.runtime.attachAudioEngine(audioEngine);
    t.ok(audioEngine.effects.includes(SpatialAudioEffect), 'the audio engine gets the 3D effect');

    const effect = new SpatialAudioEffect(audioEngine, null, null);
    effect.set(box.spatial3d);
    t.ok(effect._isPatch);
    t.same([effect.outputNode.positionX.value, effect.outputNode.positionY.value, effect.outputNode.positionZ.value,
        effect.outputNode.refDistance], [1, 2, 3, 12]);
    effect.set(null);
    t.notOk(effect._isPatch, 'not connected for sounds that aren\'t 3D');

    // A playing sound moves with its sprite, and the listener is the camera
    const chain = {spatial3d: new SpatialAudioEffect(audioEngine, null, null)};
    box.sprite.soundBank = {
        playerTargets: new Map([['sound', box]]),
        soundPlayers: {sound: {isPlaying: true}},
        soundEffects: new Map([['sound', chain]])
    };
    box.setXYZ(4, 0, 0);
    vm.runtime.scene3D._updateAudio();
    t.equal(chain.spatial3d.outputNode.positionX.value, 4);
    const listener = audioEngine.audioContext.listener;
    t.same([listener.positionZ.value, round(listener.forwardZ.value), round(listener.upY.value)], [5, -1, 1],
        'the default camera at z = 5 looks along -z');
    t.end();
});

// Pausing (the pause button's addon emits RUNTIME_PAUSED / RUNTIME_UNPAUSED)

test('pausing stops everything that moves by itself', async t => {
    const {vm, physics, box, other} = await makeVM();
    const scene3D = vm.runtime.scene3D;
    await physics.load();
    call(vm, 'physics3d_setbody', {BODY: 'dynamic'}, box);
    box.setXYZ(0, 5, 0);
    other.setXYZ(20, 0, 0);
    const turns = vm.runtime.getTargetForStage().lookupOrCreateVariable('turns', 'turns');
    turns.value = 0;
    addScript(other, [{
        opcode: 'data_changevariableby',
        fields: {VARIABLE: {value: 'turns', id: 'turns'}},
        inputs: {VALUE: 1}
    }], {opcode: 'control_whenframe', fields: {PHASE: 'update'}});
    vm.runtime.fileManager.addFile('robot.gltf', makeAnimatedModel());
    other.addModel({name: 'robot', file: 'robot.gltf'});
    other.setModel(1);
    await scene3D.getModel('robot.gltf');
    vm.greenFlag();
    scene3D.playAnimation(other, 'spin', true);
    scene3D.follow.start(null, other, 'third', 5);

    vm.runtime.emit('RUNTIME_PAUSED');
    const y = box.y;
    const camera = scene3D.getCameraState();
    other.setXYZ(30, 0, 0);
    for (let i = 0; i < 5; i++) {
        vm.runtime._step();
        physics.step(1 / 60);
        scene3D._updateAnimations(0.5);
    }
    t.equal(box.y, y, 'physics');
    t.equal(turns.value, 0, 'per-frame scripts');
    t.equal(other.animation.time, 0, 'animations');
    t.same(scene3D.getCameraState(), camera, 'camera following');

    vm.runtime.emit('RUNTIME_UNPAUSED');
    vm.runtime._step();
    physics.step(1 / 60);
    scene3D._updateAnimations(0.5);
    t.ok(box.y < y, 'physics goes on');
    t.equal(turns.value, 1, 'per-frame scripts go on');
    // The runtime's own frame adds the real time since the last one, a few milliseconds
    t.ok(other.animation.time >= 0.5 && other.animation.time < 0.6, 'animations go on');
    t.end();
});

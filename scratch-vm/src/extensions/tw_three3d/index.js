const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');
const Color = require('../../util/color');
const Scene3D = require('../../engine/scene-3d');
const uid = require('../../util/uid');

// eslint-disable-next-line max-len
const blockIconURI = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><g stroke="#4b3aa8" stroke-width="2" stroke-linejoin="round"><path fill="#b3a6ff" d="M20 5 34 12.5 20 20 6 12.5z"/><path fill="#8a78ff" d="M6 12.5 20 20v15L6 27.5z"/><path fill="#6c57f0" d="M34 12.5 20 20v15l14-7.5z"/></g></svg>')}`;

const PROPS = ['x', 'y', 'z', 'rotX', 'rotY', 'rotZ', 'scaleX', 'scaleY', 'scaleZ'];

const CAMERA_AXES = ['x', 'y', 'z', 'yaw', 'pitch'];

/**
 * @param {THREE.Material|THREE.Material[]} material
 * @returns {THREE.Material[]}
 */
const asArray = material => (Array.isArray(material) ? material : [material]);

/**
 * Procedural objects: 3D objects that scripts create and change by name, for scenes with many generated objects.
 * Also has the camera, mouse look and environment blocks. Everything happens in the runtime's Scene3D, the same
 * scene as the 3D sprites. The extension ID is still three3d so that older projects keep working.
 *
 * three.js is only touched through scene3D.THREE after scene3D.ensure(), because the exported player only has it
 * for projects that use 3D.
 */
class Scratch3Three3DBlocks {
    constructor (runtime) {
        this.runtime = runtime;
    }

    /** @returns {Scene3D} */
    get _scene3D () {
        return this.runtime.scene3D;
    }

    /**
     * @returns {boolean} true if the scene exists (there is a stage to draw on)
     */
    _ensure () {
        return this._scene3D.ensure();
    }

    _markDirty () {
        this._scene3D.markDirty();
    }

    get _camera () {
        return this._scene3D.camera;
    }

    _get (name) {
        return this._scene3D.getObject(Cast.toString(name));
    }

    _degToRad (degrees) {
        return Cast.toNumber(degrees) * Math.PI / 180;
    }

    getInfo () {
        const xyz = (x, y, z) => ({
            X: {type: ArgumentType.NUMBER, defaultValue: x},
            Y: {type: ArgumentType.NUMBER, defaultValue: y},
            Z: {type: ArgumentType.NUMBER, defaultValue: z}
        });
        const name = {NAME: {type: ArgumentType.STRING, defaultValue: '方塊1'}};
        return {
            id: 'three3d',
            name: '程序物件',
            color1: '#7c5cff',
            color2: '#6a4ae6',
            color3: '#5a3ccc',
            blockIconURI,
            menuIconURI: blockIconURI,
            blocks: [
                {
                    opcode: 'create',
                    blockType: BlockType.COMMAND,
                    text: '建立 [SHAPE] 名稱 [NAME]',
                    arguments: {
                        SHAPE: {type: ArgumentType.STRING, menu: 'shape', defaultValue: 'cube'},
                        ...name
                    }
                },
                {
                    opcode: 'loadModel',
                    blockType: BlockType.COMMAND,
                    text: '載入模型 [FILE] 名稱 [NAME]',
                    arguments: {
                        FILE: {type: ArgumentType.STRING, menu: 'modelFile', defaultValue: ''},
                        NAME: {type: ArgumentType.STRING, defaultValue: '模型1'}
                    }
                },
                {
                    opcode: 'remove',
                    blockType: BlockType.COMMAND,
                    text: '刪除 [NAME]',
                    arguments: name
                },
                {
                    opcode: 'removeAll',
                    blockType: BlockType.COMMAND,
                    text: '刪除所有 3D 物體'
                },
                {
                    opcode: 'exists',
                    blockType: BlockType.BOOLEAN,
                    text: '[NAME] 存在？',
                    arguments: name
                },
                '---',
                {
                    opcode: 'setPosition',
                    blockType: BlockType.COMMAND,
                    text: '將 [NAME] 位置設為 x:[X] y:[Y] z:[Z]',
                    arguments: {...name, ...xyz(0, 0, 0)}
                },
                {
                    opcode: 'changePosition',
                    blockType: BlockType.COMMAND,
                    text: '將 [NAME] 位置改變 x:[X] y:[Y] z:[Z]',
                    arguments: {...name, ...xyz(0.1, 0, 0)}
                },
                {
                    opcode: 'setRotation',
                    blockType: BlockType.COMMAND,
                    text: '將 [NAME] 旋轉設為 x:[X] y:[Y] z:[Z] 度',
                    arguments: {...name, ...xyz(0, 0, 0)}
                },
                {
                    opcode: 'changeRotation',
                    blockType: BlockType.COMMAND,
                    text: '將 [NAME] 旋轉 x:[X] y:[Y] z:[Z] 度',
                    arguments: {...name, ...xyz(0, 5, 0)}
                },
                {
                    opcode: 'lookAtObject',
                    blockType: BlockType.COMMAND,
                    text: '將 [NAME] 面向 [TARGET]',
                    arguments: {...name, TARGET: {type: ArgumentType.STRING, defaultValue: '方塊2'}}
                },
                {
                    opcode: 'setScale',
                    blockType: BlockType.COMMAND,
                    text: '將 [NAME] 縮放設為 x:[X] y:[Y] z:[Z]',
                    arguments: {...name, ...xyz(1, 1, 1)}
                },
                {
                    opcode: 'setColor',
                    blockType: BlockType.COMMAND,
                    text: '將 [NAME] 顏色設為 [COLOR]',
                    arguments: {...name, COLOR: {type: ArgumentType.COLOR, defaultValue: '#4c97ff'}}
                },
                {
                    opcode: 'setVisible',
                    blockType: BlockType.COMMAND,
                    text: '將 [NAME] [VISIBLE]',
                    arguments: {...name, VISIBLE: {type: ArgumentType.STRING, menu: 'visible', defaultValue: 'show'}}
                },
                {
                    opcode: 'getProp',
                    blockType: BlockType.REPORTER,
                    text: '[NAME] 的 [PROP]',
                    arguments: {...name, PROP: {type: ArgumentType.STRING, menu: 'prop', defaultValue: 'x'}}
                },
                '---',
                {
                    opcode: 'setCameraPosition',
                    blockType: BlockType.COMMAND,
                    text: '相機位置設為 x:[X] y:[Y] z:[Z]',
                    arguments: xyz(0, 0, 5)
                },
                {
                    opcode: 'changeCameraPosition',
                    blockType: BlockType.COMMAND,
                    text: '相機位置改變 x:[X] y:[Y] z:[Z]',
                    arguments: xyz(0, 0, -0.1)
                },
                {
                    opcode: 'cameraLookAt',
                    blockType: BlockType.COMMAND,
                    text: '相機看向 x:[X] y:[Y] z:[Z]',
                    arguments: xyz(0, 0, 0)
                },
                {
                    opcode: 'cameraLookAtObject',
                    blockType: BlockType.COMMAND,
                    text: '相機看向 [NAME]',
                    arguments: name
                },
                {
                    opcode: 'setCameraFov',
                    blockType: BlockType.COMMAND,
                    text: '相機視角設為 [FOV] 度',
                    arguments: {FOV: {type: ArgumentType.NUMBER, defaultValue: 60}}
                },
                {
                    opcode: 'getCamera',
                    blockType: BlockType.REPORTER,
                    text: '相機的 [AXIS]',
                    arguments: {AXIS: {type: ArgumentType.STRING, menu: 'axis', defaultValue: 'x'}}
                },
                {
                    opcode: 'moveCamera',
                    blockType: BlockType.COMMAND,
                    text: '相機向 [DIR] 移動 [STEPS]',
                    arguments: {
                        DIR: {type: ArgumentType.STRING, menu: 'direction', defaultValue: 'forward'},
                        STEPS: {type: ArgumentType.NUMBER, defaultValue: 0.1}
                    }
                },
                {
                    opcode: 'setCameraDirection',
                    blockType: BlockType.COMMAND,
                    text: '相機方向設為 水平:[YAW] 垂直:[PITCH] 度',
                    arguments: {
                        YAW: {type: ArgumentType.NUMBER, defaultValue: 0},
                        PITCH: {type: ArgumentType.NUMBER, defaultValue: 0}
                    }
                },
                '---',
                {
                    opcode: 'enablePointerLock',
                    blockType: BlockType.COMMAND,
                    text: '啟用滑鼠視角控制 靈敏度 [SENS]',
                    arguments: {SENS: {type: ArgumentType.NUMBER, defaultValue: 1}}
                },
                {
                    opcode: 'disablePointerLock',
                    blockType: BlockType.COMMAND,
                    text: '停用滑鼠視角控制'
                },
                {
                    opcode: 'isPointerLocked',
                    blockType: BlockType.BOOLEAN,
                    text: '滑鼠已鎖定？'
                },
                '---',
                {
                    opcode: 'setBackground',
                    blockType: BlockType.COMMAND,
                    text: '將 3D 背景顏色設為 [COLOR]',
                    arguments: {COLOR: {type: ArgumentType.COLOR, defaultValue: '#202040'}}
                },
                {
                    opcode: 'clearBackground',
                    blockType: BlockType.COMMAND,
                    text: '將 3D 背景設為透明'
                },
                {
                    opcode: 'setAmbient',
                    blockType: BlockType.COMMAND,
                    text: '環境光強度設為 [VALUE]',
                    arguments: {VALUE: {type: ArgumentType.NUMBER, defaultValue: 0.6}}
                },
                {
                    opcode: 'setSun',
                    blockType: BlockType.COMMAND,
                    text: '平行光來自 x:[X] y:[Y] z:[Z] 強度 [VALUE]',
                    arguments: {...xyz(3, 5, 4), VALUE: {type: ArgumentType.NUMBER, defaultValue: 1.2}}
                },
                {
                    opcode: 'setLayerVisible',
                    blockType: BlockType.COMMAND,
                    text: '[VISIBLE] 3D 畫面',
                    arguments: {VISIBLE: {type: ArgumentType.STRING, menu: 'visible', defaultValue: 'show'}}
                }
            ],
            menus: {
                modelFile: {
                    acceptReporters: true,
                    items: '_getModelFileMenu'
                },
                shape: {
                    acceptReporters: true,
                    items: [
                        {text: '方塊', value: 'cube'},
                        {text: '球體', value: 'sphere'},
                        {text: '圓柱', value: 'cylinder'},
                        {text: '圓錐', value: 'cone'},
                        {text: '平面', value: 'plane'},
                        {text: '圓環', value: 'torus'}
                    ]
                },
                visible: {
                    acceptReporters: false,
                    items: [
                        {text: '顯示', value: 'show'},
                        {text: '隱藏', value: 'hide'}
                    ]
                },
                prop: {
                    acceptReporters: true,
                    items: [
                        {text: 'x 位置', value: 'x'},
                        {text: 'y 位置', value: 'y'},
                        {text: 'z 位置', value: 'z'},
                        {text: 'x 旋轉', value: 'rotX'},
                        {text: 'y 旋轉', value: 'rotY'},
                        {text: 'z 旋轉', value: 'rotZ'},
                        {text: 'x 縮放', value: 'scaleX'},
                        {text: 'y 縮放', value: 'scaleY'},
                        {text: 'z 縮放', value: 'scaleZ'}
                    ]
                },
                axis: {
                    acceptReporters: false,
                    items: [
                        'x',
                        'y',
                        'z',
                        {text: '水平角度', value: 'yaw'},
                        {text: '垂直角度', value: 'pitch'}
                    ]
                },
                direction: {
                    acceptReporters: true,
                    items: [
                        {text: '前', value: 'forward'},
                        {text: '後', value: 'back'},
                        {text: '左', value: 'left'},
                        {text: '右', value: 'right'},
                        {text: '上', value: 'up'},
                        {text: '下', value: 'down'}
                    ]
                }
            }
        };
    }

    _getModelFileMenu () {
        const names = this.runtime.fileManager.getFileNames().filter(name => Scene3D.MODEL_EXTENSION.test(name));
        if (names.length === 0) {
            return [{text: '（先到「檔案」分頁上傳 .glb）', value: ''}];
        }
        return names;
    }

    loadModel (args) {
        if (!this._ensure()) return;
        const promise = this._scene3D.getModel(Cast.toString(args.FILE));
        if (!promise) return;
        const key = Cast.toString(args.NAME);
        return promise.then(scene => {
            this._scene3D.setObject(key, this._scene3D.cloneModel(scene));
        }, () => {});
    }

    create (args) {
        if (!this._ensure()) return;
        const THREE = this._scene3D.THREE;
        const shape = Scene3D.SHAPES.includes(args.SHAPE) ? args.SHAPE : 'cube';
        const mesh = new THREE.Mesh(
            this._scene3D.getGeometry(shape),
            new THREE.MeshStandardMaterial({
                color: 0x4c97ff,
                side: shape === 'plane' ? THREE.DoubleSide : THREE.FrontSide
            })
        );
        mesh.userData.twSharedGeometry = true;
        this._scene3D.setObject(Cast.toString(args.NAME), mesh);
    }

    remove (args) {
        this._scene3D.removeObject(Cast.toString(args.NAME));
    }

    removeAll () {
        this._scene3D.clearObjects();
    }

    exists (args) {
        return this._scene3D.objects.has(Cast.toString(args.NAME));
    }

    setPosition (args) {
        const mesh = this._get(args.NAME);
        if (!mesh) return;
        mesh.position.set(Cast.toNumber(args.X), Cast.toNumber(args.Y), Cast.toNumber(args.Z));
        this._markDirty();
    }

    changePosition (args) {
        const mesh = this._get(args.NAME);
        if (!mesh) return;
        mesh.position.x += Cast.toNumber(args.X);
        mesh.position.y += Cast.toNumber(args.Y);
        mesh.position.z += Cast.toNumber(args.Z);
        this._markDirty();
    }

    setRotation (args) {
        const mesh = this._get(args.NAME);
        if (!mesh) return;
        mesh.rotation.set(this._degToRad(args.X), this._degToRad(args.Y), this._degToRad(args.Z));
        this._markDirty();
    }

    changeRotation (args) {
        const mesh = this._get(args.NAME);
        if (!mesh) return;
        mesh.rotation.x += this._degToRad(args.X);
        mesh.rotation.y += this._degToRad(args.Y);
        mesh.rotation.z += this._degToRad(args.Z);
        this._markDirty();
    }

    lookAtObject (args) {
        const mesh = this._get(args.NAME);
        const target = this._get(args.TARGET);
        if (!mesh || !target || mesh === target) return;
        // Turns the object's +z side toward the target
        mesh.lookAt(target.position);
        this._markDirty();
    }

    setScale (args) {
        const mesh = this._get(args.NAME);
        if (!mesh) return;
        mesh.scale.set(Cast.toNumber(args.X), Cast.toNumber(args.Y), Cast.toNumber(args.Z));
        this._markDirty();
    }

    setColor (args) {
        const mesh = this._get(args.NAME);
        if (!mesh) return;
        const THREE = this._scene3D.THREE;
        const rgb = Cast.toRgbColorObject(args.COLOR);
        mesh.traverse(child => {
            if (!child.isMesh) return;
            if (mesh.userData.twModel && !child.userData.twOwnMaterial) {
                // Materials are shared with other copies of the model, so give this copy its own
                child.material = Array.isArray(child.material) ?
                    child.material.map(material => material.clone()) :
                    child.material.clone();
                child.userData.twOwnMaterial = true;
            }
            for (const material of asArray(child.material)) {
                if (material.color) material.color.setRGB(rgb.r / 255, rgb.g / 255, rgb.b / 255, THREE.SRGBColorSpace);
            }
        });
        this._markDirty();
    }

    setVisible (args) {
        const mesh = this._get(args.NAME);
        if (!mesh) return;
        mesh.visible = args.VISIBLE !== 'hide';
        this._markDirty();
    }

    getProp (args) {
        const mesh = this._get(args.NAME);
        if (!mesh || !PROPS.includes(args.PROP)) return 0;
        const radToDeg = radians => radians * 180 / Math.PI;
        let value;
        switch (args.PROP) {
        case 'x': value = mesh.position.x; break;
        case 'y': value = mesh.position.y; break;
        case 'z': value = mesh.position.z; break;
        case 'rotX': value = radToDeg(mesh.rotation.x); break;
        case 'rotY': value = radToDeg(mesh.rotation.y); break;
        case 'rotZ': value = radToDeg(mesh.rotation.z); break;
        case 'scaleX': value = mesh.scale.x; break;
        case 'scaleY': value = mesh.scale.y; break;
        case 'scaleZ': value = mesh.scale.z; break;
        }
        return Math.round(value * 1e6) / 1e6;
    }

    setCameraPosition (args) {
        if (!this._ensure()) return;
        this._camera.position.set(Cast.toNumber(args.X), Cast.toNumber(args.Y), Cast.toNumber(args.Z));
        this._markDirty();
    }

    changeCameraPosition (args) {
        if (!this._ensure()) return;
        this._camera.position.x += Cast.toNumber(args.X);
        this._camera.position.y += Cast.toNumber(args.Y);
        this._camera.position.z += Cast.toNumber(args.Z);
        this._markDirty();
    }

    cameraLookAt (args) {
        if (!this._ensure()) return;
        this._camera.lookAt(Cast.toNumber(args.X), Cast.toNumber(args.Y), Cast.toNumber(args.Z));
        this._markDirty();
    }

    cameraLookAtObject (args) {
        const mesh = this._get(args.NAME);
        if (!mesh || !this._ensure()) return;
        this._camera.lookAt(mesh.position);
        this._markDirty();
    }

    setCameraFov (args) {
        if (!this._ensure()) return;
        this._camera.fov = Math.min(179, Math.max(1, Cast.toNumber(args.FOV)));
        this._camera.updateProjectionMatrix();
        this._markDirty();
    }

    getCamera (args) {
        if (!CAMERA_AXES.includes(args.AXIS)) return 0;
        if (!this._camera) {
            // No stage yet: the camera the project will start with
            return this._scene3D.environment.camera[args.AXIS];
        }
        const radToDeg = radians => radians * 180 / Math.PI;
        let value;
        switch (args.AXIS) {
        case 'yaw': value = radToDeg(this._camera.rotation.y); break;
        case 'pitch': value = radToDeg(this._camera.rotation.x); break;
        default: value = this._camera.position[args.AXIS];
        }
        return Math.round(value * 1e6) / 1e6;
    }

    moveCamera (args) {
        if (!this._ensure()) return;
        const steps = Cast.toNumber(args.STEPS);
        // Forward/back/left/right stay level with the ground, like a first-person game
        const yaw = this._camera.rotation.y;
        const forwardX = -Math.sin(yaw);
        const forwardZ = -Math.cos(yaw);
        const position = this._camera.position;
        switch (args.DIR) {
        case 'forward': position.x += forwardX * steps; position.z += forwardZ * steps; break;
        case 'back': position.x -= forwardX * steps; position.z -= forwardZ * steps; break;
        case 'right': position.x -= forwardZ * steps; position.z += forwardX * steps; break;
        case 'left': position.x += forwardZ * steps; position.z -= forwardX * steps; break;
        case 'up': position.y += steps; break;
        case 'down': position.y -= steps; break;
        default: return;
        }
        this._markDirty();
    }

    setCameraDirection (args) {
        if (!this._ensure()) return;
        const pitch = this._degToRad(args.PITCH);
        this._camera.rotation.set(
            Math.max(-Scene3D.MAX_PITCH, Math.min(Scene3D.MAX_PITCH, pitch)),
            this._degToRad(args.YAW),
            0
        );
        this._markDirty();
    }

    enablePointerLock (args, util) {
        // Clicking the block in the palette also adds a WASD example script
        if (util.thread.stackClick && !util.target.blocks.getBlock(util.thread.topBlock)) {
            this._addExampleScript(util.target);
        }
        if (!this._ensure()) return;
        this._scene3D.setPointerLock(true, Cast.toNumber(args.SENS));
    }

    disablePointerLock () {
        this._scene3D.setPointerLock(false);
    }

    isPointerLocked () {
        return this._scene3D.isPointerLocked();
    }

    /**
     * Add a "green flag → mouse look → WASD/QE every frame" script to the target,
     * unless it already uses the mouse look block.
     * @param {Target} target The sprite or stage being edited.
     */
    _addExampleScript (target) {
        const existing = target.blocks._blocks;
        if (Object.values(existing).some(block => block.opcode === 'three3d_enablePointerLock')) return;

        const blocks = [];
        const add = (opcode, extra) => {
            const block = {
                id: uid(),
                opcode,
                inputs: {},
                fields: {},
                next: null,
                parent: null,
                shadow: false,
                topLevel: false,
                ...extra
            };
            blocks.push(block);
            return block;
        };
        const shadow = (opcode, field, value) => add(opcode, {
            shadow: true,
            fields: field ? {[field]: {name: field, value}} : {}
        });
        const input = (parent, name, block, obscured = null) => {
            parent.inputs[name] = {name, block: block.id, shadow: block.shadow ? block.id : obscured && obscured.id};
            block.parent = parent.id;
            if (obscured) obscured.parent = parent.id;
        };
        const chain = list => {
            for (let i = 1; i < list.length; i++) {
                list[i - 1].next = list[i].id;
                list[i].parent = list[i - 1].id;
            }
        };

        let x = 0;
        for (const id of target.blocks.getScripts()) {
            x = Math.max(x, (existing[id].x || 0) + 450);
        }

        const hat = add('event_whenflagclicked', {topLevel: true, x, y: 0});
        const enable = add('three3d_enablePointerLock');
        input(enable, 'SENS', shadow('math_number', 'NUM', '1'));
        const loop = add('control_foreachframe');
        input(loop, 'DT', shadow('control_foreachframe_deltatime'));
        chain([hat, enable, loop]);

        const ifs = [
            ['w', 'forward'],
            ['s', 'back'],
            ['a', 'left'],
            ['d', 'right'],
            ['q', 'up'],
            ['e', 'down']
        ].map(([key, dir]) => {
            const ifBlock = add('control_if');
            const pressed = add('sensing_keypressed');
            input(pressed, 'KEY_OPTION', shadow('sensing_keyoptions', 'KEY_OPTION', key));
            input(ifBlock, 'CONDITION', pressed);
            const move = add('three3d_moveCamera');
            input(move, 'DIR', shadow('three3d_menu_direction', 'direction', dir));
            const multiply = add('operator_multiply');
            input(multiply, 'NUM1', shadow('math_number', 'NUM', '5'));
            input(multiply, 'NUM2', add('control_foreachframe_deltatime'), shadow('math_number', 'NUM', ''));
            input(move, 'STEPS', multiply, shadow('math_number', 'NUM', '0.1'));
            input(ifBlock, 'SUBSTACK', move);
            return ifBlock;
        });
        chain(ifs);
        input(loop, 'SUBSTACK', ifs[0]);

        for (const block of blocks) {
            target.blocks.createBlock(block);
        }
        // Let the click finish before the editor reloads the workspace
        setTimeout(() => this.runtime.emit('BLOCKS_NEED_UPDATE'));
    }

    setBackground (args) {
        const rgb = Cast.toRgbColorObject(args.COLOR);
        this._ensure();
        this._scene3D.setEnvironment({background: {type: 'color', color: Color.rgbToHex(rgb)}});
    }

    clearBackground () {
        this._ensure();
        this._scene3D.setEnvironment({background: {type: 'none'}});
    }

    setAmbient (args) {
        this._ensure();
        this._scene3D.setEnvironment({ambient: {intensity: Math.max(0, Cast.toNumber(args.VALUE))}});
    }

    setSun (args) {
        this._ensure();
        this._scene3D.setEnvironment({sun: {
            x: Cast.toNumber(args.X),
            y: Cast.toNumber(args.Y),
            z: Cast.toNumber(args.Z),
            intensity: Math.max(0, Cast.toNumber(args.VALUE))
        }});
    }

    setLayerVisible (args) {
        if (!this._ensure()) return;
        this._scene3D.setLayerVisible(args.VISIBLE !== 'hide');
    }
}

module.exports = Scratch3Three3DBlocks;

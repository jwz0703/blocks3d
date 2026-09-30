let _TextEncoder;
if (typeof TextEncoder === 'undefined') {
    _TextEncoder = require('text-encoding').TextEncoder;
} else {
    _TextEncoder = TextEncoder;
}
const EventEmitter = require('events');
const JSZip = require('@turbowarp/jszip');

const Buffer = require('buffer').Buffer;
const centralDispatch = require('./dispatch/central-dispatch');
const ExtensionManager = require('./extension-support/extension-manager');
const log = require('./util/log');
const MathUtil = require('./util/math-util');
const Runtime = require('./engine/runtime');
const RenderedTarget = require('./sprites/rendered-target');
const Sprite = require('./sprites/sprite');
const StringUtil = require('./util/string-util');
const formatMessage = require('format-message');

const Variable = require('./engine/variable');
const newBlockIds = require('./util/new-block-ids');

const {loadCostume} = require('./import/load-costume.js');
const {loadSound} = require('./import/load-sound.js');
const {serializeSounds, serializeCostumes} = require('./serialization/serialize-assets');
require('canvas-toBlob');
const {exportCostume} = require('./serialization/tw-costume-import-export');
const Base64Util = require('./util/base64-util');
const BlockSupport = require('./engine/block-support');
const Blocks = require('./engine/blocks');
const Screen = require('./engine/screen');
const StageUndo = require('./engine/stage-undo');
const {setCostumeSource, renderableSvg} = require('./engine/svg-bindings');

const RESERVED_NAMES = ['_mouse_', '_stage_', '_edge_', '_myself_', '_random_'];

const PROJECT_MIME_TYPE = 'application/x.blocks3d.3dsb';

const CORE_EXTENSIONS = [
    // 'motion',
    // 'looks',
    // 'sound',
    // 'events',
    // 'control',
    // 'sensing',
    // 'operators',
    // 'variables',
    // 'myBlocks'
    'twfiles',
    // Global variables, arrays and objects, read and written with paths
    'twdata',
    // Variables of sprites and clones, and clones by id; shown in Control
    'twclonevars',
    // Events of the public interface of sprites (engine/sprite-interface.js); the GUI makes their categories
    'twiface',
    // Properties of instances of components (engine/components.js); the GUI puts them in the 介面 categories
    'twcomp',
    // Local variables of custom blocks; shown in My Blocks
    'twlocalvars',
    // Blocks of 3D sprites; the palette only shows them for 3D sprites
    'motion3d',
    'looks3d',
    'sensing3d',
    // Cameras and the environment of the current backdrop, for every target
    'camera3d',
    'environment3d',
    // Blocks of each kind of sky; the palette only shows them when a backdrop has that kind of sky
    'skyprocedural',
    'skycolor',
    'skyhdri',
    // Collision and physics of 3D sprites; raycasts and gravity for every target
    'physics3d',
    // Mouse over sprites, shown in Events; 3D sound, shown in Sound for 3D sprites
    'event3d',
    'sound3d',
    // Size of the screen: the reporter is shown in Sensing, the hat in Events
    'screen',
    // The wheel, taps, clicks going through sprites, what the mouse points at and the cursor: the hats are shown in
    // Events, the other blocks in Sensing
    'twmouse',
    // atan2, clamp, min, max and lerp: shown at the end of Operators
    'twmath'
];

// Disable missing translation warnings in console
formatMessage.setup({
    missingTranslation: 'ignore'
});

const createRuntimeService = runtime => {
    const service = {};
    service._refreshExtensionPrimitives = runtime._refreshExtensionPrimitives.bind(runtime);
    service._registerExtensionPrimitives = runtime._registerExtensionPrimitives.bind(runtime);
    return service;
};

/**
 * Handles connections between blocks, stage, and extensions.
 * @constructor
 */
class VirtualMachine extends EventEmitter {
    constructor () {
        super();

        /**
         * VM runtime, to store blocks, I/O devices, sprites/targets, etc.
         * @type {!Runtime}
         */
        this.runtime = new Runtime();
        centralDispatch.setService('runtime', createRuntimeService(this.runtime)).catch(e => {
            log.error(`Failed to register runtime service: ${JSON.stringify(e)}`);
        });

        /**
         * The "currently editing"/selected target ID for the VM.
         * Block events from any Blockly workspace are routed to this target.
         * @type {Target}
         */
        this.editingTarget = null;

        /**
         * The currently dragging target, for redirecting IO data.
         * @type {Target}
         */
        this._dragTarget = null;

        // Runtime emits are passed along as VM emits.
        this.runtime.on(Runtime.SCRIPT_GLOW_ON, glowData => {
            this.emit(Runtime.SCRIPT_GLOW_ON, glowData);
        });
        this.runtime.on(Runtime.SCRIPT_GLOW_OFF, glowData => {
            this.emit(Runtime.SCRIPT_GLOW_OFF, glowData);
        });
        this.runtime.on(Runtime.BLOCK_GLOW_ON, glowData => {
            this.emit(Runtime.BLOCK_GLOW_ON, glowData);
        });
        this.runtime.on(Runtime.BLOCK_GLOW_OFF, glowData => {
            this.emit(Runtime.BLOCK_GLOW_OFF, glowData);
        });
        this.runtime.on(Runtime.PROJECT_START, () => {
            this.emit(Runtime.PROJECT_START);
        });
        this.runtime.on(Runtime.PROJECT_RUN_START, () => {
            this.emit(Runtime.PROJECT_RUN_START);
        });
        this.runtime.on(Runtime.PROJECT_RUN_STOP, () => {
            this.emit(Runtime.PROJECT_RUN_STOP);
        });
        this.runtime.on(Runtime.PROJECT_CHANGED, () => {
            this.emit(Runtime.PROJECT_CHANGED);
        });
        this.runtime.on(Runtime.VISUAL_REPORT, visualReport => {
            this.emit(Runtime.VISUAL_REPORT, visualReport);
        });
        /**
         * True to give projects that aren't .3dsb (e.g. .sb3) a camera sprite when they are loaded. The editor
         * turns it on; the player doesn't need one.
         * @type {boolean}
         */
        this.addCameraOnImport = false;

        this.runtime.on(Runtime.TARGETS_UPDATE, emitProjectChanged => {
            this.emitTargetsUpdate(emitProjectChanged);
        });
        // Clicking a 3D sprite on the stage in the editor selects it
        this.runtime.on('SCENE3D_PICK_TARGET', targetId => {
            this.setEditingTarget(targetId);
        });
        this.runtime.on('SCENE3D_EDITOR_CHANGED', state => {
            this.emit('SCENE3D_EDITOR_CHANGED', state);
        });
        this.runtime.on(Runtime.MONITORS_UPDATE, monitorList => {
            this.emit(Runtime.MONITORS_UPDATE, monitorList);
        });
        this.runtime.on(Runtime.BLOCK_DRAG_UPDATE, areBlocksOverGui => {
            this.emit(Runtime.BLOCK_DRAG_UPDATE, areBlocksOverGui);
        });
        this.runtime.on(Runtime.BLOCK_DRAG_END, (blocks, topBlockId) => {
            this.emit(Runtime.BLOCK_DRAG_END, blocks, topBlockId);
        });
        this.runtime.on(Runtime.EXTENSION_ADDED, categoryInfo => {
            this.emit(Runtime.EXTENSION_ADDED, categoryInfo);
        });
        this.runtime.on(Runtime.EXTENSION_FIELD_ADDED, (fieldName, fieldImplementation) => {
            this.emit(Runtime.EXTENSION_FIELD_ADDED, fieldName, fieldImplementation);
        });
        this.runtime.on(Runtime.BLOCKSINFO_UPDATE, categoryInfo => {
            this.emit(Runtime.BLOCKSINFO_UPDATE, categoryInfo);
        });
        this.runtime.on(Runtime.BLOCKS_NEED_UPDATE, () => {
            this.emitWorkspaceUpdate();
        });
        // Editing a component is only for editing: the green flag goes back to the whole project first
        this.runtime.on(Runtime.PROJECT_START, () => {
            if (this.runtime.components.editScope) this.exitComponent(true);
        });
        this.runtime.components.onMembersSynced = () => this.refreshComponentEditView();
        this.runtime.on(Runtime.TOOLBOX_EXTENSIONS_NEED_UPDATE, () => {
            this.extensionManager.refreshBlocks();
        });
        this.runtime.on(Runtime.PERIPHERAL_LIST_UPDATE, info => {
            this.emit(Runtime.PERIPHERAL_LIST_UPDATE, info);
        });
        this.runtime.on(Runtime.USER_PICKED_PERIPHERAL, info => {
            this.emit(Runtime.USER_PICKED_PERIPHERAL, info);
        });
        this.runtime.on(Runtime.PERIPHERAL_CONNECTED, () =>
            this.emit(Runtime.PERIPHERAL_CONNECTED)
        );
        this.runtime.on(Runtime.PERIPHERAL_REQUEST_ERROR, () =>
            this.emit(Runtime.PERIPHERAL_REQUEST_ERROR)
        );
        this.runtime.on(Runtime.PERIPHERAL_DISCONNECTED, () =>
            this.emit(Runtime.PERIPHERAL_DISCONNECTED)
        );
        this.runtime.on(Runtime.PERIPHERAL_CONNECTION_LOST_ERROR, data =>
            this.emit(Runtime.PERIPHERAL_CONNECTION_LOST_ERROR, data)
        );
        this.runtime.on(Runtime.PERIPHERAL_SCAN_TIMEOUT, () =>
            this.emit(Runtime.PERIPHERAL_SCAN_TIMEOUT)
        );
        this.runtime.on(Runtime.MIC_LISTENING, listening => {
            this.emit(Runtime.MIC_LISTENING, listening);
        });
        this.runtime.on(Runtime.RUNTIME_STARTED, () => {
            this.emit(Runtime.RUNTIME_STARTED);
        });
        this.runtime.on(Runtime.RUNTIME_STOPPED, () => {
            this.emit(Runtime.RUNTIME_STOPPED);
        });
        this.runtime.on(Runtime.HAS_CLOUD_DATA_UPDATE, hasCloudData => {
            this.emit(Runtime.HAS_CLOUD_DATA_UPDATE, hasCloudData);
        });
        this.runtime.on(Runtime.RUNTIME_OPTIONS_CHANGED, runtimeOptions => {
            this.emit(Runtime.RUNTIME_OPTIONS_CHANGED, runtimeOptions);
        });
        this.runtime.on(Runtime.COMPILER_OPTIONS_CHANGED, compilerOptions => {
            this.emit(Runtime.COMPILER_OPTIONS_CHANGED, compilerOptions);
        });
        this.runtime.on(Runtime.FRAMERATE_CHANGED, framerate => {
            this.emit(Runtime.FRAMERATE_CHANGED, framerate);
        });
        this.runtime.on(Runtime.INTERPOLATION_CHANGED, framerate => {
            this.emit(Runtime.INTERPOLATION_CHANGED, framerate);
        });
        this.runtime.on(Runtime.SCREEN_SETTINGS_CHANGED, settings => {
            this.emit(Runtime.SCREEN_SETTINGS_CHANGED, settings);
        });
        this.runtime.on(Runtime.STAGE_SIZE_CHANGED, (width, height) => {
            this.emit(Runtime.STAGE_SIZE_CHANGED, width, height);
        });
        this.runtime.on(Runtime.COMPILE_ERROR, (target, error) => {
            this.emit(Runtime.COMPILE_ERROR, target, error);
        });
        this.runtime.on(Runtime.ASSET_PROGRESS, (finished, total) => {
            this.emit(Runtime.ASSET_PROGRESS, finished, total);
        });
        this.runtime.on(Runtime.TURBO_MODE_OFF, () => {
            this.emit(Runtime.TURBO_MODE_OFF);
        });
        this.runtime.on(Runtime.TURBO_MODE_ON, () => {
            this.emit(Runtime.TURBO_MODE_ON);
        });

        this.extensionManager = new ExtensionManager(this);
        this.securityManager = this.extensionManager.securityManager;
        this.runtime.extensionManager = this.extensionManager;

        // Load core extensions
        for (const id of CORE_EXTENSIONS) {
            this.extensionManager.loadExtensionIdSync(id);
        }

        this.blockListener = this.blockListener.bind(this);
        this.flyoutBlockListener = this.flyoutBlockListener.bind(this);
        this.monitorBlockListener = this.monitorBlockListener.bind(this);
        this.variableListener = this.variableListener.bind(this);

        /**
         * Export some internal classes for extensions.
         */
        this.exports = {
            Sprite,
            RenderedTarget,
            JSZip,
            Variable,

            these_broke_before_and_will_break_again: () => {
                console.warn('You are using unsupported APIs. WHEN your code breaks, do not expect help.');
                return {
                    JSGenerator: require('./compiler/jsgen.js'),
                    IRGenerator: require('./compiler/irgen.js').IRGenerator,
                    ScriptTreeGenerator: require('./compiler/irgen.js').ScriptTreeGenerator,
                    IntermediateStackBlock: require('./compiler/intermediate.js').IntermediateStackBlock,
                    IntermediateInput: require('./compiler/intermediate.js').IntermediateInput,
                    IntermediateStack: require('./compiler/intermediate.js').IntermediateStack,
                    IntermediateScript: require('./compiler/intermediate.js').IntermediateScript,
                    IntermediateRepresentation: require('./compiler/intermediate.js').IntermediateRepresentation,
                    StackOpcode: require('./compiler/enums.js').StackOpcode,
                    InputOpcode: require('./compiler/enums.js').InputOpcode,
                    InputType: require('./compiler/enums.js').InputType,
                    Thread: require('./engine/thread.js'),
                    execute: require('./engine/execute.js')
                };
            },

            i_will_not_ask_for_help_when_these_break: () => {
                this.emit('LEGACY_EXTENSION_API', 'i_will_not_ask_for_help_when_these_break');

                const oldCompilerCompatibility = require('./compiler/old-compiler-compatibility.js');
                oldCompilerCompatibility.enabled = true;

                return {
                    IRGenerator: oldCompilerCompatibility.IRGeneratorStub,
                    ScriptTreeGenerator: oldCompilerCompatibility.ScriptTreeGeneratorStub,
                    JSGenerator: oldCompilerCompatibility.JSGeneratorStub,
                    Thread: require('./engine/thread.js'),
                    execute: require('./engine/execute.js')
                };
            }
        };
    }

    /**
     * Start running the VM - do this before anything else.
     */
    start () {
        this.runtime.start();
    }

    /**
     * @deprecated Used by old versions of TurboWarp. Superceded by upstream's quit()
     */
    stop () {
        this.quit();
    }

    /**
     * Quit the VM, clearing any handles which might keep the process alive.
     * Do not use the runtime after calling this method. This method is meant for test shutdown.
     */
    quit () {
        this.runtime.quit();
    }

    /**
     * "Green flag" handler - start all threads starting with a green flag.
     */
    greenFlag () {
        this.runtime.greenFlag();
    }

    /**
     * Set whether the VM is in "turbo mode."
     * When true, loops don't yield to redraw.
     * @param {boolean} turboModeOn Whether turbo mode should be set.
     */
    setTurboMode (turboModeOn) {
        this.runtime.turboMode = !!turboModeOn;
        if (this.runtime.turboMode) {
            this.emit(Runtime.TURBO_MODE_ON);
        } else {
            this.emit(Runtime.TURBO_MODE_OFF);
        }
    }

    /**
     * Set whether the VM is in 2.0 "compatibility mode."
     * When true, ticks go at 2.0 speed (30 TPS).
     * @param {boolean} compatibilityModeOn Whether compatibility mode is set.
     */
    setCompatibilityMode (compatibilityModeOn) {
        this.runtime.setCompatibilityMode(!!compatibilityModeOn);
    }

    setFramerate (framerate) {
        this.runtime.setFramerate(framerate);
    }

    setInterpolation (interpolationEnabled) {
        this.runtime.setInterpolation(interpolationEnabled);
    }

    setRuntimeOptions (runtimeOptions) {
        this.runtime.setRuntimeOptions(runtimeOptions);
    }

    setCompilerOptions (compilerOptions) {
        this.runtime.setCompilerOptions(compilerOptions);
    }

    /**
     * Change the reference size of the screen settings (engine/screen.js); in the fixed mode that is the stage size.
     * @param {number} width
     * @param {number} height
     */
    setStageSize (width, height) {
        this.runtime.setScreenSettings({width, height});
    }

    /**
     * @param {object} settings some of mode, width, height and renderScale, see engine/screen.js
     */
    setScreenSettings (settings) {
        this.runtime.setScreenSettings(settings);
    }

    /**
     * @param {?number} aspect width / height of the screen that shows the stage
     */
    setViewportAspect (aspect) {
        this.runtime.setViewportAspect(aspect);
    }

    setInEditor (inEditor) {
        this.runtime.setInEditor(inEditor);
    }

    convertToPackagedRuntime () {
        this.runtime.convertToPackagedRuntime();
    }

    addAddonBlock (options) {
        this.runtime.addAddonBlock(options);
    }

    getAddonBlock (procedureCode) {
        return this.runtime.getAddonBlock(procedureCode);
    }

    storeProjectOptions () {
        this.runtime.storeProjectOptions();
        if (this.editingTarget.isStage) {
            this.emitWorkspaceUpdate();
        }
    }

    enableDebug () {
        this.runtime.enableDebug();
        return 'enabled debug mode';
    }

    handleExtensionButtonPress (buttonData) {
        this.runtime.handleExtensionButtonPress(buttonData);
    }

    /**
     * Stop all threads and running activities.
     */
    stopAll () {
        this.runtime.stopAll();
    }

    /**
     * Clear out current running project data.
     */
    clear () {
        this.runtime.dispose();
        this.editingTarget = null;
        this.emitTargetsUpdate(false /* Don't emit project change */);
    }

    /**
     * Get data for playground. Data comes back in an emitted event.
     */
    getPlaygroundData () {
        const instance = this;
        // Only send back thread data for the current editingTarget.
        const threadData = this.runtime.threads.filter(thread => thread.target === instance.editingTarget);
        // Remove the target key, since it's a circular reference.
        const filteredThreadData = JSON.stringify(threadData, (key, value) => {
            if (key === 'target' || key === 'blockContainer') return;
            return value;
        }, 2);
        this.emit('playgroundData', {
            blocks: this.editingTarget.blocks,
            threads: filteredThreadData
        });
    }

    /**
     * Post I/O data to the virtual devices.
     * @param {?string} device Name of virtual I/O device.
     * @param {object} data Any data object to post to the I/O device.
     */
    postIOData (device, data) {
        if (this.runtime.ioDevices[device]) {
            this.runtime.ioDevices[device].postData(data);
        }
    }

    setVideoProvider (videoProvider) {
        this.runtime.ioDevices.video.setProvider(videoProvider);
    }

    setCloudProvider (cloudProvider) {
        this.runtime.ioDevices.cloud.setProvider(cloudProvider);
    }

    /**
     * Tell the specified extension to scan for a peripheral.
     * @param {string} extensionId - the id of the extension.
     */
    scanForPeripheral (extensionId) {
        this.runtime.scanForPeripheral(extensionId);
    }

    /**
     * Connect to the extension's specified peripheral.
     * @param {string} extensionId - the id of the extension.
     * @param {number} peripheralId - the id of the peripheral.
     */
    connectPeripheral (extensionId, peripheralId) {
        this.runtime.connectPeripheral(extensionId, peripheralId);
    }

    /**
     * Disconnect from the extension's connected peripheral.
     * @param {string} extensionId - the id of the extension.
     */
    disconnectPeripheral (extensionId) {
        this.runtime.disconnectPeripheral(extensionId);
    }

    /**
     * Returns whether the extension has a currently connected peripheral.
     * @param {string} extensionId - the id of the extension.
     * @return {boolean} - whether the extension has a connected peripheral.
     */
    getPeripheralIsConnected (extensionId) {
        return this.runtime.getPeripheralIsConnected(extensionId);
    }

    /**
     * Load a project from a .3dsb, .sb, .sb2, .sb3 or json string.
     * @param {string | object} input A json string, object, or ArrayBuffer representing the project to load.
     * @return {!Promise} Promise that resolves after targets are installed.
     */
    loadProject (input) {
        const tw3dsb = require('./serialization/3dsb');
        return tw3dsb.unpack(input).then(unpacked => {
            if (unpacked) {
                return this.deserializeProject(unpacked.json, unpacked.zip)
                    .then(() => this.runtime.handleProjectLoaded());
            }
            return this._loadScratchProject(input);
        });
    }

    /**
     * Load a Scratch project (.sb, .sb2, .sb3). Its sprites become 2D sprites.
     * @param {string | object} input A json string, object, or ArrayBuffer representing the project to load.
     * @return {!Promise} Promise that resolves after targets are installed.
     */
    _loadScratchProject (input) {
        if (typeof input === 'object' && !(input instanceof ArrayBuffer) &&
          !ArrayBuffer.isView(input)) {
            // If the input is an object and not any ArrayBuffer
            // or an ArrayBuffer view (this includes all typed arrays and DataViews)
            // turn the object into a JSON string, because we suspect
            // this is a project.json as an object
            // validate expects a string or buffer as input
            // TODO not sure if we need to check that it also isn't a data view
            input = JSON.stringify(input);
        }

        const validationPromise = new Promise((resolve, reject) => {
            const validate = require('scratch-parser');
            // The second argument of false below indicates to the validator that the
            // input should be parsed/validated as an entire project (and not a single sprite)
            validate(input, false, (error, res) => {
                if (error) {
                    return reject(error);
                }
                resolve(res);
            });
        })
            .catch(error => {
                const {SB1File, ValidationError} = require('scratch-sb1-converter');

                try {
                    const sb1 = new SB1File(input);
                    const json = sb1.json;
                    json.projectVersion = 2;
                    return Promise.resolve([json, sb1.zip]);
                } catch (sb1Error) {
                    if (
                        sb1Error instanceof ValidationError ||
                        `${sb1Error}`.includes('Non-ascii character in FixedAsciiString')
                    ) {
                        // The input does not validate as a Scratch 1 file.
                    } else {
                        // The project appears to be a Scratch 1 file but it
                        // could not be successfully translated into a Scratch 2
                        // project.
                        return Promise.reject(sb1Error);
                    }
                }
                // Throw original error since the input does not appear to be
                // an SB1File.
                return Promise.reject(error);
            });

        return validationPromise
            .then(validatedInput => this.deserializeProject(validatedInput[0], validatedInput[1]))
            .then(() => this.runtime.handleProjectLoaded())
            .catch(error => {
                // Intentionally rejecting here (want errors to be handled by caller)
                if (Object.prototype.hasOwnProperty.call(error, 'validationError')) {
                    return Promise.reject(JSON.stringify(error));
                }
                return Promise.reject(error);
            });
    }

    /**
     * Load a project from the Scratch web site, by ID.
     * @param {string} id - the ID of the project to download, as a string.
     */
    downloadProjectId (id) {
        const storage = this.runtime.storage;
        if (!storage) {
            log.error('No storage module present; cannot load project: ', id);
            return;
        }
        const vm = this;
        const promise = storage.load(storage.AssetType.Project, id);
        promise.then(projectAsset => {
            if (!projectAsset) {
                log.error(`Failed to fetch project with id: ${id}`);
                return null;
            }
            return vm.loadProject(projectAsset.data);
        });
    }

    /**
     * @returns {JSZip} JSZip zip object representing the sb3.
     */
    _saveProjectZip () {
        const projectJson = this.toJSON();

        // TODO want to eventually move zip creation out of here, and perhaps
        // into scratch-storage
        const zip = new JSZip();

        // Put everything in a zip file
        zip.file('project.json', projectJson);
        this._addFileDescsToZip(this.serializeAssets(), zip);

        // Use a fixed modification date for the files in the zip instead of letting JSZip use the
        // current time to avoid a very small metadata leak and make zipping deterministic. The magic
        // number is from the first TurboWarp/scratch-vm commit after forking
        // (4a93dab4fa3704ab7a1374b9794026b3330f3433).
        const date = new Date(1591657163000);
        for (const file of Object.values(zip.files)) {
            file.date = date;
        }

        // Tell JSZip to only compress file formats where there will be a significant gain.
        const COMPRESSABLE_FORMATS = [
            '.json',
            '.svg',
            '.wav',
            '.ttf',
            '.otf'
        ];
        for (const file of Object.values(zip.files)) {
            if (COMPRESSABLE_FORMATS.some(ext => file.name.endsWith(ext))) {
                file.options.compression = 'DEFLATE';
            } else {
                file.options.compression = 'STORE';
            }
        }

        return zip;
    }

    /**
     * @param {JSZip.OutputType} [type] JSZip output type. Defaults to 'blob'.
     * @returns {Promise<unknown>} Compressed .3dsb file in a type determined by the type argument.
     */
    saveProject3dsb (type) {
        return this._saveProjectZip().generateAsync({
            // Don't configure compression here. _saveProjectZip() will set it for each file.
            type: type || 'blob',
            mimeType: PROJECT_MIME_TYPE
        });
    }

    /**
     * @param {JSZip.OutputType} [type] JSZip output type. Defaults to 'arraybuffer'.
     * @returns {StreamHelper} JSZip StreamHelper object generating the compressed .3dsb.
     * See: https://stuk.github.io/jszip/documentation/api_streamhelper.html
     */
    saveProject3dsbStream (type) {
        return this._saveProjectZip().generateInternalStream({
            type: type || 'arraybuffer',
            mimeType: PROJECT_MIME_TYPE,
            compression: 'DEFLATE'
        });
    }

    /**
     * Projects are only saved as .3dsb; this is an alias of saveProject3dsb for older callers (e.g. addons).
     * @param {JSZip.OutputType} [type] JSZip output type.
     * @returns {Promise<unknown>} Compressed .3dsb file.
     */
    saveProjectSb3 (type) {
        return this.saveProject3dsb(type);
    }

    /**
     * Alias of saveProject3dsbStream, see saveProjectSb3.
     * @param {JSZip.OutputType} [type] JSZip output type.
     * @returns {StreamHelper} JSZip StreamHelper object generating the compressed .3dsb.
     */
    saveProjectSb3Stream (type) {
        return this.saveProject3dsbStream(type);
    }

    /**
     * tw: Serialize the project into a map of files without actually zipping the project.
     * The buffers returned are the exact same ones used internally, not copies. Avoid directly
     * manipulating them (except project.json, which is created by this function).
     * @returns {Record<string, Uint8Array>} Map of file name to the raw data for that file.
     */
    saveProjectSb3DontZip () {
        const projectJson = this.toJSON();

        const files = {
            'project.json': new _TextEncoder().encode(projectJson)
        };
        for (const fileDesc of this.serializeAssets()) {
            files[fileDesc.fileName] = fileDesc.fileContent;
        }

        return files;
    }

    /**
     * @type {Array<object>} Array of all assets currently in the runtime
     */
    get assets () {
        const costumesAndSounds = this.runtime.targets.reduce((acc, target) => (
            acc
                .concat(target.sprite.sounds.map(sound => sound.asset))
                .concat(target.sprite.costumes.map(costume => costume.asset))
        ), []);
        const fonts = this.runtime.fontManager.serializeAssets();
        const files = this.runtime.fileManager.serializeAssets();
        return [
            ...costumesAndSounds,
            ...fonts,
            ...files
        ];
    }

    /**
     * @param {string} targetId Optional ID of target to export
     * @returns {Array<{fileName: string; fileContent: Uint8Array;}} list of file descs
     */
    serializeAssets (targetId) {
        const costumeDescs = serializeCostumes(this.runtime, targetId);
        const soundDescs = serializeSounds(this.runtime, targetId);
        const fontDescs = this.runtime.fontManager.serializeAssets().map(asset => ({
            fileName: `${asset.assetId}.${asset.dataFormat}`,
            fileContent: asset.data
        }));
        // Project files are project-wide, so exported sprites don't include them
        const fileDescs = targetId ? [] : this.runtime.fileManager.serializeAssets().map(asset => ({
            fileName: `${asset.assetId}.${asset.dataFormat}`,
            fileContent: asset.data
        }));
        return [
            ...costumeDescs,
            ...soundDescs,
            ...fontDescs,
            ...fileDescs
        ];
    }

    _addFileDescsToZip (fileDescs, zip) {
        // TODO: sort files, smallest first
        for (let i = 0; i < fileDescs.length; i++) {
            const currFileDesc = fileDescs[i];
            zip.file(currFileDesc.fileName, currFileDesc.fileContent);
        }
    }

    /**
     * Exports a sprite in the sprite3 format.
     * @param {string} targetId ID of the target to export
     * @param {string=} optZipType Optional type that the resulting
     * zip should be outputted in. Options are: base64, binarystring,
     * array, uint8array, arraybuffer, blob, or nodebuffer. Defaults to
     * blob if argument not provided.
     * See https://stuk.github.io/jszip/documentation/api_jszip/generate_async.html#type-option
     * for more information about these options.
     * @return {object} A generated zip of the sprite and its assets in the format
     * specified by optZipType or blob by default.
     */
    exportSprite (targetId, optZipType) {
        const spriteJson = this.toJSON(targetId);

        const zip = new JSZip();
        zip.file('sprite.json', spriteJson);
        this._addFileDescsToZip(this.serializeAssets(targetId), zip);

        return zip.generateAsync({
            type: typeof optZipType === 'string' ? optZipType : 'blob',
            mimeType: 'application/x.scratch.sprite3',
            compression: 'DEFLATE',
            compressionOptions: {
                level: 6
            }
        });
    }

    /**
     * Export a component on its own (a .3dsc file): a zip with component.json and the costumes and sounds of the
     * component and the components in it.
     * @param {string} targetId an instance of the component, or a sprite in one
     * @param {string=} optZipType see exportSprite
     * @returns {Promise} the zip
     */
    exportComponent (targetId, optZipType) {
        const tw3dsb = require('./serialization/3dsb');
        const target = this.runtime.getTargetById(targetId);
        if (!target) return Promise.reject(new Error('No such sprite'));
        const {json, files} = tw3dsb.serializeComponentFile(this.runtime, target);
        const zip = new JSZip();
        zip.file('component.json', StringUtil.stringify(json));
        const wanted = new Set(files);
        const descs = this.serializeAssets().filter(desc => wanted.has(desc.fileName));
        this._addFileDescsToZip(descs, zip);
        return zip.generateAsync({
            type: typeof optZipType === 'string' ? optZipType : 'blob',
            compression: 'DEFLATE',
            compressionOptions: {
                level: 6
            }
        });
    }

    /**
     * @param {ArrayBuffer|Uint8Array} input a file that is being added as a sprite
     * @returns {Promise<boolean>} true if it is a component file (.3dsc), not a sprite
     */
    async isComponentFile (input) {
        try {
            const zip = await JSZip.loadAsync(input);
            return !!zip.file('component.json');
        } catch (e) {
            return false;
        }
    }

    /**
     * @param {ArrayBuffer|Uint8Array} input a .3dsc file
     * @returns {Promise<{name: string, props: string[], inputs: string[], outputs: string[], components: string[],
     * extensions: string[]}>} what is in it (the properties, inputs and outputs of the component, the components in
     * it and the extensions it uses), to ask about before it is added
     */
    async describeComponentFile (input) {
        const tw3dsb = require('./serialization/3dsb');
        const zip = await JSZip.loadAsync(input);
        const entry = zip.file('component.json');
        if (!entry) throw new Error('component.json is not in the file');
        return tw3dsb.describeComponentFile(JSON.parse(await entry.async('string')));
    }

    /**
     * Add a component from a .3dsc file (from exportComponent). The project's own components, names and data stay as
     * they are: the ones with the same ids or names get others. While a component is being edited, it goes into it.
     * @param {ArrayBuffer|Uint8Array} input the file
     * @returns {Promise<string>} id of the instance that was added
     */
    async importComponent (input) {
        const tw3dsb = require('./serialization/3dsb');
        const zip = await JSZip.loadAsync(input);
        const entry = zip.file('component.json');
        if (!entry) throw new Error('component.json is not in the file');
        const project = tw3dsb.componentFileToProject(JSON.parse(await entry.async('string')), this.runtime);
        const {targets, extensions} = await tw3dsb.deserialize(project, this.runtime, zip, false);
        const added = targets.filter(target => !target.isStage);
        await this.installTargets(added, extensions, false, false);
        this.runtime.emitProjectChanged();
        const root = added.find(target => target.sprite && target.sprite.component && !target.componentOwner);
        return root ? root.id : (added[0] && added[0].id);
    }

    /**
     * Export the project as .3dsb project.json, or a sprite as sprite.json.
     * @param {string=} optTargetId - Optional id of a sprite to serialize
     * @param {*} serializationOptions Options to pass to the serializer
     * @return {string} Serialized state of the runtime.
     */
    toJSON (optTargetId, serializationOptions) {
        const tw3dsb = require('./serialization/3dsb');
        return StringUtil.stringify(tw3dsb.serialize(this.runtime, optTargetId, serializationOptions));
    }

    // TODO do we still need this function? Keeping it here so as not to introduce
    // a breaking change.
    /**
     * Load a project from a Scratch JSON representation.
     * @param {string} json JSON string representing a project.
     * @returns {Promise} Promise that resolves after the project has loaded
     */
    fromJSON (json) {
        log.warn('fromJSON is now just a wrapper around loadProject, please use that function instead.');
        return this.loadProject(json);
    }

    /**
     * Load a project from a Scratch JSON representation.
     * @param {string} projectJSON JSON string representing a project.
     * @param {?JSZip} zip Optional zipped project containing assets to be loaded.
     * @returns {Promise} Promise that resolves after the project has loaded
     */
    deserializeProject (projectJSON, zip) {
        // Clear the current runtime
        this.clear();
        // Projects without screen settings (.sb3, older .3dsb) keep the Scratch stage; .3dsb sets its own and
        // stored TurboWarp settings can change the size
        this.runtime.setScreenSettings(Screen.defaultSettings());

        if (typeof performance !== 'undefined') {
            performance.mark('scratch-vm-deserialize-start');
        }
        const runtime = this.runtime;
        const is3dsb = !!(projectJSON.meta && projectJSON.meta.format === '3dsb');
        // Projects from before paths (ROADMAP.md 4.12) have their variable blocks converted
        const oldData = !is3dsb || !(Number(projectJSON.meta.formatVersion) >= 3);
        const deserializePromise = function () {
            if (is3dsb) {
                const tw3dsb = require('./serialization/3dsb');
                return tw3dsb.deserialize(projectJSON, runtime, zip);
            }
            const projectVersion = projectJSON.projectVersion;
            if (projectVersion === 2) {
                const sb2 = require('./serialization/sb2');
                return sb2.deserialize(projectJSON, runtime, false, zip);
            }
            if (projectVersion === 3) {
                const sb3 = require('./serialization/sb3');
                return sb3.deserialize(projectJSON, runtime, zip);
            }
            // TODO: reject with an Error (possible breaking API change!)
            // eslint-disable-next-line prefer-promise-reject-errors
            return Promise.reject('Unable to verify Scratch Project version.');
        };
        return deserializePromise()
            .then(({targets, extensions}) => {
                if (typeof performance !== 'undefined') {
                    performance.mark('scratch-vm-deserialize-end');
                    try {
                        performance.measure('scratch-vm-deserialize',
                            'scratch-vm-deserialize-start', 'scratch-vm-deserialize-end');
                    } catch (e) {
                        // performance.measure() will throw an error if the start deserialize
                        // marker was removed from memory before we finished deserializing
                        // the project. We've seen this happen a couple times when loading
                        // very large projects.
                        log.error(e);
                    }
                }
                return this.installTargets(targets, extensions, true, oldData)
                    .then(() => {
                        if (is3dsb) return;
                        // Scratch projects draw with the pen on the pen layer, which is a canvas sprite here
                        const canvas = extensions.extensionIDs.has('pen') ? this.ensureDefaultCanvas() : null;
                        // The editor gives imported projects a camera sprite to edit the view with. Without one,
                        // the stage shows the same thing from the default camera.
                        return Promise.resolve(canvas)
                            .then(() => this.addCameraOnImport && this.ensureDefaultCamera());
                    })
                    .then(() => this.runtime.scene3D.onProjectLoaded());
            });
    }

    /**
     * @param {string[]} extensionIDs The IDs of the extensions
     * @param {Map<string, string>} extensionURLs A map of extension ID to URL
     */
    async _loadExtensions (extensionIDs, extensionURLs = new Map()) {
        const defaultExtensionURLs = require('./extension-support/tw-default-extension-urls');
        const extensionPromises = [];
        for (const extensionID of extensionIDs) {
            if (this.extensionManager.isExtensionLoaded(extensionID)) {
                // Already loaded
            } else if (this.extensionManager.isBuiltinExtension(extensionID)) {
                // Builtin extension
                this.extensionManager.loadExtensionIdSync(extensionID);
            } else {
                // Custom extension
                let url = extensionURLs.get(extensionID);
                if (!url && Object.prototype.hasOwnProperty.call(defaultExtensionURLs, extensionID)) {
                    url = defaultExtensionURLs[extensionID];
                }
                if (!url) {
                    throw new Error(`Unknown extension: ${extensionID}`);
                }
                if (await this.securityManager.canLoadExtensionFromProject(url)) {
                    extensionPromises.push(this.extensionManager.loadExtensionURL(url));
                } else {
                    throw new Error(`Permission to load extension denied: ${extensionID}`);
                }
            }
        }
        return Promise.all(extensionPromises);
    }

    /**
     * Install `deserialize` results: zero or more targets after the extensions (if any) used by those targets.
     * @param {Array.<Target>} targets - the targets to be installed
     * @param {ImportedExtensionsInfo} extensions - metadata about extensions used by these targets
     * @param {boolean} wholeProject - set to true if installing a whole project, as opposed to a single sprite.
     * @param {boolean} [oldData] - true if the targets are from before variables became paths (ROADMAP.md 4.12):
     * their variable blocks and names are converted (see serialization/tw-data-upgrade.js)
     * @returns {Promise} resolved once targets have been installed
     */
    async installTargets (targets, extensions, wholeProject, oldData) {
        await this.extensionManager.allAsyncExtensionsLoaded();

        targets = targets.filter(target => !!target);

        // Variable and list blocks of older projects become 資料 blocks with paths
        require('./serialization/tw-data-upgrade').upgradeTargets(targets, this.runtime, extensions.extensionIDs,
            !!oldData);

        return this._loadExtensions(extensions.extensionIDs, extensions.extensionURLs).then(() => {
            targets.forEach(target => {
                this.runtime.addTarget(target);
                (/** @type RenderedTarget */ target).updateAllDrawableProperties();
                // Ensure unique sprite name (members of components have names of their own inside them)
                if (target.isSprite() && !target.componentOwner) this.renameSprite(target.id, target.getName());
            });
            // Sprites added while a component is being edited go into it
            const scope = this.runtime.components.editScope;
            if (!wholeProject && scope) {
                for (const target of targets) {
                    if (target.isSprite() && !target.componentOwner) {
                        this.runtime.components.adoptMember(scope, target);
                    }
                }
                this.refreshComponentEditView();
            }
            // Sort the executable targets by layerOrder.
            // Remove layerOrder property after use.
            this.runtime.executableTargets.sort((a, b) => a.layerOrder - b.layerOrder);
            targets.forEach(target => {
                delete target.layerOrder;
            });

            // Select the first target for editing, e.g., the first sprite.
            if (wholeProject && (targets.length > 1)) {
                this.editingTarget = targets[1];
            } else {
                this.editingTarget = targets[0];
            }

            if (!wholeProject) {
                this.editingTarget.fixUpVariableReferences();
            }

            if (wholeProject) {
                this.runtime.parseProjectOptions();
            }

            // Update the VM user's knowledge of targets and blocks on the workspace.
            this.emitTargetsUpdate(false /* Don't emit project change */);
            this.emitWorkspaceUpdate();
            this.runtime.setEditingTarget(this.editingTarget);
            this.runtime.ioDevices.cloud.setStage(this.runtime.getTargetForStage());
        });
    }

    /**
     * Add a sprite, this could be .sprite2 or .sprite3. Unpack and validate
     * such a file first.
     * @param {string | object} input A json string, object, or ArrayBuffer representing the project to load.
     * @return {!Promise} Promise that resolves after targets are installed.
     */
    addSprite (input) {
        const errorPrefix = 'Sprite Upload Error:';
        if (typeof input === 'object' && !(input instanceof ArrayBuffer) &&
          !ArrayBuffer.isView(input)) {
            // If the input is an object and not any ArrayBuffer
            // or an ArrayBuffer view (this includes all typed arrays and DataViews)
            // turn the object into a JSON string, because we suspect
            // this is a project.json as an object
            // validate expects a string or buffer as input
            // TODO not sure if we need to check that it also isn't a data view
            input = JSON.stringify(input);
        }

        const validationPromise = new Promise((resolve, reject) => {
            const validate = require('scratch-parser');
            // The second argument of true below indicates to the parser/validator
            // that the given input should be treated as a single sprite and not
            // an entire project
            validate(input, true, (error, res) => {
                if (error) return reject(error);
                resolve(res);
            });
        });

        return validationPromise
            .then(validatedInput => {
                const projectVersion = validatedInput[0].projectVersion;
                if (projectVersion === 2) {
                    return this._addSprite2(validatedInput[0], validatedInput[1]);
                }
                if (projectVersion === 3) {
                    return this._addSprite3(validatedInput[0], validatedInput[1]);
                }
                // TODO: reject with an Error (possible breaking API change!)
                // eslint-disable-next-line prefer-promise-reject-errors
                return Promise.reject(`${errorPrefix} Unable to verify sprite version.`);
            })
            .then(() => this.runtime.emitProjectChanged())
            .catch(error => {
                // Intentionally rejecting here (want errors to be handled by caller)
                if (Object.prototype.hasOwnProperty.call(error, 'validationError')) {
                    return Promise.reject(JSON.stringify(error));
                }
                // TODO: reject with an Error (possible breaking API change!)
                // eslint-disable-next-line prefer-promise-reject-errors
                return Promise.reject(`${errorPrefix} ${error}`);
            });
    }

    /**
     * Add a single sprite from the "Sprite2" (i.e., SB2 sprite) format.
     * @param {object} sprite Object representing 2.0 sprite to be added.
     * @param {?ArrayBuffer} zip Optional zip of assets being referenced by json
     * @returns {Promise} Promise that resolves after the sprite is added
     */
    _addSprite2 (sprite, zip) {
        // Validate & parse

        const sb2 = require('./serialization/sb2');
        return sb2.deserialize(sprite, this.runtime, true, zip)
            .then(({targets, extensions}) =>
                this.installTargets(targets, extensions, false, true));
    }

    /**
     * @param {?Target} target
     * @returns {string} '2d' for 2D sprites and the stage, '3d' for 3D sprites, 'camera' for camera sprites
     */
    getTargetKind (target) {
        return BlockSupport.kindOf(target);
    }

    /**
     * @param {string} opcode
     * @param {string} kind '2d', '3d' or 'camera', see getTargetKind()
     * @returns {boolean} true if the palette of that kind of target shows the block
     */
    isBlockInPalette (opcode, kind) {
        return BlockSupport.isInPalette(opcode, kind);
    }

    /**
     * @param {string} opcode
     * @param {string} kind '2d', '3d' or 'camera'
     * @returns {boolean} true if the block does nothing on that kind of target, so the workspace draws it faded
     */
    isBlockUnsupported (opcode, kind) {
        return BlockSupport.getBlockSupport(opcode, kind).support === BlockSupport.HIDE;
    }

    /**
     * @param {string} opcode
     * @param {?Target} target
     * @returns {boolean} true if it is a hat that the mouse starts, and the mouse goes through the target, so that it
     * never starts there
     */
    isMouseHatIgnored (opcode, target) {
        return !!target && !target.isStage && Blocks.MOUSE_HATS.includes(opcode) && target.mouseMode === 'pass';
    }

    /**
     * @param {string} kind '2d', '3d' or 'camera'
     * @returns {string[]} what the "[property] of [sprite]" block offers for sprites of that kind, or null for the
     * usual 2D list
     */
    getSpriteAttributes (kind) {
        const attributes = BlockSupport.ATTRIBUTES[kind];
        return attributes ? attributes.slice() : null;
    }

    /**
     * Add a camera sprite. The first one becomes the current camera.
     * @param {object} [options] see makeCameraJSON in serialization/3dsb.js: name, position, rotation, fov
     * @param {boolean} [options.select] false to keep editing the current target
     * @returns {Promise<CameraTarget>} Resolves with the new sprite once it is installed.
     */
    addCamera (options = {}) {
        const tw3dsb = require('./serialization/3dsb');
        const previousTarget = this.editingTarget;
        return tw3dsb.deserialize(tw3dsb.makeCameraJSON(options), this.runtime, null, true)
            .then(({targets, extensions}) => this.installTargets(targets, extensions, false).then(() => targets[0]))
            .then(target => {
                if (options.select === false && previousTarget && previousTarget !== target) {
                    this.setEditingTarget(previousTarget.id);
                } else {
                    this.emitTargetsUpdate();
                }
                return target;
            });
    }

    /**
     * Give a project without a camera sprite one, where the default camera is, without selecting it.
     * @returns {Promise<?CameraTarget>} the camera sprite that was added, if any
     */
    ensureDefaultCamera () {
        if (this.runtime.scene3D.getCameras().length) return Promise.resolve(null);
        const state = this.runtime.scene3D.getCameraState();
        return this.addCamera({
            name: '相機',
            position: {x: state.x, y: state.y, z: state.z},
            rotation: {x: state.pitch, y: state.yaw, z: state.roll},
            fov: state.fov,
            select: false
        });
    }

    /**
     * @param {string} targetId a camera sprite
     */
    setActiveCamera (targetId) {
        const target = this.runtime.getTargetById(targetId);
        if (!target || !target.isCamera) return;
        this.runtime.scene3D.setActiveCamera(target);
        this.emitTargetsUpdate();
    }

    /**
     * @param {number} [index] a backdrop of the stage; the current one by default
     * @returns {object} its 3D environment, see engine/scene-3d-environment.js
     */
    getEnvironment3D (index) {
        return JSON.parse(JSON.stringify(this.runtime.scene3D.getEnvironment(index)));
    }

    /**
     * @returns {object} the environment of a new project, for new environments added in the editor
     */
    getDefaultEnvironment3D () {
        return require('./engine/scene-3d-environment').defaultEnvironment();
    }

    /**
     * @param {object} changes partial environment, e.g. {sky: {type: 'color'}}
     * @param {number} [index] a backdrop of the stage; the current one by default
     */
    setEnvironment3D (changes, index) {
        this.runtime.scene3D.setEnvironment(changes, index);
        this.emitTargetsUpdate();
    }

    /**
     * Add a new 3D sprite and select it.
     * @param {object} [options] Initial state, all optional:
     * name, models (e.g. [{name: 'cube', shape: 'cube'}] or [{name: 'car', file: 'car.glb'}]),
     * position, rotation and scale ({x, y, z}), visible, currentModel and material ({color, opacity, texture}).
     * @returns {Promise} Resolves after the sprite is installed.
     */
    addSprite3D (options = {}) {
        const tw3dsb = require('./serialization/3dsb');
        const spriteJSON = {
            isStage: false,
            name: typeof options.name === 'string' && options.name ? options.name : '3D 角色',
            kind: '3d',
            variables: {},
            lists: {},
            broadcasts: {},
            blocks: {},
            comments: {},
            sounds: [],
            costumes: [],
            volume: 100,
            draggable: false,
            position: options.position || {x: 0, y: 0, z: 0},
            rotation: options.rotation || {x: 0, y: 0, z: 0},
            scale: options.scale || {x: 1, y: 1, z: 1},
            visible: typeof options.visible === 'boolean' ? options.visible : true,
            models: options.models || [{name: 'cube', shape: 'cube'}],
            currentModel: options.currentModel || 0,
            material: Object.assign({color: '#4c97ff'}, options.material)
        };
        return tw3dsb.deserialize(spriteJSON, this.runtime, null, true)
            .then(({targets, extensions}) => this.installTargets(targets, extensions, false));
    }

    /**
     * Add a new canvas sprite: a 2D sprite whose picture is a canvas that the pen and other code draw on.
     * @param {object} [options]
     * @param {string} [options.name] sprite name
     * @param {boolean} [options.atBack] true to put it behind every other sprite, where the pen layer was
     * @param {boolean} [options.select] false to keep editing the current target
     * @returns {Promise<CanvasTarget>} Resolves with the new sprite once it is installed.
     */
    addCanvasSprite (options = {}) {
        const tw3dsb = require('./serialization/3dsb');
        const previousTarget = this.editingTarget;
        const spriteJSON = {
            isStage: false,
            name: typeof options.name === 'string' && options.name ? options.name : '畫布',
            kind: 'canvas',
            variables: {},
            lists: {},
            broadcasts: {},
            blocks: {},
            comments: {},
            sounds: [],
            costumes: [],
            volume: 100,
            visible: true,
            x: 0,
            y: 0,
            size: 100,
            direction: 90,
            draggable: false,
            rotationStyle: 'all around'
        };
        return tw3dsb.deserialize(spriteJSON, this.runtime, null, true)
            .then(({targets, extensions}) => this.installTargets(targets, extensions, false).then(() => targets[0]))
            .then(target => {
                if (options.atBack) target.goToBack();
                if (options.select === false && previousTarget && previousTarget !== target) {
                    this.setEditingTarget(previousTarget.id);
                } else {
                    this.emitTargetsUpdate();
                }
                return target;
            });
    }

    /**
     * Pen blocks draw on canvas sprites. Give projects that use the pen one to draw on if they have none, behind
     * every sprite like the pen layer of Scratch.
     * @returns {Promise<?CanvasTarget>} the canvas sprite that was added, if any
     */
    ensureDefaultCanvas () {
        if (this.runtime.canvasSprites.getDefault()) return Promise.resolve(null);
        return this.addCanvasSprite({name: '畫筆', atBack: true, select: false});
    }

    /**
     * @param {string} [targetId] a sprite's id; the editing target by default
     * @returns {?Target3D} the 3D sprite, or null if it isn't one
     */
    _get3DTarget (targetId) {
        const target = targetId ? this.runtime.getTargetById(targetId) : this.editingTarget;
        return target && target.is3D ? target : null;
    }

    /**
     * Add a model to a 3D sprite.
     * @param {object} model {name, shape} or {name, file} (a .glb/.gltf in the Files tab)
     * @param {string} [targetId] the sprite; the editing target by default
     * @returns {number} index of the new model, or -1
     */
    addModel3D (model, targetId) {
        const target = this._get3DTarget(targetId);
        if (!target) return -1;
        const index = target.addModel(model);
        if (index !== -1) this.emitTargetsUpdate();
        return index;
    }

    /**
     * @param {number} index model to delete from the editing target
     * @returns {?function} restores the model, or null if nothing was deleted (the last model can't be)
     */
    deleteModel3D (index) {
        const target = this._get3DTarget();
        const deleted = target && target.deleteModel(index);
        if (!deleted) return null;
        this.emitTargetsUpdate();
        return () => {
            target.addModel(deleted, index);
            this.emitTargetsUpdate();
        };
    }

    /**
     * @param {number} index model of the editing target
     * @param {string} name new name; made unique among the sprite's models
     */
    renameModel3D (index, name) {
        const target = this._get3DTarget();
        if (!target) return;
        target.renameModel(index, name);
        this.emitTargetsUpdate();
    }

    /**
     * @param {number} index model of the editing target to copy
     * @returns {number} index of the copy, or -1
     */
    duplicateModel3D (index) {
        const target = this._get3DTarget();
        if (!target) return -1;
        const newIndex = target.duplicateModel(index);
        if (newIndex !== -1) this.emitTargetsUpdate();
        return newIndex;
    }

    /**
     * @param {string} targetId the 3D sprite
     * @param {number} index model to move
     * @param {number} newIndex where it goes
     * @returns {boolean} true if anything moved
     */
    reorderModel3D (targetId, index, newIndex) {
        const target = this._get3DTarget(targetId);
        if (!target || !target.reorderModel(index, newIndex)) return false;
        this.emitTargetsUpdate();
        return true;
    }

    /**
     * Change what a model of the editing target shows, keeping its name.
     * @param {number} index model of the editing target
     * @param {object} source {shape} or {file}
     */
    setModelSource3D (index, source) {
        const target = this._get3DTarget();
        if (!target) return;
        target.setModelSource(index, source);
        this.emitTargetsUpdate();
    }

    /**
     * Add a single sb3 sprite.
     * @param {object} sprite Object rperesenting 3.0 sprite to be added.
     * @param {?ArrayBuffer} zip Optional zip of assets being referenced by target json
     * @returns {Promise} Promise that resolves after the sprite is added
     */
    _addSprite3 (sprite, zip) {
        // Validate & parse
        const sb3 = require('./serialization/sb3');
        return sb3
            .deserialize(sprite, this.runtime, zip, true)
            .then(({targets, extensions}) => this.installTargets(targets, extensions, false,
                !(Number(sprite.formatVersion) >= 3)));
    }

    /**
     * Add a costume to the current editing target.
     * @param {string} md5ext - the MD5 and extension of the costume to be loaded.
     * @param {!object} costumeObject Object representing the costume.
     * @property {int} skinId - the ID of the costume's render skin, once installed.
     * @property {number} rotationCenterX - the X component of the costume's origin.
     * @property {number} rotationCenterY - the Y component of the costume's origin.
     * @property {number} [bitmapResolution] - the resolution scale for a bitmap costume.
     * @param {string} optTargetId - the id of the target to add to, if not the editing target.
     * @param {string} optVersion - if this is 2, load costume as sb2, otherwise load costume as sb3.
     * @returns {?Promise} - a promise that resolves when the costume has been added
     */
    addCostume (md5ext, costumeObject, optTargetId, optVersion) {
        const target = optTargetId ? this.runtime.getTargetById(optTargetId) :
            this.editingTarget;
        if (target) {
            return loadCostume(md5ext, costumeObject, this.runtime, optVersion).then(() => {
                target.addCostume(costumeObject);
                target.setCostume(
                    target.getCostumes().length - 1
                );
                this.runtime.emitProjectChanged();
            });
        }
        // If the target cannot be found by id, return a rejected promise
        // TODO: reject with an Error (possible breaking API change!)
        // eslint-disable-next-line prefer-promise-reject-errors
        return Promise.reject();
    }

    /**
     * Add a costume loaded from the library to the current editing target.
     * @param {string} md5ext - the MD5 and extension of the costume to be loaded.
     * @param {!object} costumeObject Object representing the costume.
     * @property {int} skinId - the ID of the costume's render skin, once installed.
     * @property {number} rotationCenterX - the X component of the costume's origin.
     * @property {number} rotationCenterY - the Y component of the costume's origin.
     * @property {number} [bitmapResolution] - the resolution scale for a bitmap costume.
     * @returns {?Promise} - a promise that resolves when the costume has been added
     */
    addCostumeFromLibrary (md5ext, costumeObject) {
        // TODO: reject with an Error (possible breaking API change!)
        // eslint-disable-next-line prefer-promise-reject-errors
        if (!this.editingTarget) return Promise.reject();
        return this.addCostume(md5ext, costumeObject, this.editingTarget.id, 2 /* optVersion */);
    }

    /**
     * Duplicate the costume at the given index. Add it at that index + 1.
     * @param {!int} costumeIndex Index of costume to duplicate
     * @returns {?Promise} - a promise that resolves when the costume has been decoded and added
     */
    duplicateCostume (costumeIndex) {
        const originalCostume = this.editingTarget.getCostumes()[costumeIndex];
        const clone = Object.assign({}, originalCostume);
        const md5ext = `${clone.assetId}.${clone.dataFormat}`;
        return loadCostume(md5ext, clone, this.runtime).then(() => {
            this.editingTarget.addCostume(clone, costumeIndex + 1);
            this.editingTarget.setCostume(costumeIndex + 1);
            this.emitTargetsUpdate();
        });
    }

    /**
     * Duplicate the sound at the given index. Add it at that index + 1.
     * @param {!int} soundIndex Index of sound to duplicate
     * @returns {?Promise} - a promise that resolves when the sound has been decoded and added
     */
    duplicateSound (soundIndex) {
        const originalSound = this.editingTarget.getSounds()[soundIndex];
        const clone = Object.assign({}, originalSound);
        return loadSound(clone, this.runtime, this.editingTarget.sprite.soundBank).then(() => {
            this.editingTarget.addSound(clone, soundIndex + 1);
            this.emitTargetsUpdate();
        });
    }

    /**
     * Rename a costume on the current editing target.
     * @param {int} costumeIndex - the index of the costume to be renamed.
     * @param {string} newName - the desired new name of the costume (will be modified if already in use).
     */
    renameCostume (costumeIndex, newName) {
        this.editingTarget.renameCostume(costumeIndex, newName);
        this.emitTargetsUpdate();
    }

    /**
     * Delete a costume from the current editing target.
     * @param {int} costumeIndex - the index of the costume to be removed.
     * @return {?function} A function to restore the deleted costume, or null,
     * if no costume was deleted.
     */
    deleteCostume (costumeIndex) {
        const deletedCostume = this.editingTarget.deleteCostume(costumeIndex);
        if (deletedCostume) {
            const target = this.editingTarget;
            this.runtime.emitProjectChanged();
            return () => {
                target.addCostume(deletedCostume);
                this.emitTargetsUpdate();
            };
        }
        return null;
    }

    /**
     * Add a sound to the current editing target.
     * @param {!object} soundObject Object representing the costume.
     * @param {string} optTargetId - the id of the target to add to, if not the editing target.
     * @returns {?Promise} - a promise that resolves when the sound has been decoded and added
     */
    addSound (soundObject, optTargetId) {
        const target = optTargetId ? this.runtime.getTargetById(optTargetId) :
            this.editingTarget;
        if (target) {
            return loadSound(soundObject, this.runtime, target.sprite.soundBank).then(() => {
                target.addSound(soundObject);
                this.emitTargetsUpdate();
            });
        }
        // If the target cannot be found by id, return a rejected promise
        return Promise.reject(new Error(`No target with ID: ${optTargetId}`));
    }

    /**
     * Rename a sound on the current editing target.
     * @param {int} soundIndex - the index of the sound to be renamed.
     * @param {string} newName - the desired new name of the sound (will be modified if already in use).
     */
    renameSound (soundIndex, newName) {
        this.editingTarget.renameSound(soundIndex, newName);
        this.emitTargetsUpdate();
    }

    /**
     * Get a sound buffer from the audio engine.
     * @param {int} soundIndex - the index of the sound to be got.
     * @return {AudioBuffer} the sound's audio buffer.
     */
    getSoundBuffer (soundIndex) {
        const id = this.editingTarget.sprite.sounds[soundIndex].soundId;
        if (id && this.runtime && this.runtime.audioEngine) {
            return this.editingTarget.sprite.soundBank.getSoundPlayer(id).buffer;
        }
        return null;
    }

    /**
     * Update a sound buffer.
     * @param {int} soundIndex - the index of the sound to be updated.
     * @param {AudioBuffer} newBuffer - new audio buffer for the audio engine.
     * @param {ArrayBuffer} soundEncoding - the new (wav) encoded sound to be stored
     */
    updateSoundBuffer (soundIndex, newBuffer, soundEncoding) {
        const sound = this.editingTarget.sprite.sounds[soundIndex];
        if (sound && sound.broken) delete sound.broken;
        const id = sound ? sound.soundId : null;
        if (id && this.runtime && this.runtime.audioEngine) {
            this.editingTarget.sprite.soundBank.getSoundPlayer(id).buffer = newBuffer;
        }
        // Update sound in runtime
        if (soundEncoding) {
            // Now that we updated the sound, the format should also be updated
            // so that the sound can eventually be decoded the right way.
            // Sounds that were formerly 'adpcm', but were updated in sound editor
            // will not get decoded by the audio engine correctly unless the format
            // is updated as below.
            sound.format = '';
            const storage = this.runtime.storage;
            sound.asset = storage.createAsset(
                storage.AssetType.Sound,
                storage.DataFormat.WAV,
                soundEncoding,
                null,
                true // generate md5
            );
            sound.assetId = sound.asset.assetId;
            sound.dataFormat = storage.DataFormat.WAV;
            sound.md5 = `${sound.assetId}.${sound.dataFormat}`;
            sound.sampleCount = newBuffer.length;
            sound.rate = newBuffer.sampleRate;
        }
        // If soundEncoding is null, it's because gui had a problem
        // encoding the updated sound. We don't want to store anything in this
        // case, and gui should have logged an error.

        this.emitTargetsUpdate();
    }

    /**
     * Delete a sound from the current editing target.
     * @param {int} soundIndex - the index of the sound to be removed.
     * @return {?Function} A function to restore the sound that was deleted,
     * or null, if no sound was deleted.
     */
    deleteSound (soundIndex) {
        const target = this.editingTarget;
        const deletedSound = this.editingTarget.deleteSound(soundIndex);
        if (deletedSound) {
            this.runtime.emitProjectChanged();
            const restoreFun = () => {
                target.addSound(deletedSound);
                this.emitTargetsUpdate();
            };
            return restoreFun;
        }
        return null;
    }

    /**
     * Get a string representation of the image from storage.
     * @param {int} costumeIndex - the index of the costume to be got.
     * @return {string} the costume's SVG string if it's SVG,
     *     a dataURI if it's a PNG or JPG, or null if it couldn't be found or decoded.
     */
    getCostume (costumeIndex) {
        const asset = this.editingTarget.getCostumes()[costumeIndex].asset;
        if (!asset || !this.runtime || !this.runtime.storage) return null;
        const format = asset.dataFormat;
        if (format === this.runtime.storage.DataFormat.SVG) {
            return asset.decodeText();
        } else if (format === this.runtime.storage.DataFormat.PNG ||
                format === this.runtime.storage.DataFormat.JPG) {
            return asset.encodeDataURI();
        }
        log.error(`Unhandled format: ${asset.dataFormat}`);
        return null;
    }

    /**
     * TW: Get the raw binary data to use when exporting a costume to the user's local file system.
     * @param {Costume} costumeObject scratch-vm costume object
     * @returns {Uint8Array}
     */
    getExportedCostume (costumeObject) {
        return exportCostume(costumeObject);
    }

    /**
     * TW: Get a base64 string to use when exporting a costume to the user's local file system.
     * @param {Costume} costumeObject scratch-vm costume object
     * @returns {string} base64 string. Not a data: URI.
     */
    getExportedCostumeBase64 (costumeObject) {
        const binaryData = this.getExportedCostume(costumeObject);
        return Base64Util.uint8ArrayToBase64(binaryData);
    }

    /**
     * Update a costume with the given bitmap
     * @param {!int} costumeIndex - the index of the costume to be updated.
     * @param {!ImageData} bitmap - new bitmap for the renderer.
     * @param {!number} rotationCenterX x of point about which the costume rotates, relative to its upper left corner
     * @param {!number} rotationCenterY y of point about which the costume rotates, relative to its upper left corner
     * @param {!number} bitmapResolution 1 for bitmaps that have 1 pixel per unit of stage,
     *     2 for double-resolution bitmaps
     */
    updateBitmap (costumeIndex, bitmap, rotationCenterX, rotationCenterY, bitmapResolution) {
        return this._updateBitmap(
            this.editingTarget.getCostumes()[costumeIndex],
            bitmap,
            rotationCenterX,
            rotationCenterY,
            bitmapResolution
        );
    }

    _updateBitmap (costume, bitmap, rotationCenterX, rotationCenterY, bitmapResolution) {
        if (!(costume && this.runtime && this.runtime.renderer)) return;
        if (costume && costume.broken) delete costume.broken;
        delete costume.svgBindingSource;

        costume.rotationCenterX = rotationCenterX;
        costume.rotationCenterY = rotationCenterY;

        // If the bitmap originally had a zero width or height, use that value
        const bitmapWidth = bitmap.sourceWidth === 0 ? 0 : bitmap.width;
        const bitmapHeight = bitmap.sourceHeight === 0 ? 0 : bitmap.height;
        // @todo: updateBitmapSkin does not take ImageData
        const canvas = document.createElement('canvas');
        canvas.width = bitmapWidth;
        canvas.height = bitmapHeight;
        const context = canvas.getContext('2d');
        context.putImageData(bitmap, 0, 0);

        // Divide by resolution because the renderer's definition of the rotation center
        // is the rotation center divided by the bitmap resolution
        this.runtime.renderer.updateBitmapSkin(
            costume.skinId,
            canvas,
            bitmapResolution,
            [rotationCenterX / bitmapResolution, rotationCenterY / bitmapResolution]
        );

        // @todo there should be a better way to get from ImageData to a decodable storage format
        canvas.toBlob(blob => {
            const reader = new FileReader();
            reader.addEventListener('loadend', () => {
                const storage = this.runtime.storage;
                costume.dataFormat = storage.DataFormat.PNG;
                costume.bitmapResolution = bitmapResolution;
                costume.size = [bitmapWidth, bitmapHeight];
                costume.asset = storage.createAsset(
                    storage.AssetType.ImageBitmap,
                    costume.dataFormat,
                    Buffer.from(reader.result),
                    null, // id
                    true // generate md5
                );
                costume.assetId = costume.asset.assetId;
                costume.md5 = `${costume.assetId}.${costume.dataFormat}`;
                this.emitTargetsUpdate();
            });
            // Bitmaps with a zero width or height return null for their blob
            if (blob){
                reader.readAsArrayBuffer(blob);
            }
        });
    }

    /**
     * Update a costume with the given SVG
     * @param {int} costumeIndex - the index of the costume to be updated.
     * @param {string} svg - new SVG for the renderer.
     * @param {number} rotationCenterX x of point about which the costume rotates, relative to its upper left corner
     * @param {number} rotationCenterY y of point about which the costume rotates, relative to its upper left corner
     */
    updateSvg (costumeIndex, svg, rotationCenterX, rotationCenterY) {
        return this._updateSvg(
            this.editingTarget.getCostumes()[costumeIndex],
            svg,
            rotationCenterX,
            rotationCenterY
        );
    }

    _updateSvg (costume, svg, rotationCenterX, rotationCenterY) {
        if (costume && costume.broken) delete costume.broken;
        if (costume && this.runtime && this.runtime.renderer) {
            costume.rotationCenterX = rotationCenterX;
            costume.rotationCenterY = rotationCenterY;
            setCostumeSource(costume, svg);
            this.runtime.renderer.updateSVGSkin(costume.skinId, renderableSvg(svg), [rotationCenterX, rotationCenterY]);
            costume.size = this.runtime.renderer.getSkinSize(costume.skinId);
        }
        const storage = this.runtime.storage;
        // If we're in here, we've edited an svg in the vector editor,
        // so the dataFormat should be 'svg'
        costume.dataFormat = storage.DataFormat.SVG;
        costume.bitmapResolution = 1;
        costume.asset = storage.createAsset(
            storage.AssetType.ImageVector,
            costume.dataFormat,
            (new _TextEncoder()).encode(svg),
            null,
            true // generate md5
        );
        costume.assetId = costume.asset.assetId;
        costume.md5 = `${costume.assetId}.${costume.dataFormat}`;
        this.emitTargetsUpdate();
    }

    /**
     * Add a backdrop to the stage.
     * @param {string} md5ext - the MD5 and extension of the backdrop to be loaded.
     * @param {!object} backdropObject Object representing the backdrop.
     * @property {int} skinId - the ID of the backdrop's render skin, once installed.
     * @property {number} rotationCenterX - the X component of the backdrop's origin.
     * @property {number} rotationCenterY - the Y component of the backdrop's origin.
     * @property {number} [bitmapResolution] - the resolution scale for a bitmap backdrop.
     * @returns {?Promise} - a promise that resolves when the backdrop has been added
     */
    addBackdrop (md5ext, backdropObject) {
        return loadCostume(md5ext, backdropObject, this.runtime).then(() => {
            const stage = this.runtime.getTargetForStage();
            stage.addCostume(backdropObject);
            stage.setCostume(stage.getCostumes().length - 1);
            this.runtime.emitProjectChanged();
        });
    }

    /**
     * Rename a sprite.
     * @param {string} targetId ID of a target whose sprite to rename.
     * @param {string} newName New name of the sprite.
     */
    renameSprite (targetId, newName) {
        const target = this.runtime.getTargetById(targetId);
        if (target) {
            if (!target.isSprite()) {
                throw new Error('Cannot rename non-sprite targets.');
            }
            const sprite = target.sprite;
            if (!sprite) {
                throw new Error('No sprite associated with this target.');
            }
            if (newName && RESERVED_NAMES.indexOf(newName) === -1) {
                const names = this.runtime.targets
                    .filter(runtimeTarget => runtimeTarget.isSprite() && runtimeTarget.id !== target.id)
                    .map(runtimeTarget => runtimeTarget.getName());
                if (sprite.component) {
                    // An instance of a component has a name of its own
                    const oldInstanceName = target.getName();
                    const instanceNames = this.runtime.targets
                        .filter(t => t.isOriginal && !t.isStage && t !== target)
                        .map(t => t.getName());
                    const newInstanceName = StringUtil.unusedName(newName, instanceNames);
                    if (newInstanceName === oldInstanceName) return;
                    for (const clone of sprite.clones) {
                        if (clone.instanceName === oldInstanceName) clone.instanceName = newInstanceName;
                    }
                    target.instanceName = newInstanceName;
                    this.runtime.components.renameInstance(oldInstanceName, newInstanceName);
                    for (const currTarget of this.runtime.targets) {
                        currTarget.blocks.updateAssetName(oldInstanceName, newInstanceName, 'sprite');
                    }
                    this.emitTargetsUpdate();
                    // Not while loading a project (nothing is being edited yet)
                    if (this.editingTarget) this.emitWorkspaceUpdate();
                    return;
                }
                const oldName = sprite.name;
                const newUnusedName = StringUtil.unusedName(newName, names);
                sprite.name = newUnusedName;
                if (oldName === newUnusedName) {
                    return;
                }
                const allTargets = this.runtime.targets;
                for (let i = 0; i < allTargets.length; i++) {
                    const currTarget = allTargets[i];
                    currTarget.blocks.updateAssetName(oldName, newName, 'sprite');
                }
                // "when [sprite] [event]" hats
                this.runtime.spriteInterfaces.renameSprite(oldName, newUnusedName);

                if (newUnusedName !== oldName) this.emitTargetsUpdate();
            }
        } else {
            throw new Error('No target with the provided id.');
        }
    }

    /**
     * Add an event to the public interface of a sprite (engine/sprite-interface.js).
     * @param {string} targetId
     * @param {string} name
     * @returns {boolean} true if it was added
     */
    addInterfaceEvent (targetId, name) {
        return this.runtime.spriteInterfaces.addEvent(this.runtime.getTargetById(targetId), name);
    }

    /**
     * @param {string} targetId
     * @param {string} oldName
     * @param {string} newName
     * @returns {boolean} true if it was renamed (with the blocks that send and receive it)
     */
    renameInterfaceEvent (targetId, oldName, newName) {
        const renamed = this.runtime.spriteInterfaces.renameEvent(this.runtime.getTargetById(targetId), oldName,
            newName);
        if (renamed) this.emitWorkspaceUpdate();
        return renamed;
    }

    /**
     * @param {string} targetId
     * @param {string} name
     * @returns {boolean} true if it was removed
     */
    removeInterfaceEvent (targetId, name) {
        return this.runtime.spriteInterfaces.removeEvent(this.runtime.getTargetById(targetId), name);
    }

    /**
     * Make a custom block of a sprite public (other sprites see it in the category of the sprite) or not.
     * @param {string} targetId
     * @param {string} prototypeId id of its prototype block
     * @param {boolean} isPublic
     */
    setProcedurePublic (targetId, prototypeId, isPublic) {
        this.runtime.spriteInterfaces.setPublic(this.runtime.getTargetById(targetId), prototypeId, isPublic);
    }

    /**
     * Delete a sprite and all its clones.
     * @param {string} targetId ID of a target whose sprite to delete.
     * @return {Function} Returns a function to restore the sprite that was deleted
     */
    deleteSprite (targetId) {
        const target = this.runtime.getTargetById(targetId);

        if (target) {
            const targetIndexBeforeDelete = this.runtime.targets.map(t => t.id).indexOf(target.id);
            if (!target.isSprite()) {
                throw new Error('Cannot delete non-sprite targets.');
            }
            const sprite = target.sprite;
            if (!sprite) {
                throw new Error('No sprite associated with this target.');
            }
            if (target.componentOwner) {
                // A member of a component: it goes out of the component, in every instance
                const owner = target.componentOwner;
                this.runtime.components.removeMember(target);
                if (this.editingTarget === target || !this.runtime.targets.includes(this.editingTarget)) {
                    this.setEditingTarget(owner.id);
                }
                this.emitTargetsUpdate();
                return null;
            }
            if (sprite.component) {
                // An instance of a component: only this one goes; the definition stays
                const components = this.runtime.components;
                const name = target.getName();
                target.deleteMonitors();
                components.removeInstance(target);
                if (this.editingTarget === target) {
                    const nextTargetIndex = Math.min(this.runtime.targets.length - 1, targetIndexBeforeDelete);
                    this.setEditingTarget(this.runtime.targets[nextTargetIndex].id);
                }
                this.emitTargetsUpdate();
                return () => Promise.resolve(components.addInstance(sprite, {name, like: target}))
                    .then(() => this.emitTargetsUpdate());
            }
            const spritePromise = this.exportSprite(targetId, 'uint8array');
            const restoreSprite = () => spritePromise.then(spriteBuffer => this.addSprite(spriteBuffer));
            // Remove monitors from the runtime state and remove the
            // target-specific monitored blocks (e.g. local variables)
            target.deleteMonitors();
            const currentEditingTarget = this.editingTarget;
            for (let i = 0; i < sprite.clones.length; i++) {
                const clone = sprite.clones[i];
                this.runtime.stopForTarget(sprite.clones[i]);
                this.runtime.disposeTarget(sprite.clones[i]);
                // Ensure editing target is switched if we are deleting it.
                if (clone === currentEditingTarget) {
                    const nextTargetIndex = Math.min(this.runtime.targets.length - 1, targetIndexBeforeDelete);
                    if (this.runtime.targets.length > 0){
                        this.setEditingTarget(this.runtime.targets[nextTargetIndex].id);
                    } else {
                        this.editingTarget = null;
                    }
                }
            }
            // Sprite object should be deleted by GC.
            this.emitTargetsUpdate();
            return restoreSprite;
        }

        throw new Error('No target with the provided id.');
    }

    /**
     * Duplicate a sprite.
     * @param {string} targetId ID of a target whose sprite to duplicate.
     * @returns {Promise} Promise that resolves when duplicated target has
     *     been added to the runtime.
     */
    duplicateSprite (targetId) {
        const target = this.runtime.getTargetById(targetId);
        if (!target) {
            throw new Error('No target with the provided id.');
        } else if (!target.isSprite()) {
            throw new Error('Cannot duplicate non-sprite targets.');
        } else if (!target.sprite) {
            throw new Error('No sprite associated with this target.');
        }
        if (target.sprite.component) {
            // Another instance of the component
            const instance = this.runtime.components.addInstance(target.sprite, {like: target});
            this.setEditingTarget(instance.id);
            return Promise.resolve();
        }
        return target.duplicate().then(newTarget => {
            this.runtime.addTarget(newTarget);
            newTarget.goBehindOther(target);
            this.setEditingTarget(newTarget.id);
        });
    }

    // Components (engine/components.js, ROADMAP.md 階段 10)

    /**
     * Turn a 2D sprite into a component, with the sprite as its first instance.
     * @param {string} targetId
     * @returns {boolean} true if it became one
     */
    makeComponent (targetId) {
        const made = !!this.runtime.components.makeComponent(this.runtime.getTargetById(targetId));
        if (made) this.emitTargetsUpdate();
        return made;
    }

    /**
     * Place another instance of the component of an instance.
     * @param {string} targetId an instance
     * @returns {?string} id of the new instance
     */
    addComponentInstance (targetId) {
        const target = this.runtime.getTargetById(targetId);
        if (!target || !target.sprite.component) return null;
        const instance = this.runtime.components.addInstance(target.sprite, {like: target});
        this.setEditingTarget(instance.id);
        return instance.id;
    }

    /**
     * Turn an instance back into a sprite of its own, with a copy of the blocks, costumes and sounds.
     * @param {string} targetId an instance
     * @returns {Promise} resolves when the new sprite is there
     */
    unpackComponent (targetId) {
        const target = this.runtime.getTargetById(targetId);
        if (!target || !target.sprite.component) return Promise.resolve();
        return this.exportSprite(targetId, 'uint8array').then(data => {
            const layer = target.getLayerOrder ? target.getLayerOrder() : null;
            this.runtime.components.removeInstance(target);
            return this.addSprite(data).then(() => {
                const sprite = this.editingTarget;
                if (sprite && layer !== null && sprite.setLayerOrder) sprite.setLayerOrder(layer);
                this.emitTargetsUpdate();
            });
        });
    }

    /**
     * @param {string} targetId an instance
     * @returns {{instances: number, blocks: number}} what deleting its component would take with it: its instances,
     * and blocks elsewhere that use it (they stay, and do nothing)
     */
    getComponentUsage (targetId) {
        const target = this.runtime.getTargetById(targetId);
        if (!target || !target.sprite.component) return {instances: 0, blocks: 0};
        const components = this.runtime.components;
        const sprite = target.sprite;
        const names = new Set(components.instancesOf(sprite).map(t => t.getName())
            .concat(`_any_${sprite.name}`));
        let blocks = 0;
        for (const [owner, block] of components.allBlocks()) {
            if (owner.sprite === sprite) continue;
            const values = [block.fields.SPRITE, block.fields.COMPONENT].filter(Boolean).map(f => f.value);
            const instance = components.instanceFieldOf(owner, block);
            if (instance !== null) values.push(instance);
            if (block.mutation && block.mutation.sprite) values.push(block.mutation.sprite);
            if (values.some(value => names.has(value) || value === sprite.name)) blocks++;
        }
        return {instances: components.instancesOf(sprite).length, blocks};
    }

    /**
     * Delete the component of an instance, with all its instances.
     * @param {string} targetId an instance
     */
    deleteComponent (targetId) {
        const target = this.runtime.getTargetById(targetId);
        if (!target || !target.sprite.component) return;
        const editing = this.editingTarget;
        this.runtime.components.removeDefinition(target.sprite);
        if (editing && !this.runtime.targets.includes(editing)) {
            this.setEditingTarget(this.runtime.targets[this.runtime.targets.length - 1].id);
        }
        this.emitTargetsUpdate();
    }

    /**
     * @param {string} targetId an instance
     * @param {string} name new name of its component
     */
    renameComponent (targetId, name) {
        const target = this.runtime.getTargetById(targetId);
        if (target && this.runtime.components.renameDefinition(target.sprite, name)) {
            this.emitTargetsUpdate();
            this.emitWorkspaceUpdate();
        }
    }

    /**
     * @param {string} targetId an instance
     * @param {string} name a property
     * @param {*} value its value for this instance; undefined for the default
     */
    setComponentProp (targetId, name, value) {
        const target = this.runtime.getTargetById(targetId);
        if (!target) return;
        const components = this.runtime.components;
        if (typeof value === 'undefined') components.resetProp(target, name);
        else components.setProp(target, name, value);
        // An instance inside a component: the value belongs to the component, for every instance of it
        const spec = target.sprite.component ? components.specOf(target) : null;
        if (spec) {
            spec.props = Object.assign({}, target.componentProps);
            const owner = target.componentOwner;
            for (const instance of owner.sprite.clones) {
                const other = instance.componentMembers && instance.componentMembers.get(spec.key);
                if (other && other !== target) other.componentProps = Object.assign({}, spec.props);
            }
        }
        this.emitTargetsUpdate();
    }

    /**
     * Add, change, rename or remove a property of the component of an instance.
     * @param {string} targetId an instance
     * @param {string} action 'add', 'update', 'rename' or 'remove'
     * @param {string|object} name the property (for 'add': {name, type, default, options})
     * @param {*} [value] for 'update': {type, default, options}; for 'rename': the new name
     * @returns {boolean} false if it couldn't be done (e.g. the name is taken)
     */
    editComponentProp (targetId, action, name, value) {
        const target = this.runtime.getTargetById(targetId);
        if (!target || !target.sprite.component) return false;
        const components = this.runtime.components;
        let done = true;
        if (action === 'add') done = components.addProp(target.sprite, name);
        else if (action === 'update') components.updateProp(target.sprite, name, value);
        else if (action === 'rename') done = components.renameProp(target.sprite, name, value);
        else if (action === 'remove') components.removeProp(target.sprite, name);
        if (done) this.emitTargetsUpdate();
        return done;
    }

    /**
     * Make, change or remove an output of the component a target is in (engine/components.js).
     * @param {string} targetId an instance, or a sprite in one
     * @param {string} action 'define' (make one, or change the one with `id`) or 'remove'
     * @param {object} spec for 'define': {proccode, argumentIds, argumentNames, id}; for 'remove': {id}
     * @returns {?object} the output ('define'), true if it was removed, or null/false if it couldn't be done
     */
    editComponentOutput (targetId, action, spec) {
        const components = this.runtime.components;
        const sprite = components.definitionOfTarget(this.runtime.getTargetById(targetId));
        if (!sprite) return null;
        let result = null;
        if (action === 'define') result = components.defineOutput(sprite, spec, spec && spec.id);
        else if (action === 'remove') result = components.removeOutput(sprite, spec && spec.id);
        else if (action === 'forward') {
            result = components.forwardOutput(sprite, spec && spec.instance, spec && spec.port);
        }
        if (result) {
            this.emitWorkspaceUpdate();
            this.emitTargetsUpdate();
        }
        return result;
    }

    /**
     * Set the audio engine for the VM/runtime
     * @param {!AudioEngine} audioEngine The audio engine to attach
     */
    attachAudioEngine (audioEngine) {
        this.runtime.attachAudioEngine(audioEngine);
    }

    /**
     * Set the renderer for the VM/runtime
     * @param {!RenderWebGL} renderer The renderer to attach
     */
    attachRenderer (renderer) {
        this.runtime.attachRenderer(renderer);
    }

    /**
     * @returns {RenderWebGL} The renderer attached to the vm
     */
    get renderer () {
        return this.runtime && this.runtime.renderer;
    }

    // @deprecated
    attachV2SVGAdapter () {
    }

    /**
     * Set the bitmap adapter for the VM/runtime, which converts scratch 2
     * bitmaps to scratch 3 bitmaps. (Scratch 3 bitmaps are all bitmap resolution 2)
     * @param {!function} bitmapAdapter The adapter to attach
     */
    attachV2BitmapAdapter (bitmapAdapter) {
        this.runtime.attachV2BitmapAdapter(bitmapAdapter);
    }

    /**
     * Set the storage module for the VM/runtime
     * @param {!ScratchStorage} storage The storage module to attach
     */
    attachStorage (storage) {
        this.runtime.attachStorage(storage);
    }

    /**
     * set the current locale and builtin messages for the VM
     * @param {!string} locale       current locale
     * @param {!object} messages     builtin messages map for current locale
     * @returns {Promise} Promise that resolves when all the blocks have been
     *     updated for a new locale (or empty if locale hasn't changed.)
     */
    setLocale (locale, messages) {
        if (locale !== formatMessage.setup().locale) {
            formatMessage.setup({locale: locale, translations: {[locale]: messages}});
        }
        this.emit('LOCALE_CHANGED', locale);
        return this.extensionManager.refreshBlocks();
    }

    /**
     * get the current locale for the VM
     * @returns {string} the current locale in the VM
     */
    getLocale () {
        return formatMessage.setup().locale;
    }

    /**
     * Handle a Blockly event for the current editing target.
     * @param {!Blockly.Event} e Any Blockly event.
     */
    blockListener (e) {
        if (this.editingTarget) {
            this.editingTarget.blocks.blocklyListen(e);
        }
    }

    /**
     * Handle a Blockly event for the flyout.
     * @param {!Blockly.Event} e Any Blockly event.
     */
    flyoutBlockListener (e) {
        this.runtime.flyoutBlocks.blocklyListen(e);
    }

    /**
     * Handle a Blockly event for the flyout to be passed to the monitor container.
     * @param {!Blockly.Event} e Any Blockly event.
     */
    monitorBlockListener (e) {
        // Filter events by type, since monitor blocks only need to listen to these events.
        // Monitor blocks shouldn't be destroyed when flyout blocks are deleted.
        if (['create', 'change'].indexOf(e.type) !== -1) {
            this.runtime.monitorBlocks.blocklyListen(e);
        }
    }

    /**
     * Handle a Blockly event for the variable map.
     * @param {!Blockly.Event} e Any Blockly event.
     */
    variableListener (e) {
        // Filter events by type, since blocks only needs to listen to these
        // var events.
        if (['var_create', 'var_rename', 'var_delete'].indexOf(e.type) !== -1) {
            this.runtime.getTargetForStage().blocks.blocklyListen(e);
        }
    }

    /**
     * Delete all of the flyout blocks.
     */
    clearFlyoutBlocks () {
        this.runtime.flyoutBlocks.deleteAllBlocks();
    }

    /**
     * Set an editing target. An editor UI can use this function to switch
     * between editing different targets, sprites, etc.
     * After switching the editing target, the VM may emit updates
     * to the list of targets and any attached workspace blocks
     * (see `emitTargetsUpdate` and `emitWorkspaceUpdate`).
     * @param {string} targetId Id of target to set as editing.
     */
    setEditingTarget (targetId) {
        // Has the target id changed? If not, exit.
        if (this.editingTarget && targetId === this.editingTarget.id) {
            return;
        }
        const target = this.runtime.getTargetById(targetId);
        if (target) {
            this.editingTarget = target;
            // Emit appropriate UI updates.
            this.emitTargetsUpdate(false /* Don't emit project change */);
            this.emitWorkspaceUpdate();
            this.runtime.setEditingTarget(target);
        }
    }

    /**
     * @param {Block[]} blockObjects
     * @returns {object}
     */
    exportStandaloneBlocks (blockObjects) {
        const sb3 = require('./serialization/sb3');
        const serialized = sb3.serializeStandaloneBlocks(blockObjects, this.runtime);
        return serialized;
    }

    /**
     * Called when blocks are dragged from one sprite to another. Adds the blocks to the
     * workspace of the given target.
     * @param {!Array<object>} blocks Blocks to add.
     * @param {!string} targetId Id of target to add blocks to.
     * @param {?string} optFromTargetId Optional target id indicating that blocks are being
     * shared from that target. This is needed for resolving any potential variable conflicts.
     * @return {!Promise} Promise that resolves when the extensions and blocks have been added.
     */
    shareBlocksToTarget (blocks, targetId, optFromTargetId) {
        const sb3 = require('./serialization/sb3');

        const {blocks: copiedBlocks, extensionURLs} = sb3.deserializeStandaloneBlocks(blocks);
        newBlockIds(copiedBlocks);
        const target = this.runtime.getTargetById(targetId);

        if (optFromTargetId) {
            // If the blocks are being shared from another target,
            // resolve any possible variable conflicts that may arise.
            const fromTarget = this.runtime.getTargetById(optFromTargetId);
            fromTarget.resolveVariableSharingConflictsWithTarget(copiedBlocks, target);
        }

        // Create a unique set of extensionIds that are not yet loaded
        const dataUpgrade = require('./serialization/tw-data-upgrade');
        const extensionIDs = new Set(copiedBlocks
            .map(b => sb3.getExtensionIdForOpcode(b.opcode))
            .filter(id => !!id) // Remove ids that do not exist
            .filter(id => !this.extensionManager.isExtensionLoaded(id)) // and remove loaded extensions
            .filter(id => !dataUpgrade.OLD_EXTENSIONS.includes(id)) // and old ones, whose blocks are converted
        );

        return this._loadExtensions(extensionIDs, extensionURLs).then(() => {
            copiedBlocks.forEach(block => {
                target.blocks.createBlock(block);
            });
            if (copiedBlocks.some(block => dataUpgrade.isOldBlock(block.opcode) ||
                block.opcode === 'control_create_clone_of' || block.opcode === 'control_start_as_clone')) {
                dataUpgrade.upgradeBlocks(target, copiedBlocks.map(block => block.id), this.runtime);
            }
            target.blocks.updateTargetSpecificBlocks(target.isStage);
        });
    }

    /**
     * Called when costumes are dragged from editing target to another target.
     * Sets the newly added costume as the current costume.
     * @param {!number} costumeIndex Index of the costume of the editing target to share.
     * @param {!string} targetId Id of target to add the costume.
     * @return {Promise} Promise that resolves when the new costume has been loaded.
     */
    shareCostumeToTarget (costumeIndex, targetId) {
        const originalCostume = this.editingTarget.getCostumes()[costumeIndex];
        const clone = Object.assign({}, originalCostume);
        const md5ext = `${clone.assetId}.${clone.dataFormat}`;
        return loadCostume(md5ext, clone, this.runtime).then(() => {
            const target = this.runtime.getTargetById(targetId);
            if (target) {
                target.addCostume(clone);
                target.setCostume(
                    target.getCostumes().length - 1
                );
            }
        });
    }

    /**
     * Called when sounds are dragged from editing target to another target.
     * @param {!number} soundIndex Index of the sound of the editing target to share.
     * @param {!string} targetId Id of target to add the sound.
     * @return {Promise} Promise that resolves when the new sound has been loaded.
     */
    shareSoundToTarget (soundIndex, targetId) {
        const originalSound = this.editingTarget.getSounds()[soundIndex];
        const clone = Object.assign({}, originalSound);
        const target = this.runtime.getTargetById(targetId);
        return loadSound(clone, this.runtime, target.sprite.soundBank).then(() => {
            if (target) {
                target.addSound(clone);
                this.emitTargetsUpdate();
            }
        });
    }

    /**
     * Repopulate the workspace with the blocks of the current editingTarget. This
     * allows us to get around bugs like gui#413.
     */
    refreshWorkspace () {
        if (this.editingTarget) {
            this.emitWorkspaceUpdate();
            this.runtime.setEditingTarget(this.editingTarget);
            this.emitTargetsUpdate(false /* Don't emit project change */);
        }
    }

    /**
     * Emit metadata about available targets.
     * An editor UI could use this to display a list of targets and show
     * the currently editing one.
     * @param {bool} triggerProjectChange If true, also emit a project changed event.
     * Disabled selectively by updates that don't affect project serialization.
     * Defaults to true.
     */
    emitTargetsUpdate (triggerProjectChange) {
        if (typeof triggerProjectChange === 'undefined') triggerProjectChange = true;
        let lazyTargetList;
        const getTargetListLazily = () => {
            if (!lazyTargetList) {
                lazyTargetList = this.runtime.targets
                    .filter(
                        // Don't report clones.
                        target => !Object.prototype.hasOwnProperty.call(target, 'isOriginal') || target.isOriginal
                    ).map(
                        target => target.toJSON()
                    );
            }
            return lazyTargetList;
        };
        this.emit('targetsUpdate', {
            // [[target id, human readable target name], ...].
            get targetList () {
                return getTargetListLazily();
            },
            // Currently editing target id.
            editingTarget: this.editingTarget ? this.editingTarget.id : null
        });
        if (triggerProjectChange) {
            this.runtime.emitProjectChanged();
        }
    }

    /**
     * Emit an Blockly/scratch-blocks compatible XML representation
     * of the current editing target's blocks.
     */
    emitWorkspaceUpdate () {
        if (this.editingTarget) this.runtime.components.completeOutputBlocks(this.editingTarget);
        // Create a list of broadcast message Ids according to the stage variables
        const stageVariables = this.runtime.getTargetForStage().variables;
        let messageIds = [];
        for (const varId in stageVariables) {
            if (stageVariables[varId].type === Variable.BROADCAST_MESSAGE_TYPE) {
                messageIds.push(varId);
            }
        }
        // Go through all blocks on all targets, removing referenced
        // broadcast ids from the list.
        for (let i = 0; i < this.runtime.targets.length; i++) {
            const currTarget = this.runtime.targets[i];
            const currBlocks = currTarget.blocks._blocks;
            for (const blockId in currBlocks) {
                if (currBlocks[blockId].fields.BROADCAST_OPTION) {
                    const id = currBlocks[blockId].fields.BROADCAST_OPTION.id;
                    const index = messageIds.indexOf(id);
                    if (index !== -1) {
                        messageIds = messageIds.slice(0, index)
                            .concat(messageIds.slice(index + 1));
                    }
                }
            }
        }
        // Anything left in messageIds is not referenced by a block, so delete it.
        for (let i = 0; i < messageIds.length; i++) {
            const id = messageIds[i];
            delete this.runtime.getTargetForStage().variables[id];
        }
        const globalVarMap = Object.assign({}, this.runtime.getTargetForStage().variables);
        const localVarMap = this.editingTarget.isStage ?
            Object.create(null) :
            Object.assign({}, this.editingTarget.variables);

        const globalVariables = Object.keys(globalVarMap).map(k => globalVarMap[k]);
        const localVariables = Object.keys(localVarMap).map(k => localVarMap[k]);
        const workspaceComments = Object.keys(this.editingTarget.comments)
            .map(k => this.editingTarget.comments[k])
            .filter(c => c.blockId === null);

        const xmlString = `<xml xmlns="http://www.w3.org/1999/xhtml">
                            <variables>
                                ${globalVariables.map(v => v.toXML()).join()}
                                ${localVariables.map(v => v.toXML(true)).join()}
                            </variables>
                            ${workspaceComments.map(c => c.toXML()).join()}
                            ${this.editingTarget.blocks.toXML(this.editingTarget.comments)}
                        </xml>`;

        this.emit('workspaceUpdate', {xml: xmlString});
    }

    /**
     * Get a target id for a drawable id. Useful for interacting with the renderer
     * @param {int} drawableId The drawable id to request the target id for
     * @returns {?string} The target id, if found. Will also be null if the target found is the stage.
     */
    getTargetIdForDrawableId (drawableId) {
        const target = this.runtime.getTargetByDrawableId(drawableId);
        if (target &&
            Object.prototype.hasOwnProperty.call(target, 'id') &&
            Object.prototype.hasOwnProperty.call(target, 'isStage') &&
            !target.isStage) {
            // While a component is being edited, only it can be picked on the stage
            const scope = this.runtime.components.editScope;
            if (scope && !this.componentScopeTargets().includes(target)) return null;
            // A member of a component is picked as the instance it is in, at the level being edited (like a group:
            // double-click to go in)
            return this.componentLevelOf(target).id;
        }
        return null;
    }

    /**
     * @param {Target} target
     * @returns {Target} the target itself, or the instance of a component it is in at the level being edited: the
     * top level, or directly in the component being edited
     */
    componentLevelOf (target) {
        const scope = this.runtime.components.editScope || null;
        let level = target;
        while (level !== scope && level.componentOwner && level.componentOwner !== scope) level = level.componentOwner;
        return level;
    }

    /**
     * Double-clicking a target on the stage: an instance of a component is entered, with the member that was
     * clicked (or the instance in it that contains it) selected; anything else is selected.
     * @param {int} drawableId the drawable that was double-clicked
     */
    enterComponentAtDrawable (drawableId) {
        const target = this.runtime.getTargetByDrawableId(drawableId);
        if (!target || target.isStage) return;
        const levelId = this.getTargetIdForDrawableId(drawableId);
        const level = levelId && this.runtime.getTargetById(levelId);
        if (!level) return;
        if (!level.sprite.component) {
            this.setEditingTarget(level.id);
            return;
        }
        this.enterComponent(level.id);
        if (level === target) return;
        let inside = target;
        while (inside.componentOwner && inside.componentOwner !== level) inside = inside.componentOwner;
        this.setEditingTarget(inside.id);
    }

    /**
     * @returns {Array<Target>} the instance whose component is being edited, and the members in it (and in them)
     */
    componentScopeTargets () {
        const components = this.runtime.components;
        const scope = components.editScope;
        if (!scope) return [];
        const result = [];
        const add = target => {
            result.push(target);
            for (const member of components.membersOf(target)) add(member);
        };
        add(scope);
        return result;
    }

    /**
     * Enter or leave editing a component (the component mode of the editor): what is outside it is hidden
     * ('isolate') or faded ('surround') on the stage and can't be picked, and sprites added meanwhile go into it.
     * @param {?string} instanceId the instance to edit, or null to stop
     * @param {string} [view] 'isolate' (default) or 'surround'
     */
    setComponentEditScope (instanceId, view = 'isolate') {
        const components = this.runtime.components;
        const scope = instanceId ? this.runtime.getTargetById(instanceId) : null;
        components.editScope = scope && scope.sprite.component ? scope : null;
        this._componentView = view;
        this.refreshComponentEditView();
        this.emitTargetsUpdate(false);
    }

    /**
     * Open the page of a component: the component on its own, with an instance of it that is not saved, while the
     * project does not run (see Components.openPage). Opened while one is open, it is on top of it (going in).
     * @param {string} targetId an instance of the component, one in the page (a component inside it), or the
     * component (a member of it)
     * @returns {?string} the id of the instance of the page
     */
    openComponentPage (targetId) {
        const components = this.runtime.components;
        const target = this.runtime.getTargetById(targetId);
        const sprite = target && (target.sprite.component ? target.sprite : components.definitionOfTarget(target));
        if (!sprite) return null;
        const preview = components.openPage(sprite);
        if (!preview) return null;
        this.refreshComponentEditView();
        this.setEditingTarget(preview.id);
        this.emitTargetsUpdate(false);
        this.emit('componentPageChanged');
        return preview.id;
    }

    /**
     * Go back from the page of a component: to the one it was opened from, or the project.
     * @param {boolean} [all] true to go all the way back to the project
     */
    closeComponentPage (all) {
        const components = this.runtime.components;
        if (!components.page) return;
        const closed = components.page.stack[components.page.stack.length - 1];
        let preview = components.closePage();
        if (all) {
            while (preview) preview = components.closePage();
        }
        this.refreshComponentEditView();
        const back = preview || components.instancesOf(closed)[0] ||
            this.runtime.targets.find(target => target.isOriginal && !target.isStage && !target.isPreview);
        this.setEditingTarget((back || this.runtime.getTargetForStage()).id);
        this.emitTargetsUpdate(false);
        this.emit('componentPageChanged');
    }

    /**
     * Start the component of the page again, with new variables.
     */
    resetComponentPage () {
        const components = this.runtime.components;
        if (!components.page) return;
        const preview = components.restartPage();
        this.refreshComponentEditView();
        if (preview) this.setEditingTarget(preview.id);
        this.emitTargetsUpdate(false);
    }

    /**
     * @returns {?{path: Array<string>, instanceId: string}} the component pages that are open, from the outside in
     * (names of the components), and the instance of the innermost
     */
    getComponentPage () {
        const page = this.runtime.components.page;
        if (!page) return null;
        return {path: page.stack.map(sprite => sprite.name), instanceId: page.preview.id};
    }

    /**
     * @param {string} targetId an instance, or a sprite in one
     * @returns {?{inputs: Array<object>, outputs: Array<object>}} what the outside can do with the component (its
     * public custom blocks, {id, proccode, argumentIds, argumentNames, returns}) and what it says
     * ({id, proccode, params: [{id, name, type}]})
     */
    getComponentInterface (targetId) {
        const components = this.runtime.components;
        const holder = components.holderOf(this.runtime.getTargetById(targetId));
        if (!holder) return null;
        const {publicProcedures} = require('./engine/sprite-interface');
        return {
            inputs: publicProcedures(holder),
            outputs: JSON.parse(JSON.stringify(holder.sprite.component.outputs))
        };
    }

    /**
     * Run an input of the instance of the page (the buttons of the test panel).
     * @param {string} prototypeId the prototype block of the public custom block
     * @param {object} values by id of the arguments
     * @returns {Promise<*>} resolves when it is done, with what it reports if it is a reporter
     */
    runComponentInput (prototypeId, values) {
        return this.runtime.components.callInput(prototypeId, values);
    }

    /**
     * Edit the component of an instance (an older name of openComponentPage).
     * @param {string} instanceId an instance
     */
    enterComponent (instanceId) {
        this.openComponentPage(instanceId);
    }

    /**
     * Stop editing the component, one level up (or all the way out).
     * @param {boolean} [all] true to go back to the whole project
     */
    exitComponent (all) {
        this.closeComponentPage(all);
    }

    /**
     * Put an instance of a component into the component being edited.
     * @param {string} componentId the component to put in
     * @returns {?string} id of the new instance, or null if it can't go in (e.g. it contains the edited one)
     */
    addComponentToEdited (componentId) {
        const components = this.runtime.components;
        const scope = components.editScope;
        const member = components.addComponentMember(scope, components.definitions.get(componentId));
        if (!member) return null;
        this.refreshComponentEditView();
        this.setEditingTarget(member.id);
        this.emitTargetsUpdate();
        return member.id;
    }

    /**
     * @param {string} view how the stage shows what is outside the component being edited: 'isolate' or 'surround'
     */
    setComponentView (view) {
        this._componentView = view === 'surround' ? 'surround' : 'isolate';
        this.refreshComponentEditView();
        this.emitTargetsUpdate(false);
    }

    /**
     * @returns {string} see setComponentView
     */
    getComponentView () {
        return this._componentView || 'isolate';
    }

    /**
     * Show the stage for the component being edited (see setComponentEditScope), or as it is.
     */
    refreshComponentEditView () {
        const renderer = this.runtime.renderer;
        const scope = this.runtime.components.editScope;
        const scene3D = this.runtime.scene3D;
        if (!renderer) return;
        const inside = new Set(this.componentScopeTargets());
        for (const target of this.runtime.targets) {
            if (target.isStage || typeof target.drawableID !== 'number') continue;
            target.updateAllDrawableProperties();
            if (!scope || inside.has(target)) continue;
            if (this._componentView === 'surround') {
                renderer.updateDrawableEffect(target.drawableID, 'ghost', 75);
            } else {
                renderer.updateDrawableVisible(target.drawableID, false);
            }
        }
        const stage = this.runtime.getTargetForStage();
        const isolated = !!scope && this._componentView !== 'surround';
        if (stage && typeof stage.drawableID === 'number') {
            if (isolated) renderer.updateDrawableVisible(stage.drawableID, false);
            else stage.updateAllDrawableProperties();
        }
        // A neutral background while only the component is shown
        if (renderer.setBackgroundColor) {
            if (isolated) renderer.setBackgroundColor(0.91, 0.93, 0.96);
            else renderer.setBackgroundColor(1, 1, 1);
        }
        if (scene3D) {
            if (scope && this._componentView !== 'surround') {
                if (typeof this._layer3DVisible !== 'boolean') this._layer3DVisible = scene3D._layerVisible;
                scene3D.setLayerVisible(false);
            } else if (typeof this._layer3DVisible === 'boolean') {
                scene3D.setLayerVisible(this._layer3DVisible);
                this._layer3DVisible = null;
            }
        }
        this.runtime.requestRedraw();
    }

    /**
     * Turn sprites into a component. One sprite: it is the component. More: a new, empty sprite in the middle of
     * them is the component, and they go into it.
     * @param {Array<string>} targetIds 2D sprites
     * @returns {Promise<?string>} the id of the instance of the new component
     */
    makeComponentFrom (targetIds) {
        const targets = targetIds.map(id => this.runtime.getTargetById(id))
            .filter(target => target && !target.isStage && !target.componentOwner && !target.is3D &&
                !target.isCamera && !target.isCanvas);
        if (targets.length === 0) return Promise.resolve(null);
        if (targets.length === 1) {
            return Promise.resolve(this.makeComponent(targets[0].id) ? targets[0].id : null);
        }
        const x = targets.reduce((sum, t) => sum + t.x, 0) / targets.length;
        const y = targets.reduce((sum, t) => sum + t.y, 0) / targets.length;
        const storage = this.runtime.storage;
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2" viewBox="0 0 2 2"></svg>';
        const data = new TextEncoder().encode(svg);
        const asset = storage.createAsset(storage.AssetType.ImageVector, storage.DataFormat.SVG, data, null, true);
        if (storage.builtinHelper) {
            storage.builtinHelper._store(storage.AssetType.ImageVector, storage.DataFormat.SVG, data, asset.assetId);
        }
        const names = this.runtime.targets.filter(t => t.isOriginal && !t.isStage).map(t => t.getName());
        const name = StringUtil.unusedName('元件', names);
        return this.addSprite({
            isStage: false,
            name,
            variables: {},
            lists: {},
            broadcasts: {},
            blocks: {},
            comments: {},
            currentCostume: 0,
            sounds: [],
            volume: 100,
            visible: true,
            x,
            y,
            size: 100,
            direction: 90,
            draggable: false,
            rotationStyle: 'all around',
            costumes: [{
                name: '空白',
                bitmapResolution: 1,
                dataFormat: 'svg',
                assetId: asset.assetId,
                md5ext: `${asset.assetId}.svg`,
                rotationCenterX: 1,
                rotationCenterY: 1
            }]
        }).then(() => {
            const root = this.runtime.targets.find(t => t.isOriginal && t.getName() === name);
            if (!root) return null;
            root.setXY(x, y);
            this.makeComponent(root.id);
            for (const target of targets) this.runtime.components.adoptMember(root, target);
            this.setEditingTarget(root.id);
            this.emitTargetsUpdate();
            return root.id;
        });
    }

    /**
     * Reorder target by index. Return whether a change was made.
     * @param {!string} targetIndex Index of the target.
     * @param {!number} newIndex index that the target should be moved to.
     * @returns {boolean} Whether a target was reordered.
     */
    reorderTarget (targetIndex, newIndex) {
        let targets = this.runtime.targets;
        targetIndex = MathUtil.clamp(targetIndex, 0, targets.length - 1);
        newIndex = MathUtil.clamp(newIndex, 0, targets.length - 1);
        if (targetIndex === newIndex) return false;
        const target = targets[targetIndex];
        targets = targets.slice(0, targetIndex).concat(targets.slice(targetIndex + 1));
        targets.splice(newIndex, 0, target);
        this.runtime.targets = targets;
        this.emitTargetsUpdate();
        return true;
    }

    /**
     * Reorder the costumes of a target if it exists. Return whether it succeeded.
     * @param {!string} targetId ID of the target which owns the costumes.
     * @param {!number} costumeIndex index of the costume to move.
     * @param {!number} newIndex index that the costume should be moved to.
     * @returns {boolean} Whether a costume was reordered.
     */
    reorderCostume (targetId, costumeIndex, newIndex) {
        const target = this.runtime.getTargetById(targetId);
        if (target) {
            const reorderSuccessful = target.reorderCostume(costumeIndex, newIndex);
            if (reorderSuccessful) {
                this.runtime.emitProjectChanged();
            }
            return reorderSuccessful;
        }
        return false;
    }

    /**
     * Reorder the sounds of a target if it exists. Return whether it occured.
     * @param {!string} targetId ID of the target which owns the sounds.
     * @param {!number} soundIndex index of the sound to move.
     * @param {!number} newIndex index that the sound should be moved to.
     * @returns {boolean} Whether a sound was reordered.
     */
    reorderSound (targetId, soundIndex, newIndex) {
        const target = this.runtime.getTargetById(targetId);
        if (target) {
            const reorderSuccessful = target.reorderSound(soundIndex, newIndex);
            if (reorderSuccessful) {
                this.runtime.emitProjectChanged();
            }
            return reorderSuccessful;
        }
        return false;
    }

    /**
     * Put a target into a "drag" state, during which its X/Y positions will be unaffected
     * by blocks.
     * @param {string} targetId The id for the target to put into a drag state
     */
    startDrag (targetId) {
        const target = this.runtime.getTargetById(targetId);
        if (target) {
            this._dragTarget = target;
            this._dragStart = StageUndo.snapshot(target);
            target.startDrag();
        }
    }

    /**
     * Remove a target from a drag state, so blocks may begin affecting X/Y position again
     * @param {string} targetId The id for the target to remove from the drag state
     */
    stopDrag (targetId) {
        const target = this.runtime.getTargetById(targetId);
        if (target) {
            this._dragTarget = null;
            target.stopDrag();
            if (this._dragStart) this.runtime.stageUndo.record(target, this._dragStart);
            this._dragStart = null;
            this.setEditingTarget(target.sprite && target.sprite.clones[0] ?
                target.sprite.clones[0].id : target.id);
        }
    }

    /**
     * Post/edit sprite info for the current editing target or the drag target.
     * @param {object} data An object with sprite info data to set.
     */
    postSpriteInfo (data) {
        if (this._dragTarget) {
            this._dragTarget.postSpriteInfo(data);
        } else {
            const before = StageUndo.snapshot(this.editingTarget);
            this.editingTarget.postSpriteInfo(data);
            // Turning a dial or typing into a field changes the same thing many times in a row: that's one edit
            this.runtime.stageUndo.record(this.editingTarget, before, true);
            // A member of a component being edited: the component changes
            if (this.editingTarget.componentOwner) this.runtime.components.memberChanged(this.editingTarget);
        }
        // Post sprite info means the gui has changed something about a sprite,
        // either through the sprite info pane fields (e.g. direction, size) or
        // through dragging a sprite on the stage
        // Emit a project changed event.
        this.runtime.emitProjectChanged();
    }

    /**
     * Set a target's variable's value. Return whether it succeeded.
     * @param {!string} targetId ID of the target which owns the variable.
     * @param {!string} variableId ID of the variable to set.
     * @param {!*} value The new value of that variable.
     * @returns {boolean} whether the target and variable were found and updated.
     */
    setVariableValue (targetId, variableId, value) {
        const target = this.runtime.getTargetById(targetId);
        if (target) {
            const variable = target.lookupVariableById(variableId);
            if (variable) {
                variable.value = value;

                if (variable.isCloud) {
                    this.runtime.ioDevices.cloud.requestUpdateVariable(variable.name, variable.value);
                }

                return true;
            }
        }
        return false;
    }

    /**
     * Get a target's variable's value. Return null if the target or variable does not exist.
     * @param {!string} targetId ID of the target which owns the variable.
     * @param {!string} variableId ID of the variable to set.
     * @returns {?*} The value of the variable, or null if it could not be looked up.
     */
    getVariableValue (targetId, variableId) {
        const target = this.runtime.getTargetById(targetId);
        if (target) {
            const variable = target.lookupVariableById(variableId);
            if (variable) {
                return variable.value;
            }
        }
        return null;
    }

    /**
     * Allow VM consumer to configure the ScratchLink socket creator.
     * @param {Function} factory The custom ScratchLink socket factory.
     */
    configureScratchLinkSocketFactory (factory) {
        this.runtime.configureScratchLinkSocketFactory(factory);
    }
}

module.exports = VirtualMachine;

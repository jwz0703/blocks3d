# my-turbowarp

A personal fork of [TurboWarp](https://turbowarp.org) with **no extension sandbox**.

- Every custom extension (URL, file or pasted text) runs **unsandboxed**; the option cannot be changed.
- Extensions saved inside a project load automatically, with no prompt.
- Custom blocks can return values (the "Custom Reporters" feature) by default; it is no longer an entry in the extension library.
- Infinite Clones, Remove Fencing, Remove Miscellaneous Limits and High Quality Pen are always on and no longer appear in Settings (project options and URL parameters cannot turn them off).
- Default framerate is 60 FPS. It can still be changed in Settings, by `?fps=`, or by stored project options.
- Other permission prompts (fetch, open window, camera, microphone, etc.) are unchanged.
- The Sounds tab is gone. The **Files** tab (檔案, right of Costumes) lists the current sprite's sounds first, then project-wide files stored inside the .sb3. Uploading or dropping an audio file (mp3, wav, ogg, flac, aac, m4a) adds it as a sound and opens the normal sound editor; its menu also has the sound library and recording. Anything that used to open the Sounds tab opens this tab. The 3D extension can load `.glb`/`.gltf` models from it, and the built-in 檔案 category (always loaded, shown right after My Blocks) reads files as text, data URL or size.
- There is no "Make a Variable" / "Make a List" button (and so no cloud variables). The 變數 category holds blocks that take the variable name as text, such as `變數 [名稱] 設為 ()`, `變數 [名稱] 改變 ()` and `取得變數 [名稱]`, plus the matching 清單 blocks. A variable or list is created the first time a block writes to it and is stored on the stage (saved with the project). Control, after the clone blocks, has the same set as 分身變數 / 分身清單: they are stored on the sprite, and each clone gets its own copy.
- Control has a `讓 (i) 從 (1) 跑到 (10)` loop (counts down when the start is larger). Drag `i` out of it like a custom block parameter; it reads the closest enclosing loop with the same name, and is 0 outside one. A loop dropped inside another is renamed to a free name (`j`, `k`, …) automatically, and right-click → 重新命名變數 renames a loop and the parameters that belong to it.
- My Blocks has 區域變數 blocks right under the return block: `區域變數 [名稱] 設為 ()`, `區域變數 [名稱] 改變 ()`, `取得區域變數 [名稱]` and `區域變數 [名稱] 存在？`. They belong to the custom block call they run in: every call (recursion, or several scripts running the same block at once) gets its own set, which is gone when the call ends. Outside a custom block, each run of a script gets its own set. Unset ones read as 0.
- Control has a `摺疊區塊` C block (after the stop block) that only groups blocks to make scripts easier to read; the blocks inside always run once. Click its triangle to hide the blocks inside, which turns it into a comment-coloured single block, and click again to show them. Right-click → 重新命名 changes its name. Both are saved with the project.
- Sensing has `[ ] 鍵剛按下？`, `[ ] 鍵剛放開？` and `[ ] 鍵按住秒數` after `按下 [ ] 鍵？`. Key events are recorded as they arrive and become visible at the start of the next frame, so a tap shorter than one frame is still caught, and key repeat while holding does not count as a new press. Each 剛按下 / 剛放開 block reports a given press or release once per script (and once per clone), even in a loop that runs many times per frame or without screen refresh; the event is only available in the frame right after it happens. 按住秒數 is 0 when the key is not held; with 任意鍵 it is the longest held key.
- Looks ends with a `log ()` block that prints its input to the browser console (`console.log`).
- **File → 匯出為 HTML / 匯出為 ZIP** exports the project with this fork's own player, so 3D, files and every other change here keep working offline. The player is only the stage, filling the window, and the project starts right away (sound starts after the first click or key press). The ZIP holds `index.html`, `player.js`, `project.js` and a copy of `project.sb3`, plus `music.js` / `three.js` when the project uses the music / 3D extension. To keep exports small, the player can't load Scratch 1/2 projects (it doesn't need to), only has the Scratch fonts that the project's vector costumes use, and the hardware extensions (micro:bit, LEGO, Force & Acceleration) in it do nothing.

> ⚠️ Unsandboxed extensions have full access to the page. Only load extensions and projects you trust.

## Layout

| Folder | Upstream | Notes |
| --- | --- | --- |
| `scratch-gui/` | TurboWarp/scratch-gui | Interface. Uses `scratch-vm` from `../scratch-vm` |
| `scratch-vm/` | TurboWarp/scratch-vm | Runtime. Default security manager is also unsandboxed |
| `scratch-render/` | TurboWarp/scratch-render | Stage renderer. `scratch-gui/node_modules/scratch-render` is a symlink to it; its own `node_modules` only holds what isn't hoisted into scratch-gui's |

### Upstream base

The packages were copied (without their git history) from these upstream commits. Upstream is no longer merged; needed fixes are ported by hand.

| Folder | Upstream commit |
| --- | --- |
| `scratch-gui/` | [`25c11c6f246de9c6d36b29a61c505cd35f34cb8c`](https://github.com/TurboWarp/scratch-gui/commit/25c11c6f246de9c6d36b29a61c505cd35f34cb8c) (develop, 2026-09-15, "Add support for DMCA takedowns (#1194)") |
| `scratch-vm/` | [`c4823421cb7c17d8d8a89878851ce1668c26a21f`](https://github.com/TurboWarp/scratch-vm/commit/c4823421cb7c17d8d8a89878851ce1668c26a21f) (develop, 2026-07-12, "Fix toggleScript confusion when block ID is reused across targets (#347)") |
| `scratch-render/` | [`a67f7c9c07d459582c227d4fd3fae8f59d8fc9ce`](https://github.com/TurboWarp/scratch-render/commit/a67f7c9c07d459582c227d4fd3fae8f59d8fc9ce) (develop, 2026-05-23, "Export EffectTransform, ShaderManager") |

## Development

```sh
cd scratch-vm && npm install --ignore-scripts
cd ../scratch-gui && npm install
npm start          # http://localhost:8601
npm run build      # outputs to scratch-gui/build/
```

## What changed

- `scratch-gui/src/containers/tw-security-manager.jsx`: `getSandboxMode` always returns `'unsandboxed'`, and `canLoadExtensionFromProject` always returns `true`
- `scratch-gui/src/containers/tw-custom-extension-modal.jsx` + `components/tw-custom-extension-modal/custom-extension-modal.jsx`: the "Run without sandbox" checkbox was removed
- `scratch-gui/src/lib/tw-persisted-unsandboxed.js`: deleted
- `scratch-vm/src/extension-support/tw-security-manager.js`: defaults changed to unsandboxed and auto-load
- `scratch-gui/src/containers/blocks.jsx`: calls `workspace.enableProcedureReturns()` right after the workspace is created
- `scratch-gui/src/lib/libraries/extensions/index.jsx`: removed the "Custom Reporters" entry
- `scratch-gui/package.json`: `scratch-vm` → `file:../scratch-vm`
- `scratch-vm/src/engine/runtime.js`: `maxClones: Infinity`, `miscLimits: false` and `fencing: false` are forced in `setRuntimeOptions`; `attachRenderer` turns on high quality render
- `scratch-vm/src/engine/tw-frame-loop.js`: default framerate 60
- `scratch-gui/src/reducers/tw.js`: matching defaults (60 FPS, HQ pen, infinite clones, no fencing, no misc limits)
- `scratch-gui/src/{containers,components}/tw-settings-modal*`: removed the High Quality Pen, Infinite Clones, Remove Fencing and Remove Miscellaneous Limits settings (and the now-empty "Remove Limits" section)
- `scratch-gui/src/lib/tw-state-manager-hoc.jsx`: dropped `?hqpen`, `?clones`, `?offscreen`, `?limitless`; `?fps` is omitted when it is 60
- `scratch-vm/src/engine/tw-file-manager.js`: project files, saved like custom fonts (`customFiles` in project.json, `md5.ext` in the zip); wired up in `runtime.js`, `serialization/sb3.js` and `virtual-machine.js`
- `scratch-render/src/RenderWebGL.js`: `setUnderlay(fn)`: `draw()` calls `fn(gl)` right after clearing the stage and before any drawable, then restores its own GL state
- `scratch-vm/src/extensions/tw_three3d/index.js`: three.js shares the stage's WebGL2 context and draws below the backdrop through `setUnderlay`, so no frame is copied between contexts. The scene renders into a 4× multisampled target (the stage context has antialiasing off) that is only re-rendered when the scene or the stage size changed, then drawn onto the stage. Without WebGL2 (or with an unmodified scratch-render) it falls back to the old offscreen canvas shown as a bitmap skin in the video layer
- `scratch-vm/src/extensions/tw_three3d/index.js`: `載入模型` block (GLTFLoader; `.gltf` buffers and textures are looked up in the Files tab)
- `scratch-vm/src/extensions/tw_files/index.js`: new 檔案 extension; loaded at startup via `CORE_EXTENSIONS` in `virtual-machine.js`, removed from the extension library, and placed after My Blocks by `make-toolbox-xml.js`
- `scratch-vm/src/extensions/tw_vars/` (`twvars`) and `tw_clone_vars/` (`twclonevars`): named variable/list blocks, both built from `make-variable-blocks.js` and loaded via `CORE_EXTENSIONS`; `make-toolbox-xml.js` uses `twvars` in place of the Variables category and moves the `twclonevars` blocks to the end of Control (sprites only)
- `scratch-gui/src/containers/tw-file-tab.jsx` + `components/tw-file-tab/`: the Files tab, which also hosts sounds (`SoundEditor`, sound library, recorder)
- `scratch-gui/src/components/gui/gui.jsx`, `containers/gui.jsx`, `reducers/editor-tab.js`: Sounds tab removed; `SOUNDS_TAB_INDEX` is now an alias of `FILES_TAB_INDEX` (2)
- `scratch-gui/src/components/asset-panel/selector.jsx`: items can set their own `dragType`, so sounds in the Files tab still drag to other sprites and the backpack
- `control_for_range` / `control_for_range_index`: block definitions in `scratch-gui/src/lib/blocks.js`, toolbox in `make-toolbox-xml.js`, interpreter in `scratch-vm/src/blocks/scratch3_control.js`, compiler in `scratch-vm/src/compiler/{irgen,jsgen,iroptimizer,enums}.js`, and registered as a draggable parameter in `runtime.js`
- `control_fold`: block definition and its triangle field (`field_fold_toggle`, value in the `OPEN` field) in `scratch-gui/src/lib/blocks.js`, toolbox in `make-toolbox-xml.js`, run like `control_all_at_once` in `scratch-vm/src/blocks/scratch3_control.js` and `compiler/irgen.js`
- `looks_log`: block definition in `scratch-gui/src/lib/blocks.js`, toolbox in `make-toolbox-xml.js`, interpreter in `scratch-vm/src/blocks/scratch3_looks.js`, and run by the compiler through `compat-blocks.js`
- `scratch-vm/src/extensions/tw_local_vars/` (`twlocalvars`): local variables, loaded via `CORE_EXTENSIONS`. The interpreter keeps them on the stack frame that holds the call's parameters (`locals` in `engine/thread.js`, reset in `scratch3_procedures.js`); the compiler turns them into a `Map` created at the start of each generated function (`irgen.js`, `jsgen.js`, `enums.js`, `localGet` in `jsexecute.js`). `make-toolbox-xml.js` hides the category and `containers/blocks.jsx` inserts its blocks under the return block by replacing `ScratchBlocks.Procedures.flyoutCategory` (category callbacks are shared by all workspaces, so registering one only on the main workspace gets overwritten by the Make a Block dialog)
- `scratch-gui/src/playground/standalone.js` + the `standalone` config in `webpack.config.js`: single-file player (`build/js/standalone.js`, always minified) used by `src/lib/tw-standalone-export.js`. It uses scratch-vm, scratch-render and scratch-audio directly, not the GUI. Modules in `src/lib/tw-standalone/` replace the parts most projects don't need; the music samples and three.js are built separately (`standalone-music.js`, `standalone-three.js`) and only exported with projects whose blocks use those extensions

## License

- `scratch-gui/` is GPL-3.0 (see `scratch-gui/LICENSE`). Because the interface is GPL-3.0, any public release of the whole product must be open source under GPL-3.0.
- `scratch-vm/` and `scratch-render/` are MPL-2.0 (see their `LICENSE`). Files changed from upstream stay MPL-2.0; new files may be added under MPL-2.0 too.
- The upstream `LICENSE` and `TRADEMARK` files are kept as they are, and so are the copyright and source notices of Scratch (MIT Scratch Team) and TurboWarp. The Scratch name, logo and characters are MIT trademarks and must not be used to promote this product.

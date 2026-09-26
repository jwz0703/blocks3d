const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Base64Util = require('../../util/base64-util');
const Cast = require('../../util/cast');

// eslint-disable-next-line max-len
const blockIconURI = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><path fill="#ffd966" stroke="#b38f00" stroke-width="2" stroke-linejoin="round" d="M5 10a2 2 0 0 1 2-2h9l3 3h14a2 2 0 0 1 2 2v17a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/></svg>')}`;

/**
 * Read files uploaded in the editor's Files tab.
 */
class Scratch3FilesBlocks {
    constructor (runtime) {
        this.runtime = runtime;

        /** @type {Map<string, string>} data URLs by md5, since building them is slow for big files */
        this._dataURLCache = new Map();
        runtime.fileManager.on('change', () => this._dataURLCache.clear());
    }

    getInfo () {
        const file = {FILE: {type: ArgumentType.STRING, menu: 'file', defaultValue: ''}};
        return {
            id: 'twfiles',
            name: '檔案',
            color1: '#e6ac00',
            color2: '#cc9900',
            color3: '#b38600',
            blockIconURI,
            menuIconURI: blockIconURI,
            blocks: [
                {
                    opcode: 'fileList',
                    blockType: BlockType.REPORTER,
                    text: '檔案列表'
                },
                {
                    opcode: 'fileExists',
                    blockType: BlockType.BOOLEAN,
                    text: '檔案 [FILE] 存在？',
                    arguments: file
                },
                {
                    opcode: 'fileText',
                    blockType: BlockType.REPORTER,
                    text: '檔案 [FILE] 的文字內容',
                    arguments: file
                },
                {
                    opcode: 'fileDataURL',
                    blockType: BlockType.REPORTER,
                    text: '檔案 [FILE] 的 data URL',
                    arguments: file
                },
                {
                    opcode: 'fileSize',
                    blockType: BlockType.REPORTER,
                    text: '檔案 [FILE] 的大小（位元組）',
                    arguments: file
                }
            ],
            menus: {
                file: {
                    acceptReporters: true,
                    items: '_getFileMenu'
                }
            }
        };
    }

    _getFileMenu () {
        const names = this.runtime.fileManager.getFileNames();
        if (names.length === 0) {
            return [{text: '（先到「檔案」分頁上傳檔案）', value: ''}];
        }
        return names;
    }

    _getFile (args) {
        return this.runtime.fileManager.getFile(Cast.toString(args.FILE));
    }

    fileList () {
        return JSON.stringify(this.runtime.fileManager.getFileNames());
    }

    fileExists (args) {
        return !!this._getFile(args);
    }

    fileText (args) {
        const file = this._getFile(args);
        if (!file) return '';
        return new TextDecoder().decode(file.data);
    }

    fileDataURL (args) {
        const file = this._getFile(args);
        if (!file) return '';
        const key = `${file.md5}/${file.name.toLowerCase()}`;
        let url = this._dataURLCache.get(key);
        if (!url) {
            const mimeType = this.runtime.fileManager.getMimeType(file.name);
            url = `data:${mimeType};base64,${Base64Util.uint8ArrayToBase64(file.data)}`;
            this._dataURLCache.set(key, url);
        }
        return url;
    }

    fileSize (args) {
        const file = this._getFile(args);
        return file ? file.size : 0;
    }
}

module.exports = Scratch3FilesBlocks;

const KINDS = {
    image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'],
    model: ['glb', 'gltf'],
    audio: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'],
    video: ['mp4', 'webm'],
    text: ['txt', 'json', 'csv', 'md', 'js', 'css', 'html', 'xml', 'yaml', 'yml', 'obj', 'mtl']
};

/**
 * @param {string} name File name, including extension
 * @returns {'image'|'model'|'audio'|'video'|'text'|'other'} How the Files tab should show the file
 */
export const getFileKind = name => {
    const dot = name.lastIndexOf('.');
    const ext = dot === -1 ? '' : name.substring(dot + 1).toLowerCase();
    for (const [kind, extensions] of Object.entries(KINDS)) {
        if (extensions.includes(ext)) return kind;
    }
    return 'other';
};

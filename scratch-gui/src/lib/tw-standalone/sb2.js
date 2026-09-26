/* eslint-disable import/no-commonjs */

// tw: stands in for scratch-vm's serialization/sb2.js in the exported player, which never loads Scratch 2 projects.

const unsupported = () => Promise.reject(new Error('Scratch 2 projects are not supported here'));

module.exports = {
    deserialize: unsupported
};

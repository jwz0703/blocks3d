/* eslint-disable import/no-commonjs */

// tw: stands in for scratch-sb1-converter in the exported player, which never loads Scratch 1 projects.
// virtual-machine.js treats ValidationError as "not a Scratch 1 project".

class ValidationError extends Error {}

class SB1File {
    constructor () {
        throw new ValidationError('Scratch 1 projects are not supported here');
    }
}

module.exports = {
    SB1File,
    ValidationError
};

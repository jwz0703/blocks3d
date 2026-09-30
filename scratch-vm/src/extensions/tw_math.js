const ArgumentType = require('../extension-support/argument-type');
const BlockType = require('../extension-support/block-type');
const Cast = require('../util/cast');

const number = defaultValue => ({type: ArgumentType.NUMBER, defaultValue});

/**
 * @param {number} value
 * @returns {number} the value without floating point noise, like Scratch's own trigonometry
 */
const clean = value => Math.round(value * 1e10) / 1e10;

/**
 * Math that Scratch doesn't have (ROADMAP.md 9, 旋轉與數學): atan2, keeping a value in a range, the smaller and
 * larger of two values, and going part of the way from one value to another. Built in: shown at the end of
 * Operators. Angles are in degrees, like the other blocks.
 */
class Scratch3MathBlocks {
    getInfo () {
        return {
            id: 'twmath',
            name: '數學',
            color1: '#59C059',
            color2: '#46B946',
            color3: '#389438',
            blocks: [
                {
                    opcode: 'atan2',
                    blockType: BlockType.REPORTER,
                    text: 'atan2 y:[Y] x:[X]',
                    arguments: {Y: number(1), X: number(1)}
                },
                {
                    opcode: 'clamp',
                    blockType: BlockType.REPORTER,
                    text: '把 [VALUE] 限制在 [MIN] 到 [MAX]',
                    arguments: {VALUE: number(''), MIN: number(0), MAX: number(100)}
                },
                {
                    opcode: 'min',
                    blockType: BlockType.REPORTER,
                    text: '[A] 和 [B] 較小的',
                    arguments: {A: number(''), B: number('')}
                },
                {
                    opcode: 'max',
                    blockType: BlockType.REPORTER,
                    text: '[A] 和 [B] 較大的',
                    arguments: {A: number(''), B: number('')}
                },
                {
                    opcode: 'lerp',
                    blockType: BlockType.REPORTER,
                    text: '從 [A] 到 [B] 的 [T] 處',
                    arguments: {A: number(0), B: number(10), T: number(0.5)}
                }
            ]
        };
    }

    /**
     * @param {object} args Y, X
     * @returns {number} the direction of the point (x, y) from the x axis, in degrees from -180 to 180
     */
    atan2 (args) {
        return clean(Math.atan2(Cast.toNumber(args.Y), Cast.toNumber(args.X)) * 180 / Math.PI);
    }

    /**
     * @param {object} args VALUE, MIN, MAX (either order)
     * @returns {number} the value, or the nearest end of the range if it is outside
     */
    clamp (args) {
        const a = Cast.toNumber(args.MIN);
        const b = Cast.toNumber(args.MAX);
        return Math.min(Math.max(Cast.toNumber(args.VALUE), Math.min(a, b)), Math.max(a, b));
    }

    min (args) {
        return Math.min(Cast.toNumber(args.A), Cast.toNumber(args.B));
    }

    max (args) {
        return Math.max(Cast.toNumber(args.A), Cast.toNumber(args.B));
    }

    /**
     * @param {object} args A, B, T
     * @returns {number} A when T is 0, B when T is 1, in between (or beyond) otherwise
     */
    lerp (args) {
        const a = Cast.toNumber(args.A);
        const b = Cast.toNumber(args.B);
        return clean(a + ((b - a) * Cast.toNumber(args.T)));
    }
}

module.exports = Scratch3MathBlocks;

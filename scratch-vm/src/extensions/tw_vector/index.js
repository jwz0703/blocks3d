const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');
const DataPath = require('../../util/data-path');

/**
 * 向量: vectors as objects {x, y, z}, e.g. the position of a 3D sprite ("[sprite] 的 [位置]") or what "移到位置 ()"
 * takes. Vectors can also be JSON text like {"x": 1} or arrays [x, y, z]; missing parts are 0.
 * An extension from the extension library, not built in.
 */
class VectorBlocks {
    getInfo () {
        const vector = {type: ArgumentType.STRING, defaultValue: ''};
        const block = (opcode, text, args) => ({
            opcode, blockType: BlockType.REPORTER, text, arguments: args, disableMonitor: true
        });
        return {
            id: 'twvector',
            name: '向量',
            color1: '#5B67E6',
            color2: '#4D58CF',
            color3: '#3F48B8',
            blocks: [
                block('vector', '向量 x:[X] y:[Y] z:[Z]', {
                    X: {type: ArgumentType.NUMBER, defaultValue: 0},
                    Y: {type: ArgumentType.NUMBER, defaultValue: 0},
                    Z: {type: ArgumentType.NUMBER, defaultValue: 0}
                }),
                block('add', '[A] + [B]', {A: vector, B: vector}),
                block('subtract', '[A] - [B]', {A: vector, B: vector}),
                block('scale', '[A] × [N]', {A: vector, N: {type: ArgumentType.NUMBER, defaultValue: 2}}),
                '---',
                block('length', '[A] 的長度', {A: vector}),
                block('distance', '[A] 到 [B] 的距離', {A: vector, B: vector}),
                block('normalize', '[A] 的單位向量', {A: vector}),
                block('dot', '[A] 和 [B] 的內積', {A: vector, B: vector}),
                block('cross', '[A] 和 [B] 的外積', {A: vector, B: vector}),
                block('component', '[A] 的 [AXIS]', {
                    A: vector,
                    AXIS: {type: ArgumentType.STRING, menu: 'axis', defaultValue: 'x'}
                })
            ],
            menus: {
                axis: {
                    acceptReporters: false,
                    items: ['x', 'y', 'z']
                }
            }
        };
    }

    vector (args) {
        return DataPath.vectorOf(Cast.toNumber(args.X), Cast.toNumber(args.Y), Cast.toNumber(args.Z));
    }

    add (args) {
        const a = DataPath.toVector(args.A);
        const b = DataPath.toVector(args.B);
        return DataPath.vectorOf(a.x + b.x, a.y + b.y, a.z + b.z);
    }

    subtract (args) {
        const a = DataPath.toVector(args.A);
        const b = DataPath.toVector(args.B);
        return DataPath.vectorOf(a.x - b.x, a.y - b.y, a.z - b.z);
    }

    scale (args) {
        const a = DataPath.toVector(args.A);
        const n = Cast.toNumber(args.N);
        return DataPath.vectorOf(a.x * n, a.y * n, a.z * n);
    }

    length (args) {
        const a = DataPath.toVector(args.A);
        return Math.sqrt((a.x * a.x) + (a.y * a.y) + (a.z * a.z));
    }

    distance (args) {
        return this.length({A: this.subtract(args)});
    }

    normalize (args) {
        const a = DataPath.toVector(args.A);
        const length = this.length({A: a});
        return length === 0 ? DataPath.vectorOf(0, 0, 0) : DataPath.vectorOf(a.x / length, a.y / length, a.z / length);
    }

    dot (args) {
        const a = DataPath.toVector(args.A);
        const b = DataPath.toVector(args.B);
        return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
    }

    cross (args) {
        const a = DataPath.toVector(args.A);
        const b = DataPath.toVector(args.B);
        return DataPath.vectorOf((a.y * b.z) - (a.z * b.y), (a.z * b.x) - (a.x * b.z), (a.x * b.y) - (a.y * b.x));
    }

    component (args) {
        const a = DataPath.toVector(args.A);
        return ['x', 'y', 'z'].includes(args.AXIS) ? a[args.AXIS] : 0;
    }
}

module.exports = VectorBlocks;

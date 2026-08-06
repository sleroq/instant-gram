import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateInlineMediaBox } from './inline-media-box.ts';

function assertBoxClose(
    actual: { width: number; height: number },
    expected: { width: number; height: number },
    tolerance = 1e-10,
) {
    assert.ok(Math.abs(actual.width - expected.width) <= tolerance, JSON.stringify({ actual, expected }));
    assert.ok(Math.abs(actual.height - expected.height) <= tolerance, JSON.stringify({ actual, expected }));
}

test('inline media box preserves canonical geometry', () => {
    assert.deepEqual(calculateInlineMediaBox(9, 16), { width: 168.75, height: 300 });
    assert.deepEqual(calculateInlineMediaBox(1, 1), { width: 300, height: 300 });
    assert.deepEqual(calculateInlineMediaBox(16, 9), { width: 300, height: 168.75 });
    assert.deepEqual(calculateInlineMediaBox(1, 10), { width: 30, height: 300 });
    assert.deepEqual(calculateInlineMediaBox(10, 1), { width: 300, height: 30 });
});

test('inline media box depends on ratio across practical and extreme finite scales', () => {
    const portrait = calculateInlineMediaBox(9, 16);
    assertBoxClose(calculateInlineMediaBox(540, 960), portrait);
    assertBoxClose(calculateInlineMediaBox(9e-300, 16e-300), portrait);
    assertBoxClose(calculateInlineMediaBox(9e306, 16e306), portrait);

    const half = calculateInlineMediaBox(1, 2);
    assertBoxClose(calculateInlineMediaBox(1e-300, 2e-300), half);
    assertBoxClose(calculateInlineMediaBox(5e307, 1e308), half);

    assert.deepEqual(
        calculateInlineMediaBox(Number.MIN_VALUE, Number.MAX_VALUE),
        calculateInlineMediaBox(Number.MIN_VALUE * 2, Number.MAX_VALUE / 2),
    );
});

test('inline media box floors browser-unrenderable axes at exactly one CSS pixel', () => {
    assert.deepEqual(calculateInlineMediaBox(Number.MIN_VALUE, Number.MAX_VALUE), {
        width: 1,
        height: 300,
    });
    assert.deepEqual(calculateInlineMediaBox(Number.MAX_VALUE, Number.MIN_VALUE), {
        width: 300,
        height: 1,
    });
    assert.deepEqual(calculateInlineMediaBox(1 / 300, 1), { width: 1, height: 300 });
    assert.deepEqual(calculateInlineMediaBox(1, 1 / 300), { width: 300, height: 1 });
});

test('inline media box remains finite, positive, bounded, and monotonic over logarithmic ratios', () => {
    const dimensions: Array<[number, number]> = [
        [Number.MIN_VALUE, Number.MIN_VALUE],
        [Number.MAX_VALUE, Number.MAX_VALUE],
        [Number.MIN_VALUE, Number.MAX_VALUE],
        [Number.MAX_VALUE, Number.MIN_VALUE],
        ...Array.from({ length: 161 }, (_, index): [number, number] => {
            const exponent = -320 + index * 4;
            return exponent <= 0 ? [10 ** exponent, 1] : [1, 10 ** -exponent];
        }),
    ];

    let previousWidth = 0;
    let previousHeight = Number.POSITIVE_INFINITY;
    for (const [width, height] of dimensions.slice(4)) {
        const box = calculateInlineMediaBox(width, height);
        assert.ok(Number.isFinite(box.width) && box.width > 0 && box.width <= 300, JSON.stringify({ width, height, box }));
        assert.ok(Number.isFinite(box.height) && box.height > 0 && box.height <= 300, JSON.stringify({ width, height, box }));
        assert.ok(box.width >= previousWidth, JSON.stringify({ width, height, box, previousWidth }));
        assert.ok(box.height <= previousHeight, JSON.stringify({ width, height, box, previousHeight }));
        previousWidth = box.width;
        previousHeight = box.height;
    }

    for (const [width, height] of dimensions.slice(0, 4)) {
        const box = calculateInlineMediaBox(width, height);
        assert.ok(Number.isFinite(box.width) && box.width > 0 && box.width <= 300);
        assert.ok(Number.isFinite(box.height) && box.height > 0 && box.height <= 300);
    }
});

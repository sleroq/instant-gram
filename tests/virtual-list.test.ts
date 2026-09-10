import assert from 'node:assert/strict';
import test from 'node:test';
import { computeChatWindow } from '../entrypoints/ui/virtual-list.ts';

test('chat window remains bounded and follows fixed-row scrolling', () => {
    assert.deepEqual(computeChatWindow(0, 1_000), { start: 0, end: 31 });
    const window = computeChatWindow(72 * 800, 1_000);
    assert.equal(window.start, 797);
    assert.equal(window.end, 828);
    assert.ok(window.end - window.start <= 31);
});

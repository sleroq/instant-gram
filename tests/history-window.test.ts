import assert from 'node:assert/strict';
import test from 'node:test';
import {
    HISTORY_MOUNT_LIMIT,
    HISTORY_SLICE,
    initialHistoryWindow,
    moveNewer,
    moveOlder,
} from '../entrypoints/ui/history-window.ts';

test('history windows consume cached slices without exceeding the mount bound', () => {
    assert.deepEqual(initialHistoryWindow(120), { start: 80, end: 120 });
    assert.deepEqual(moveOlder({ start: 80, end: 120 }), {
        start: 40,
        end: 120,
    });
    assert.deepEqual(moveOlder({ start: 40, end: 120 }), { start: 0, end: 80 });
    assert.deepEqual(moveOlder({ start: 0, end: 80 }), { start: 0, end: 80 });
    assert.deepEqual(moveNewer({ start: 0, end: 40 }, 120), {
        start: 0,
        end: 80,
    });
    assert.ok(HISTORY_SLICE < HISTORY_MOUNT_LIMIT);
});

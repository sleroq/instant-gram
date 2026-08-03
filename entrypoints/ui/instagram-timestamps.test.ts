import assert from 'node:assert/strict';
import test from 'node:test';
import { parseThreadActivityMs } from '../../lib/instagram-timestamps.ts';

test('thread activity parses Instagram numeric strings as epoch milliseconds', () => {
    assert.equal(
        parseThreadActivityMs({
            last_activity_timestamp_ms: '1785755105123',
        }),
        1_785_755_105_123,
    );
    assert.equal(
        parseThreadActivityMs({ last_activity_ms: '1785755105123' }),
        1_785_755_105_123,
    );
});

test('thread activity preserves numeric timestamps and rejects invalid strings', () => {
    assert.equal(
        parseThreadActivityMs({
            last_activity_timestamp_ms: 1_785_755_105_123,
        }),
        1_785_755_105_123,
    );
    assert.equal(
        parseThreadActivityMs({
            last_activity_timestamp_ms: 'not-a-date',
            last_activity_at_ms: '1785755105123',
        }),
        1_785_755_105_123,
    );
    assert.equal(parseThreadActivityMs({ last_activity_at_ms: 'not-a-date' }), 0);
});

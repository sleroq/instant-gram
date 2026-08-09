import assert from 'node:assert/strict';
import test from 'node:test';
import {
    DEFAULT_REEL_VOLUME,
    parseReelVolumePreference,
    readReelVolumePreference,
    writeReelVolumePreference,
} from './reel-volume.ts';

test('persisted reel volume accepts only complete valid preferences', () => {
    assert.deepEqual(parseReelVolumePreference('{"volume":0.35,"muted":true}'), {
        volume: 0.35,
        muted: true,
    });
    assert.equal(parseReelVolumePreference('{"volume":2,"muted":false}'), undefined);
    assert.equal(parseReelVolumePreference('{"volume":0.5}'), undefined);
    assert.equal(parseReelVolumePreference('not-json'), undefined);
});

test('reel volume persistence is best-effort', () => {
    const unavailable = () => { throw new Error('storage unavailable'); };
    assert.deepEqual(readReelVolumePreference(unavailable), DEFAULT_REEL_VOLUME);
    assert.doesNotThrow(() => writeReelVolumePreference({ volume: 0.5, muted: false }, unavailable));
});

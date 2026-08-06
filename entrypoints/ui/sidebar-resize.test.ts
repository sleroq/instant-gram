import assert from 'node:assert/strict';
import test from 'node:test';
import {
    clampSidebarWidth,
    parseSidebarWidth,
    readSidebarWidthPreference,
    removeSidebarWidthPreference,
    sidebarWidthBounds,
    writeSidebarWidthPreference,
} from './sidebar-resize.ts';

test('sidebar width keeps a usable conversation and clamps to desktop limits', () => {
    assert.deepEqual(sidebarWidthBounds(1200), { min: 280, max: 520 });
    assert.equal(clampSidebarWidth(100, 1200), 280);
    assert.equal(clampSidebarWidth(900, 1200), 520);
    assert.deepEqual(sidebarWidthBounds(700), { min: 280, max: 332 });
    assert.deepEqual(sidebarWidthBounds(641), { min: 273, max: 273 });
});

test('persisted sidebar width accepts only finite positive numbers', () => {
    assert.equal(parseSidebarWidth('448'), 448);
    assert.equal(parseSidebarWidth(null), undefined);
    assert.equal(parseSidebarWidth(''), undefined);
    assert.equal(parseSidebarWidth('not-a-number'), undefined);
    assert.equal(parseSidebarWidth('-1'), undefined);
    assert.equal(parseSidebarWidth('Infinity'), undefined);
});

test('sidebar preference storage failures are best-effort', () => {
    const unavailable = () => { throw new Error('storage unavailable'); };
    const throwingStorage = () => ({
        getItem: () => { throw new Error('read denied'); },
        setItem: () => { throw new Error('write denied'); },
        removeItem: () => { throw new Error('remove denied'); },
    });

    assert.equal(readSidebarWidthPreference(unavailable), undefined);
    assert.equal(readSidebarWidthPreference(throwingStorage), undefined);
    assert.doesNotThrow(() => writeSidebarWidthPreference(410, unavailable));
    assert.doesNotThrow(() => writeSidebarWidthPreference(410, throwingStorage));
    assert.doesNotThrow(() => removeSidebarWidthPreference(unavailable));
    assert.doesNotThrow(() => removeSidebarWidthPreference(throwingStorage));
});

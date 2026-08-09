import assert from 'node:assert/strict';
import test from 'node:test';
import { fuzzyMatchScore } from './fuzzy-match.ts';

test('fuzzy chat matching handles initials, subsequences, and accents', () => {
    assert.notEqual(fuzzyMatchScore('Martí Vanyonov martivanyonov', 'm van'), undefined);
    assert.notEqual(fuzzyMatchScore('Design Friends', 'dsgn fr'), undefined);
    assert.equal(fuzzyMatchScore('Design Friends', 'family'), undefined);
    assert.ok(
        fuzzyMatchScore('Martin', 'mart')! > fuzzyMatchScore('Smart Team', 'mart')!,
        'word prefixes should rank ahead of interior matches',
    );
});

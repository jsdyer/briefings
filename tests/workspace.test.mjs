import test from 'node:test';
import assert from 'node:assert/strict';
import { key, readSaved, draftFor } from '../web/workspace.mjs';

const fin = ['FIN-123', 'Real-Time Rail', '', 'Payments', '', 'D', '2023-03-04', 'I', '', '', 'fin'];
const tbs = ['TBS-123', 'Network outage', '', '', '', 'D', '2023-04-03', 'I', '', '', 'tbs'];

test('restores a valid list, rejects malformed entries and removes duplicates', () => {
  assert.deepEqual(readSaved(JSON.stringify([fin, fin, ['bad'], tbs])), [fin, tbs]);
  assert.deepEqual(readSaved('invalid'), []);
  assert.notEqual(key(fin), key(tbs));
});

test('drafts only the requested institution and preserves published references', () => {
  const text = draftFor([fin, tbs], 'fin', 'Finance Canada');
  assert.match(text, /Finance Canada/);
  assert.match(text, /FIN-123/);
  assert.match(text, /fin%2CFIN-123/);
  assert.doesNotMatch(text, /TBS-123|Network outage/);
  assert.equal(draftFor([fin], 'tbs', 'TBS'), '');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceStore } from '../src/workspace-store.js';
const storage = () => {
  const data = new Map();
  return { getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) };
};
test('navigation preserves file, parameters and asynchronous results, refresh restores saved stages without a stuck busy state', async () => {
  const saved = storage();
  const store = createWorkspaceStore(saved, 'alice');
  const file = new Blob(['manuscript']);
  store.set('upload.file', file);
  store.set('parameters.paper.k', 7);
  store.set('busy', 'review-flow');
  const unsubscribe = store.subscribe(() => {});
  unsubscribe(); // Iframe is removed while a request runs.
  await Promise.resolve().then(() => { store.set('project', { id: 'paper', reviewFlow: { journals: [1] } }); store.set('activeStep', 2); store.set('busy', ''); });
  assert.equal(store.get('upload.file'), file);
  assert.equal(store.get('activeStep'), 2);
  const restored = createWorkspaceStore(saved, 'alice');
  assert.equal(restored.get('activeStep'), 2);
  assert.equal(restored.get('parameters.paper.k'), 7);
  assert.equal(restored.get('project').id, 'paper');
  assert.equal(restored.get('upload.file', null), null);
  assert.equal(restored.get('busy', ''), '');
});
test('logout and account switch discard old state and reject late request results', () => {
  const saved = storage();
  let current = 'alice';
  const alice = createWorkspaceStore(saved, 'alice', () => current === 'alice');
  alice.set('project', { id: 'private' });
  current = 'bob';
  alice.set('project', { id: 'late' });
  assert.equal(alice.get('project').id, 'private');
  alice.dispose();
  alice.set('project', { id: 'late' });
  assert.equal(alice.get('project'), undefined);
  assert.equal(saved.getItem('alice'), undefined);
  assert.equal(createWorkspaceStore(saved, 'bob').get('project'), undefined);
});
test('new submission resets the selected manuscript and upload inputs', () => {
  const store = createWorkspaceStore(storage(), 'alice');
  store.set('upload.file', new Blob(['draft']));
  store.set('upload.keywords', 'old keywords');
  store.resetUpload();
  assert.equal(store.get('upload.file', null), null);
  assert.equal(store.get('upload.keywords', ''), '');
});

test('rebuttal draft persists but revision files remain only in memory', () => {
  const saved = storage();
  const store = createWorkspaceStore(saved, 'alice');
  const file = new Blob(['revised paper']);
  store.set('rebuttal.paper.comments', 'Reviewer 1: methods');
  store.set('rebuttal.paper.file', file);
  store.set('activeStep', 4);
  assert.equal(store.get('rebuttal.paper.file'), file);
  const restored = createWorkspaceStore(saved, 'alice');
  assert.equal(restored.get('rebuttal.paper.comments'), 'Reviewer 1: methods');
  assert.equal(restored.get('activeStep'), 4);
  assert.equal(restored.get('rebuttal.paper.file', null), null);
});

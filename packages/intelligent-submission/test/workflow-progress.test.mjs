import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { withAccount } from '../server/lib/store.mjs';
import { trackWorkflow, workflowProgress, workflowStage, workflowSignal } from '../server/lib/workflow-progress.mjs';
test('workflow progress is tenant scoped, blocks duplicates and cancels on disconnect', async () => {
  const res = new EventEmitter();
  let signal;
  try {
    withAccount('alice', () => trackWorkflow({ params: { id: 'same-id' } }, res, () => {
      workflowStage('scoring 1/5');
      signal = workflowSignal(new AbortController().signal);
      assert.equal(workflowProgress('same-id').message, 'scoring 1/5');
    }));
    withAccount('bob', () => assert.equal(workflowProgress('same-id').running, false));
    let status;
    withAccount('alice', () => trackWorkflow({ params: { id: 'same-id' } }, { status(code) { status = code; return this; }, json() {} }, () => assert.fail('must not run twice')));
    assert.equal(status, 409);
    res.emit('close');
    assert.equal(signal.aborted, true);
    withAccount('alice', () => assert.equal(workflowProgress('same-id').running, false));
  } finally { res.emit('close'); }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { getOpenAlexStatus, searchJournalSources } from '../server/lib/scholarly-search.mjs';

test('missing, empty and whitespace OpenAlex keys reject before any network request', async () => {
  const previous = process.env.OPENALEX_API_KEY;
  process.env.OPENALEX_API_KEY = 'ambient-test-key';
  try {
    for (const env of [{}, { OPENALEX_API_KEY: '' }, { OPENALEX_API_KEY: '   ' }]) {
      assert.equal(getOpenAlexStatus(env).configured, false);
      let calls = 0;
      await assert.rejects(searchJournalSources('biology', {
        env,
        fetchImpl: async () => { calls += 1; throw new Error('unexpected network request'); },
      }), /OPENALEX_API_KEY/);
      assert.equal(calls, 0);
    }
  } finally {
    if (previous === undefined) delete process.env.OPENALEX_API_KEY;
    else process.env.OPENALEX_API_KEY = previous;
  }
});

test('OpenAlex uses the injected key without exposing it in public status', async () => {
  const env = { OPENALEX_API_KEY: '  injected-test-key  ' };
  assert.equal(getOpenAlexStatus(env).configured, true);
  assert.equal(JSON.stringify(getOpenAlexStatus(env)).includes('injected-test-key'), false);
  let calls = 0;
  await searchJournalSources('biology', {
    env,
    fetchImpl: async (url) => {
      calls += 1;
      assert.equal(url.searchParams.get('api_key'), 'injected-test-key');
      return { ok: true, json: async () => ({ results: [] }) };
    },
  });
  assert.equal(calls, 1);
});

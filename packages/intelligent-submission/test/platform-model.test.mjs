import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { withPlatformModel } from '../server/lib/platform-model.mjs';
import { callDeepSeekJson, getDeepSeekStatus } from '../server/lib/deepseek.mjs';

test('platform model calls retain per-request model, workspace and authentication', async () => {
  const received = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    received.push({ body, auth: req.headers.authorization, url: req.url });
    await new Promise(resolve => setTimeout(resolve, body.modelID === 'first' ? 25 : 1));
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({ text: JSON.stringify({ chosen: body.modelID }), model: body.modelID, provider: body.providerID }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const upstream = `http://127.0.0.1:${server.address().port}`;
    const results = await Promise.all(['first','second'].map(modelID => withPlatformModel({ upstream,
      authorization: `Basic ${modelID}`, model: { modelID, providerID: 'onescience', directory: `/workspace/${modelID}` }
    }, () => callDeepSeekJson([{ role: 'user', content: 'Return JSON.' }], { env: { DEEPSEEK_API_KEY: 'must-not-be-used' } }))));
    assert.deepEqual(results.map(result => result.data.chosen), ['first','second']);
    for (const item of received) {
      assert.equal(item.auth, `Basic ${item.body.modelID}`);
      assert.equal(new URL(item.url, upstream).searchParams.get('directory'), `/workspace/${item.body.modelID}`);
      assert.equal(item.body.providerID, 'onescience');
      assert.equal(item.body.apiKey, undefined);
    }
    assert.equal(results[0].trace.source, 'platform');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('missing platform selection never falls back to independent DeepSeek credentials', async () => {
  await withPlatformModel({ upstream: 'http://127.0.0.1:1', authorization: 'Basic test' }, async () => {
    assert.equal(getDeepSeekStatus({ DEEPSEEK_API_KEY: 'configured' }).configured, false);
    await assert.rejects(callDeepSeekJson([], { env: { DEEPSEEK_API_KEY: 'configured' } }), /选择模型/);
  });
});

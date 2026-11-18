import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { extractDocument } from '../server/lib/extractor.mjs';
import { withPlatformModel } from '../server/lib/platform-model.mjs';

const title = 'Thermal Stability and Sublimation Pressures of Some Ruthenocene Compounds';
const abstract = 'We study the thermal stability of ruthenocene compounds including (η5-C5H4R)(η5-C5H4R′)Ru. Measurements using a Knudsen cell show that compound 11 has the highest vapor pressure.';
const file = { originalname: 'paper.txt', buffer: Buffer.from(`${title}\nAbstract: ${abstract}\nKeywords: ruthenocene; thermal stability\n1 Introduction\nBody`) };

async function platform(handler, run) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    return await withPlatformModel({ upstream: `http://127.0.0.1:${server.address().port}`, authorization: 'Basic test', model: { providerID: 'configured-provider', modelID: 'configured-model' } }, run);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

test('always uses selected platform model before accepting local metadata', async () => {
  let calls = 0;
  await platform(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const request = JSON.parse(raw);calls++;
    assert.equal(request.modelID, 'configured-model');
    assert.equal(request.providerID, 'configured-provider');
    assert.ok(request.messages[1].content.includes('highest vapor pressure'));
    res.end(JSON.stringify({ text: JSON.stringify({ title, abstract }), model: request.modelID }));
  }, async () => {
    const result = await extractDocument(file);
    assert.equal(result.title, title);
    assert.equal(result.abstract, abstract);
    assert.equal(result.metadataExtraction.method, 'system-model');
  });
  assert.equal(calls, 1);
});

for (const mode of ['http-error', 'invalid-json', 'hallucinated', 'partial']) {
  test(`local metadata survives ${mode}`, async () => {
    await platform((_req, res) => {
      if (mode === 'http-error') {res.writeHead(503);res.end();return;}
      const output = mode === 'invalid-json' ? 'not-json' : JSON.stringify(mode === 'hallucinated'
        ? {title:'Invented clinical trial of unrelated medicine',abstract:'Patients receiving imaginary treatment experience dramatic recovery with no supporting information in this manuscript.'}
        : {title,abstract:abstract.slice(0,70)+','});
      res.end(JSON.stringify({text:output}));
    }, async () => {
      const result=await extractDocument(file);
      assert.equal(result.metadataExtraction.method,'local');
      assert.equal(result.abstract,abstract);
    });
  });
}

test('unresponsive model times out and falls back', async () => {
  await platform(() => {}, async () => {
    const result=await extractDocument(file,{timeoutMs:30});
    assert.equal(result.metadataExtraction.status,'fallback');
    assert.equal(result.abstract,abstract);
  });
});

test('unconfigured model returns local extraction without a network call', async () => {
  await withPlatformModel({upstream:'http://127.0.0.1:1'},async () => {
    const result=await extractDocument(file);
    assert.equal(result.metadataExtraction.reason,'model-unavailable');
    assert.equal(result.abstract,abstract);
  });
});

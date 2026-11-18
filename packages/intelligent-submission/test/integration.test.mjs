import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withAccount, saveProject, listProjects } from '../server/lib/store.mjs';

const listen = async (server) => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
};

test('gateway authenticates uploads, isolates accounts, persists edits and exposes the existing review workflow', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'submission-test-'));
  process.env.SUBMISSION_STORAGE_DIR = path.join(dir, 'storage');
  process.env.DEEPSEEK_API_KEY = '';
  process.env.OPENALEX_API_KEY = '';
  process.env.NODE_ENV = 'production';
  const sources = [1, 2, 3].map((i) => ({ id: `https://openalex.org/S${i}`, display_name: `Test Journal ${i}`, type: 'journal', works_count: 1000, summary_stats: { '2yr_mean_citedness': i * 4 }, x_concepts: [] }));
  const batches = [];
  const modelBatches = [];
  let failRebuttal = false;
  let modelFailureStatus = 503;
  let selectedModel;
  let worksMode = 'normal';
  const upstream = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    response.setHeader('Content-Type', 'application/json');
    const send = (body) => response.end(JSON.stringify(body));
    if (url.pathname === '/provider/submission') {
      if (failRebuttal) { response.statusCode = modelFailureStatus; return send({ error: { message: 'fixture unavailable' } }); }
      let body = ''; for await (const chunk of request) body += chunk;
      const content = JSON.parse(body).messages[1].content;
      if (content.startsWith('评分协议版本：')) {
        const papers = JSON.parse(content.slice(content.indexOf('[')));
        modelBatches.push(papers);
        return send({model:'fixture',provider:'onescience',text:JSON.stringify({evaluations:papers.map((paper,i)=>({paper_id:paper.paper_id,score:80-i*10,rank:i+1,confidence:0.5}))})});
      }
      const input = JSON.parse(content);
      if (input.manuscriptText) return send({ model: 'metadata-fixture', provider: 'onescience', text: JSON.stringify({ title: 'Evidence grounded scientific agents', abstract: 'We propose a reproducible framework for research agents. Experiments on three datasets demonstrate improved accuracy and efficiency compared to existing methods.' }) });
      return send({ model: 'rebuttal-fixture', provider: 'onescience', text: JSON.stringify({ summary: 'Revision plan', items: input.reviewComments.map((comment) => ({ id: comment.id, priority: 'high', location: 'Methods', evidence: 'We propose a reproducible framework for research agents.', suggestion: '补充方法与实验细节', verification: '核实真实实验结果', responseOutline: '拟补充实验说明' })) }) });
    }
    if (url.pathname === '/health' || url.pathname === '/v1/models') return send({ capabilities: ['paper_score_batch'], backend: 'test', active: 'test' });
    if (url.pathname === '/v1/paper-scores') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const batch = JSON.parse(body).papers;
      batches.push(batch);
      return send({ scores: batch.map((paper, i) => ({ paper_id: paper.paper_id, score: 80 - i * 10, raw_score: 2 - i * 0.1, score_method: 'validation_empirical_cdf' })), model_trace: { model: 'integration-test-fixture' } });
    }
    if (url.pathname.startsWith('/sources/')) return send(sources.find((item) => item.id.endsWith(url.pathname.slice(8))));
    if (url.pathname === '/sources') return send({ results: sources.filter((item) => item.display_name === url.searchParams.get('search')) });
    if (url.pathname === '/works') {
      if (worksMode === 'failed') { response.statusCode = 503; return send({}); }
      if (worksMode === 'empty') return send({ results: [] });
      const sourceId = /primary_location.source.id:(S\d+)/.exec(url.searchParams.get('filter') || '')?.[1];
      if (worksMode === 'insufficient' && sourceId === 'S1') return send({results:[]});
      const selected = sourceId ? sources.filter((item) => item.id.endsWith(sourceId)) : sources;
      return send({ results: selected.flatMap((source) => [1, 2].map((i) => ({
        id: `https://openalex.org/W${source.id.slice(-1)}${i}`, display_name: `Scientific agents evidence ${i}`,
        language: 'en', publication_year: new Date().getUTCFullYear(), primary_location: { source }, relevance_score: 80,
        abstract_inverted_index: worksMode === 'insufficient' && sourceId === 'S2' ? { '   ': [0] } : { Scientific: [0], agents: [1], improve: [2], reproducibility: [3], through: [4], controlled: [5], experiments: [6] },
      }))) });
    }
    const token = url.searchParams.get('token');
    if (token === 'unavailable') { response.writeHead(503).end('{}'); return; }
    if (token === 'malformed') { response.end('{}'); return; }
    if (!['alice', 'bob'].includes(token)) { response.writeHead(401).end('{}'); return; }
    response.end(JSON.stringify({ account: { id: token }, expiresAt: Date.now() + 60000 }));
  });
  const upstreamUrl = await listen(upstream);
  const { createGateway, createSubmissionServer } = await import('../server/gateway.mjs');
  // dotenv must not cause tests to send manuscript text to live services.
  process.env.DEEPSEEK_API_KEY = '';
  process.env.OPENALEX_API_KEY = '';
  await mkdir(path.join(dir, 'ui'));
  await writeFile(path.join(dir, 'ui/index.html'), '<html><head></head><body>OneCode</body></html>');
  const gateway = await (process.env.SUBMISSION_TEST_EMBEDDED ? createSubmissionServer : createGateway)({ upstream: upstreamUrl, appDir: path.join(dir, 'ui') });
  const base = await listen(gateway);
  const auth = (account) => ({ Authorization: `Basic ${Buffer.from(`opencode:${account}`).toString('base64')}` });
  const request = (route, options = {}, account = 'alice') => fetch(`${base}/intelligent-submission/api${route}`, { ...options, headers: { ...auth(account), ...(selectedModel ? { 'X-Submission-Model': encodeURIComponent(JSON.stringify(selectedModel)) } : {}), ...options.headers } });
  try {
    assert.equal((await fetch(`${base}/intelligent-submission/api/projects`)).status, 401);
    assert.equal((await request('/projects', {}, 'invalid')).status, 401);
    assert.equal((await fetch(`${base}/intelligent-submission/api/rankers/local`)).status, 401);
    assert.equal((await fetch(`${base}/intelligent-submission/api/rankers/local/ranker-0.6b/test`, {method:'POST'})).status, 401);
    assert.equal((await request('/rankers/local/unknown/test', {method:'POST'})).status, 422);
    assert.equal((await request('/rankers/local/ranker-0.6b/test', {method:'POST',headers:{Origin:'https://other.example'}})).status, 403);
    const localModels = await (await request('/rankers/local')).json();
    assert.equal(localModels.models.length, 3);
    assert.equal(JSON.stringify(localModels).includes('apiKey'), false);
    const installRequest = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({acceptLicense:true}) };
    assert.equal((await request('/rankers/local/unknown/install', installRequest)).status, 422);
    assert.equal((await request('/rankers/local/ranker-0.6b/install', {...installRequest,body:'{}'})).status, 422);
    assert.equal((await request('/rankers/local/ranker-0.6b/install', {...installRequest,headers:{...installRequest.headers,Origin:'https://other.example'}})).status, 403);
    const previousInstallDisabled = process.env.ONECODE_RANKER_INSTALL_DISABLED;
    process.env.ONECODE_RANKER_INSTALL_DISABLED = '1';
    try { assert.equal((await request('/rankers/local/ranker-0.6b/install', installRequest)).status, 409); }
    finally { if(previousInstallDisabled === undefined) delete process.env.ONECODE_RANKER_INSTALL_DISABLED; else process.env.ONECODE_RANKER_INSTALL_DISABLED = previousInstallDisabled; }

    assert.equal((await request('/projects', {}, 'unavailable')).status, 503);
    assert.equal((await request('/projects', {}, 'malformed')).status, 503);
    assert.equal((await request('/projects', { headers: { Authorization: `Basic ${Buffer.from(':alice').toString('base64')}` } })).status, 200);
    assert.equal((await request('/projects', { headers: { Origin: 'https://other.example' } })).status, 403);
    assert.equal((await fetch(`${base}/workspace/capabilities?category=submission`)).status, process.env.SUBMISSION_TEST_EMBEDDED ? 404 : 200);
    const form = new FormData();
    form.append('paper', new Blob(['Title: Evidence grounded scientific agents\nAbstract: We propose a reproducible framework for research agents. Experiments on three datasets demonstrate improved accuracy and efficiency compared to existing methods.\nKeywords: scientific agents, reproducibility, machine learning'], { type: 'text/plain' }), 'paper.txt');
    form.append('useAI', 'false');
    const upload = await request('/analyze', { method: 'POST', body: form });
    assert.equal(upload.status, 201);
    const project = await upload.json();
    assert.ok(project.id);
    assert.equal((await fetch(`${base}/intelligent-submission/api/knowledge`)).status,401);
    const library=await (await request('/knowledge')).json();
    assert.equal(library.length,1);
    assert.equal(library[0].coverage,'full-text');
    assert.equal(library[0].text,undefined);
    assert.deepEqual(await (await request('/knowledge',{},'bob')).json(),[]);
    assert.equal((await request(`/knowledge/${library[0].id}`,{},'bob')).status,404);
    assert.equal((await request(`/knowledge/${library[0].id}`,{method:'DELETE'},'bob')).status,404);
    assert.ok((await (await request(`/knowledge/${library[0].id}`)).json()).text.includes('reproducible'));
    assert.equal((await request(`/projects/${project.id}/knowledge-analysis`,{method:'POST'},'bob')).status,404);

    assert.equal(project.profile.targetLanguage, 'en');
    const invalidLanguage = await request(`/projects/${project.id}/review-flow`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetLanguage: 'invalid' }) });
    assert.equal(invalidLanguage.status, 422);
    assert.equal(project.document.text, undefined);
    assert.equal((await (await request('/projects')).json()).length, 1);
    assert.deepEqual(await (await request('/projects', {}, 'bob')).json(), []);
    assert.equal((await request(`/projects/${project.id}`, {}, 'bob')).status, 404);
    const patch = await request(`/projects/${project.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Updated manuscript title' }) });
    assert.equal(patch.status, 200);
    assert.equal((await patch.json()).name, 'Updated manuscript title');
    const run = await request(`/projects/${project.id}/review-flow`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k: 3, n: 2, useAI: false }) });
    // Missing scholarly credentials must be explicit, never produce fabricated journals.
    const result = await run.json();
    assert.equal(run.status, 422);
    assert.match(result.error, /OpenAlex|检索/);
    process.env.OPENALEX_API_KEY = 'test-fixture';
    process.env.OPENALEX_BASE_URL = upstreamUrl;
    process.env.RANKER_8B_SERVICE_URL = upstreamUrl;
    const flowRequest = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ useAI: false }) };
    worksMode = 'failed';
    const unavailable = await request(`/projects/${project.id}/review-flow`, flowRequest);
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).code, 'SCHOLARLY_SERVICE_UNAVAILABLE');
    worksMode = 'empty';
    const empty = await request(`/projects/${project.id}/review-flow`, flowRequest);
    assert.equal(empty.status, 422);
    assert.equal((await empty.json()).code, 'NO_MATCHING_JOURNALS');
    worksMode = 'normal';
    const scored = await request(`/projects/${project.id}/review-flow`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k: 3, n: 2, scoringModel: 'ranker-8b', useAI: false }) });
    assert.equal(scored.status, 200);
    const report = (await scored.json()).reviewFlow;
    assert.equal(report.journals.length, 3);
    assert.equal(report.hyperparameters.targetLanguage, 'en');
    assert.equal(batches.length, 3);
    assert.ok(batches.every((batch) => batch.length === 3 && batch.every((paper) => !('text' in paper))));
    assert.ok(report.journals.every((journal) => journal.referencePapers.length === 2 && journal.comparison.benchmarkVerdict === 'above_recent_baseline'));
    const reloaded = await (await request(`/projects/${project.id}`)).json();
    assert.equal(reloaded.reviewFlow.journals.length, 3);
    // Existing papers without a Keywords section still reach actual batch scoring.
    await withAccount('alice', () => saveProject({ ...reloaded,
      document: { ...reloaded.document, keywords: [] },
      profile: { ...reloaded.profile, keywords: [], researchField: '' },
      aiAnalysis: { status: 'error' },
    }));
    const batchCount = batches.length;
    const withoutKeywords = await request(`/projects/${project.id}/review-flow`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scoringModel: 'ranker-8b', useAI: false, k: 2, n: 1 }),
    });
    assert.equal(withoutKeywords.status, 200);
    const inferred = (await withoutKeywords.json()).reviewFlow;
    assert.ok(inferred.keywords.length > 0);
    assert.equal(batches.length, batchCount + 2);
    assert.ok(inferred.journals.every(journal => journal.manuscriptScore.modelTrace));
    await withAccount('alice', () => saveProject(reloaded));
    const reviewRequest = (comments = 'Reviewer 1: clarify methods.\n\nReviewer 2: add baselines.') => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comments }) });
    assert.equal((await request(`/projects/${project.id}/rebuttal`, reviewRequest(), 'bob')).status, 404);
    assert.equal((await request(`/projects/${project.id}/rebuttal`, reviewRequest(''))).status, 400);
    assert.equal((await request(`/projects/${project.id}/rebuttal`, reviewRequest())).status, 503);
    process.env.DEEPSEEK_API_KEY = 'fixture';
    process.env.DEEPSEEK_BASE_URL = upstreamUrl;
    selectedModel = { providerID: 'onescience', modelID: 'fixture-model' };
    const revision = await request(`/projects/${project.id}/rebuttal`, reviewRequest());
    assert.equal(revision.status, 200);
    const revised = await revision.json();
    assert.equal(revised.rebuttal.items.length, 2);
    assert.ok(revised.rebuttal.items[0].evidence);
    assert.equal(revised.reviewFlow.journals.length, 3);
    assert.equal(revised.document.text, undefined);
    worksMode = 'insufficient';
    const partial = await request(`/projects/${project.id}/review-flow`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({k:3,n:2,useAI:false}) });
    assert.equal(partial.status,200);
    const partialReport = (await partial.json()).reviewFlow;
    assert.equal(partialReport.scoring.model,'deepseek');
    assert.equal(partialReport.journals.length,3);
    assert.equal(modelBatches.length,1);
    assert.equal(modelBatches[0].length,3);
    const skipped = partialReport.journals.filter(item=>item.scoringError?.includes('暂不进行批量评分'));
    assert.equal(skipped.length,2);
    assert.ok(skipped.every(item=>item.manuscriptScore.score === null && item.comparison.benchmarkVerdict === 'insufficient_reference_data' && item.comparison.scoreDelta === null));
    assert.ok(partialReport.journals.some(item=>item.manuscriptScore.modelTrace));
    assert.equal((await (await request(`/projects/${project.id}`)).json()).reviewFlow.journals.length,3);
    worksMode = 'normal';
    failRebuttal = true;
    process.env.RANKER_3B_SERVICE_URL = upstreamUrl;
    process.env.RANKER_06B_SERVICE_URL = upstreamUrl;
    modelFailureStatus = 400;
    for (const scoringModel of ['ranker-8b', 'ranker-3b', 'ranker-0.6b']) {
      const count = batches.length;
      const recovered = await request(`/projects/${project.id}/review-flow`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scoringModel, k: 2, n: 1 }),
      });
      assert.equal(recovered.status, 200);
      const fallback = (await recovered.json()).reviewFlow;
      assert.match(fallback.discovery.llmError, /HTTP 400/);
      assert.equal(fallback.discovery.method, 'openalex-web-discovery+keyword-fallback');
      assert.ok(fallback.discovery.searchQueries.length);
      assert.equal(fallback.scoring.model, scoringModel);
      assert.equal(batches.length, count + 2);
      assert.ok(fallback.journals.every(journal => journal.manuscriptScore.modelTrace));
    }
    modelFailureStatus = 503;
    const before = batches.length;
    const failedFlow = await request(`/projects/${project.id}/review-flow`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scoringModel: 'deepseek' }) });
    assert.equal(failedFlow.status, 400);
    assert.match((await failedFlow.json()).error, /系统模型调用失败/);
    assert.equal(batches.length, before);
    assert.equal((await (await request(`/projects/${project.id}/review-progress`)).json()).running, false);
    assert.equal((await request(`/projects/${project.id}/review-progress`, {}, 'bob')).status, 404);
    assert.equal((await request(`/projects/${project.id}/rebuttal`, reviewRequest())).status, 400);
    const persisted = await (await request(`/projects/${project.id}`)).json();
    assert.deepEqual(persisted.rebuttal, revised.rebuttal);
    failRebuttal = false;
    await withAccount('alice', () => saveProject({ id: 'historical', name: 'Old paper', document: { title: 'Old paper' } }));
    assert.equal((await request('/projects/historical/rebuttal', reviewRequest())).status, 422);
    const replacement = new FormData();
    replacement.append('comments', 'Explain methods');
    replacement.append('paper', new Blob(['Title: Revision\nAbstract: We propose a reproducible framework for research agents. Controlled experiments evaluate three public datasets and compare multiple baselines with documented evaluation procedures.']), 'revision.txt');
    const recovered = await request('/projects/historical/rebuttal', { method: 'POST', body: replacement });
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.json()).rebuttal.manuscript.filename, 'revision.txt');
    assert.equal((await request(`/knowledge/${library[0].id}`,{method:'DELETE'})).status,200);
    assert.equal((await request(`/knowledge/${library[0].id}`)).status,404);
    assert.ok(!(await (await request('/knowledge')).json()).some(item=>item.id===library[0].id));
    assert.equal((await request('/not-a-route')).status, 404);
    await withAccount('alice', () => Promise.all(Array.from({ length: 8 }, (_, i) => saveProject({ id: `parallel-${i}`, name: `Paper ${i}` }))));
    assert.equal((await withAccount('alice', listProjects)).length, 10);
    assert.equal((await withAccount('bob', listProjects)).length, 0);
  } finally {
    await new Promise((resolve) => gateway.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

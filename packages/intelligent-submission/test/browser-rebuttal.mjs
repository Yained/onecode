// Run after npm run build; uses isolated local services and no real model API.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../app/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const dir = await mkdtemp(path.join(tmpdir(), 'rebuttal-browser-'));
const listen = async (server) => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; };
process.env.NODE_ENV = 'production';
process.env.SUBMISSION_STORAGE_DIR = path.join(dir, 'storage');
process.env.DEEPSEEK_API_KEY = 'fixture';
process.env.OPENALEX_API_KEY = '';
const requestedModels = [];
const upstream = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Content-Type', 'application/json');
  const send = (data) => res.end(JSON.stringify(data));
  if (url.pathname === '/platform/auth/session' && url.searchParams.get('token') === 'browser-fixture') return send({ account: { id: 'test-author' }, expiresAt: Date.now() + 600000 });
  if (url.pathname === '/provider/submission') {
    let body = ''; for await (const chunk of req) body += chunk;
    requestedModels.push(JSON.parse(body).modelID);
    const content = JSON.parse(body).messages[1].content;
    if (content.includes('私有检索资料：')) {
      const sources = JSON.parse(content.split('私有检索资料：')[1]);
      return send({model:'fixture',provider:'onescience',text:JSON.stringify({knowledge_notes:[{sourceId:sources[0].id,quote:'Scientific agents use documented baselines.',relationship:'同样关注科研智能体评估',suggestion:'建议在相关工作中对比基线设置。',keywords:['科研智能体']} ]})});
    }
    const input = JSON.parse(content);
    await new Promise(resolve => setTimeout(resolve, 1200));
    return send({ model: JSON.parse(body).modelID, provider: 'onescience', text: JSON.stringify({ summary: '先补充实验设计，再说明局限。', items: input.reviewComments.map((comment) => ({ id: comment.id, priority: 'high', location: 'Methods', evidence: 'We evaluated three datasets.', suggestion: '补充数据集划分与基线配置，报告真实实验结果。', verification: '核实实验日志和样本数量。', responseOutline: '拟在方法章节补充实验设计说明。' })) }) });
  }
  if (url.pathname === '/health' || url.pathname === '/v1/models') return send({ capabilities: ['paper_score_batch'], active: 'fixture' });
  res.statusCode = 401; send({});
});
const upstreamUrl = await listen(upstream);
process.env.DEEPSEEK_BASE_URL = upstreamUrl;
for (const model of ['8B', '3B', '0_6B']) process.env[`RANKER_${model}_SERVICE_URL`] = upstreamUrl;
await mkdir(path.join(dir, 'ui'));
await writeFile(path.join(dir, 'ui/index.html'), `<!doctype html><meta charset="utf-8"><style>body{margin:0}iframe{width:100%;height:1400px;border:0}</style><button id="away" onclick="document.querySelector('iframe')?.remove()">其他页面</button><button id="back" onclick="mount()">返回投稿</button><script>
localStorage.setItem('onecode.settings.dat:platformAuthToken','browser-fixture');
localStorage.setItem('onecode.settings.dat:platformAuthSession',JSON.stringify({token:'browser-fixture',account:{id:'test-author'},expiresAt:Date.now()+600000}));
sessionStorage.setItem('onescience.submission-model:test-author',JSON.stringify({providerID:'onescience',modelID:'first-model',name:'First model'}));
function mount(){const frame=document.createElement('iframe');frame.src='/intelligent-submission/?embed=1';document.body.append(frame)}mount();</script>`);
const { createGateway } = await import('../server/gateway.mjs');
const gateway = await createGateway({ upstream: upstreamUrl, appDir: path.join(dir, 'ui') });
const base = await listen(gateway);
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || path.resolve('../../.dev-logs/browser/chrome-linux64/chrome'), args: ['--no-sandbox'], headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  const frame = () => page.frameLocator('iframe');
  await frame().getByText(/当前模型：First model/).waitFor();
  await page.evaluate(() => { sessionStorage.setItem('onescience.submission-model:test-author', JSON.stringify({providerID:'onescience',modelID:'second-model',name:'Second model'})); window.dispatchEvent(new Event('onescience:submission-model-changed')); });
  await frame().getByText(/当前模型：Second model/).waitFor();
  await frame().locator('input[type=file]').setInputFiles({ name: 'paper.txt', mimeType: 'text/plain', buffer: Buffer.from('Title: 面向科研任务的机器学习方法\nAbstract: We evaluated three datasets. This study investigates reproducible research agents with documented baselines and transparent evaluation methods.\nKeywords: scientific agents, evaluation') });
  await frame().locator('label').filter({ has: frame().locator('input[type=checkbox]') }).click();
  assert.equal(await frame().locator('input[type=checkbox]').isChecked(), false);
  let releaseUpload;
  const uploadGate = new Promise(resolve => { releaseUpload = resolve; });
  await page.route('**/api/analyze', async route => { await uploadGate; await route.continue(); });
  const uploadButton = frame().locator('form button[type=submit]');
  await uploadButton.hover();
  await page.waitForTimeout(250);
  const beforeUpload = await uploadButton.boundingBox();
  await uploadButton.click();
  await frame().getByRole('status').filter({ hasText: '正在上传并解析论文内容' }).waitFor();
  const duringUpload = await uploadButton.boundingBox();
  assert.equal(await uploadButton.isDisabled(), true);
  for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(beforeUpload[key] - duringUpload[key]) < 1, `upload button shifted: ${key}`);
  releaseUpload();
  await frame().getByLabel('目标投稿语言', {exact:true}).waitFor();
  await frame().getByRole('button', {name:'私有知识库',exact:true}).click();
  await frame().getByRole('heading',{name:'私有知识库',exact:true}).waitFor();
  await frame().getByText('1 篇论文',{exact:true}).waitFor();
  await frame().getByLabel('添加知识库论文').setInputFiles({name:'prior.txt',mimeType:'text/plain',buffer:Buffer.from('Title: Scientific agents with transparent evaluation\nAbstract: Scientific agents use documented baselines. Earlier experiments evaluate research reproducibility through transparent methods and public data.\nKeywords: scientific agents, evaluation, reproducibility')});
  await frame().getByRole('button',{name:'添加到知识库',exact:true}).click();
  await frame().getByText('2 篇论文',{exact:true}).waitFor();
  await page.screenshot({path:path.resolve('../../.dev-logs/rebuttal/knowledge-desktop.png'),fullPage:true,animations:'disabled'});
  await frame().getByRole('button',{name:'投稿流程',exact:true}).click();
  await frame().getByRole('button',{name:'结合知识库分析',exact:true}).click();
  await frame().getByText('建议在相关工作中对比基线设置。',{exact:true}).waitFor();
  await page.route('**/api/projects/*/review-progress', route => route.fulfill({ json: { running: true, message: '正在评分第 1/5 本期刊', elapsedSeconds: 12 } }));
  let requestedLanguage;
  await page.route('**/api/projects/*/review-flow', async route => { requestedLanguage = route.request().postDataJSON().targetLanguage; await new Promise(resolve => setTimeout(resolve, 3000)); await route.fulfill({ status: 503, json: { error: '模型测试服务暂时不可用' } }); });
  const language = () => frame().getByLabel('目标投稿语言', { exact: true });
  await language().waitFor();
  assert.equal(await language().inputValue(), 'zh');
  assert.equal(await language().locator('option').count(), 3);
  await language().selectOption('en');
  await page.locator('#away').click(); await page.locator('#back').click();
  await language().waitFor();
  assert.equal(await language().inputValue(), 'en');
  await language().selectOption('all');
  await frame().getByRole('button', { name: '运行当前审稿流程', exact: true }).click();
  await frame().getByRole('status').filter({ hasText: '正在评分第 1/5 本期刊' }).waitFor();
  await frame().getByText('模型测试服务暂时不可用', { exact: true }).waitFor();
  assert.equal(await frame().getByRole('button', { name: '运行当前审稿流程', exact: true }).isEnabled(), true);
  assert.equal(requestedLanguage, 'all');
  await frame().getByRole('button', { name: /Rebuttal 修改建议/ }).click();
  const comments = 'Reviewer 1: 请补充数据集划分。\n\nReviewer 2: 请说明基线配置。';
  await frame().getByLabel('评审意见', { exact: true }).fill(comments);
  await page.locator('#away').click(); await page.locator('#back').click();
  await frame().getByLabel('评审意见', { exact: true }).waitFor();
  assert.equal(await frame().getByLabel('评审意见', { exact: true }).inputValue(), comments);
  await frame().getByRole('button', { name: '生成修改建议', exact: true }).click();
  await frame().getByText('正在逐条分析…', { exact: true }).waitFor();
  await page.locator('#away').click(); await page.locator('#back').click();
  await frame().getByRole('heading', { name: '论文修订计划' }).waitFor({ timeout: 20000 });
  assert.equal(await frame().locator('.rebuttal-item').count(), 2);
  assert.equal(await frame().locator('.rebuttal-item blockquote').first().innerText(), 'Reviewer 1: 请补充数据集划分。');
  const download = page.waitForEvent('download');
  await frame().getByRole('button', { name: '下载修改建议' }).click();
  assert.equal((await download).suggestedFilename(), 'rebuttal-revision-plan.md');
  // Opening a saved project must recover the report from the API, not only UI memory.
  const id = await frame().getByLabel('历史投稿项目').inputValue();
  await frame().getByRole('button', { name: '新建投稿', exact: true }).click();
  await frame().getByLabel('历史投稿项目').selectOption(id);
  await frame().getByRole('heading', { name: '论文修订计划' }).waitFor();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: path.resolve('../../.dev-logs/rebuttal/rebuttal-mobile.png'), fullPage: true, animations: 'disabled' });
  await frame().getByRole('button',{name:'私有知识库',exact:true}).click();
  await frame().getByText('2 篇论文',{exact:true}).waitFor();
  await page.screenshot({path:path.resolve('../../.dev-logs/rebuttal/knowledge-mobile.png'),fullPage:true,animations:'disabled'});
  const inner = page.frames().find(item=>item.url().includes('/intelligent-submission/'));
  assert.ok(await inner.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth));
  await frame().getByRole('button',{name:'删除',exact:true}).first().click();
  await frame().getByRole('button',{name:'确认删除',exact:true}).click();
  await frame().getByText('1 篇论文',{exact:true}).waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(requestedModels, ['second-model','second-model']);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  console.log('PASS: fifth stage, draft navigation, in-flight result recovery, saved report, download, mobile layout');
} catch (error) {
  for (const page of browser?.contexts()[0]?.pages() || []) {
    for (const frame of page.frames()) console.error((await frame.locator("body").innerText().catch(() => "")).slice(0, 1800));
  }
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => gateway.close(resolve));
  await new Promise(resolve => upstream.close(resolve));
  await rm(dir, { recursive: true, force: true });
}

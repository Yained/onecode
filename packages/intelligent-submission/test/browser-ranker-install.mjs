// Run after npm run build; uses isolated local services and no real model API.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../app/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const dir = await mkdtemp(path.join(tmpdir(), 'ranker-install-browser-'));
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
    if (input.manuscriptText) return send({model:'fixture',provider:'onescience',text:JSON.stringify({title:'Research evaluation methods',abstract:'We compare reproducible research methods on several datasets using transparent evaluation protocols.'})});
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
let phase = 'not_installed';
let installs = 0;
const local = () => ({id:'ranker-0.6b',label:'0.6B Ranker',phase,message:phase === 'ready' ? '本地 Ranker 已就绪，评分将在本机进行' : phase === 'error' ? '下载中断，请重试' : phase === 'downloading' ? '正在从魔搭下载基础模型' : '尚未安装本地模型',available:phase==='ready',installed:phase==='ready',busy:phase==='downloading',downloadGB:1.6,diskGB:16,license:'Apache 2.0',licenseUrl:'https://www.modelscope.cn/models/Qwen/Qwen3-0.6B/files',supported:true,enabled:true,location:'运行 OneCode 后端的机器',requirements:'NVIDIA CUDA 显卡',downloadedBytes:phase==='downloading'?300000000:0});
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || path.resolve('../../.dev-logs/browser/chrome-linux64/chrome'), args:['--no-sandbox'], headless:true });
  const page = await browser.newPage({viewport:{width:1440,height:1100}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/model/status',route=>route.fulfill({json:{llm:{configured:true,name:'First model'},scholarlySearch:{configured:true},scoringModels:[{id:'deepseek',available:true},...['ranker-8b','ranker-3b','ranker-0.6b'].map(id=>({id,available:id==='ranker-0.6b'&&phase==='ready'}))]}}));
  await page.route('**/api/rankers/local',route=>route.fulfill({json:{models:[local(), ...['ranker-3b','ranker-8b'].map(id=>({...local(),id,phase:'not_installed',message:'尚未安装本地模型',available:false,installed:false,busy:false,downloadGB:id==='ranker-3b'?6.3:16.2,diskGB:id==='ranker-3b'?22:32,license:id==='ranker-3b'?'Qwen Research License':'Meta Llama 3 Community License'}))]}}));
  await page.route('**/api/rankers/local/ranker-0.6b/install',route=>{
    assert.equal(route.request().method(),'POST');
    assert.equal(route.request().postDataJSON().acceptLicense,true);
    installs++; phase='downloading'; return route.fulfill({status:202,json:local()});
  });
  await page.route('**/api/rankers/local/ranker-0.6b/test',route=>route.fulfill({json:{available:true,message:'连接成功，本地模型服务已就绪。'}}));
  await page.goto(base);
  const frame=()=>page.frameLocator('iframe');
  await frame().locator('input[type=file]').setInputFiles({name:'paper.txt',mimeType:'text/plain',buffer:Buffer.from('Title: Research evaluation methods\nAbstract: We compare reproducible research methods on several datasets using transparent evaluation protocols.\nKeywords: evaluation, reproducibility')});
  await frame().locator('label').filter({has:frame().locator('input[type=checkbox]')}).click();
  await frame().locator('form button[type=submit]').click();
  const select=()=>frame().getByLabel('最终评分模型',{exact:true});
  await select().waitFor();
  assert.equal(await select().inputValue(),'deepseek');
  assert.equal(await frame().getByText('本地 Ranker',{exact:true}).count(),0);
  assert.equal(await select().locator('option').count(),2);
  await select().selectOption('other');
  await frame().getByRole('dialog').waitFor();
  assert.equal(await frame().getByRole('dialog').getByRole('article').count(),3);
  const card=()=>frame().getByRole('article',{name:'Qwen3 · 0.6B Ranker',exact:true});
  const install=()=>card().getByRole('button',{name:'一键下载安装并启用',exact:true});
  await install().waitFor();
  assert.equal(await install().isDisabled(),true);

  await card().getByRole('checkbox').check();
  await install().click();
  await frame().getByRole('button',{name:'正在安装或加载…'}).waitFor();
  assert.equal(installs,1);
  phase='error';
  const retry=frame().getByRole('button',{name:'重试下载安装'});
  await retry.waitFor();await retry.click();assert.equal(installs,2);
  await page.locator('#away').click();await page.locator('#back').click();
  await select().selectOption('other');
  await frame().getByRole('button',{name:'正在安装或加载…'}).waitFor();
  phase='ready';
  await frame().getByRole('status').filter({hasText:'本地 Ranker 已就绪'}).waitFor();
  await frame().getByRole('button',{name:'测试连通性'}).click();
  await frame().getByText('连接成功，本地模型服务已就绪。',{exact:true}).waitFor();
  await frame().getByRole('dialog').screenshot({path:'/tmp/onecode-ranker-dialog-desktop.png'});
  await page.setViewportSize({width:390,height:1000});
  await frame().getByRole('dialog').screenshot({path:'/tmp/onecode-ranker-dialog-mobile.png'});
  await frame().getByRole('button',{name:'使用此模型评分'}).click();
  assert.equal(await select().inputValue(),'other');
  assert.equal(await frame().getByRole('button',{name:'运行当前审稿流程'}).isEnabled(),true);
  const box = await select().boundingBox(); assert.ok(box.width > 200);
  await page.setViewportSize({width:1440,height:1100});
  await page.screenshot({path:'/tmp/onecode-ranker-install-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:1000});
  await page.screenshot({path:'/tmp/onecode-ranker-install-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: API default, consent, install request, progress, retry, navigation recovery, ready scoring, responsive layout');
} finally {
  await browser?.close();
  await new Promise(resolve=>gateway.close(resolve));
  await new Promise(resolve=>upstream.close(resolve));
  await rm(dir,{recursive:true,force:true});
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalRankerManager, LOCAL_RANKERS, runCommand } from '../server/lib/local-ranker.mjs';
import { DEFAULT_SCORING_MODEL, DEFAULT_RANKER_MODEL, normalizeScoringModel } from '../server/lib/scoring-models.mjs';

const markInstalled = async (root, id) => {
  const model = LOCAL_RANKERS[id];
  await mkdir(path.join(root, id), { recursive: true });
  await writeFile(path.join(root, id, 'installed.json'), JSON.stringify({ revision: model.revision, baseRevision: model.baseRevision, manifest: model.manifest }));
};

test('API is the default scorer without changing legacy ranker routing', () => {
  assert.equal(DEFAULT_SCORING_MODEL, 'deepseek');
  assert.equal(normalizeScoringModel(), 'deepseek');
  assert.equal(DEFAULT_RANKER_MODEL, 'ranker-8b');
});

test('installation is single-flight, persistent, versioned and exposes no service credentials', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ranker-manager-'));
  const manager = new LocalRankerManager({ root });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let installs = 0;
  manager.setup = async id => { installs++; await gate; await markInstalled(root, id); };
  manager.launch = async id => { manager.services.set(id, { connection: { baseUrl: 'http://127.0.0.1:12345', apiKey: 'private-fixture-key' } }); manager.update(id, { phase: 'ready' }); };
  try {
    assert.equal((await manager.status('ranker-0.6b')).phase, 'not_installed');
    await assert.rejects(manager.install('../arbitrary'), /不支持/);
    await manager.install('ranker-0.6b');
    await manager.install('ranker-0.6b');
    await assert.rejects(manager.install('ranker-3b'), /另一个/);
    release(); await manager.job;
    assert.equal(installs, 1);
    const status = await manager.status('ranker-0.6b');
    assert.equal(status.available, true);
    assert.equal(status.installed, true);
    assert.equal(JSON.stringify(status).includes('private-fixture-key'), false);
    const restarted = new LocalRankerManager({ root });
    assert.equal((await restarted.status('ranker-0.6b')).phase, 'installed');
    await writeFile(path.join(root, 'ranker-0.6b/installed.json'), JSON.stringify({ revision: 'old' }));
    assert.equal(await restarted.installed('ranker-0.6b'), false);
  } finally { release(); manager.close(); await rm(root, { recursive: true, force: true }); }
});

test('failed installation releases its lock and retries without marking incomplete files installed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ranker-retry-'));
  const manager = new LocalRankerManager({ root });
  manager.setup = async () => { throw new Error('download interrupted'); };
  manager.launch = async () => {};
  try {
    await manager.install('ranker-3b'); await manager.job;
    assert.equal((await manager.status('ranker-3b')).phase, 'error');
    assert.equal(await manager.installed('ranker-3b'), false);
    manager.setup = id => markInstalled(root, id);
    await manager.install('ranker-3b'); await manager.job;
    assert.equal(await manager.installed('ranker-3b'), true);
    const release = await manager.lock(); await release();
  } finally { manager.close(); await rm(root, { recursive: true, force: true }); }
});

test('cross-process installation lock prevents concurrent package writes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ranker-lock-'));
  try {
    const one = new LocalRankerManager({ root });
    const two = new LocalRankerManager({ root });
    const unlock = await one.lock();
    await assert.rejects(two.lock(), /另一进程/);
    await unlock();
    const unlock2 = await two.lock(); await unlock2();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('subprocess failures and timeouts reject without exposing captured output', async () => {
  await assert.rejects(runCommand(process.execPath, ['-e', 'console.error("private-key"); process.exit(2)']), error => !error.message.includes('private-key'));
  await assert.rejects(runCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 30 }), /超时/);
});

test('managed service starts on a random loopback port, authenticates and closes with its host', async t => {
  const python = process.env.ONECODE_RANKER_PYTHON || 'python3';
  if (!await runCommand(python, ['--version']).then(()=>true,()=>false)) return t.skip('Python is unavailable');
  const root = await mkdtemp(path.join(os.tmpdir(), 'ranker-process-'));
  const runtime = path.join(root, 'runtime');
  const manager = new LocalRankerManager({ root, runtime });
  manager.python = () => python;
  await mkdir(path.join(runtime, 'ranker_service'), {recursive:true});
  await writeFile(path.join(runtime, 'ranker_service/__init__.py'), '');
  await writeFile(path.join(runtime, 'ranker_service/app.py'), `
import json, os
from http.server import HTTPServer, BaseHTTPRequestHandler
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        ok = self.headers.get('Authorization') == 'Bearer ' + os.environ['RANKER_SERVICE_API_KEY']
        self.send_response(200 if ok else 401)
        self.end_headers()
        self.wfile.write(b'{}')
    def log_message(self, *args): pass
server = HTTPServer(('127.0.0.1',0),Handler)
print(json.dumps({'event':'ready','url':'http://127.0.0.1:'+str(server.server_port)}),flush=True)
server.serve_forever()
`);
  try {
    await markInstalled(root,'ranker-0.6b');
    const [one,two] = await Promise.all([manager.start('ranker-0.6b'),manager.start('ranker-0.6b')]);
    assert.equal(one.baseUrl,two.baseUrl);
    assert.match(one.baseUrl,/^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal((await fetch(one.baseUrl)).status,401);
    assert.equal((await fetch(one.baseUrl,{headers:{Authorization:'Bearer '+one.apiKey}})).status,200);
    assert.equal((await manager.status('ranker-0.6b')).available,true);
    const child=manager.services.get('ranker-0.6b').child;
    const exited=new Promise(resolve=>child.once('exit',resolve));
    manager.close();await exited;
    await assert.rejects(fetch(one.baseUrl));
  } finally {manager.close();await rm(root,{recursive:true,force:true});}
});

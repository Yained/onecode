import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { localRankers, runCommand } from '../server/lib/local-ranker.mjs';
import { scorePapersWithRanker } from '../server/lib/ranker-client.mjs';

test('installed models route scoring to the local authenticated service, overriding remote configuration', async () => {
  const previous = { installed: localRankers.installed, start: localRankers.start, connection: localRankers.connection };
  const remote = process.env.RANKER_06B_SERVICE_URL;
  process.env.RANKER_06B_SERVICE_URL = 'https://remote.invalid';
  const connection = { baseUrl: 'http://127.0.0.1:12345', apiKey: 'local-fixture-secret' };
  let starts = 0;
  localRankers.installed = async () => true;
  localRankers.start = async () => { starts++; return connection; };
  localRankers.connection = () => connection;
  try {
    await scorePapersWithRanker([{paperId:'test',title:'Example',abstract:'Example abstract'}], {
      modelId:'ranker-0.6b', fetchImpl:async (url, options) => {
        assert.equal(url,connection.baseUrl+'/v1/paper-scores');
        assert.equal(options.headers.Authorization,'Bearer '+connection.apiKey);
        return new Response(JSON.stringify({scores:[],model_trace:{}}),{status:200});
      },
    });
    assert.equal(starts,1);
  } finally {
    Object.assign(localRankers,previous);
    if(remote === undefined) delete process.env.RANKER_06B_SERVICE_URL; else process.env.RANKER_06B_SERVICE_URL=remote;
  }
});

test('installer rejects altered manifests, altered weights and path traversal', async t => {
  const python = process.env.ONECODE_RANKER_PYTHON || 'python3';
  if(!await runCommand(python,['--version']).then(()=>true,()=>false)) return t.skip('Python is unavailable');
  const file=fileURLToPath(new URL('../scripts/ranker/install.py',import.meta.url));
  await runCommand(python,['-c',`
import importlib.util, tempfile, json, hashlib
from pathlib import Path
spec=importlib.util.spec_from_file_location('installer',${JSON.stringify(file)})
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as name:
    root=Path(name);(root/'weights').write_bytes(b'expected')
    manifest={'files':{'weights':{'sha256':hashlib.sha256(b'expected').hexdigest()}}}
    def write_manifest():
        (root/'manifest.json').write_text(json.dumps(manifest))
        return hashlib.sha256((root/'manifest.json').read_bytes()).hexdigest()
    sha=write_manifest();module.verify_adapter(root,sha)
    try: module.verify_adapter(root,'0'*64)
    except ValueError: pass
    else: raise AssertionError('altered manifest accepted')
    (root/'weights').write_bytes(b'corrupt')
    try: module.verify_adapter(root,sha)
    except ValueError: pass
    else: raise AssertionError('altered weight accepted')
    manifest={'files':{'../outside':{'sha256':'0'*64}}};sha=write_manifest()
    try: module.verify_adapter(root,sha)
    except ValueError: pass
    else: raise AssertionError('path traversal accepted')
`]);
});

import { createManagedPython } from './managed-python.mjs';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile, open, rm, stat, statfs, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const catalogPath = fileURLToPath(new URL('./local-ranker-catalog.json', import.meta.url));
export const LOCAL_RANKERS = Object.freeze(JSON.parse(readFileSync(catalogPath, 'utf8')));
const runtimePath = fileURLToPath(new URL('../../scripts/ranker/', import.meta.url));
const activePhases = new Set(['checking', 'environment', 'downloading', 'verifying', 'starting']);

function childEnvironment(extra = {}) {
  const env = { ...process.env, ...extra, PYTHONUNBUFFERED: '1', PYTHONNOUSERSITE: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1' };
  delete env.PYTHONPATH;
  delete env.PYTHONHOME;
  return env;
}

// Shell-free arguments; output is bounded and never returned to the browser.
export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: childEnvironment(), windowsHide: true, ...options });
    let output = '';
    child.stdout?.on('data', data => { output = (output + data).slice(-8000); });
    child.stderr?.on('data', data => { output = (output + data).slice(-8000); });
    const timer = setTimeout(() => { child.kill(); reject(new Error('安装步骤等待超时，请检查网络后重试。')); }, options.timeoutMs || 60_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(`安装命令失败（退出码 ${code}）。请检查 Python、网络及 NVIDIA 驱动。`, { cause: output })); });
    options.onChild?.(child);
  });
}

async function directoryBytes(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const sizes = await Promise.all(entries.map(async entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? directoryBytes(file) : (await stat(file).catch(() => null))?.size || 0;
  }));
  return sizes.reduce((total, size) => total + size, 0);
}

export class LocalRankerManager {
  constructor({ root = process.env.ONECODE_RANKER_HOME || path.join(os.homedir(), '.cache', 'onecode', 'rankers'), runtime = runtimePath } = {}) {
    this.root = path.resolve(root);
    this.runtime = runtime;
    this.states = new Map();
    this.services = new Map();
    this.starts = new Map();
    this.removing = new Set();
    this.installing = null;
    this.setupChild = null;
    this.cancelled = new Set();
    this.pausedPhases = new Map();
    this.closed = false;
  }
  model(id) {
    if (!Object.hasOwn(LOCAL_RANKERS, id)) throw new Error('不支持的本地 Ranker 模型。');
    return LOCAL_RANKERS[id];
  }
  python() { return path.join(this.root, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'); }
  update(id, fields) { this.states.set(id, { ...this.states.get(id), ...fields }); }
  async installed(id) {
    const model = this.model(id);
    const marker = await readFile(path.join(this.root, id, 'installed.json'), 'utf8').then(JSON.parse).catch(() => null);
    return marker?.revision === model.revision && marker?.baseRevision === model.baseRevision && marker?.manifest === model.manifest;
  }
  async status(id) {
    const model = this.model(id);
    const installed = await this.installed(id);
    const state = this.states.get(id) || { phase: installed ? 'installed' : 'not_installed', message: installed ? '已下载，点击启用本地推理' : '尚未安装本地模型' };
    return { id, label: model.label, ...state, installed, available: this.services.has(id) && !this.removing.has(id), busy: activePhases.has(state.phase) || state.phase === 'paused' || this.removing.has(id),
      downloadGB: model.downloadGB, diskGB: model.diskGB, license: model.license,
      licenseUrl: `https://www.modelscope.cn/models/${model.base}/files`,
      enabled: process.env.ONECODE_RANKER_INSTALL_DISABLED !== '1', location: '运行 OneCode 后端的机器',
      supported: ['linux', 'win32'].includes(process.platform) && process.arch === 'x64', requirements: 'NVIDIA CUDA 显卡；缺少 Python 时会自动安装独立环境' };
  }
  async list() { return Promise.all(Object.keys(LOCAL_RANKERS).map(id => this.status(id))); }
  connection(id) { return this.services.get(id)?.connection; }
  async lock() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const file = path.join(this.root, '.install.lock');
    try {
      const handle = await open(file, 'wx', 0o600);
      await handle.writeFile(String(process.pid)); await handle.close();
      return () => rm(file, { force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(await readFile(file, 'utf8').catch(() => ''));
      const age = Date.now() - (await stat(file)).mtimeMs;
      try { if (pid > 0) process.kill(pid, 0); else if (age > 60_000) throw Object.assign(new Error(), { code: 'ESRCH' }); }
      catch (check) { if (check.code === 'ESRCH') { await rm(file, { force: true }); return this.lock(); } }
      throw new Error('另一进程正在安装模型，请稍后重试。');
    }
  }
  async install(id) {
    this.model(id);
    if (this.closed) throw new Error('服务正在关闭。');
    if (this.removing.has(id)) throw new Error('模型正在删除，请稍后重试。');
    if (process.env.ONECODE_RANKER_INSTALL_DISABLED === '1') throw new Error('管理员已关闭本机模型安装。');
    if (this.installing === id) return this.status(id);
    if (this.installing) throw new Error('正在安装另一个模型，请等待完成后再试。');
    if (this.services.has(id)) return this.status(id);
    this.installing = id;
    this.update(id, { phase: 'checking', message: '正在检查本机环境', downloadedBytes: 0 });
    this.cancelled.delete(id);
    this.job = (async () => {
      const unlock = await this.lock();
      try {
        if (this.cancelled.has(id)) throw new Error('下载任务已取消。');
        if (!await this.installed(id)) await this.setup(id);
        if (this.closed) throw new Error('安装已停止。');
        if (this.cancelled.has(id)) throw new Error('下载任务已取消。');
        await this.start(id).catch(async error => {
          // A missing/corrupt runtime must be repairable by the same install button.
          await rm(path.join(this.root, id, 'installed.json'), { force: true });
          throw error;
        });
      } finally { await unlock(); }
    })().catch(error => {
      if (this.cancelled.has(id)) {
        this.cancelled.delete(id);
        this.pausedPhases.delete(id);
        this.update(id, { phase: 'not_installed', message: '下载任务已取消', downloadedBytes: 0 });
      } else {
        this.lastError = error;
        this.update(id, { phase: 'error', message: error.message });
      }
    }).finally(() => { this.installing = null; this.setupChild = null; });
    return this.status(id);
  }
  async pause(id) {
    this.model(id);
    if (this.installing !== id || !this.setupChild) throw new Error('当前没有可暂停的下载任务。');
    const state = this.states.get(id) || {};
    if (state.phase === 'paused') return this.status(id);
    if (process.platform !== 'linux') throw new Error('当前系统暂不支持暂停下载任务。');
    if (!this.setupChild.kill('SIGSTOP')) throw new Error('下载进程已结束，无法暂停。');
    this.pausedPhases.set(id, { phase: state.phase || 'downloading', message: state.message || '下载已暂停' });
    this.update(id, { phase: 'paused', message: '下载已暂停' });
    return this.status(id);
  }
  async resume(id) {
    this.model(id);
    if (this.installing !== id || !this.setupChild) throw new Error('当前没有可继续的下载任务。');
    const previous = this.pausedPhases.get(id);
    if (!previous) return this.status(id);
    if (!this.setupChild.kill('SIGCONT')) throw new Error('下载进程已结束，无法继续。');
    this.pausedPhases.delete(id);
    this.update(id, previous);
    return this.status(id);
  }
  async cancel(id) {
    this.model(id);
    if (this.installing !== id) throw new Error('当前没有可取消的下载任务。');
    this.cancelled.add(id);
    this.pausedPhases.delete(id);
    if (this.setupChild) {
      this.setupChild.kill('SIGCONT');
      this.setupChild.kill('SIGTERM');
    }
    await this.job;
    await rm(path.join(this.root, id), { recursive: true, force: true });
    this.update(id, { phase: 'not_installed', message: '下载任务已取消', downloadedBytes: 0 });
    return this.status(id);
  }
  async remove(id) {
    this.model(id);
    if (this.removing.has(id)) throw new Error('模型正在删除，请稍后重试。');
    if (this.installing === id || this.starts.has(id)) throw new Error('模型正在下载或启动，请先停止任务后再删除。');
    this.removing.add(id);
    this.update(id, { phase: 'removing', message: '正在停止本地推理并删除模型' });
    try {
      const service = this.services.get(id);
      if (service) {
        await new Promise((resolve, reject) => {
          const child = service.child;
          if (child.exitCode !== null || child.signalCode !== null) return resolve();
          const force = setTimeout(() => child.kill('SIGKILL'), 5000);
          const timeout = setTimeout(() => { clearTimeout(force); reject(new Error('本地推理服务未能停止，请稍后重试。')); }, 15000);
          const exited = () => { clearTimeout(force); clearTimeout(timeout); resolve(); };
          child.once('exit', exited);
          if (!child.kill('SIGTERM') && child.exitCode === null && child.signalCode === null) {
            clearTimeout(force); clearTimeout(timeout); child.removeListener('exit', exited);
            reject(new Error('本地推理服务未能停止，请稍后重试。'));
          }
        });
        if (this.services.get(id)?.child === service.child) this.services.delete(id);
      }
      await rm(path.join(this.root, id), { recursive: true, force: true });
      this.update(id, { phase: 'not_installed', message: '模型已删除', downloadedBytes: 0 });
      return this.status(id);
    } catch (error) {
      this.update(id, { phase: 'error', message: `删除模型失败：${error.message}` });
      throw error;
    } finally { this.removing.delete(id); }
  }
  async setup(id) {
    const model = this.model(id);
    if (!['linux', 'win32'].includes(process.platform) || process.arch !== 'x64') throw new Error('当前本地 Ranker 需要 Linux/Windows 和 NVIDIA CUDA，请使用系统对话模型 API。');
    await runCommand('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader']).catch(() => { throw new Error('未检测到可用的 NVIDIA 驱动，请安装驱动后重试，或使用系统对话模型。'); });
    const disk = await statfs(this.root);
    const cachedBytes = await directoryBytes(path.join(this.root, id)) + await directoryBytes(path.join(this.root, 'venv'));
    if (disk.bavail * disk.bsize < Math.max(2e9, model.diskGB * 1e9 - cachedBytes)) throw new Error(`可用磁盘空间不足，首次安装建议至少 ${model.diskGB} GB。`);
    const check = 'import sys; assert (3,10) <= sys.version_info[:2] <= (3,12)';
    const venv = path.join(this.root, 'venv');
    const ready = await runCommand(this.python(), ['-c', `${check}; import pip`]).then(() => true, () => false);
    const options = { timeoutMs: 3_600_000, onChild: child => { this.setupChild = child; if (this.closed) child.kill(); } };
    this.update(id, { phase: 'environment', message: ready ? '正在检查推理环境依赖' : '正在创建独立推理环境并安装依赖，首次可能需要较长时间' });
    if (!ready) {
      if (await stat(venv).then(() => true, () => false)) throw new Error('已有的 Ranker Python 环境无法使用，请联系管理员检查后重建，避免覆盖现有依赖。');
      const candidates = process.env.ONECODE_RANKER_PYTHON ? [[process.env.ONECODE_RANKER_PYTHON, []]] : [['python3.11', []], ['python3', []], ['python', []], ...(process.platform === 'win32' ? [['py', ['-3.11']]] : [])];
      let selected;
      for (const [command, prefix] of candidates) {
        if (await runCommand(command, [...prefix, '-c', check]).then(() => true, () => false)) { selected = [command, prefix]; break; }
      }
      if (selected) {
        await runCommand(selected[0], [...selected[1], '-m', 'venv', venv], options).catch(async () => {
          // The first attempt may leave a partial environment that uv refuses to replace.
          await rm(venv, { recursive: true, force: true });
          await createManagedPython(this.root, runCommand, options);
        });
      } else {
        this.update(id, { phase: 'environment', message: '正在自动下载独立 Python 环境，无需手动安装' });
        await createManagedPython(this.root, runCommand, options);
      }
    }
    const versions = ['transformers==4.53.2', 'peft==0.15.2', 'accelerate==1.7.0', 'bitsandbytes==0.46.1', 'safetensors==0.4.3', 'numpy==1.26.4', 'modelscope==1.40.2'];
    await runCommand(this.python(), ['-m', 'pip', 'install', 'torch==2.3.0', '--index-url', 'https://download.pytorch.org/whl/cu121'], options);
    await runCommand(this.python(), ['-m', 'pip', 'install', ...versions], options);
    let pending = '';
    await runCommand(this.python(), [path.join(this.runtime, 'install.py'), '--model', id, '--root', this.root, '--catalog', catalogPath], {
      ...options, timeoutMs: 43_200_000, onChild: child => {
        this.setupChild = child;
        if (this.closed) child.kill();
        child.stdout.on('data', data => {
          pending += data;
          const lines = pending.split('\n'); pending = lines.pop().slice(-16000);
          for (const line of lines) if (line.startsWith('RANKER_PROGRESS ')) {
            try {
              const value = JSON.parse(line.slice(16));
              if (['downloading', 'verifying', 'installed'].includes(value.phase)) this.update(id, { phase: value.phase === 'installed' ? 'starting' : value.phase, message: String(value.message).slice(0, 300), ...(Number.isFinite(value.downloadedBytes) ? { downloadedBytes: value.downloadedBytes } : {}) });
            } catch { /* Ignore non-protocol dependency logs. */ }
          }
        });
      },
    });
  }
  async start(id) {
    this.model(id);
    if (this.closed) throw new Error('服务正在关闭。');
    if (this.removing.has(id)) throw new Error('模型正在删除，请稍后重试。');
    if (this.services.has(id)) return this.connection(id);
    if (this.starts.has(id)) return this.starts.get(id);
    const promise = this.launch(id).catch(error => { this.update(id, { phase: 'error', message: error.message }); throw error; }).finally(() => this.starts.delete(id));
    this.starts.set(id, promise);
    return promise;
  }
  async launch(id) {
    if (!await this.installed(id)) throw new Error('请先下载安装所选 Ranker 模型。');
    this.update(id, { phase: 'starting', message: '正在加载本地模型到 GPU，请稍候' });
    const key = randomBytes(32).toString('hex');
    const model = this.model(id);
    const config = { backend: 'transformers', auth: { required: true, api_key_env: 'RANKER_SERVICE_API_KEY' },
      model: { base_model_path: path.join(this.root, id, 'base'), adapter_path: path.join(this.root, id, 'adapter'), calibration_path: path.join(this.root, id, 'adapter/validation-calibration.json'), model_name: model.base, model_version: model.revision, adapter_version: model.revision, input_schema: 'fulltext_evidence_v1', max_length: 1024, batch_size: 1, device: process.env.ONECODE_RANKER_DEVICE || 'cuda:0' },
      server: { host: '127.0.0.1', port: 0, max_concurrent: 1, max_request_bytes: 4194304 } };
    const configPath = path.join(this.root, id, `service-${process.pid}.json`);
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    return new Promise((resolve, reject) => {
      const child = spawn(this.python(), ['-u', '-m', 'ranker_service.app', '--config', configPath], {
        cwd: this.runtime, windowsHide: true, env: childEnvironment({ ONECODE_RANKER_MANAGED: '1', RANKER_SERVICE_API_KEY: key, RANKER_BACKEND: 'transformers', RANKER_HOST: '127.0.0.1', RANKER_PORT: '0', NAIPV2_BASE_MODEL: config.model.base_model_path, NAIPV2_ADAPTER_DIR: config.model.adapter_path, NAIPV2_CALIBRATION_PATH: config.model.calibration_path }),
      });
      const timer = setTimeout(() => { child.kill(); reject(new Error('本地模型加载超时，请检查显存或驱动后重试。')); }, 600_000);
      let buffer = '';
      child.stderr.on('data', () => {});
      child.stdout.on('data', data => {
        buffer += data;
        const lines = buffer.split('\n'); buffer = lines.pop().slice(-16000);
        for (const line of lines) {
          let value; try { value = JSON.parse(line); } catch { continue; }
          if (value.event !== 'ready' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(value.url)) continue;
          const connection = { baseUrl: value.url, apiKey: key };
          fetch(`${connection.baseUrl}/v1/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) }).then(response => {
            if (!response.ok) throw new Error('本地推理服务检查失败。');
            if (this.closed || child.exitCode !== null) throw new Error('本地推理已停止。');
            clearTimeout(timer);
            this.services.set(id, { child, connection });
            this.update(id, { phase: 'ready', message: '本地 Ranker 已就绪，评分将在本机进行' });
            resolve(connection);
          }).catch(error => { child.kill(); reject(error); });
        }
      });
      child.once('error', () => { clearTimeout(timer); reject(new Error('本地推理环境不可用，请重试安装。')); });
      child.once('exit', () => {
        clearTimeout(timer);
        if (this.services.get(id)?.child === child) {
          this.services.delete(id);
          if (!this.closed) this.update(id, { phase: 'error', message: '本地推理已退出，请检查显存与驱动后重试启用。' });
        }
        reject(new Error('本地模型启动失败，请检查 GPU 显存和驱动。'));
      });
      this.pendingChildren ??= new Set(); this.pendingChildren.add(child);
      child.once('exit', () => this.pendingChildren.delete(child));
    });
  }
  close() {
    this.closed = true;
    this.setupChild?.kill();
    for (const child of this.pendingChildren || []) child.kill();
    this.services.clear();
  }
}

export const localRankers = new LocalRankerManager();
process.once('exit', () => localRankers.close());

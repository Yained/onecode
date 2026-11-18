import { mkdir, readFile, writeFile, chmod, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const releases = {
  linux: { archive: 'uv-x86_64-unknown-linux-gnu.tar.gz', sha256: 'e4f169ec380f1793b898a6f1fcbacd22db25cf7ca0349a6e96ffb85b69998d04', binary: 'uv-x86_64-unknown-linux-gnu/uv' },
  win32: { archive: 'uv-x86_64-pc-windows-msvc.zip', sha256: 'bb701bd35b586c45966654ea2703c9bd116a6a4fc0a8ca755bd644c2c41c5ebe', binary: 'uv.exe' },
};

// Download a pinned, verified bootstrap tool without running a shell installer.
export async function createManagedPython(root, run, options = {}) {
  const release = releases[process.platform];
  if (!release || process.arch !== 'x64') throw new Error('自动安装环境需要 Linux/Windows x64。');
  const tools = path.join(root, 'tools');
  await mkdir(tools, { recursive: true, mode: 0o700 });
  const archive = path.join(tools, release.archive);
  const valid = bytes => bytes && createHash('sha256').update(bytes).digest('hex') === release.sha256;
  let bytes = await readFile(archive).catch(() => null);
  if (!valid(bytes)) {
    const response = await fetch(`https://github.com/astral-sh/uv/releases/download/0.13.3/${release.archive}`, { signal: AbortSignal.timeout(300_000) }).catch(error => {
      throw new Error('独立 Python 环境下载失败，请检查 GitHub 网络连接后重试。', { cause: error });
    });
    if (!response.ok) throw new Error('独立 Python 环境下载失败，请检查 GitHub 网络连接后重试。');
    bytes = Buffer.from(await response.arrayBuffer());
    if (!valid(bytes)) throw new Error('环境安装工具校验失败，请重试。');
    await writeFile(archive, bytes, { mode: 0o600 });
  }
  await run('tar', ['-xf', archive, '-C', tools], options);
  const binary = path.join(tools, release.binary);
  await access(binary);
  if (process.platform !== 'win32') await chmod(binary, 0o700);
  const env = { ...process.env, UV_PYTHON_INSTALL_DIR: path.join(root, 'python'), UV_CACHE_DIR: path.join(root, 'uv-cache'), UV_PYTHON_BIN_DIR: path.join(root, 'python-bin'), UV_NO_MODIFY_PATH: '1', PYTHONNOUSERSITE: '1' };
  delete env.PYTHONPATH;
  delete env.PYTHONHOME;
  await run(binary, ['venv', '--python', '3.11', '--managed-python', '--seed', path.join(root, 'venv')], { ...options, env });
}

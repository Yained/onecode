import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { normalizeUploadFilename } from './filename.mjs';

const accounts = new AsyncLocalStorage();
const writes = new Map();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../storage');

export function withAccount(account, action) {
  return accounts.run(createHash('sha256').update(account).digest('hex'), action);
}

export function accountScope() { return accounts.getStore(); }

function storageFile() {
  const account = accounts.getStore();
  if (!account) throw new Error('投稿项目必须关联已验证的 OneCode 账号。');
  return path.join(process.env.SUBMISSION_STORAGE_DIR || root, account, 'projects.json');
}

function normalizeStoredProject(project) {
  if (!project?.document?.filename) return project;
  return { ...project, document: { ...project.document, filename: normalizeUploadFilename(project.document.filename) } };
}

async function readAll(file = storageFile()) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    return Array.isArray(parsed) ? parsed.map(normalizeStoredProject) : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

// Serialize read-modify-write operations per account so concurrent uploads cannot lose projects.
function update(action) {
  const file = storageFile();
  const next = (writes.get(file) || Promise.resolve()).catch(() => {}).then(async () => {
    const projects = await readAll(file);
    const result = action(projects);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(projects, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, file);
    return result;
  });
  writes.set(file, next);
  void next.finally(() => { if (writes.get(file) === next) writes.delete(file); }).catch(() => {});
  return next;
}

export async function listProjects() {
  return (await readAll()).map((project) => ({
    id: project.id, name: project.name, status: project.status, stage: project.stage,
    createdAt: project.createdAt, updatedAt: project.updatedAt,
    document: project.document ? { title: project.document.title, filename: project.document.filename, fileType: project.document.fileType } : null,
  })).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function getProject(id) {
  return (await readAll()).find((project) => project.id === id) ?? null;
}

export function saveProject(project) {
  return update((projects) => {
    const index = projects.findIndex((item) => item.id === project.id);
    if (index >= 0) projects[index] = project;
    else projects.push(project);
    return project;
  });
}

export function patchProject(id, patch) {
  return update((projects) => {
    const index = projects.findIndex((project) => project.id === id);
    if (index < 0) return null;
    projects[index] = { ...projects[index], ...patch, id, updatedAt: new Date().toISOString() };
    return projects[index];
  });
}

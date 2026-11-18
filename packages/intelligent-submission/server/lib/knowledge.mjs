import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { accountScope } from './store.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../storage');
const writes = new Map();
const hash = value => createHash('sha256').update(value).digest('hex');
function file() {
  const account = accountScope();
  if (!account) throw new Error('私有知识库需要已验证的账号。');
  return path.join(process.env.SUBMISSION_STORAGE_DIR || root, account, 'knowledge.json');
}
async function read(location = file()) {
  try { return JSON.parse(await readFile(location, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { items: [], imported: [] }; throw error; }
}
function update(action) {
  const location = file();
  const next = (writes.get(location) || Promise.resolve()).catch(() => {}).then(async () => {
    const data = await read(location);
    const result = await action(data);
    await mkdir(path.dirname(location), { recursive: true, mode: 0o700 });
    const temp = `${location}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(data), { mode: 0o600 });
    await rename(temp, location);
    return result;
  });
  writes.set(location, next);
  void next.finally(() => { if (writes.get(location) === next) writes.delete(location); }).catch(() => {});
  return next;
}
const identity = document => hash(`${document.title || ''}\n${document.filename || ''}`);
export const documentFingerprint = document => hash(String(document.text || `${document.title || ''}\n${document.abstract || ''}`).trim());
function metadata(item) { const { text, fingerprint, identity: key, originalFile, ...rest } = item; return rest; }
function insert(data, document, projectId, originalFile) {
  const text = String(document.text || '').trim();
  const fingerprint = documentFingerprint(document);
  const prior = data.items.find(item => item.fingerprint === fingerprint || (!item.text && item.identity === identity(document)));
  if (projectId && !data.imported.includes(projectId)) data.imported.push(projectId);
  if (prior && (prior.text || !text) && (!originalFile || prior.originalFile)) return metadata(prior);
  const details = prior?.metadataEditedAt ? prior : document;
  const item = { id: prior?.id || randomUUID(), identity: identity(document), fingerprint,
    title: String(details.title || document.filename || '未命名论文'), filename: String(document.filename || ''),
    abstract: String(details.abstract || ''), keywords: (details.keywords || []).slice(0, 50),
    text, coverage: text ? 'full-text' : 'metadata-only', characters: text.length,
    createdAt: prior?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...(prior?.metadataEditedAt ? { metadataEditedAt: prior.metadataEditedAt } : {}),
    ...(originalFile?.buffer ? { originalFile: { filename: originalFile.originalname || document.filename || 'paper', mimetype: originalFile.mimetype || 'application/octet-stream', data: originalFile.buffer.toString('base64') } } : prior?.originalFile ? { originalFile: prior.originalFile } : {}) };
  if (prior) data.items[data.items.indexOf(prior)] = item; else data.items.push(item);
  return metadata(item);
}
export async function addKnowledgeDocument(document, projectId, originalFile) {
  return update(data => insert(data, document, projectId, originalFile));
}
export async function listKnowledge(query = '') {
  const q = String(query).trim().toLowerCase().slice(0, 200);
  return (await read()).items.filter(item => !q || `${item.title} ${item.abstract} ${item.keywords.join(' ')} ${item.text}`.toLowerCase().includes(q))
    .map(metadata).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function getKnowledgeDocument(id, includeText = false) {
  const item = (await read()).items.find(item => item.id === id);
  return item ? { ...metadata(item), ...(includeText ? { text: item.text } : {}) } : null;
}
export async function getKnowledgeOriginal(id) {
  const item = (await read()).items.find(item => item.id === id);
  return item?.originalFile || null;
}
export async function editKnowledgeDocument(id, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length || Object.keys(patch).some(key => !['title', 'abstract', 'keywords'].includes(key))) {
    throw new Error('只能编辑论文标题、摘要和关键词。');
  }
  const changes = {};
  if (Object.hasOwn(patch, 'title')) {
    if (typeof patch.title !== 'string' || !patch.title.trim() || patch.title.trim().length > 500) throw new Error('论文标题不能为空且不能超过 500 字。');
    changes.title = patch.title.trim();
  }
  if (Object.hasOwn(patch, 'abstract')) {
    if (typeof patch.abstract !== 'string' || patch.abstract.length > 20000) throw new Error('论文摘要不能超过 20000 字。');
    changes.abstract = patch.abstract.trim();
  }
  if (Object.hasOwn(patch, 'keywords')) {
    if (!Array.isArray(patch.keywords) || patch.keywords.length > 50 || patch.keywords.some(word => typeof word !== 'string' || word.length > 100)) throw new Error('关键词最多 50 个，每个不能超过 100 字。');
    changes.keywords = [...new Set(patch.keywords.map(word => word.trim()).filter(Boolean))];
  }
  return update(data => {
    const item = data.items.find(value => value.id === id);
    if (!item) return null;
    Object.assign(item, changes, { updatedAt: new Date().toISOString(), metadataEditedAt: new Date().toISOString() });
    return metadata(item);
  });
}
export async function deleteKnowledgeDocument(id) {
  return update(data => { const count = data.items.length; data.items = data.items.filter(item => item.id !== id); return count !== data.items.length; });
}
function terms(value) {
  const words = String(value).toLowerCase().match(/[a-z][a-z0-9-]{2,}|[\u3400-\u9fff]+/g) || [];
  const stop = new Set(['the','and','with','for','that','this','from','are','was','were','our','paper','study','method','方法','研究','本文','提出','结果','论文']);
  return [...new Set(words.flatMap(word => /[\u3400-\u9fff]/.test(word) ? Array.from({length:Math.max(0,word.length-1)},(_,i)=>word.slice(i,i+2)) : [word]).filter(word=>!stop.has(word)))].slice(0, 250);
}
export async function retrieveKnowledge(document) {
  const queryTerms = terms(`${document.title || ''} ${(document.keywords || []).join(' ')} ${String(document.abstract || '').slice(0, 2000)}`);
  const fingerprint = documentFingerprint(document);
  const results = [];
  for (const item of (await read()).items) {
    if (item.fingerprint === fingerprint || item.identity === identity(document)) continue;
    const text = item.text || `${item.title}\n${item.abstract}`;
    const snippets = [];
    for (let offset=0;offset<text.length;offset+=1000) {
      const excerpt = text.slice(offset,offset+1200);
      const lower = excerpt.toLowerCase();
      const hits = queryTerms.filter(term=>lower.includes(term));
      if (hits.length < Math.min(2,queryTerms.length) || !hits.length) continue;
      snippets.push({ excerpt, offset, score: hits.length });
    }
    snippets.sort((a,b)=>b.score-a.score);
    if (snippets.length) results.push({ id:item.id,title:item.title,filename:item.filename,coverage:item.coverage,score:snippets[0].score,snippets:snippets.slice(0,2) });
  }
  results.sort((a,b)=>b.score-a.score);
  return { generatedAt:new Date().toISOString(), method:'keyword-chunk-retrieval', sources:results.slice(0,3), notes:[],
    notice:'仅检索当前账号的私有论文。相关片段用于背景与相关工作补充，不代表当前稿件成果，不参与期刊基准评分。' };
}
export function validateKnowledgeNotes(notes, context) {
  return (Array.isArray(notes)?notes:[]).slice(0,6).flatMap(note=>{
    const source = context?.sources?.find(source=>source.id === note?.sourceId);
    const quote = typeof note?.quote === 'string' ? note.quote.trim().slice(0,500) : '';
    if (!source || !quote || !source.snippets.some(snippet=>snippet.excerpt.includes(quote))) return [];
    const clean = value => typeof value === 'string' ? value.trim().slice(0,1500) : '';
    if (!clean(note.relationship) || !clean(note.suggestion)) return [];
    return [{sourceId:source.id,quote,relationship:clean(note.relationship),suggestion:clean(note.suggestion),
      keywords:(Array.isArray(note.keywords)?note.keywords:[]).filter(value=>typeof value==='string').map(value=>value.trim().slice(0,60)).filter(Boolean).slice(0,6)}];
  });
}

import { workspaceHost, workspaceAccount } from './workspace-state.js';

const account = workspaceAccount();

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (workspaceAccount() !== account) throw new Error('登录账户已变化，请重新打开智能投稿。');
  const token = workspaceHost.localStorage.getItem('onecode.settings.dat:platformAuthToken');
  if (token) headers.set('Authorization', `Basic ${btoa(`:${token}`)}`);
  const selected = workspaceHost.sessionStorage.getItem(`onescience.submission-model:${account}`);
  if (selected) headers.set('X-Submission-Model', encodeURIComponent(selected));
  let response;
  // Upload includes transfer, PDF conversion (up to 45s) and model assessment (up to 10 minutes), plus transport overhead.
  const timeoutMs = (path === '/api/analyze' || path === '/api/demo' || path.endsWith('/rebuttal')) ? 720_000 : path.endsWith('/review-flow') ? 5_910_000 : path.endsWith('/review-progress') ? 8000 : (!options.method || options.method === 'GET') ? 15_000 : 120_000;
  try { response = await workspaceHost.fetch(`/intelligent-submission${path}`, { ...options, headers, signal: options.signal || AbortSignal.timeout(timeoutMs) }); }
  catch (error) { if (['TimeoutError', 'AbortError'].includes(error.name)) throw new Error(path === '/api/analyze' ? '上传与论文分析等待超过 12 分钟。请先查看历史投稿项目是否已保存；也可关闭大模型语义画像后重试文件解析。' : '请求等待超时，已结束等待。请检查模型或代理连接后重试。'); throw error; }
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) throw new Error('请先登录 OneCode，再使用智能投稿。');
  if (!response.ok) throw new Error(payload.error || '请求失败，请稍后重试。');
  return payload;
}

async function downloadFile(path) {
  if (workspaceAccount() !== account) throw new Error('登录账户已变化，请重新打开智能投稿。');
  const headers = new Headers();
  const token = workspaceHost.localStorage.getItem('onecode.settings.dat:platformAuthToken');
  if (token) headers.set('Authorization', `Basic ${btoa(`:${token}`)}`);
  const selected = workspaceHost.sessionStorage.getItem(`onescience.submission-model:${account}`);
  if (selected) headers.set('X-Submission-Model', encodeURIComponent(selected));
  const response = await workspaceHost.fetch(`/intelligent-submission${path}`, { headers });
  if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || '下载失败，请稍后重试。'); }
  return response.blob();
}

export const api = {
  knowledge: (q='') => request(`/api/knowledge?q=${encodeURIComponent(q)}`),
  knowledgeDocument: id => request(`/api/knowledge/${encodeURIComponent(id)}`),
  downloadKnowledge: id => downloadFile(`/api/knowledge/${encodeURIComponent(id)}/download`),
  uploadKnowledge: body => request('/api/knowledge', {method:'POST',body}),
  editKnowledge: (id, patch) => request(`/api/knowledge/${encodeURIComponent(id)}`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)}),
  deleteKnowledge: id => request(`/api/knowledge/${encodeURIComponent(id)}`, {method:'DELETE'}),
  reviewProgress: (id) => request(`/api/projects/${id}/review-progress`),
  testRanker: id => request(`/api/rankers/local/${encodeURIComponent(id)}/test`, { method: 'POST' }),
  localRankers: () => request('/api/rankers/local'),
  installRanker: id => request(`/api/rankers/local/${encodeURIComponent(id)}/install`, { method: 'POST' }),
  pauseRanker: id => request(`/api/rankers/local/${encodeURIComponent(id)}/pause`, { method: 'POST' }),
  resumeRanker: id => request(`/api/rankers/local/${encodeURIComponent(id)}/resume`, { method: 'POST' }),
  cancelRanker: id => request(`/api/rankers/local/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  deleteRanker: id => request(`/api/rankers/local/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  modelStatus: () => request('/api/model/status'),
  journals: () => request('/api/journals'),
  listProjects: () => request('/api/projects'),
  getProject: (id) => request(`/api/projects/${id}`),
  createDemo: () => request('/api/demo', { method: 'POST' }),
  analyze: (formData) => request('/api/analyze', { method: 'POST', body: formData }),
  patchProject: (id, patch) =>
    request(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  generateRebuttal: (id, formData) => request(`/api/projects/${id}/rebuttal`, { method: 'POST', body: formData }),
  runReviewFlow: (id, options = {}) =>
    request(`/api/projects/${id}/review-flow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    }),
};

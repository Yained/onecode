import { AsyncLocalStorage } from 'node:async_hooks';
import { accountScope } from './store.mjs';
const active = new Map();
const context = new AsyncLocalStorage();
const key = (id) => `${accountScope()}:${id}`;
export const workflowSignal = (signal) => context.getStore() ? AbortSignal.any([signal, context.getStore().controller.signal]) : signal;
export function workflowProgress(id) { return active.get(key(id))?.progress || { running: false }; }
export function workflowStage(message) {
  const state = context.getStore();
  if (!state) return;
  state.controller.signal.throwIfAborted();
  state.progress = { ...state.progress, message, elapsedSeconds: Math.floor((Date.now() - state.progress.startedAt) / 1000) };
}
export function trackWorkflow(req, res, next) {
  const id = key(req.params.id);
  if (active.has(id)) return res.status(409).json({ error: '当前项目已有流程在运行，请等待当前任务完成。' });
  const state = { controller: new AbortController(), progress: { running: true, message: '正在准备流程', startedAt: Date.now() } };
  active.set(id, state);
  const journals = Math.max(2, Math.min(Number(req.body?.k) || 5, 8));
  // One planning call and one scoring call per journal, plus retrieval overhead.
  const limit = (journals + 1) * 620_000 + 300_000;
  const timer = setTimeout(() => state.controller.abort(new Error(`当前流程超过 ${Math.ceil(limit / 60_000)} 分钟，已停止。请检查模型服务，或减少候选期刊数后重试。`)), limit);
  res.once('close', () => {
    clearTimeout(timer);
    if (!res.writableEnded) state.controller.abort(new Error('客户端连接已断开，流程已停止。'));
    if (active.get(id) === state) active.delete(id);
  });
  context.run(state, next);
}

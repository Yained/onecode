import { workflowSignal } from './workflow-progress.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';
const context = new AsyncLocalStorage();
export const withPlatformModel = (value, fn) => context.run(value, fn);
export const platformModelContext = () => context.getStore();
export function platformModelStatus() {
  const value = context.getStore();
  if (!value) return null;
  return { provider: '系统模型', configured: !!value.model?.providerID && !!value.model?.modelID,
    model: value.model?.modelID || '', name: value.model?.name || value.model?.modelID || '', source: 'platform' };
}
export async function callPlatformJson(messages, options = {}) {
  const value = context.getStore();
  if (!value?.model?.providerID || !value.model.modelID) throw new Error('请先在对话中选择模型，再打开智能投稿。');
  const url = new URL('/provider/submission', value.upstream);
  if (value.model.directory) url.searchParams.set('directory', value.model.directory);
  let response;
  try { response = await fetch(url, { method: 'POST', signal: workflowSignal(AbortSignal.timeout(Math.min(options.timeoutMs || 620_000, 620_000))),
    headers: { 'Content-Type': 'application/json', Authorization: value.authorization },
    body: JSON.stringify({ providerID: value.model.providerID, modelID: value.model.modelID, variant: value.model.variant,
      messages, maxTokens: options.maxTokens || 5000 }) });
  } catch (error) {
    if (['TimeoutError', 'AbortError'].includes(error.name)) throw new Error('系统模型未在 10 分钟内完成响应，流程已停止。请稍后重试或在对话中更换模型。');
    throw error;
  }
  if (!response.ok) throw new Error(`系统模型调用失败（HTTP ${response.status}），请检查对话模型及提供方连接。`);
  const result = await response.json();
  const text = String(result.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('系统模型未返回有效 JSON，请重试或在对话中更换模型。'); }
  return { data, trace: { provider: result.provider, model: result.model, source: 'platform' } };
}

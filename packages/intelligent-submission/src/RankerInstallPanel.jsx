import { useEffect, useState, useRef } from 'react';
import { api } from './api.js';
import { useWorkspaceState } from './workspace-state.js';

export function RankerInstallPanel({ modelId, onStatus, onDelete, disabled, onSelect, selected }) {
  const [, setModelStatus] = useWorkspaceState('modelStatus', null);
  const lastReady = useRef(false);
  const [status, setStatus] = useState(null);
  const [taskAction, setTaskAction] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');
  const testGeneration = useRef(0);
  const testConnection = async () => {
    const generation = ++testGeneration.current;
    setTesting(true); setTestResult('');
    try { const result = await api.testRanker(modelId); if (generation === testGeneration.current) setTestResult(result.message); }
    catch (failure) { if (generation === testGeneration.current) setTestResult(`连接失败：${failure.message}`); }
    finally { setTesting(false); }
  };
  useEffect(() => {
    let stopped = false;
    let timer;
    const poll = async () => {
      try {
        const result = await api.localRankers();
        const next = result.models.find(model => model.id === modelId);
        if (!stopped) {
          if (!next) throw new Error('服务器未返回该模型的信息，请重试。');
          setStatusError('');
          setStatus(next); onStatus?.(next);
          if (lastReady.current !== !!next?.available) {
            lastReady.current = !!next?.available;
            api.modelStatus().then(value => { if (!stopped) setModelStatus(value); }).catch(() => {});
          }
        }
      } catch (failure) { if (!stopped) setStatusError(failure.message.includes('投稿接口不存在') ? '模型管理接口尚未加载，请管理员重启 OneCode 后端后重试。' : `无法获取模型状态：${failure.message}`); }
      if (!stopped) timer = setTimeout(poll, 2000);
    };
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [modelId, onStatus, setModelStatus, refresh]);
  const install = async () => {
    setSubmitting(true); setError('');
    try { const next = await api.installRanker(modelId); setStatus(next); onStatus?.(next); setRefresh(value => value + 1); }
    catch (failure) { setError(failure.message); }
    finally { setSubmitting(false); }
  };
  const manageTask = async action => {
    testGeneration.current += 1;
    setTestResult(''); setTaskAction(true); setError('');
    try { const next = await api[action](modelId); setStatus(next); onStatus?.(next); setRefresh(value => value + 1); return next; }
    catch (failure) { setError(failure.message); }
    finally { setTaskAction(false); }
  };
  const deleteModel = async () => {
    if (!window.confirm('确定删除已下载的模型文件吗？删除后需要重新下载才能使用。')) return;
    const next = await manageTask('deleteRanker');
    if (next && !next.installed) onDelete?.(modelId);
  };
  const expectedBytes = Number(status?.downloadGB) * 1e9;
  const progress = status?.phase === 'starting' ? 100 : expectedBytes > 0
    ? Math.min(99, Math.max(0, Number(status?.downloadedBytes) || 0) / expectedBytes * 100) : 0;
  return <div className="ranker-install-panel">
    <strong>本地 Ranker</strong>
    <p>下载到{status?.location || '运行 OneCode 后端的机器'}。远程访问时会安装到服务器，不会下载到浏览器设备。</p>
    {status && <>
      <p>模型约 {status.downloadGB} GB，首次安装建议预留 {status.diskGB} GB（含推理环境）。需要 {status.requirements}。</p>
      <p role="status" aria-live="polite">{status.message}{status.downloadedBytes > 0 && status.busy ? ` · 已下载 ${(status.downloadedBytes / 1e9).toFixed(2)} GB` : ''}</p>
      {status.busy && status.phase !== 'removing' && <div className="ranker-download-controls"><div className="ranker-download-meter"><progress max="100" value={progress} aria-label="模型下载进度" aria-valuetext={`约 ${Math.floor(progress)}%`}>{Math.floor(progress)}%</progress><span aria-hidden="true">约 {Math.floor(progress)}%</span></div><div>{status.phase === 'paused' ? <button type="button" className="button button-secondary" onClick={() => manageTask('resumeRanker')} disabled={taskAction || disabled}>继续</button> : <button type="button" className="button button-secondary" onClick={() => manageTask('pauseRanker')} disabled={taskAction || disabled}>暂停</button>}<button type="button" className="button button-secondary" onClick={() => manageTask('cancelRanker')} disabled={taskAction || disabled}>取消</button></div></div>}
      {status.installed && <div className="ranker-model-actions"><button type="button" className="button button-secondary" onClick={testConnection} disabled={testing || status.busy || taskAction || disabled}>{testing ? '正在测试…' : '测试连通性'}</button><button type="button" className="button button-secondary" onClick={deleteModel} disabled={status.busy || taskAction || testing || disabled}>删除模型</button>{status.available && onSelect && <button type="button" className="button button-primary" onClick={onSelect} disabled={status.busy || taskAction || disabled}>{selected ? '继续使用此模型' : '使用此模型评分'}</button>}</div>}
      {testResult && <p role="status">{testResult}</p>}
      {!status.supported && <p>此设备暂不支持当前 CUDA 推理环境，请使用系统对话模型 API。</p>}
      {!status.enabled && <p>管理员已关闭本机模型安装。</p>}
      {!status.available && <button className="button button-secondary" onClick={install} disabled={!status.supported || !status.enabled || status.busy || submitting || disabled}>
        {status.busy || submitting ? '正在安装或加载…' : status.installed ? '启用本地模型' : status.phase === 'error' ? '重试下载安装' : '一键下载安装并启用'}
      </button>}
    </>}
    {!status && !statusError && <p role="status">正在检查本地模型状态…</p>}
    {statusError && <div role="alert"><p>{statusError}</p><button type="button" className="button button-secondary" onClick={() => setRefresh(value => value + 1)}>重新检查模型状态</button></div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

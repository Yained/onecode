import { useEffect, useRef } from 'react';
import { RankerInstallPanel } from './RankerInstallPanel.jsx';

const models = [
  { id: 'ranker-0.6b', name: 'Qwen3 · 0.6B Ranker', description: '轻量模型，下载体积小，适合优先体验本地评分。' },
  { id: 'ranker-3b', name: 'Qwen2.5 · 3B Ranker', description: '中等规模模型，需要更多显存。' },
  { id: 'ranker-8b', name: 'Llama 3 · 8B Ranker', description: '较大规模模型，对磁盘与显存要求较高。' },
];

export function RankerModelDialog({ onClose, onSelect, onDelete, selected }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="ranker-model-dialog" aria-labelledby="ranker-dialog-title" onCancel={onClose} onClose={onClose}>
    <header><div><h2 id="ranker-dialog-title">添加其他模型</h2><p>下载训练好的 Ranker，在运行 OneCode 后端的机器上评分。</p></div><button type="button" className="button button-secondary" onClick={onClose} aria-label="关闭模型窗口">关闭</button></header>
    <div className="ranker-model-list">{models.map(model => <article key={model.id} aria-label={model.name}>
      <h3>{model.name}</h3><p>{model.description}</p><p>包含基座模型、训练权重、评分头与校准文件。</p>
      <RankerInstallPanel modelId={model.id} onSelect={() => onSelect(model.id)} onDelete={onDelete} selected={selected === model.id} />
    </article>)}</div>
    <p className="ranker-dialog-note">下载过程中可以关闭窗口，后台会继续下载；重新打开可查看进度。</p>
  </dialog>;
}

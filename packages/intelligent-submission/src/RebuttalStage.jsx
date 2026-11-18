import { FileCheck2, Loader2, Download } from 'lucide-react';
import { api } from './api.js';
import { useWorkspaceState } from './workspace-state.js';

const priorities = { high: '优先处理', medium: '建议修改', low: '细节完善' };

function downloadReport(report) {
  const lines = ['# Rebuttal 论文修改建议', '', `论文：${report.manuscript?.title || ''}`, `生成时间：${report.generatedAt}`, '', report.summary];
  for (const item of report.items) lines.push('', `## 意见 ${item.id} · ${priorities[item.priority]}`, '', item.comment, '', `修改位置：${item.location}`, '', `原文依据：${item.evidence || '未在提供内容中找到可核对的原句，请作者核实。'}`, '', `修改建议：${item.suggestion}`, '', `待补充或核实：${item.verification}`, '', `回应思路：${item.responseOutline || '结合实际修改后填写。'}`);
  lines.push('', report.notice);
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'rebuttal-revision-plan.md';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function RebuttalStage({ project, busy, runAction, modelStatus }) {
  const report = project.rebuttal;
  const [comments, setComments] = useWorkspaceState(`rebuttal.${project.id}.comments`, report?.items.map((item) => item.comment).join('\n\n') || '');
  const [file, setFile] = useWorkspaceState(`rebuttal.${project.id}.file`, null);
  const savedComments = report?.items.map((item) => item.comment).join('\n\n');
  const changed = report && (comments.trim() !== savedComments || Boolean(file));
  const generate = async (event) => {
    event.preventDefault();
    const form = new FormData();
    form.append('comments', comments);
    if (file) form.append('paper', file);
    const result = await runAction('rebuttal', () => api.generateRebuttal(project.id, form), 4);
    if (result) setFile(null);
  };
  return (
    <div className="stage-content rebuttal-stage">
      <div className="stage-heading"><div><span>REBUTTAL & REVISION</span><h2>根据评审意见修改论文</h2><p>逐条理解评审意见，结合原文制定修改方案和回应思路。</p></div></div>
      <form className="surface-card rebuttal-form" onSubmit={generate}>
        <label htmlFor="rebuttal-comments">评审意见</label><textarea id="rebuttal-comments" value={comments} onChange={(event) => setComments(event.target.value)} maxLength={20000} required disabled={!!busy} placeholder={'请粘贴真实评审意见，每条之间用空行分隔。例如：\nReviewer 1：请补充与现有方法的对比实验。\n\nReviewer 2：请进一步说明数据集构建和样本筛选标准。'} />
        <small>每次最多 20 条、20,000 字符。保留 Reviewer 编号，便于逐条回应。当前 {comments.length.toLocaleString()} 字符。</small>
        <label htmlFor="rebuttal-paper">论文文件（可选重新上传）<input id="rebuttal-paper" type="file" accept=".pdf,.docx,.txt,.md" disabled={!!busy} onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
        <small>{file ? `已选择：${file.name}。本次建议将以此文件为依据。` : `优先使用本项目上传的论文：${report?.manuscript?.filename || project.document.filename || project.name}。若原文已失效，请重新选择；也可上传修订稿。`} 文件仅驻留内存，最大 15 MB。</small>
        {file && <button type="button" className="button button-secondary" disabled={!!busy} onClick={() => { setFile(null); document.getElementById('rebuttal-paper').value = ''; }}>取消重新上传</button>}
        <div className="rebuttal-actions"><button className="button button-primary" type="submit" disabled={!!busy || !comments.trim() || modelStatus?.llm?.configured === false}>{busy === 'rebuttal' ? <Loader2 size={17} className="spin" /> : <FileCheck2 size={17} />}{busy === 'rebuttal' ? '正在逐条分析…' : report ? '重新生成修改建议' : '生成修改建议'}</button><small>{modelStatus?.llm?.configured === false ? '请先在对话中选择模型。' : '使用当前对话模型分析论文与评审意见。'}</small></div>
      </form>
      {report && <section className="rebuttal-report" aria-label="逐条修改建议">
        <header><div><h3>论文修订计划</h3><p className="rebuttal-meta">{report.model} · {new Date(report.generatedAt).toLocaleString('zh-CN')} · 共 {report.items.length} 条意见</p></div><button className="button button-secondary" onClick={() => downloadReport(report)}><Download size={16} />下载修改建议</button></header>
        {changed && <p className="catalog-notice">输入已更新，下方仍为上次生成的结果；请重新生成以匹配最新意见和论文。</p>}
        {report.inputCoverage?.truncated && <p className="catalog-notice">论文较长，本次分析使用开头和结尾共 60,000 字符；中间未提供内容需要作者核实。</p>}
        <p>{report.summary}</p>
        {report.items.map((item) => <article className="surface-card rebuttal-item" key={item.id}>
          <header><h4>评审意见 {item.id}</h4><span className="rebuttal-priority">{priorities[item.priority]}</span></header>
          <blockquote>{item.comment}</blockquote>
          <dl><div><dt>建议修改位置</dt><dd>{item.location}</dd></div><div><dt>原文依据</dt><dd>{item.evidence || '未在提供内容中找到可核对的原句，请作者结合完整论文核实。'}</dd></div><div><dt>具体修改建议</dt><dd>{item.suggestion}</dd></div><div><dt>需要补充或核实</dt><dd>{item.verification}</dd></div><div><dt>回应思路</dt><dd>{item.responseOutline || '完成修改后，结合实际证据组织回应。'}</dd></div></dl>
        </article>)}
        <p className="catalog-notice">{report.notice}</p>
      </section>}
    </div>
  );
}

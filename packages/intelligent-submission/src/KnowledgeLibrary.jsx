import { useEffect, useState } from 'react';
import { Download, Pencil, Trash2, UploadCloud } from 'lucide-react';
import { api } from './api.js';

export function KnowledgeLibrary() {
  const [items,setItems] = useState([]);
  const [query,setQuery] = useState('');
  const [selected,setSelected] = useState(null);
  const [editing,setEditing] = useState(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const refresh = () => api.knowledge(query).then(setItems);
  useEffect(()=>{ let active=true; api.knowledge().then(value=>{if(active)setItems(value)}).catch(error=>{if(active)setError(error.message)}); return ()=>{active=false}; },[]);
  const run = async action => {setBusy(true);setError('');try{await action()}catch(error){setError(error.message)}finally{setBusy(false)}};
  const upload = event => {
    const file=event.target.files?.[0]; event.target.value=''; if(!file)return;
    run(async()=>{const body=new FormData();body.append('paper',file);await api.uploadKnowledge(body);await refresh()});
  };
  const download = item => run(async()=>{
    const blob=await api.downloadKnowledge(item.id);const url=URL.createObjectURL(blob);const link=document.createElement('a');
    link.href=url;link.download=item.filename||'paper';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  const closeDialog = () => {setSelected(null);setEditing(null);setError('')};
  const beginEdit = item => {
    setError('');setSelected(item);
    setEditing({title:item.title||'',abstract:item.abstract||'',keywords:(item.keywords||[]).join('，')});
  };
  const saveEdit = event => {
    event.preventDefault();
    if (!selected || !editing) return;
    run(async()=>{
      const updated=await api.editKnowledge(selected.id,{
        title:editing.title,
        abstract:editing.abstract,
        keywords:editing.keywords.split(/[,，;；、\n]/).map(word=>word.trim()).filter(Boolean),
      });
      setSelected(updated);setEditing(null);await refresh();
    });
  };
  const remove = item => {
    if (!window.confirm(`确定从论文库删除《${item.title||item.filename}》吗？删除后原文也将无法从论文库下载。`)) return;
    run(async()=>{await api.deleteKnowledge(item.id);if(selected?.id===item.id)closeDialog();await refresh()});
  };
  return <section className="stage-content knowledge-library">
    <div className="knowledge-heading"><div><span className="section-kicker">PAPER LIBRARY</span><h2>论文库</h2><p>查看论文摘要与关键词，点击卡片了解完整信息。</p></div><div className="knowledge-header-actions"><form className="knowledge-search-form" onSubmit={event=>{event.preventDefault();run(refresh)}}><input aria-label="检索论文" value={query} onChange={event=>setQuery(event.target.value)} placeholder="标题、关键词或正文"/><button className="button button-secondary" disabled={busy} type="submit">检索</button></form><label className="button button-secondary knowledge-upload-button"><UploadCloud size={17}/><span>上传论文</span><input aria-label="上传论文" type="file" accept=".pdf,.docx,.txt,.md" onChange={upload} disabled={busy}/></label></div></div>
    {error && <div role="alert" className="error-banner">{error}</div>}
    <p className="library-count">{items.length} 篇论文</p>
    <div className="knowledge-card-grid">{items.map(item=><article className="surface-card knowledge-card" key={item.id}>
      <button className="knowledge-card-open" disabled={busy} onClick={()=>run(async()=>setSelected(await api.knowledgeDocument(item.id)))}>
        <h3>{item.title||item.filename}</h3><p>{item.abstract||'暂无摘要'}</p>
        <div className="keyword-cloud">{(item.keywords||[]).map(word=><span key={word}>{word}</span>)}</div>
      </button>
      <div className="knowledge-card-footer"><small>{item.filename} · {item.coverage==='full-text'?'已保存全文':'仅元数据'}</small><div className="knowledge-card-actions"><button className="button button-secondary" disabled={busy} onClick={()=>beginEdit(item)}><Pencil size={16}/><span>编辑</span></button><button className="button button-secondary knowledge-delete-button" disabled={busy} onClick={()=>remove(item)}><Trash2 size={16}/><span>删除</span></button><button className="button button-primary" disabled={busy} onClick={()=>download(item)}><Download size={16}/><span>下载论文</span></button></div></div>
    </article>)}</div>
    {!items.length && <p>暂无论文。可从右上角上传，也可在投稿流程上传后自动加入。</p>}
    {selected && <div className="paper-modal-backdrop" role="presentation" onClick={closeDialog}><section className="surface-card paper-modal" role="dialog" aria-modal="true" aria-labelledby="paper-title" onClick={event=>event.stopPropagation()}>
      <button className="paper-modal-close" onClick={closeDialog} aria-label="关闭" disabled={busy}>×</button>
      {editing ? <form className="paper-edit-form" onSubmit={saveEdit}>
        <h2 id="paper-title">编辑论文</h2>
        <label>标题<input value={editing.title} onChange={event=>setEditing({...editing,title:event.target.value})} maxLength={500} required/></label>
        <label>摘要<textarea value={editing.abstract} onChange={event=>setEditing({...editing,abstract:event.target.value})} maxLength={20000} rows={7}/></label>
        <label>关键词（用逗号分隔）<input value={editing.keywords} onChange={event=>setEditing({...editing,keywords:event.target.value})}/></label>
        <div className="paper-modal-actions"><button className="button button-secondary" type="button" disabled={busy} onClick={()=>setEditing(null)}>取消</button><button className="button button-primary" type="submit" disabled={busy}>保存修改</button></div>
      </form> : <><h2 id="paper-title">{selected.title||selected.filename}</h2><h3>摘要</h3><p>{selected.abstract||'暂无摘要'}</p><h3>关键词</h3><div className="keyword-cloud">{(selected.keywords||[]).map(word=><span key={word}>{word}</span>)}</div><div className="paper-modal-actions"><button className="button button-secondary" disabled={busy} onClick={()=>beginEdit(selected)}><Pencil size={16}/><span>编辑</span></button><button className="button button-secondary knowledge-delete-button" disabled={busy} onClick={()=>remove(selected)}><Trash2 size={16}/><span>删除</span></button><button className="button button-primary" disabled={busy} onClick={()=>download(selected)}><Download size={16}/><span>下载论文</span></button></div></>}
      {error && <p role="alert" className="error-banner">{error}</p>}
    </section></div>}
  </section>;
}

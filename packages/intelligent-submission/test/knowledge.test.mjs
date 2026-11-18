import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withAccount, saveProject, accountScope } from '../server/lib/store.mjs';
import { addKnowledgeDocument, listKnowledge, getKnowledgeDocument, deleteKnowledgeDocument, retrieveKnowledge, validateKnowledgeNotes } from '../server/lib/knowledge.mjs';
import { analyzeKnowledgeWithDeepSeek } from '../server/lib/deepseek.mjs';

test('private knowledge persists, isolates tenants, deduplicates concurrent uploads and respects deletions', async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'knowledge-test-'));process.env.SUBMISSION_STORAGE_DIR=dir;
  const doc={title:'Information retrieval evaluation',filename:'prior.txt',abstract:'Scientific information retrieval with documented baselines.',keywords:['information retrieval'],text:'Scientific information retrieval with documented baselines. Private prior work.'};
  try {
    await assert.rejects(listKnowledge(),/账号/);
    const saved=await withAccount('alice',async()=>{
      const uploaded=await Promise.all(Array.from({length:5},()=>addKnowledgeDocument(doc)));
      assert.equal(new Set(uploaded.map(item=>item.id)).size,1);
      assert.equal((await listKnowledge()).length,1);
      assert.equal((await listKnowledge())[0].text,undefined);
      assert.equal((await getKnowledgeDocument(uploaded[0].id)).text,doc.text);
      assert.equal((await stat(path.join(dir,accountScope(),'knowledge.json'))).mode&0o777,0o600);
      assert.equal((await retrieveKnowledge(doc)).sources.length,0);
      const context=await retrieveKnowledge({...doc,title:'New retrieval benchmark',filename:'new.txt',text:'Current manuscript: information retrieval evaluation.'});
      assert.equal(context.sources.length,1);
      assert.equal(context.sources[0].id,uploaded[0].id);
      return uploaded[0];
    });
    await withAccount('bob',async()=>{
      assert.deepEqual(await listKnowledge(),[]);
      assert.equal(await getKnowledgeDocument(saved.id),null);
      assert.equal(await deleteKnowledgeDocument(saved.id),false);
      assert.equal((await retrieveKnowledge(doc)).sources.length,0);
    });
    await withAccount('alice',async()=>{
      await saveProject({id:'legacy',document:{title:'Legacy retrieval',filename:'old.txt',abstract:'Information retrieval background',keywords:['information retrieval']}});
      const old=(await listKnowledge()).find(item=>item.filename==='old.txt');
      assert.equal(old.coverage,'metadata-only');
      const upgraded=await addKnowledgeDocument({title:old.title,filename:old.filename,abstract:old.abstract,text:'Information retrieval background with full content'});
      assert.equal(upgraded.id,old.id);assert.equal(upgraded.coverage,'full-text');
      assert.equal(await deleteKnowledgeDocument(old.id),true);
      assert.ok(!(await listKnowledge()).some(item=>item.id===old.id));
      assert.equal(await deleteKnowledgeDocument(saved.id),true);
      assert.deepEqual(await listKnowledge(),[]);
    });
  }finally{await rm(dir,{recursive:true,force:true});delete process.env.SUBMISSION_STORAGE_DIR;}
});

test('knowledge notes require source IDs and verbatim quotes; model receives a distinct private context',async()=>{
  const context={sources:[{id:'private-1',title:'Earlier work',coverage:'metadata-only',snippets:[{excerpt:'Information retrieval uses documented baselines.'}]}]};
  const good={sourceId:'private-1',quote:'documented baselines',relationship:'同样讨论检索评价',suggestion:'建议比较基线设置',keywords:['信息检索']};
  assert.equal(validateKnowledgeNotes([good,{...good,sourceId:'other-user'},{...good,quote:'fabricated result'}],context).length,1);
  let request;
  const result=await analyzeKnowledgeWithDeepSeek({title:'Current evaluation',abstract:'Current-only results'},context,{env:{DEEPSEEK_API_KEY:'fixture'},fetchImpl:async(_url,init)=>{
    request=JSON.parse(init.body);return Response.json({choices:[{message:{content:JSON.stringify({knowledge_notes:[good]})}}]});
  }});
  assert.equal(result.notes.length,1);
  assert.match(request.messages[1].content,/Current-only results/);
  assert.match(request.messages[1].content,/不参与评分/);
  assert.match(request.messages[1].content,/metadata-only/);
});

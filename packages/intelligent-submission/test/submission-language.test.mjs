import test from 'node:test';
import assert from 'node:assert/strict';
import { detectManuscriptLanguage, projectTargetLanguage } from '../shared/submission-language.mjs';
import { supplementChineseJournals, selectLanguageCandidates, chineseCatalogCandidates, expandChineseQueries } from '../server/lib/language-discovery.mjs';
import { enrichDiscoveredJournal } from '../server/lib/journal-discovery.mjs';
import { discoverJournalSourcesFromWorks, findRecentSimilarPapers } from '../server/lib/scholarly-search.mjs';
import { generateJournalSearchPlanWithDeepSeek } from '../server/lib/deepseek.mjs';
const env = { OPENALEX_API_KEY: 'test-only' };
const source = (id, name, extra = {}) => ({ id, name, openAlexUrl: `https://openalex.org/${id}`, subjects: [], ...extra });

test('Chinese manuscript defaults to Chinese, explicit selection overrides detection, unknown stays unrestricted', () => {
  assert.equal(detectManuscriptLanguage({ title: '中文学术论文信息检索方法', abstract: 'An English translated abstract with several words.' }), 'zh');
  assert.equal(projectTargetLanguage({ document: { title: '中文学术论文信息检索方法' }, profile: { targetLanguage: 'en' } }), 'en');
  assert.equal(detectManuscriptLanguage({ title: 'Evaluation of research information retrieval methods' }), 'en');
  assert.equal(detectManuscriptLanguage({ title: '研究の方法' }), 'all');
  assert.equal(detectManuscriptLanguage({}), 'all');
});

test('strict Chinese mode uses catalog identity rather than journal display-name language or metadata alone', () => {
  const chinese = source('S1','Journal of Computer Applications',{issn:'1001-9081', countryCode:'CN', metadataLanguage:'en'});
  const english = source('S2','Some English Journal',{metadataLanguage:'zh'});
  const lookalike = source('S3','Journal of Software',{issn:'9999-9999',countryCode:'US',metadataLanguage:'zh'});
  assert.equal(selectLanguageCandidates([chinese, english, lookalike],'zh').length,1);
  assert.equal(selectLanguageCandidates([chinese],'zh')[0].name,'计算机应用');
  assert.equal(enrichDiscoveredJournal(lookalike).language,null);
  assert.equal(selectLanguageCandidates([chinese,english],'en').length,1);
  assert.equal(selectLanguageCandidates([chinese,english],'all').length,2);
});

test('work discovery sends selected language filter, ignores contradictory records, unrestricted does not filter', async () => {
  for (const targetLanguage of ['zh','en','all']) {
    const seen=[];
    const result=await discoverJournalSourcesFromWorks(['information retrieval'], { env, targetLanguage, fetchImpl: async value => {
      const url=new URL(value); seen.push(url);
      if(url.pathname==='/works') return Response.json({results:['zh','en'].map((language,i)=>({id:`W${i}`,language,publication_year:2026,primary_location:{source:{id:`https://openalex.org/S${i}`,display_name:`Journal ${i}`,type:'journal'}},relevance_score:10}))});
      return Response.json({id:`https://openalex.org/${url.pathname.split('/').pop()}`,display_name:'Journal',type:'journal'});
    }});
    const filter=seen[0].searchParams.get('filter');
    if(targetLanguage==='all') { assert.doesNotMatch(filter,/language:/);assert.equal(result.sources.length,2); }
    else { assert.ok(filter.includes(`language:${targetLanguage}`));assert.equal(result.sources.length,1); }
  }
});

test('verified Chinese journals retain English-translated metadata; English mode filters recent records', async () => {
  for(const targetLanguage of ['zh','en']) {
    const filters=[];
    const result=await findRecentSimilarPapers({name:'计算机应用'},[],{env,targetLanguage,source:{id:'S1'},queries:['information retrieval'],fetchImpl:async value=>{
      filters.push(new URL(value).searchParams.get('filter'));
      return Response.json({results:['zh','en'].map((language,i)=>({id:`W${i}`,display_name:'Relevant article',language,publication_year:2026,primary_location:{},relevance_score:10}))});
    }});
    assert.equal(result.items.length,targetLanguage==='zh'?2:1);
    if(targetLanguage==='zh') assert.doesNotMatch(filters[0],/language:/); else assert.match(filters[0],/language:en/);
  }
});

test('Chinese catalog supplementation requires real matching paper evidence, never pads from static list', async () => {
  let evidence=false;
  const fetchImpl=async value=>{
    const url=new URL(value);
    if(url.pathname==='/sources') return Response.json({results:url.searchParams.get('filter')?.includes('1001-9081')?[{id:'https://openalex.org/S1',display_name:'Journal of Computer Applications',type:'journal',issn_l:'1001-9081',country_code:'CN',works_count:1000}]:[]});
    return Response.json({results:evidence?[{id:'https://openalex.org/W1',display_name:'Information retrieval method',publication_year:2026,language:'en',primary_location:{},relevance_score:30}]:[]});
  };
  assert.equal((await supplementChineseJournals(['information retrieval'],['人工智能'],{env,fetchImpl})).sources.length,0);
  evidence=true;
  const result=await supplementChineseJournals(['information retrieval'],['人工智能'],{env,fetchImpl});
  assert.equal(result.sources.length,1);
  assert.equal(selectLanguageCandidates(result.sources,'zh')[0].language,'zh');
});

test('search-plan prompt follows target language without sending English-only instructions for Chinese', async () => {
  for(const targetLanguage of ['zh','en','all']) {
    let system;
    await generateJournalSearchPlanWithDeepSeek({document:{title:'中文信息检索'},profile:{}},{targetLanguage,env:{DEEPSEEK_API_KEY:'test'},fetchImpl:async (_url, init)=>{
      system=JSON.parse(init.body).messages[0].content;
      return Response.json({choices:[{message:{content:JSON.stringify({search_queries:['信息 检索','information retrieval'],subjects:[]})}}]});
    }});
    if(targetLanguage==='zh') assert.match(system,/至少一半检索式为中文/);
    if(targetLanguage==='en') assert.match(system,/检索式使用英文/);
    if(targetLanguage==='all') assert.match(system,/目标投稿语言：不限/);
  }
});


test('expansion reaches journals beyond first eight using translated terms, stops after target batch', async () => {
  const catalog = chineseCatalogCandidates(['机器学习'], 32);
  assert.ok(catalog.length > 10);
  const seen = [];
  const fetchImpl = async value => {
    const url = new URL(value);
    seen.push(url);
    if (url.pathname === '/sources') {
      const query = url.searchParams.get('search');
      const journal = catalog.find(item => (item.englishName || item.name) === query);
      if (!journal) return Response.json({results:[]});
      const index = catalog.indexOf(journal);
      return Response.json({results:[{id:`https://openalex.org/S${index}`,display_name:journal.name,type:'journal',country_code:'CN',works_count:1000}]});
    }
    const index = Number(url.searchParams.get('filter').match(/source.id:S(\d+)/)[1]);
    return Response.json({results:index >= 8 && url.searchParams.get('search') === 'machine learning' ? [{id:`https://openalex.org/W${index}`,display_name:'Machine learning evaluation',publication_year:2026,primary_location:{},relevance_score:20}] : []});
  };
  const progress = [];
  const result = await supplementChineseJournals(['机器学习'], [], {env,fetchImpl,targetCount:2,onProgress:message=>progress.push(message)});
  assert.ok(result.sources.length >= 2);
  assert.ok(result.stats.checked > 8);
  assert.equal(result.stats.stopReason,'target-reached');
  assert.equal(result.stats.expanded,true);
  assert.ok(result.stats.checked < catalog.length);
  assert.ok(progress.some(message=>message.includes('扩展同义词')));
  assert.ok(result.sources.every(item=>item.evidenceQueries.includes('machine learning')));
  const resolves = seen.filter(url=>url.pathname==='/sources').map(url=>url.search);
  assert.equal(resolves.length,new Set(resolves).size);
});

test('synonyms stay on topic; existing sufficient evidence avoids extra requests', async () => {
  assert.ok(expandChineseQueries(['信息检索'],[]).includes('information retrieval'));
  assert.ok(!expandChineseQueries(['信息检索'],[]).includes('deep learning'));
  const result = await supplementChineseJournals(['信息检索'], [], {targetCount:1,existingSources:[source('S1','Journal of Computer Applications',{issn:'1001-9081',countryCode:'CN'})],fetchImpl:()=>{throw new Error('unexpected request')}});
  assert.equal(result.stats.checked,0);
  assert.equal(result.stats.stopReason,'target-reached');
});

test('catalog expansion has a bounded time budget and reports partial coverage', async () => {
  const result = await supplementChineseJournals(['信息检索'],[],{env,budgetMs:1,fetchImpl:async()=>{await new Promise(resolve=>setTimeout(resolve,5));return Response.json({results:[]});}});
  assert.equal(result.stats.stopReason,'time-budget');
  assert.equal(result.sources.length,0);
  assert.ok(result.stats.checked <= 3);
});


test('scoring retrieval prefers abstract-bearing papers over title-only records within the requested limit', async () => {
  const result = await findRecentSimilarPapers({name:'Test journal'},[],{env,source:{id:'S1'},limit:1,preferAbstract:true,queries:['information retrieval'],fetchImpl:async()=>Response.json({results:[
    {id:'W1',display_name:'Title-only result',publication_year:2026,relevance_score:90},
    {id:'W2',display_name:'Related paper with abstract',publication_year:2026,relevance_score:70,abstract_inverted_index:{'Information':[0],'retrieval':[1]}}
  ]})});
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].id,'W2');
});

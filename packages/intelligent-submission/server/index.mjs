import { localRankers, LOCAL_RANKERS } from './lib/local-ranker.mjs';
import { accountScope } from './lib/store.mjs';
import { addKnowledgeDocument, listKnowledge, getKnowledgeDocument, getKnowledgeOriginal, editKnowledgeDocument, deleteKnowledgeDocument } from './lib/knowledge.mjs';
import 'dotenv/config';
import { detectManuscriptLanguage, projectTargetLanguage, validTargetLanguage, languageLabels } from '../shared/submission-language.mjs';
import { supplementChineseJournals, selectLanguageCandidates } from './lib/language-discovery.mjs';
import { trackWorkflow, workflowProgress, workflowStage } from './lib/workflow-progress.mjs';
import { platformModelContext } from './lib/platform-model.mjs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { extractDocument } from './lib/extractor.mjs';
import { analyzeDocument } from './lib/analyzer.mjs';
import {
  analyzeManuscriptWithDeepSeek,
  generateJournalSearchPlanWithDeepSeek,
  getDeepSeekStatus,
} from './lib/deepseek.mjs';
import { discoverJournalSourcesFromWorks, getOpenAlexStatus, findRecentSimilarPapers } from './lib/scholarly-search.mjs';
import {
  fallbackManuscriptScore,
  fallbackReferenceScore,
} from './lib/reviewer-client.mjs';
import {
  getRankerServiceStatus,
  scoreFromRanker,
  scorePapersWithRanker,
} from './lib/ranker-client.mjs';
import {
  getDeepSeekScorerStatus,
  scoreFromDeepSeek,
  scorePapersWithDeepSeek,
} from './lib/deepseek-scorer.mjs';
import {
  DEFAULT_SCORING_MODEL,
  SCORING_MODELS,
  normalizeScoringModel,
  scoringModelDefinition,
} from './lib/scoring-models.mjs';
import {
  compareWithJournalBenchmark,
  enrichJournalMetrics,
  selectDistinctJournals,
  workflowKeywords,
} from './lib/review-flow.mjs';
import { enrichDiscoveredJournal, prestigeBandForDiscovered } from './lib/journal-discovery.mjs';
import { journalCatalog, journals } from './data/journals.mjs';
import { getProject, listProjects, patchProject, saveProject } from './lib/store.mjs';

import { generateRebuttal, parseReviewComments } from './lib/rebuttal.mjs';

export const app = express();
const port = Number(process.env.PORT || 3001);
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});
const volatileDocuments = new Map();
const volatileRebuttalDocuments = new Map();

app.use(express.json({ limit: '2mb' }));

function publicDocument(document) {
  const { text, ...metadata } = document;
  return metadata;
}

async function createProjectFromDocument(document, profile, options = {}) {
  const analysis = analyzeDocument(document);
  const modelStatus = getDeepSeekStatus();
  let aiAnalysis = null;
  if (modelStatus.configured && options.useAI !== false) {
    try {
      aiAnalysis = await analyzeManuscriptWithDeepSeek(document);
    } catch (error) {
      aiAnalysis = {
        status: 'error',
        model: modelStatus.model,
        generatedAt: new Date().toISOString(),
        message: '论文已解析，AI 深度评估未完成。已保留标题、摘要、关键词及基础评估，可继续使用。',
      };
      console.error(`Model assessment failed: ${error.message}`);
    }
  }
  const now = new Date().toISOString();
  const project = {
    id: crypto.randomUUID(),
    name: document.title,
    status: aiAnalysis?.status === 'ready' ? 'AI 深度评估已完成' : '已完成初评',
    stage: 1,
    createdAt: now,
    updatedAt: now,
    profile: { ...profile, manuscriptLanguage: detectManuscriptLanguage(document), targetLanguage: profile.targetLanguage || detectManuscriptLanguage(document) },
    document: publicDocument(document),
    analysis,
    aiAnalysis,
    reviewFlow: null,
  };
  volatileDocuments.set(project.id, document);
  await saveProject(project);
  return project;
}

app.get('/api/health', async (_request, response) => {
  response.json({
    ok: true,
    service: 'onescience-submission-agent',
    version: '0.7.0',
    model: getDeepSeekStatus(),
    scholarlySearch: getOpenAlexStatus(),
    ranker: await getRankerServiceStatus(),
  });
});

app.get('/api/model/status', async (_request, response) => {
  const rankerStatuses = await Promise.all(
    SCORING_MODELS.filter((model) => model.kind === 'ranker')
      .map((model) => getRankerServiceStatus({ modelId: model.id })),
  );
  const deepSeekScorer = getDeepSeekScorerStatus();
  response.json({
    llm: getDeepSeekStatus(),
    scholarlySearch: getOpenAlexStatus(),
    ranker: rankerStatuses[0],
    scoringModels: [...rankerStatuses, {
      ...deepSeekScorer,
      id: 'deepseek',
      label: '系统对话模型',
      kind: 'deepseek',
    }],
  });
});

// The gateway supplies the verified account and enforces same-origin writes.
app.get('/api/rankers/local', async (_request, response, next) => {
  if (!accountScope()) return response.status(401).json({ error: '请先登录 OneCode。' });
  try { response.json({ models: await localRankers.list() }); } catch (error) { next(error); }
});
app.post('/api/rankers/local/:id/install', async (request, response) => {
  if (!accountScope()) return response.status(401).json({ error: '请先登录 OneCode。' });
  if (!Object.hasOwn(LOCAL_RANKERS, request.params.id)) return response.status(422).json({ error: '不支持的本地 Ranker 模型。' });
  try { response.status(202).json(await localRankers.install(request.params.id)); }
  catch (error) { response.status(409).json({ error: error.message }); }
});

app.post('/api/rankers/local/:id/pause', async (request, response) => {
  if (!accountScope()) return response.status(401).json({ error: '请先登录 OneCode。' });
  if (!Object.hasOwn(LOCAL_RANKERS, request.params.id)) return response.status(422).json({ error: '不支持的本地 Ranker 模型。' });
  try { response.json(await localRankers.pause(request.params.id)); }
  catch (error) { response.status(409).json({ error: error.message }); }
});
app.post('/api/rankers/local/:id/resume', async (request, response) => {
  if (!accountScope()) return response.status(401).json({ error: '请先登录 OneCode。' });
  if (!Object.hasOwn(LOCAL_RANKERS, request.params.id)) return response.status(422).json({ error: '不支持的本地 Ranker 模型。' });
  try { response.json(await localRankers.resume(request.params.id)); }
  catch (error) { response.status(409).json({ error: error.message }); }
});
app.post('/api/rankers/local/:id/cancel', async (request, response) => {
  if (!accountScope()) return response.status(401).json({ error: '请先登录 OneCode。' });
  if (!Object.hasOwn(LOCAL_RANKERS, request.params.id)) return response.status(422).json({ error: '不支持的本地 Ranker 模型。' });
  try { response.json(await localRankers.cancel(request.params.id)); }
  catch (error) { response.status(409).json({ error: error.message }); }
});
app.delete('/api/rankers/local/:id', async (request, response) => {
  if (!accountScope()) return response.status(401).json({ error: '请先登录 OneCode。' });
  if (!Object.hasOwn(LOCAL_RANKERS, request.params.id)) return response.status(422).json({ error: '不支持的本地 Ranker 模型。' });
  try { response.json(await localRankers.remove(request.params.id)); }
  catch (error) { response.status(409).json({ error: error.message }); }
});

app.post('/api/rankers/local/:id/test', async (request, response) => {
  if (!accountScope()) return response.status(401).json({ error: '请先登录 OneCode。' });
  if (!Object.hasOwn(LOCAL_RANKERS, request.params.id)) return response.status(422).json({ error: '不支持的本地 Ranker 模型。' });
  try {
    if (!await localRankers.installed(request.params.id)) return response.status(409).json({ error: '模型尚未安装或已删除，请重新下载安装。' });
    const started = Date.now();
    const connection = await localRankers.start(request.params.id);
    const result = await fetch(`${connection.baseUrl}/v1/models`, { headers: { Authorization: `Bearer ${connection.apiKey}` }, signal: AbortSignal.timeout(10000) });
    if (!result.ok) throw new Error('本地模型未通过连通性检查，请重新启用后重试。');
    response.json({ available: true, message: `连接成功，本地模型服务已就绪（${Date.now() - started} ms）。` });
  } catch (error) { response.status(409).json({ error: error.message }); }
});

app.get('/api/journals', (_request, response) => {
  response.json({
    catalog: { ...journalCatalog, size: journals.length },
    items: journals.map(({ keywords, ...item }) => item),
  });
});

app.get('/api/knowledge', async (req, res, next) => {
  try { res.json(await listKnowledge(req.query.q)); } catch (error) { next(error); }
});
app.get('/api/knowledge/:id', async (req, res, next) => {
  try { const item = await getKnowledgeDocument(req.params.id); if (!item) return res.status(404).json({error:'未找到该知识库论文。'}); res.json(item); } catch (error) { next(error); }
});
app.post('/api/knowledge', upload.single('paper'), async (req, res, next) => {
  try { if (!req.file) return res.status(400).json({error:'请选择论文文件。'}); res.status(201).json(await addKnowledgeDocument(await extractDocument(req.file), null, req.file)); } catch (error) { next(error); }
});
app.patch('/api/knowledge/:id', async (req, res, next) => {
  try { const item = await editKnowledgeDocument(req.params.id, req.body); if (!item) return res.status(404).json({error:'未找到该论文。'}); res.json(item); } catch (error) { next(error); }
});
app.get('/api/knowledge/:id/download', async (req, res, next) => {
  try {
    const item = await getKnowledgeDocument(req.params.id, true);
    if (!item) return res.status(404).json({error:'未找到该论文。'});
    const originalFile = await getKnowledgeOriginal(req.params.id);
    const name = originalFile?.filename || (item.filename || item.title || 'paper').replace(/\.[^.]+$/, '') + '.txt';
    res.setHeader('Content-Type', originalFile?.mimetype || 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(name));
    const extractedText = item.text || [item.title, item.abstract, (item.keywords || []).join(', ')].filter(Boolean).join('\n\n');
    res.send(originalFile?.data ? Buffer.from(originalFile.data, 'base64') : Buffer.from(extractedText, 'utf8'));
  } catch (error) { next(error); }
});
app.delete('/api/knowledge/:id', async (req, res, next) => {
  try { if (!await deleteKnowledgeDocument(req.params.id)) return res.status(404).json({error:'未找到该知识库论文。'}); res.json({deleted:true}); } catch (error) { next(error); }
});
app.get('/api/projects', async (_request, response, next) => {
  try {
    response.json(await listProjects());
  } catch (error) {
    next(error);
  }
});

app.get('/api/projects/:id', async (request, response, next) => {
  try {
    const project = await getProject(request.params.id);
    if (!project) return response.status(404).json({ error: '未找到该投稿项目。' });
    response.json(project);
  } catch (error) {
    next(error);
  }
});

app.post('/api/analyze', upload.single('paper'), async (request, response, next) => {
  try {
    if (!request.file) return response.status(400).json({ error: '请选择需要分析的论文文件。' });
    const extracted = await extractDocument(request.file);
    await addKnowledgeDocument(extracted, null, request.file);
    const project = await createProjectFromDocument(
      extracted,
      {
        researchField: request.body.researchField?.trim() || '',
        keywords: String(request.body.keywords || '')
          .split(/[,，;；、]/)
          .map((item) => item.trim())
          .filter(Boolean),
        accessPreference: request.body.accessPreference || '不限',
      },
      { useAI: request.body.useAI !== 'false' },
    );
    response.status(201).json(project);
  } catch (error) {
    next(error);
  }
});

app.post('/api/demo', async (request, response, next) => {
  try {
    const demoText = `面向科研论文的可解释智能投稿辅助方法\n\n摘要：针对科研人员选刊依据分散、投稿准备重复和审稿意见处理效率低的问题，本研究提出一种可解释的全链路智能投稿辅助框架。该框架融合论文结构分析、期刊知识检索和任务化修订机制，并在计算机科学领域样例数据上开展验证。实验结果表明，该方法能够稳定识别稿件结构风险并生成可追踪的修改任务，为人机协同投稿提供可复现的实现路径。\n\n关键词：学术投稿；智能体；论文评估；期刊推荐；可解释人工智能\n\n1 引言\n学术投稿涉及论文评估、选刊、格式准备和审稿回复等多个阶段。现有工具通常只覆盖其中一个环节，难以保留跨阶段决策依据。本文提出一个统一工作流，并总结三项主要贡献。\n\n2 研究方法\n我们构建包含论文解析器、规则评估器和期刊匹配器的原型系统。数据集包含 120 篇公开论文元数据，按照 8:2 划分测试样本。所有评分参数、随机种子和实验配置均保存在公开配置文件中。\n\n3 实验结果\n与关键词检索基线相比，本方法在 30 个测试样例上的任务覆盖率提高 18.4%。消融实验显示，结构识别和用户偏好分别贡献 9.1% 和 6.3% 的增益，p < 0.05。\n\n4 讨论\n结果表明结构化流程能够提高投稿准备的一致性，但当前样本规模有限，且尚未覆盖不同学科的评价差异。\n\n5 结论\n本文验证了可解释智能投稿辅助流程的可行性，后续将扩大数据规模并引入真实投稿结果。\n\n参考文献\n[1] Author A. Intelligent research workflows. 2024.\n[2] Author B. Journal recommendation systems. 2023.\n[3] Author C. Explainable artificial intelligence. 2022.\n[4] Author D. Scientific document analysis. 2024.\n[5] Author E. Human-AI collaboration. 2021.\n[6] Author F. Scholarly communication. 2020.\n[7] Author G. Reproducible experiments. 2023.\n[8] Author H. Peer review analytics. 2022.\n[9] Author I. Academic writing support. 2024.\n[10] Author J. Research information retrieval. 2021.\n[11] Author K. Submission decision support. 2023.\n[12] Author L. Document quality assessment. 2022.`;
    const fakeFile = { originalname: 'OneScience-MVP-示例论文.txt', buffer: Buffer.from(demoText) };
    const extracted = await extractDocument(fakeFile);
    const project = await createProjectFromDocument(
      extracted,
      {
        researchField: '计算机科学',
        keywords: ['智能体', '论文评估', '期刊推荐'],
        accessPreference: '不限',
      },
      { useAI: true },
    );
    response.status(201).json(project);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/projects/:id', async (request, response, next) => {
  try {
    const allowed = ['name', 'status'];
    const safePatch = Object.fromEntries(
      Object.entries(request.body).filter(([key]) => allowed.includes(key)),
    );
    const project = await patchProject(request.params.id, safePatch);
    if (!project) return response.status(404).json({ error: '未找到该投稿项目。' });
    response.json(project);
  } catch (error) {
    next(error);
  }
});

app.get('/api/projects/:id/review-progress', async (req, res, next) => {
  try {
    if (!await getProject(req.params.id)) return res.status(404).json({ error: '未找到该投稿项目。' });
    const progress = workflowProgress(req.params.id);
    res.json({ ...progress, elapsedSeconds: progress.startedAt ? Math.floor((Date.now() - progress.startedAt) / 1000) : 0 });
  } catch (error) { next(error); }
});

app.post('/api/projects/:id/review-flow', trackWorkflow, async (request, response, next) => {
  try {
    const project = await getProject(request.params.id);
    if (!project) return response.status(404).json({ error: '未找到该投稿项目。' });
    const targetLanguage = request.body.targetLanguage ?? projectTargetLanguage(project);
    if (!validTargetLanguage(targetLanguage)) return response.status(422).json({ error: '目标投稿语言必须为中文、英文或不限。' });
    project.profile = { ...project.profile, targetLanguage };
    await patchProject(project.id, { profile: project.profile });
    const journalCount = Math.max(2, Math.min(Number(request.body.k) || 5, 8));
    const papersPerJournal = Math.max(1, Math.min(Number(request.body.n) || 3, 8));
    const recentYears = Math.max(1, Math.min(Number(request.body.recentYears) || 3, 8));
    const scoringModel = normalizeScoringModel(request.body.scoringModel || DEFAULT_SCORING_MODEL);
    if (!scoringModel) {
      return response.status(422).json({ error: '评分模型无效，可选值为 ranker-8b、ranker-3b、ranker-0.6b 或 deepseek。' });
    }
    const scorerDefinition = scoringModelDefinition(scoringModel);
    if (scorerDefinition.kind === 'ranker') {
      if (await localRankers.installed(scoringModel)) await localRankers.start(scoringModel);
      const status = await getRankerServiceStatus({ modelId: scoringModel });
      if (!status.available) return response.status(409).json({ error: '所选 Ranker 未就绪，请先下载安装并启用，或选择系统对话模型。' });
    }

    const keywords = workflowKeywords(project);
    if (!keywords.length) return response.status(422).json({ error: '未能提取有效关键词，请补充研究方向或关键词后重试。' });

    const openAlexStatus = getOpenAlexStatus();
    let searchQueries = [];
    let searchSubjects = [];
    let discoveryMethod = 'openalex-web-discovery';
    let discoveryModel = null;
    let llmError = null;
    if (getDeepSeekStatus().configured && request.body.useAI !== false) {
      try {
        workflowStage('正在调用对话模型生成检索方案（单次最多等待 10 分钟）');
        const plan = await generateJournalSearchPlanWithDeepSeek(project, { targetLanguage });
        searchQueries = plan.searchQueries;
        searchSubjects = plan.subjects;
        discoveryMethod = 'openalex-web-discovery+llm-search-plan';
        discoveryModel = plan.model;
      } catch (error) {
        // Check workflow cancellation before recovering from a planning failure.
        workflowStage('检索方案生成失败，正在检查备用检索方式');
        if (scorerDefinition.kind !== 'ranker' && platformModelContext()) throw error;
        llmError = error.message;
        workflowStage('对话模型检索规划不可用，正在使用论文已有关键词继续检索');
      }
    }
    if (!searchQueries.length) {
      searchQueries = targetLanguage === 'zh' ? keywords.slice(0, 4) : [keywords.slice(0, 8).join(' ')];
      discoveryMethod = 'openalex-web-discovery+keyword-fallback';
    }
    if (!openAlexStatus.configured) {
      return response.status(422).json({ error: '未配置 OPENALEX_API_KEY，无法执行期刊 Web 检索。' });
    }
    const worksPerQuery = Math.max(10, Math.min(Number(request.body.worksPerQuery) || 50, 100));
    const minWorksCount = Math.max(0, Math.min(Number(request.body.minWorksCount) || 500, 1_000_000));
    workflowStage('正在通过 OpenAlex 检索候选期刊');
    const discovery = await discoverJournalSourcesFromWorks(searchQueries, {
      limit: Math.max(15, journalCount * 5),
      worksPerQuery,
      targetLanguage,
      recentYears: Math.max(recentYears, 5),
      minWorksCount,
    });
    if (targetLanguage === 'zh') {
      workflowStage('正在核验中文期刊目录与相关论文证据');
      const supplement = await supplementChineseJournals(searchQueries, [...keywords, ...searchSubjects], { recentYears: Math.max(recentYears, 5), targetCount: journalCount, existingSources: discovery.sources, minWorksCount, onProgress: workflowStage });
      discovery.chineseExpansion = supplement.stats;
      discovery.sources.push(...supplement.sources);
      discovery.errors.push(...supplement.errors);
    }
    const discoveredCandidates = selectLanguageCandidates(discovery.sources.filter(source => !source.worksCount || source.worksCount >= minWorksCount), targetLanguage);
    prestigeBandForDiscovered(discoveredCandidates);
    const candidates = selectDistinctJournals(discoveredCandidates, journalCount);
    if (!candidates.length && discovery.errors.length) {
      return response.status(503).json({ error: `学术检索未能完成：${discovery.errors[0].message} 本次不能判断是否存在匹配期刊，请在服务恢复后重试。`, code: 'SCHOLARLY_SERVICE_UNAVAILABLE' });
    }
    if (!candidates.length) return response.status(422).json({ error: targetLanguage === 'zh' ? '当前条件下未找到语种已核验且有相关论文证据的中文期刊。中文目录目前主要覆盖计算机与信息领域，OpenAlex 收录也可能不完整；本次没有用英文期刊补位。可调整关键词或主动切换投稿语言。' : '检索已完成，但当前条件下没有符合目标语言及筛选要求的候选期刊，请调整条件后重试。', code: 'NO_MATCHING_JOURNALS' });
    const scorerStatus = scorerDefinition.kind === 'deepseek'
      ? { ...getDeepSeekScorerStatus(), id: scoringModel, label: scorerDefinition.label, kind: 'deepseek' }
      : await getRankerServiceStatus({ modelId: scoringModel });
    if (scorerDefinition.kind === 'deepseek' && !scorerStatus.available) return response.status(503).json({ error: '请先在平台配置系统对话模型 API，或安装并选择本地 Ranker。' });
    const journalResults = [];

    for (const [index, candidate] of candidates.entries()) {
      workflowStage(`正在检索第 ${index + 1}/${candidates.length} 本期刊的近期论文`);
      let retrieval = { source: null, items: [] };
      let retrievalError = null;
      if (openAlexStatus.configured) {
        try {
          retrieval = await findRecentSimilarPapers(candidate, keywords, {
            limit: papersPerJournal,
            preferAbstract: true,
            recentYears,
            targetLanguage,
            queries: targetLanguage === 'zh' ? [...new Set([...(candidate.openAlex?.evidenceQueries || []), ...searchQueries])] : searchQueries,
            source: {
              id: candidate.openAlexId,
              openAlexUrl: candidate.source?.url || null,
              name: candidate.name,
              issn: null,
              worksCount: candidate.openAlex?.worksCount || 0,
              citedByCount: candidate.openAlex?.citedByCount || 0,
              twoYearMeanCitedness: candidate.openAlex?.twoYearMeanCitedness ?? null,
            },
          });
        } catch (error) {
          retrievalError = error.message;
        }
      } else {
        retrievalError = '未配置 OPENALEX_API_KEY，未执行近期论文 Web 检索。';
      }
      const journal = enrichJournalMetrics(candidate, retrieval.source);
      const originalDocument = volatileDocuments.get(project.id) || {
        ...project.document,
        text: project.document?.abstract || '',
      };
      let referencePapers = retrieval.items.map((paper) => ({
        ...paper,
        modelScore: fallbackReferenceScore(paper),
        scoringError: null,
      }));
      let manuscriptScore = fallbackManuscriptScore(project, journal);
      let manuscriptReview = null;
      let scoringError = null;
      let scoringTrace = null;
      const batchScoringAvailable = scorerStatus.available
        && (scorerDefinition.kind === 'deepseek'
          || scorerStatus.capabilities?.includes('paper_score_batch'));
      if (batchScoringAvailable && originalDocument.abstract?.trim() && referencePapers.some(paper => paper.abstract?.trim())) {
        try {
          const scoreInputs = [
            {
              paperId: project.id,
              title: originalDocument.title,
              abstract: originalDocument.abstract,
            },
            ...referencePapers
              .filter((paper) => paper.abstract?.trim())
              .map((paper) => ({
                paperId: paper.id,
                title: paper.title,
                abstract: paper.abstract,
              })),
          ];
          workflowStage(`正在评分第 ${index + 1}/${candidates.length} 本期刊（模型单次最多等待 10 分钟）`);
          const scored = scorerDefinition.kind === 'deepseek'
            ? await scorePapersWithDeepSeek(scoreInputs)
            : await scorePapersWithRanker(scoreInputs, { modelId: scoringModel });
          scoringTrace = scored.modelTrace;
          const scoreById = new Map(scored.scores.map((item) => [item.paper_id, item]));
          const manuscriptItem = scoreById.get(project.id);
          if (!manuscriptItem) throw new Error(`${scorerDefinition.label} 未返回用户稿件评分。`);
          const mapScore = scorerDefinition.kind === 'deepseek' ? scoreFromDeepSeek : scoreFromRanker;
          manuscriptScore = mapScore(manuscriptItem, scored.modelTrace);
          referencePapers = referencePapers.map((paper) => {
            const scoreItem = scoreById.get(paper.id);
            return scoreItem
              ? { ...paper, modelScore: mapScore(scoreItem, scored.modelTrace) }
              : { ...paper, scoringError: paper.abstract ? '批量评分结果缺少该论文。' : 'OpenAlex 未提供摘要。' };
          });
        } catch (error) {
          if (scorerDefinition.kind === 'deepseek' && platformModelContext()) throw error;
          scoringError = error.message;
          referencePapers = referencePapers.map((paper) => ({
            ...paper,
            scoringError: paper.abstract ? error.message : 'OpenAlex 未提供摘要。',
          }));
        }
      } else if (batchScoringAvailable && originalDocument.abstract?.trim()) {
        scoringError = '当前年份范围内未找到含有效摘要的相关参考论文，暂不进行批量评分和质量比较；可扩大近期窗口后重试。';
        manuscriptScore = { ...manuscriptScore, score: null, verdict: 'insufficient_reference_data', rationale: scoringError };
        referencePapers = referencePapers.map(paper => ({ ...paper,
          modelScore: { ...paper.modelScore, score: null, verdict: 'insufficient_reference_data', rationale: '该论文缺少有效摘要，未进行模型评分。' },
          scoringError: 'OpenAlex 未提供有效摘要。',
        }));
      } else if (scorerStatus.available && !originalDocument.abstract?.trim()) {
        scoringError = `用户稿件未识别到摘要，${scorerDefinition.label} 不会使用全文替代标题+摘要输入。`;
        referencePapers = referencePapers.map((paper) => ({
          ...paper,
          scoringError: paper.abstract ? scoringError : 'OpenAlex 未提供摘要。',
        }));
      } else if (scorerStatus.available) {
        scoringError = `${scorerDefinition.label} 尚未部署 paper_score_batch 能力。`;
      } else {
        scoringError = scorerStatus.error || `${scorerDefinition.label} 不可用。`;
      }
      journalResults.push({
        journal,
        retrieval: {
          provider: 'OpenAlex',
          source: retrieval.source,
          queryKeywords: keywords,
          searchQueries: retrieval.queries || searchQueries,
          queryErrors: retrieval.errors || [],
          recentYears,
          error: retrievalError,
        },
        referencePapers,
        manuscriptScore,
        manuscriptReview,
        scoringTrace,
        rankerTrace: scorerDefinition.kind === 'ranker' ? scoringTrace : null,
        scoringError,
        comparison: compareWithJournalBenchmark(manuscriptScore, referencePapers),
      });
    }

    const reviewFlow = {
      schemaVersion: '1.0.0',
      generatedAt: new Date().toISOString(),
      hyperparameters: { k: journalCount, n: papersPerJournal, recentYears, scoringModel, targetLanguage },
      scoring: { model: scoringModel, label: scorerDefinition.label, kind: scorerDefinition.kind },
      keywords,
      languageNotice: targetLanguage === 'zh' ? '中文模式使用已核验语种的期刊目录，并要求相关论文证据；目录目前主要覆盖计算机与信息领域。中文期刊的英译标题、摘要可作为检索证据，不会因此被改判为英文期刊。' : targetLanguage === 'en' ? '英文模式检索英文论文元数据，并排除目录中已知中文期刊；未经目录核验的期刊，仍需查看官网确认投稿语种。' : '不限模式不限制论文元数据语言，投稿前请核对期刊作者指南。',
      discovery: {
        method: discoveryMethod,
        model: discoveryModel,
        llmError,
        searchQueries,
        subjects: searchSubjects,
        queryCount: searchQueries.length,
        worksExamined: discovery.worksExamined,
        evidenceJournalCount: discovery.evidenceJournalCount,
        sourceCount: discovery.sources.length,
        chineseExpansion: discovery.chineseExpansion || null,
        retrievalErrors: discovery.errors,
        diversityPolicy: '至少覆盖高挑战、稳健、广覆盖三个梯度（候选充足时）；分级优先权威 JIF/CCF/中科院，缺失时用 OpenAlex 引用指标近似分档。',
      },
      services: {
        openAlex: openAlexStatus,
        ranker: scorerDefinition.kind === 'ranker' ? scorerStatus : null,
        scorer: scorerStatus,
      },
      journals: journalResults,
      notice: `${scorerDefinition.label} 只提供论文质量相对排序；系统据此比较稿件与每本期刊的近期相似论文基线，不展示录用概率。`,
    };
    workflowStage('正在保存评估结果');
    response.json(await patchProject(project.id, {
      reviewFlow,
      stage: 4,
      status: '当前审稿流程已完成',
    }));
  } catch (error) {
    next(error);
  }
});

app.post('/api/projects/:id/rebuttal', upload.single('paper'), async (request, response, next) => {
  try {
    const project = await getProject(request.params.id);
    if (!project) return response.status(404).json({ error: '未找到该投稿项目。' });
    const comments = parseReviewComments(request.body?.comments);
    const document = request.file ? await extractDocument(request.file) : volatileRebuttalDocuments.get(project.id) || volatileDocuments.get(project.id);
    if (!document?.text?.trim()) return response.status(422).json({ error: '论文原文已不在内存中，请重新选择论文文件后生成修改建议。' });
    if (!getDeepSeekStatus().configured) return response.status(503).json({ error: 'Rebuttal 需要配置 系统对话模型后使用。' });
    const rebuttal = await generateRebuttal(document, comments);
    // Persist only the report; uploaded source manuscripts stay in memory.
    volatileRebuttalDocuments.set(project.id, document);
    response.json(await patchProject(project.id, { rebuttal, stage: 5, status: 'Rebuttal 修改建议已生成' }));
  } catch (error) {
    next(error);
  }
});

app.use('/api', (_request, response) => response.status(404).json({ error: '投稿接口不存在。' }));

if (process.env.NODE_ENV === 'production') {
  const distDir = path.resolve(currentDir, '../dist');
  app.use(express.static(distDir));
  app.get('*splat', (_request, response) => response.sendFile(path.join(distDir, 'index.html')));
}

app.use((error, _request, response, _next) => {
  const isUploadLimit = error?.code === 'LIMIT_FILE_SIZE';
  const status = isUploadLimit ? 413 : 400;
  const message = isUploadLimit ? '文件不能超过 15 MB。' : error.message || '处理请求时发生错误。';
  console.error(error);
  response.status(status).json({ error: message });
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  app.listen(port, '127.0.0.1', () => {
    console.log(`OneScience API running at http://127.0.0.1:${port}`);
  });
}

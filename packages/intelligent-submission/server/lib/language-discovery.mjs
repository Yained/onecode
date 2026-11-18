import { journalIdentities } from '../data/journal-identities.mjs';
import { journals } from '../data/journals.mjs';
import { resolveCatalogSource, findRecentSimilarPapers } from './scholarly-search.mjs';
import { enrichDiscoveredJournal } from './journal-discovery.mjs';
export function languageMatches(journal, target) {
  if (target === 'zh') return journal.language === 'zh';
  if (target === 'en') return journal.language !== 'zh';
  return true;
}
export function chineseCatalogCandidates(terms, limit = 8) {
  const aliases = { 'computer science': '计算机科学', 'artificial intelligence': '人工智能', 'machine learning': '机器学习', 'software engineering': '软件工程', 'data mining': '数据挖掘', 'computer vision': '计算机视觉', 'natural language processing': '自然语言处理' };
  const input = terms.join(' ').toLowerCase();
  const text = input + ' ' + Object.entries(aliases).filter(([key]) => input.includes(key)).map(([, value]) => value).join(' ');
  return journals.filter(item => item.language === '中文').map(item => ({ item,
    score: [...new Set([...(item.fields || []), ...(item.keywords || [])])].filter(word => word.length >= 2 && text.includes(word.toLowerCase())).length,
  })).sort((a, b) => b.score - a.score || Number(!!journalIdentities[b.item.id]) - Number(!!journalIdentities[a.item.id])).slice(0, limit).map(x => x.item);
}
// Expand only concepts present in the manuscript/search plan; never add unrelated fields to fill k.
export function expandChineseQueries(queries, terms) {
  const groups = [
    ['机器学习', 'machine learning'], ['深度学习', 'deep learning'],
    ['大语言模型', '大型语言模型', 'large language model'],
    ['知识蒸馏', 'knowledge distillation'], ['信息检索', 'information retrieval'],
    ['自然语言处理', 'natural language processing'], ['计算机视觉', 'computer vision'],
    ['数据挖掘', 'data mining'], ['强化学习', 'reinforcement learning'],
    ['多智能体', '多智能体系统', 'multi-agent systems'], ['人工智能', 'artificial intelligence'],
    ['图神经网络', 'graph neural network'], ['推荐系统', 'recommender system'],
  ];
  const originals = [...new Set(queries.map(value => String(value).trim()).filter(Boolean))];
  const text = [...originals, ...terms].join(' ').toLowerCase();
  const synonyms = groups.filter(group => group.some(term => text.includes(term.toLowerCase()))).flat();
  return [...new Set([...synonyms, ...terms, ...originals.slice(4)].map(value => String(value).trim()).filter(Boolean))]
    .filter(value => !originals.slice(0, 4).includes(value)).slice(0, 8);
}
export async function supplementChineseJournals(queries, terms, options = {}) {
  const catalog = chineseCatalogCandidates([...queries, ...terms], 32);
  const target = Math.max(1, Math.min(Number(options.targetCount) || 5, 8));
  const eligible = source => !source.worksCount || source.worksCount >= (options.minWorksCount || 0);
  const sources = [];
  const errors = [];
  const resolved = new Map();
  const found = new Set();
  const initial = options.existingSources || [];
  const count = () => selectLanguageCandidates([...initial, ...sources].filter(eligible), 'zh').length;
  const deadline = Date.now() + Math.max(1, Math.min(options.budgetMs ?? 120000, 120000));
  const stats = { target, catalogSize: catalog.length, checked: 0, resolved: 0, batches: 0, expanded: false, stopReason: null };
  const phases = [
    { journals: catalog.slice(0, 8), queries: queries.slice(0, 4) },
    { journals: catalog, queries: expandChineseQueries(queries, terms), expanded: true },
  ];
  for (const phase of phases) {
    for (let offset = 0; offset < phase.journals.length; offset += 3) {
      if (count() >= target || Date.now() >= deadline) break;
      stats.batches += 1;
      stats.expanded ||= !!phase.expanded;
      options.onProgress?.(`中文期刊补充检索第 ${stats.batches} 批：已找到 ${count()}/${target} 本${phase.expanded ? '，扩大目录并扩展同义词' : ''}`);
      await Promise.all(phase.journals.slice(offset, offset + 3).map(async journal => {
        if (found.has(journal.id)) return;
        try {
          const requestOptions = { ...options, timeoutMs: Math.max(1, Math.min(15000, deadline - Date.now())) };
          const isNew = !resolved.has(journal.id);
          if (isNew) {
            stats.checked += 1;
            const source = await resolveCatalogSource(journal, requestOptions);
            resolved.set(journal.id, source);
            if (source) stats.resolved += 1;
          }
          const source = resolved.get(journal.id);
          if (!source || !eligible(source) || Date.now() >= deadline) return;
          // New catalog entries still get original queries; previously searched entries only get new terms.
          const searches = phase.expanded && isNew ? [...queries.slice(0, 4), ...phase.queries] : phase.queries;
          for (let index = 0; index < searches.length; index += 4) {
            if (Date.now() >= deadline) break;
            const retrieval = await findRecentSimilarPapers(journal, [], { ...requestOptions,
              timeoutMs: Math.max(1, Math.min(15000, deadline - Date.now())),
              source, targetLanguage: 'zh', limit: 3, queries: searches.slice(index, index + 4), includeJournalFields: false });
            errors.push(...retrieval.errors.map(error => ({ ...error, stage: 'catalog-evidence' })));
            if (!retrieval.items.length) continue;
            sources.push({ ...source, relevanceScore: Math.max(...retrieval.items.map(item => item.retrievalScore || 1)),
              evidencePaperCount: retrieval.items.length, evidenceQueryCount: new Set(retrieval.items.flatMap(item => item.evidenceQueries)).size,
              evidenceQueries: [...new Set(retrieval.items.flatMap(item => item.evidenceQueries))],
            });
            found.add(journal.id);
            break;
          }
        } catch (error) { errors.push({ stage: 'catalog-source', message: error.message }); }
      }));
    }
    if (count() >= target || Date.now() >= deadline) break;
  }
  stats.found = count();
  stats.stopReason = count() >= target ? 'target-reached' : Date.now() >= deadline ? 'time-budget' : 'catalog-exhausted';
  return { sources, errors, stats };
}
export function selectLanguageCandidates(sources, target) {
  return [...new Map(sources.map(source => [source.id, source])).values()]
    .map(source => enrichDiscoveredJournal(source)).filter(journal => languageMatches(journal, target));
}

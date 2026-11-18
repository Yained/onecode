import { verifiedJournalMetrics } from '../data/journal-metrics.mjs';

const PRESTIGE_ORDER = { leading: 3, strong: 2, broad: 1 };

export { workflowKeywords } from '../../shared/submission-keywords.mjs';

function prestigeBand(journal) {
  const impactFactor = journal.impactFactor ?? verifiedJournalMetrics[journal.id]?.impactFactor ?? null;
  if (journal.ccfRank === 'CCF-A' || journal.casZone === '中科院1区' || (impactFactor !== null && impactFactor >= 10)) return 'leading';
  if (journal.ccfRank === 'CCF-B' || journal.casZone === '中科院2区' || (impactFactor !== null && impactFactor >= 5)) return 'strong';
  return 'broad';
}

export function enrichJournalMetrics(journal, openAlexSource = null) {
  const verified = verifiedJournalMetrics[journal.id] || null;
  const existing = journal.metrics || {};
  const band = journal.prestigeBand || prestigeBand(journal);
  return {
    ...journal,
    prestigeBand: band,
    prestigeLabel: journal.prestigeLabel || (band === 'leading' ? '高挑战' : band === 'strong' ? '稳健' : '广覆盖'),
    metrics: {
      impactFactor: existing.impactFactor ?? verified?.impactFactor ?? null,
      impactFactorYear: existing.impactFactorYear ?? verified?.impactFactorYear ?? null,
      impactFactorSource: existing.impactFactorSource ?? verified?.source ?? null,
      ccf: existing.ccf ?? (journal.ccfRank || journal.ccfTier || null),
      cas: existing.cas ?? (journal.casZone || null),
      openAlexTwoYearMeanCitedness: existing.openAlexTwoYearMeanCitedness ?? openAlexSource?.twoYearMeanCitedness ?? null,
      openAlexHIndex: existing.openAlexHIndex ?? journal.openAlex?.hIndex ?? null,
      openAlexWorksCount: existing.openAlexWorksCount ?? journal.openAlex?.worksCount ?? null,
      openAlexSource: existing.openAlexSource ?? openAlexSource?.openAlexUrl ?? null,
    },
  };
}

export function selectDistinctJournals(candidates, limit = 5) {
  const size = Math.max(1, Math.min(Number(limit) || 5, 10));
  const enriched = candidates.map((item) => enrichJournalMetrics(item));
  const buckets = new Map(['leading', 'strong', 'broad'].map((band) => [
    band,
    enriched.filter((item) => item.prestigeBand === band),
  ]));
  const selected = [];
  const seen = new Set();
  const take = (item) => {
    if (!item || seen.has(item.id) || selected.length >= size) return;
    selected.push(item);
    seen.add(item.id);
  };
  // Guarantee challenge differentiation before filling by topical fit.
  for (const band of ['leading', 'strong', 'broad']) take(buckets.get(band)?.[0]);
  for (const item of enriched) take(item);
  return selected
    .sort((left, right) => ((right.matchScore ?? 0) - (left.matchScore ?? 0))
      || (PRESTIGE_ORDER[right.prestigeBand] - PRESTIGE_ORDER[left.prestigeBand]))
    .slice(0, size);
}

function percentile(sorted, ratio) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return Math.round(sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower));
}

export function compareWithJournalBenchmark(manuscriptScore, referencePapers, acceptancePrediction = null) {
  const scores = referencePapers
    .filter((paper) => !paper.modelScore?.verdict?.endsWith('fallback'))
    .map((paper) => paper.modelScore?.score).filter(Number.isFinite).sort((a, b) => a - b);
  const manuscriptAvailable = Number.isFinite(manuscriptScore.score) && !manuscriptScore.verdict?.endsWith('fallback');
  const median = percentile(scores, 0.5);
  const lowerQuartile = percentile(scores, 0.25);
  const upperQuartile = percentile(scores, 0.75);
  const delta = median === null || !manuscriptAvailable ? null : manuscriptScore.score - median;
  let benchmarkVerdict = 'insufficient_reference_data';
  if (delta !== null) benchmarkVerdict = delta >= 5 ? 'above_recent_baseline' : delta >= -5 ? 'near_recent_baseline' : 'below_recent_baseline';
  return {
    manuscriptScore: manuscriptScore.score,
    recentPaperCount: scores.length,
    recentPaperMedian: median,
    recentPaperLowerQuartile: lowerQuartile,
    recentPaperUpperQuartile: upperQuartile,
    scoreDelta: delta,
    benchmarkVerdict,
    acceptancePrediction,
    decision: acceptancePrediction?.prediction || benchmarkVerdict,
    isCalibratedProbability: Boolean(acceptancePrediction),
    notice: acceptancePrediction
      ? acceptancePrediction.disclaimer
      : !manuscriptAvailable || !scores.length
        ? '模型评分或有效参考论文不足，不生成质量比较结论；规则降级分不属于论文质量评分。'
        : `${scores.length < 2 ? '有效参考论文少于两篇，比较置信度低。' : ''}当前结论是稿件分数相对该刊近期相似论文的基线比较，不是期刊真实录用概率。`,
  };
}

export const __testables = { prestigeBand, percentile };

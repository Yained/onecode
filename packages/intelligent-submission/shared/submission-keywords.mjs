// Shared by the workflow and UI so missing author keywords cannot block a readable paper.
const stopwords = new Set(`a an the and or but of for to in on at by from with as is are was were be been being this that these those we our their they it its into through than both more most such also can could may will would should not no using used use based towards toward highly present presents paper study research propose proposed method methods approach results show shows demonstrate demonstrates including include includes version series available model models 本文 我们 一种 一个 一项 该 通过 基于 针对 提出 研究 方法 结果 表明 进行 实现 以及 其中 可以 能够 有效 提高 具有 采用 分别 主要 相关 这些 这种 论文 摘要 关键词`.split(/\s+/));

export function normalizeKeywordTerms(values, limit = 5) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [values]).flatMap(value => typeof value === 'string' ? value.split(/[,，;；、\n]+/) : [])
    .map(value => value.replace(/^(?:关键词|keywords?)\s*[:：]\s*/i, '').replace(/^[\s"'“”‘’•\-]+|[\s"'“”‘’。.!?！？•\-]+$/g, '').replace(/\s+/g, ' ').trim())
    .filter(value => value.length >= 2 && value.length <= 64
      && (value.match(/[\u3400-\u9fff]/g) || []).length <= 20
      && !/[。.!?！？:：]/.test(value)
      && !/^(?:本文|论文|我们|通过|采用|提出|构建了|实现了|围绕|为了|主要|具体包括|研究了|优化了|并围绕)/.test(value)
      && (value.match(/[A-Za-z][A-Za-z0-9+-]*/g) || []).length <= 8)
    .filter(value => {
      const key = value.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, limit);
}

// Split on prose connectors, measurements and model/version identifiers, not inside terms.
const prose = new Set(`a an the and or but of for to in on at by from with as is are was were be been being this that these those we our their they it its into through than both more most such also can could may will would should not no using used use based towards toward highly present presents paper study research propose proposed results show shows demonstrate demonstrates including include includes version series available one two three four five million billion trillion tokens parameters activated preview strong several key upgrades incorporates incorporate combines combine improve improves enhance enhances conventional faster greater pre-train diverse high-quality followed comprehensive unlocks further capabilities maximum mode redefines state-of-the-art open outperforming predecessors core tasks meanwhile requires only compared enables us routinely support supports supporting thereby making feasible checkpoints achieved achieve significant significantly respectively evaluate evaluates evaluated`.split(/\s+/));
const technicalHead = /\b(?:attention|architecture|models?|learning|networks?|connections?|optimizer|optimization|training|inference|cache|scaling|retrieval|segmentation|classification|detection|prediction|diagnosis|therapy|synthesis|catalysis|sequencing|simulation|estimation|control|stability|efficiency)\b/i;

function englishKeywords(document) {
  const candidates = new Map();
  const add = (phrase, weight) => {
    const key = phrase.toLowerCase();
    if (phrase.length < 4 || phrase.length > 80) return;
    const previous = candidates.get(key);
    candidates.set(key, { text: previous?.text || phrase, score: (previous?.score || 0) + weight });
  };
  for (const [source, weight] of [[document?.title, 2], [document?.abstract, 1]]) {
    const text = String(source || '').slice(0, 16000)
      .replace(/(?<=[a-z])-\s*\n\s*(?=[a-z])/g, '')
      .replace(/-\s*\n\s*(?=[A-Z])/g, '-')
      .replace(/https?:\/\/\S+|\S+@\S+/g, ' ');
    // Acronym definitions are strong evidence of an explicitly named technical concept.
    for (const match of text.matchAll(/\b((?:[A-Z][A-Za-z]*(?:-[A-Za-z]+)*(?:\s+|(?=\s*\())){1,6})\s*\(([A-Za-z][A-Za-z0-9]{1,7})\)/g)) {
      const phrase = match[1].trim();
      const initials = phrase.split(/[\s-]+/).map(word => word[0]).join('').toLowerCase();
      if (new RegExp(match[2].toLowerCase().split('').join('.*')).test(initials)) add(phrase, 10 * weight);
    }
    const tokens = text.match(/[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*|[^A-Za-z\s]+/g) || [];
    let chunk = [];
    const flush = () => {
      if (chunk.length >= 2 && chunk.length <= 5) {
        const phrase = chunk.join(' ');
        add(phrase, weight * (2 + (technicalHead.test(phrase) ? 3 : 0)));
      }
      // Recognize hyphenated technical names as phrases, not separate fragments.
      if (chunk.length === 1 && chunk[0].includes('-') && technicalHead.test(chunk[0])) add(chunk[0], weight * 3);
      chunk = [];
    };
    for (const token of tokens) {
      if (!/^[A-Za-z]/.test(token) || /\d/.test(token) || prose.has(token.toLowerCase())
          || /^(?:pro|flash|max|v\d+|million|billion|trillion|single-token|one-million)(?:-|$)/i.test(token)
          || /^(?:million|billion|trillion)-/i.test(token) || token.length < 2) {
        flush();
      } else chunk.push(token);
    }
    flush();
  }
  const sorted = [...candidates.values()].sort((a, b) => b.score - a.score);
  const selected = [];
  for (const candidate of sorted) {
    const key = candidate.text.toLowerCase();
    if (selected.some(item => item.toLowerCase().includes(key) || key.includes(item.toLowerCase()))) continue;
    selected.push(candidate.text);
    if (selected.length === 10) break;
  }
  return selected;
}

function textKeywords(document) {
  const english = englishKeywords(document);
  if (!/[\u3400-\u9fff]/.test(String(document?.title || '') + String(document?.abstract || ''))) return english;
  const scores = new Map();
  const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
  for (const [text, weight] of [[document?.title, 4], [document?.abstract, 1]]) {
    const clean = String(text || '').slice(0, 16000).replace(/https?:\/\/\S+|\S+@\S+/g, ' ');
    for (const item of segmenter.segment(clean)) {
      const word = item.segment.toLowerCase();
      if (!item.isWordLike || word.length < 2 || word.length > 40 || stopwords.has(word)) continue;
      if (!/^[\p{L}][\p{L}\p{N}]*$/u.test(word)) continue;
      const previous = scores.get(word);
      scores.set(word, { text: previous?.text || item.segment, score: (previous?.score || 0) + weight });
    }
  }
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, 12).map(item => item.text);
}

export function workflowKeywords(project) {
  const explicit = normalizeKeywordTerms([
    ...(project.document?.keywords || []),
    ...(project.profile?.keywords || []),
    project.profile?.researchField,
  ]);
  return explicit.length >= 3 ? explicit : normalizeKeywordTerms([...explicit, ...textKeywords(project.document)]);
}

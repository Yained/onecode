export const languageLabels = { zh: '中文', en: '英文', all: '不限' };
export const validTargetLanguage = (value) => ['zh', 'en', 'all'].includes(value);
export function detectManuscriptLanguage(document = {}) {
  const title = String(document.title || '');
  const text = `${title} ${String(document.abstract || '').slice(0, 6000)}`;
  if (/[\u3040-\u30ff\uac00-\ud7af]/u.test(text)) return 'all';
  const han = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const letters = (text.match(/[a-z]/gi) || []).length;
  if ((title.match(/[\u3400-\u9fff]/g) || []).length >= 4 || (han >= 20 && han / Math.max(1, han + letters) > 0.15)) return 'zh';
  return letters >= 20 && han === 0 ? 'en' : 'all';
}
export function projectTargetLanguage(project) {
  return validTargetLanguage(project.profile?.targetLanguage) ? project.profile.targetLanguage : detectManuscriptLanguage(project.document);
}

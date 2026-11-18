import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import mammoth from 'mammoth';
import pdf from 'pdf-parse';
import { extractMetadataWithModel } from './metadata-extraction.mjs';
import { normalizeKeywordTerms } from '../../shared/submission-keywords.mjs';
import { normalizeUploadFilename } from './filename.mjs';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '../..');
const markItDownBridge = path.join(projectRoot, 'scripts/pdf/markitdown_bridge.py');
const localMarkItDownPython = path.join(projectRoot, '.venv-markitdown/bin/python');

const SECTION_PATTERNS = {
  abstract: /(^|\n)\s*(摘\s*要|abstract)\s*[:：]?/i,
  introduction: /(^|\n)\s*(\d+[.、\s]*)?(引言|绪论|introduction|background)\s*[:：]?/i,
  methods: /(^|\n)\s*(\d+[.、\s]*)?(材料与方法|研究方法|方法|methodology|materials?\s+and\s+methods?|methods?)\s*[:：]?/i,
  results: /(^|\n)\s*(\d+[.、\s]*)?(结果|实验结果|results?|findings)\s*[:：]?/i,
  discussion: /(^|\n)\s*(\d+[.、\s]*)?(讨论|分析与讨论|discussion)\s*[:：]?/i,
  conclusion: /(^|\n)\s*(\d+[.、\s]*)?(结论|总结与展望|conclusions?)\s*[:：]?/i,
  references: /(^|\n)\s*(参考文献|references?|bibliography)\s*[:：]?/i,
};

function normalizeText(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\u00a0]+/g, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function countWords(text) {
  const latinWords = text.match(/[A-Za-z][A-Za-z'-]*/g)?.length ?? 0;
  const chineseChars = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  return latinWords + chineseChars;
}

function extractAbstract(text) {
  const heading = /(?:^|\n)[ \t]*(?:#{1,6}\s*)?(?:\*\*)?(?:摘\s*要|abstract\b)(?:\*\*)?[ \t]*[:：—–-]?[ \t]*/i.exec(text);
  if (!heading) return '';
  const remaining = text.slice(heading.index + heading[0].length).trimStart();
  const boundary = /\n[ \t]*(?:#{1,6}[ \t]*)?(?:(?:\*\*)?(?:关\s*键\s*(?:词|字)|key\s*words?|keywords?)[ \t]*[:：]|(?:(?:\d+|[IVXLCDM]+)[.、]?[ \t]+)?(?:引言|绪论|introduction\b|background\b(?![ \t]*[:：])|contents\b|references\b|index[ \t]+terms\b)|(?:figure|table)\s*\d|[图表]\s*\d|\|[^\n]*\||\d+(?:\.\d+)?[ \t]*(?:\n|$))/i;
  const end = remaining.search(boundary);
  const content = (end >= 0 ? remaining.slice(0, end) : remaining).trim();
  if (content.length < 40 || content.length > 16000) return '';
  return content
    .replace(/\n+/g, ' ')
    .replace(/([\u3400-\u9fff])\s+([\u3400-\u9fff])/g, '$1$2')
    .replace(/([\u3400-\u9fff])\s+([\u3400-\u9fff])/g, '$1$2')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractKeywords(text) {
  const match = text.match(
    /(?:关\s*键\s*(?:词|字)|key\s*words?|keywords?)\s*[:：]\s*([^\n]{2,300})/i,
  );
  if (!match) return [];
  return match[1]
    .split(/[;,；，、|]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function extractTitle(text, fallbackName) {
  const abstractStart = text.search(SECTION_PATTERNS.abstract);
  const frontMatter = abstractStart >= 0 ? text.slice(0, abstractStart) : text.slice(0, 5_000);
  const editorialStart = frontMatter.search(/(?:相关说明|修改说明|编辑说明|修订说明|作者须知)\s*[:：]/);
  const titleStart = editorialStart >= 0 ? frontMatter.slice(editorialStart).search(/(?:^|\n)\s*DOI\s*[:：][^\n]*\n/i) : -1;
  const candidates = titleStart >= 0 ? frontMatter.slice(editorialStart + titleStart).replace(/^\s*DOI[^\n]*\n/i, '') : frontMatter;
  const lines = candidates
    .split('\n')
    .map((line) => line.trim().replace(/^#{1,6}\s+/, '').replace(/^\|\s*|\s*\|$/g, '').trim())
    .filter(Boolean)
    .filter((line) => !/^(?:删除了|插入了|设置格式|批注)\s*[:：]/.test(line))
    .slice(0, 300);
  const metadataPattern = /(?:ISSN|CODEN|E-?mail|doi\b|https?:|www\.|版权所有|copyright|Tel\b|电话|Journal\s+of\b|通讯作者|通信作者|基金项目|收稿时间|修改时间|采用时间|分类号)/i;
  const affiliationPattern = /^(?:\d+\s*)?[（(].*(?:大学|学院|研究中心|实验室|University|Institute|School|Center)/i;
  const authorPattern = /(?:[,，、]\s*){2,}|\b(?:and|et\s+al\.)\b/i;

  const scored = lines
    .map((line, index) => {
      if (/^(?:\d+[)）、.]|[◇◆•])|请作者|本次修改|作者可忽略|高频问题|加批注|需要核实/.test(line)) return null;
      if (line.length < 6 || line.length > 220) return null;
      if (metadataPattern.test(line) || affiliationPattern.test(line)) return null;
      if (Object.values(SECTION_PATTERNS).some((pattern) => pattern.test(`\n${line}`))) return null;
      const chineseCount = line.match(/[\u3400-\u9fff]/g)?.length ?? 0;
      const latinWordCount = line.match(/[A-Za-z][A-Za-z'-]*/g)?.length ?? 0;
      const separatorCount = line.match(/[,，、]/g)?.length ?? 0;
      const digitCount = line.match(/\d/g)?.length ?? 0;
      if (chineseCount < 4 && latinWordCount < 4) return null;
      let score = Math.min(line.length, 80) - index * 1.5;
      if (chineseCount >= 8) score += 45;
      if (latinWordCount >= 6) score += 28;
      if (!/[。.!?；;：:]$/.test(line)) score += 12;
      if (authorPattern.test(line)) score -= 55;
      if (separatorCount >= 3) score -= 65;
      if (digitCount >= 3) score -= 55;
      if (/\d[,，]?\d|\d{3,}/.test(line)) score -= 35;
      if (/^[*†‡]+$/.test(line)) score -= 100;
      const next = lines[index + 1];
      const joined = /[的与及和]$/.test(line) && /^[\u3400-\u9fffA-Za-z -]{6,80}$/.test(next || '') && !metadataPattern.test(next)
        ? `${line}${next}` : line;
      return { line: joined, score: score + (joined !== line ? 25 : 0) };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);
  return scored[0]?.line || path.parse(fallbackName).name;
}

function markItDownPython() {
  const configured = String(process.env.MARKITDOWN_PYTHON || '').trim();
  if (configured) return configured;
  return fs.existsSync(localMarkItDownPython) ? localMarkItDownPython : null;
}

async function pdfToMarkdown(buffer, metadata = false) {
  const python = markItDownPython();
  if (!python || !fs.existsSync(markItDownBridge)) {
    throw new Error('MarkItDown PDF 环境未安装。');
  }
  return new Promise((resolve, reject) => {
    const child = spawn(python, [markItDownBridge, ...(metadata ? ['--metadata'] : [])], {
      cwd: projectRoot,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new Error('MarkItDown PDF 转换超时。')));
    }, 45_000);
    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > 20 * 1024 * 1024) {
        child.kill('SIGKILL');
        finish(() => reject(new Error('MarkItDown 输出超过 20 MB 限制。')));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (code) => finish(() => {
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString('utf8').trim().slice(0, 500);
        reject(new Error(detail || `MarkItDown 退出码 ${code}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString('utf8'));
    }));
    child.stdin.on('error', () => {});
    child.stdin.end(buffer);
  });
}

function countReferences(text) {
  const referenceStart = text.search(SECTION_PATTERNS.references);
  const referenceText = referenceStart >= 0 ? text.slice(referenceStart) : text;
  const numbered = referenceText.match(/(?:^|\n)\s*(?:\[\d+\]|\d+[.)、])\s+/g)?.length ?? 0;
  const authorYear = referenceText.match(/\([12][0-9]{3}[a-z]?\)/gi)?.length ?? 0;
  return Math.max(numbered, Math.min(authorYear, 200));
}

export async function extractDocument(file, options = {}) {
  const filename = normalizeUploadFilename(file.originalname);
  const extension = path.extname(filename).toLowerCase();
  let rawText = '';
  let extractionMethod = 'plain-text';
  let extractionWarning = null;
  let layoutTitle = '';
  let layoutAbstract = '';
  let metadataText = '';

  if (extension === '.docx') {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    rawText = result.value;
    extractionMethod = 'mammoth';
  } else if (extension === '.pdf') {
    try {
      const extracted = JSON.parse(await pdfToMarkdown(file.buffer, true));
      rawText = extracted.markdown;
      metadataText = extracted.metadataText || '';
      layoutTitle = typeof extracted.title === 'string' ? extracted.title : '';
      layoutAbstract = typeof extracted.abstract === 'string' ? extracted.abstract : '';
      extractionMethod = 'markitdown-pdf';
    } catch (error) {
      const result = await pdf(file.buffer);
      rawText = result.text;
      extractionMethod = 'pdf-parse-fallback';
      extractionWarning = `MarkItDown 不可用，已回退到 pdf-parse：${error.message}`;
    }
  } else if (['.txt', '.md'].includes(extension)) {
    rawText = file.buffer.toString('utf8');
  } else {
    throw new Error('暂不支持该文件格式，请上传 DOCX、PDF、TXT 或 Markdown 文件。');
  }

  const text = normalizeText(rawText);
  if (text.length < 120) {
    throw new Error('未能提取到足够的论文正文，请检查文件是否为空、加密或仅包含扫描图片。');
  }

  const detectedSections = Object.fromEntries(
    Object.entries(SECTION_PATTERNS).map(([name, pattern]) => [name, pattern.test(text)]),
  );
  const chineseChars = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latinChars = text.match(/[A-Za-z]/g)?.length ?? 0;

  const plainAbstract = extractAbstract(metadataText || text);
  const localAbstract = !layoutAbstract || (!/[.!?。！？]$/.test(layoutAbstract) && plainAbstract.length > layoutAbstract.length && plainAbstract.startsWith(layoutAbstract.slice(0, 60)))
    ? plainAbstract : layoutAbstract;
  const metadata = await extractMetadataWithModel(metadataText || text, options);
  const { title: modelTitle, abstract: modelAbstract, keywords: modelKeywords = [], ...metadataExtraction } = metadata;

  return {
    filename,
    fileType: extension.slice(1).toUpperCase(),
    title: modelTitle || layoutTitle || extractTitle(text, filename),
    abstract: modelAbstract || localAbstract || extractAbstract(text),
    metadataExtraction,
    keywords: normalizeKeywordTerms([...extractKeywords(text), ...(Array.isArray(modelKeywords) ? modelKeywords : [modelKeywords])]),
    language: chineseChars >= latinChars * 0.35 ? '中文' : '英文',
    characterCount: text.length,
    wordCount: countWords(text),
    referenceCount: countReferences(text),
    detectedSections,
    extractionMethod,
    extractionWarning,
    text,
  };
}

export const __testables = {
  normalizeText,
  countWords,
  extractAbstract,
  extractKeywords,
  extractTitle,
  pdfToMarkdown,
};

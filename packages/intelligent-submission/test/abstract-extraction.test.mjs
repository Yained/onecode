import test from 'node:test';
import assert from 'node:assert/strict';
import { __testables } from '../server/lib/extractor.mjs';
const abstract = 'We present a reproducible method for scientific document analysis. Experiments evaluate the method across multiple datasets and demonstrate improved accuracy.';
test('abstract before chart numbers and a long contents section excludes figure data', () => {
  const text = `Title\nAbstract\n${abstract}\n1.2\nModel comparisons\n${'| 80 | 90 |\n'.repeat(500)}\nContents\n1 Introduction\nBody`;
  assert.equal(__testables.extractAbstract(text), abstract);
});
test('long abstracts are not discarded at the old 2200 character limit', () => {
  const content = Array(25).fill(abstract).join(' ');
  assert.equal(__testables.extractAbstract(`Abstract\n${content}\n# 1 Introduction\nBody`), content);
});
test('Markdown abstract and next heading are recognized', () => {
  assert.equal(__testables.extractAbstract(`## **Abstract**\n${abstract}\n## Keywords: analysis; retrieval`), abstract);
});
test('abstract-like words do not create an abstract', () => {
  assert.equal(__testables.extractAbstract(`Abstracting scientific documents\n${abstract}`), '');
});
test('structured abstract subsections remain part of the abstract', () => {
  const content = `Background: ${abstract}\nMethods: We evaluate three datasets.\nResults: Accuracy improves.`;
  assert.equal(__testables.extractAbstract(`Abstract\n${content}\n1 Introduction\nBody`), content.replaceAll('\n', ' '));
});

test('IEEE inline abstract ends at Index Terms or Roman introduction', () => {
  assert.equal(__testables.extractAbstract(`Abstract—${abstract}\nIndex Terms—image restoration\nI. INTRODUCTION\nOther text`), abstract);
  assert.equal(__testables.extractAbstract(`Abstract: ${abstract}\nI. INTRODUCTION\nOther text`), abstract);
});

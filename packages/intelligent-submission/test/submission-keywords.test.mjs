import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowKeywords } from '../shared/submission-keywords.mjs';
test('English manuscript without Keywords or AI analysis yields grounded search terms', () => {
 const document = {title:'Towards Highly Efficient Million-Token Context Intelligence', abstract:'We present language models with sparse attention and compressed attention for long context intelligence.',keywords:[]};
 const words = workflowKeywords({document,profile:{},aiAnalysis:{status:'error'}});
 assert.ok(words.includes('sparse attention'));
 assert.ok(words.some(x=>x.toLowerCase().includes('context')));
 assert.ok(words.length && words.length<=12);
 assert.ok(words.every(word=>(document.title+' '+document.abstract).toLowerCase().includes(word.toLowerCase())));
 assert.ok(!words.includes('We'));
});
test('Chinese manuscript without labels yields segmented terms rather than the whole abstract', () => {
 const words=workflowKeywords({document:{title:'大语言模型的长上下文稀疏注意力机制',abstract:'本文提出稀疏注意力机制，支持长上下文推理并降低计算成本。'}});
 assert.ok(words.length>=3);
 assert.ok(words.every(word=>word.length<12));
 assert.ok(!words.includes('本文'));
});
test('author and user keywords retain precedence and order',()=>{
 assert.deepEqual(workflowKeywords({document:{keywords:['机器学习'],title:'Different title'},profile:{keywords:['机器学习','智能体']}}),['机器学习','智能体']);
});
test('empty and non-informative text does not fabricate topics',()=>{
 assert.deepEqual(workflowKeywords({document:{title:'123 --',abstract:'We present this study.'}}),[]);
 assert.deepEqual(workflowKeywords({}),[]);
});

 test('technical phrases retain names and discard quantities and version fragments', () => {
  const words = workflowKeywords({document:{title:'Towards Highly Efficient Million-Token Context Intelligence',abstract:'We present two strong Mixture-of-Experts (MoE) language models — Example-V4-Pro with 1.6T parameters. A hybrid attention architecture combines Compressed Sparse Attention (CSA) and Heavily Compressed Attention (HCA). Manifold-Constrained Hyper-Connections (mHC) enhance residual connections. The Muon optimizer improves training stability. Both support one million tokens.'}});
  assert.ok(words.includes('Compressed Sparse Attention'));
  assert.ok(words.includes('Heavily Compressed Attention'));
  assert.ok(words.includes('Mixture-of-Experts'));
  assert.ok(words.includes('Manifold-Constrained Hyper-Connections'));
  assert.ok(words.includes('Muon optimizer'));
  assert.ok(words.every(word=>! /^(million|pro|one|v4|token|parameters|long|attention)$/i.test(word)));
 });
 test('phrase rules generalize to non-LLM research without retaining prose verbs',()=>{
  const words=workflowKeywords({document:{title:'Stellar populations with Bayesian inference',abstract:'We investigate stellar populations using high-resolution spectroscopy and Bayesian inference.'}});
  assert.ok(words.some(x=>x.toLowerCase()==='bayesian inference'));
  assert.ok(words.includes('high-resolution spectroscopy'));
  assert.ok(!words.some(x=>x.toLowerCase().includes('investigate')));
 });

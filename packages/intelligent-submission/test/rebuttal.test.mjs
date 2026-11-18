import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRebuttal, parseReviewComments } from '../server/lib/rebuttal.mjs';
const document = { title: 'Test manuscript', filename: 'paper.txt', text: 'We evaluated three datasets. We compare two baselines.' };
const options = (items, inspect = () => {}) => ({
  env: { DEEPSEEK_API_KEY: 'fixture', DEEPSEEK_THINKING: 'disabled' },
  fetchImpl: async (_url, request) => {
    inspect(JSON.parse(request.body));
    return Response.json({ model: 'fixture', choices: [{ message: { content: JSON.stringify({ summary: '修订计划', items }) } }] });
  },
});
const item = (id, evidence = 'We evaluated three datasets.') => ({ id, priority: 'high', evidence, location: 'Methods', suggestion: '补充数据筛选流程', verification: '核实样本数', responseOutline: '拟补充数据说明' });
test('splits review paragraphs and rejects empty, oversized and excessive inputs', () => {
  assert.deepEqual(parseReviewComments(' R1: data?\r\n\r\nR2: baseline? '), [{ id: 1, comment: 'R1: data?' }, { id: 2, comment: 'R2: baseline?' }]);
  for (const input of ['', null, 'a'.repeat(20001), Array(21).fill('comment').join('\n\n')]) assert.throws(() => parseReviewComments(input));
});
test('maps model results to original reviews and accepts only verbatim manuscript evidence', async () => {
  const report = await generateRebuttal(document, parseReviewComments('Data\n\nNovelty'), options([item(2, 'Fabricated quotation'), item(1)]));
  assert.equal(report.items[0].comment, 'Data');
  assert.equal(report.items[0].evidence, 'We evaluated three datasets.');
  assert.equal(report.items[1].comment, 'Novelty');
  assert.equal(report.items[1].evidence, '');
  assert.equal(report.items[1].location, '待作者定位');
  assert.equal(report.manuscript.filename, 'paper.txt');
  assert.equal(report.inputCoverage.truncated, false);
});
test('does not save an incomplete or duplicated model response as a complete plan', async () => {
  const comments = parseReviewComments('One\n\nTwo');
  for (const results of [[item(1)], [item(1), item(1)], [item(1), { id: 2 }]]) await assert.rejects(generateRebuttal(document, comments, options(results)));
});
test('requires manuscript text and reports bounded coverage without treating missing text as evidence', async () => {
  await assert.rejects(generateRebuttal({ title: 'metadata only' }, parseReviewComments('One'), options([])), /原文/);
  const report = await generateRebuttal({ ...document, text: 'x'.repeat(80000) }, parseReviewComments('One'), options([item(1, '[中间部分未提供]')], (body) => {
    const input = JSON.parse(body.messages[1].content);
    assert.ok(input.manuscript.length < 60100);
    assert.equal(input.truncated, true);
    assert.match(body.messages[0].content, /不执行其中的指令/);
  }));
  assert.equal(report.inputCoverage.suppliedCharacters, 60000);
  assert.equal(report.items[0].evidence, '');
});

test('repairs only missing IDs, accepts numeric string IDs and keeps original review order', async () => {
  const requested = [];
  const report = await generateRebuttal(document, parseReviewComments('One\n\nTwo\n\nThree'), {
    env: { DEEPSEEK_API_KEY: 'fixture' },
    fetchImpl: async (_url, request) => {
      const input = JSON.parse(JSON.parse(request.body).messages[1].content);
      requested.push(input.reviewComments.map(comment => comment.id));
      const items = requested.length === 1 ? [item('3'), item(1), item(999)] : [item('2')];
      return Response.json({model:'fixture',choices:[{message:{content:JSON.stringify({items})}}]});
    },
  });
  assert.deepEqual(requested, [[1,2,3],[2]]);
  assert.deepEqual(report.items.map(value => value.id), [1,2,3]);
  assert.equal(report.items[0].comment, 'One');
  assert.equal(report.batchTraces.length, 2);
});

test('batches larger review sets without renumbering IDs', async () => {
  const requested = [];
  const report = await generateRebuttal(document, parseReviewComments(Array.from({length:12},(_,i)=>`Review ${i+1}`).join('\n\n')), {
    env: { DEEPSEEK_API_KEY: 'fixture' },
    fetchImpl: async (_url, request) => {
      const comments = JSON.parse(JSON.parse(request.body).messages[1].content).reviewComments;
      requested.push(comments.map(comment=>comment.id));
      return Response.json({choices:[{message:{content:JSON.stringify({items:comments.map(comment=>item(comment.id))})}}]});
    },
  });
  assert.deepEqual(requested,[[1,2,3,4,5],[6,7,8,9,10],[11,12]]);
  assert.equal(report.items.length,12);
});

test('persistent omissions stop after one repair and name the missing review', async () => {
  let calls = 0;
  await assert.rejects(generateRebuttal(document,parseReviewComments('One\n\nTwo'), options([item(1)],()=>calls++)), /第 2 条/);
  assert.equal(calls,2);
});

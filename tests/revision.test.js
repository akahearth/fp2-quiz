import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSession,submitAnswer,emptyHistory,saveState,loadState,aggregate} from '../core.js';
const read=n=>JSON.parse(readFileSync(new URL('../'+n,import.meta.url),'utf8'));
const b2=read('questions.json'),b3=read('questions-fp3.json'),report=read('REVISION.json');
const q=(bank,id)=>bank.questions.find(q=>q.id===id),text=q=>q.choices.find(c=>c.id===q.correctChoiceId).text;
test('600問の追加点検記録と108問の改修前後・全解説が現行データに一致する',()=>{
  assert.equal(report.questions.length,600);assert.equal(report.counts.revised,108);
  assert.equal(report.questions.filter(r=>r.grade==='2'&&r.status==='revised').length,86);
  assert.equal(report.questions.filter(r=>r.grade==='3'&&r.status==='revised').length,22);
  for(const r of report.questions){const item=q(r.grade==='2'?b2:b3,r.id);assert.equal(item.prompt,r.after.prompt);assert.deepEqual(item.choices,r.after.choices);assert.ok(item.editorialReview.examReference.url.includes('jafp.or.jp'));assert.equal(item.editorialReview.checkedAt,'2026-10-12');assert.equal(new Set(item.choices.map(c=>c.text)).size,item.choices.length);}
  assert.equal(b2.questions.filter(q=>q.calculation).length,74);assert.equal(b3.questions.filter(q=>q.calculation).length,18);
  for(const bank of [b2,b3])for(const item of bank.questions.filter(q=>q.calculation)){
    const numbers=item.choices.map(c=>c.text.match(/^(\d+(?:\.\d+)?)[％倍]。$/));
    if(numbers.every(Boolean))assert.equal(new Set(numbers.map(m=>(m[1].split('.')[1]||'').length)).size,1,item.id);
  }
});
test('改修した複合計算の主な誤答が独立した誤りの算式と一致し、正解とは異なる',()=>{
  const cases={
    'life-049':['13万円。','12万9,500円。','12万9,000円。'],
    'risk-045':['6万5,000円。','9万円。','3万5,000円。'],
    'risk-046':['16万円。','24万円。','12万円。'],
    'finance-046':['5,000円の利益。','9,100円の利益。','9,120円の利益。'],
    'tax-045':['2万円。','5万円。','6万円。'],
    'inheritance-050':['100万円。','0円。','498万円。']
  };
  assert.deepEqual([5000*(18-5),5000*18,5000*(12-5)],[65000,90000,35000]);
  assert.deepEqual([1000*(155-150),1020*155-1000*149,1020*156-1000*150],[5000,9100,9120]);
  assert.deepEqual([(2600-2100)*.2,Math.max(0,2600-110-2500)*.2,(2600-110)*.2],[100,0,498]);
  for(const [id,options] of Object.entries(cases)){const item=q(b2,id);assert.deepEqual(item.choices.filter(c=>c.id!==item.correctChoiceId).map(c=>c.text),options);assert.ok(options.every(t=>t!==text(item)));}
});
test('用語の曖昧さを解消し、2級と3級の入院・手術の対象額を区別する',()=>{
  assert.match(q(b2,'risk-005').prompt,/死亡時期が早い場合と遅い場合/);
  assert.match(q(b2,'life-050').prompt,/2年間の累計額ではない/);
  assert.match(q(b2,'tax-041').prompt,/17年8か月/);
  assert.match(q(b2,'tax-045').prompt,/治療Aの費用だけ/);
  assert.equal(text(q(b2,'risk-046')),'20万円。');assert.equal(text(q(b3,'fp3-risk-049')),'16万円。');
  assert.match(q(b3,'fp3-risk-049').prompt,/手術給付金だけ/);
  assert.match(q(b3,'fp3-tax-030').prompt,/所得金額調整控除・特定支出控除は考慮しない/);
  for(const bank of [b2,b3])assert.ok(bank.questions.every(q=>!q.prompt.includes('でとして')));
});
test('改修前の問題スナップショットは再開せず、既存成績・復習状態は保持する',()=>{
  const before={...b2,dataVersion:'2026-10-11.audit-300',questions:[{...q(b2,'risk-046'),prompt:'旧問題文'}]};const h=emptyHistory(),s=createSession(before,h,{mode:'random',count:10},Date.parse('2026-10-12T00:00:00Z'));
  submitAnswer(h,s,s.questions[0].choices.find(c=>c.id!==s.questions[0].correctChoiceId).id);
  const map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};saveState(storage,h,s);
  const loaded=loadState(storage,b2);assert.equal(loaded.active,null);assert.deepEqual(loaded.history,h);assert.equal(aggregate(b2.questions,loaded.history).pending,1);
});

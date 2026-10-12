import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {emptyHistory,poolFor,createSession,submitAnswer,saveState,loadState} from '../core.js';
const bank=JSON.parse(readFileSync(new URL('../questions.json',import.meta.url),'utf8'));
const audit=JSON.parse(readFileSync(new URL('../AUDIT.json',import.meta.url),'utf8'));
test('全300問の6項目の照合、法令基準日、全4選択肢の判定と出典を記録',()=>{
  assert.equal(bank.questions.length,300); assert.equal(audit.questions.length,300);
  assert.equal(audit.counts.confirmed,294); assert.equal(audit.counts.needsReview,6);
  for(const q of bank.questions) {
    const row=audit.questions.find(r=>r.id===q.id);
    assert.equal(q.basisDate,'2026-04-01');assert.ok(['2026-10-11','2026-10-12'].includes(q.lastVerified));assert.equal(row.checkedAt,q.lastVerified);
    assert.equal(q.audit.checkedItems.length,6);assert.equal(row.choices.length,4);
    assert.equal(row.choices.filter(c=>c.assessment==='正解').length,1);
    assert.deepEqual(row.choices.map(c=>c.explanation),q.choices.map(c=>c.explanation));
    assert.equal(row.status,q.needsReview?'needs-review':'confirmed');
    assert.match(q.prompt,/最も適切/);
    if(!q.needsReview) {assert.ok(q.audit.evidence.length>0,q.id);assert.ok(q.sources.every(s=>q.audit.evidence.some(e=>e.url===s.url&&e.note)),q.id);}
    else assert.ok(q.reviewReason,q.id);
  }
});
test('全演習モード・復習・模試から要確認を除外する',()=>{
  const history=emptyHistory();
  for(const q of bank.questions.filter(q=>q.needsReview)) history.records[q.id]={reviewPending:true};
  for(const mode of ['random','field','unit','review','mock']) {
    const settings={mode,count:60,fieldIds:bank.fields.map(f=>f.id),unitId:'estate-transaction'};
    const pool=poolFor(bank,history,settings);
    assert.ok(pool.every(q=>!q.needsReview));
    if(mode!=='review') assert.ok(createSession(bank,history,settings).questions.every(q=>!q.needsReview));
  }
  assert.equal(poolFor(bank,history,{mode:'random'}).length,294);
});
test('旧セッションの要確認問題を復元せず、確定した累計履歴を保護する',()=>{
  const q=bank.questions.find(q=>q.needsReview),oldBank={...bank,questions:[{...q,needsReview:false}]};
  const history=emptyHistory(),session=createSession(oldBank,history,{mode:'random',count:10});
  submitAnswer(history,session,session.questions[0].correctChoiceId);
  const map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
  saveState(storage,history,session);
  const restored=loadState(storage,bank);
  assert.equal(restored.active,null);assert.deepEqual(restored.history,history);assert.match(restored.warning,/要確認/);
});
test('数値・期間の区別と2つの初期計算問題を独立に確認',()=>{
  const find=id=>bank.questions.find(q=>q.id===id);
  const answer=id=>{const q=find(id);return q.choices.find(c=>c.id===q.correctChoiceId).text;};
  assert.equal(answer('estate-001'),`${200*.6}㎡`);
  assert.equal(answer('tax-002'),`${240-80}万円`);
  assert.match(find('risk-048').prompt,/毎月1回、合計60回/);assert.match(find('risk-048').prompt,/10万円/);
  assert.match(find('life-048').prompt,/年額/);assert.match(find('risk-005').prompt,/保険期間満了/);
  assert.match(find('life-047').prompt,/10円未満.*四捨五入/);
});

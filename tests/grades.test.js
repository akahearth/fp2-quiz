import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gradeConfig,readGrade,GRADE_PREFERENCE_KEY} from '../grades.js';
import {validateBank,emptyHistory,createSession,submitAnswer,nextQuestion,finishSession,loadState,saveState,exportBackup,importBackup,poolFor,expired,validateActive} from '../core.js';
const read = file=>JSON.parse(readFileSync(new URL('../'+file,import.meta.url),'utf8'));
const fp2=read('questions.json'),fp3=read('questions-fp3.json'),audit=read('AUDIT-FP3.json');
const now=Date.parse('2026-10-11T00:00:00Z');
const rng=()=>0.42;
function memory(){const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)};}
const options={mode:'random',count:10,fieldIds:[],unitId:''};

test('3級は6分野各50問、各形式25問で全300問に個別根拠と全選択肢解説がある',()=>{
  validateBank(fp3);assert.equal(fp3.questions.length,300);assert.equal(new Set(fp3.questions.map(q=>q.prompt)).size,300);
  assert.equal(audit.counts.confirmed,300);assert.equal(audit.questions.length,300);
  let choices=0;
  for(const field of fp3.fields)for(const format of ['true-false','three-choice'])assert.equal(fp3.questions.filter(q=>q.fieldId===field.id&&q.format===format).length,25);
  for(const q of fp3.questions){
    assert.ok(q.id.startsWith('fp3-'));assert.equal(q.basisDate,'2026-04-01');assert.equal(q.needsReview,false);
    assert.equal(q.audit.checkedItems.length,6);assert.ok(q.audit.evidence.length);
    const source=fp2.questions.find(p=>p.id===q.audit.adaptedFrom);assert.ok(source&&!source.needsReview);
    assert.ok(q.sources.every(s=>q.audit.evidence.some(e=>e.url===s.url)));
    const row=audit.questions.find(r=>r.id===q.id);assert.equal(row.prompt,q.prompt);assert.deepEqual(row.sources,q.sources);
    assert.equal(row.choices.filter(c=>c.assessment==='正解').length,1);
    q.choices.forEach(c=>{assert.ok(c.explanation);assert.equal(row.choices.find(r=>r.id===c.id).explanation,c.explanation);});choices+=q.choices.length;
  }assert.equal(choices,750);
});
test('級・形式に対応しない選択肢数や○×順序を拒否する',()=>{
  for(const mutate of [b=>b.questions[0].choices.pop(),b=>b.questions[0].choices.reverse(),b=>b.questions[0].format='four-choice',b=>b.grade='4']){
    const b=structuredClone(fp3);mutate(b);assert.throws(()=>validateBank(b));
  }
  const b=structuredClone(fp2);b.questions[0].choices.pop();assert.throws(()=>validateBank(b));
});
test('級の選択は不明値・保存不可時に2級を既定値とし、保存キーは既存2級を維持する',()=>{
  const store=memory();assert.equal(readGrade(store),'2');store.setItem(GRADE_PREFERENCE_KEY,'3');assert.equal(readGrade(store),'3');
  store.setItem(GRADE_PREFERENCE_KEY,'invalid');assert.equal(readGrade(store),'2');assert.equal(readGrade({getItem(){throw Error();}}),'2');
  assert.equal(gradeConfig('2').storageKey,'fp2-trainer:v1');assert.equal(gradeConfig('3').storageKey,'fp3-trainer:v1');assert.throws(()=>gradeConfig('4'));
});
test('2級・3級の回答、復習、途中セッションは別々に保存・再開し、相互に上書きしない',()=>{
  const store=memory(),h2=emptyHistory(),h3=emptyHistory();
  const s2=createSession(fp2,h2,options,now,rng),s3=createSession(fp3,h3,options,now+1,rng);
  submitAnswer(h2,s2,s2.questions[0].correctChoiceId,now+10);saveState(store,h2,s2);
  const original=store.getItem('fp2-trainer:v1');assert.deepEqual(loadState(store,fp3).history,emptyHistory());
  const bad=s3.questions[0].choices.find(c=>c.id!==s3.questions[0].correctChoiceId).id;
  submitAnswer(h3,s3,bad,now+10);saveState(store,h3,s3,'3');assert.equal(store.getItem('fp2-trainer:v1'),original);
  const r2=loadState(store,fp2),r3=loadState(store,fp3);assert.equal(Object.keys(r2.history.records).length,1);assert.equal(Object.keys(r3.history.records).length,1);
  assert.equal(r2.active.selected,s2.selected);assert.equal(r3.active.selected,bad);assert.equal(r3.history.records[s3.questions[0].id].reviewPending,true);
  assert.equal(poolFor(fp2,r2.history,{mode:'review'}).length,0);assert.equal(poolFor(fp3,r3.history,{mode:'review'}).length,1);
});
test('旧2級バックアップを受け入れ、級が違うバックアップは復元前に拒否する',()=>{
  const h=emptyHistory(),b2=JSON.stringify(exportBackup(h,fp2.dataVersion,new Date(now).toISOString()));
  const b3=JSON.stringify(exportBackup(h,fp3.dataVersion,new Date(now).toISOString(),'3'));
  assert.deepEqual(importBackup(b2),h);assert.deepEqual(importBackup(b3,'3'),h);
  assert.throws(()=>importBackup(b2,'3'),/選択中の級/);assert.throws(()=>importBackup(b3,'2'),/選択中の級/);
});
test('3級60問模試は正誤30・3択30、各分野10問、90分で再開・採点できる',()=>{
  const h=emptyHistory(),s=createSession(fp3,h,{...options,mode:'mock',count:60},now,rng);
  assert.equal(s.questions.length,60);assert.equal(new Set(s.questions.map(q=>q.id)).size,60);
  assert.ok(s.questions.slice(0,30).every(q=>q.format==='true-false'));assert.ok(s.questions.slice(30).every(q=>q.format==='three-choice'));
  for(const f of fp3.fields)for(const format of ['true-false','three-choice'])assert.equal(s.questions.filter(q=>q.fieldId===f.id&&q.format===format).length,5);
  assert.equal(s.deadline-now,90*60000);assert.equal(expired(s,now+90*60000-1),false);assert.equal(expired(s,s.deadline),true);
  for(const q of s.questions.filter(q=>q.format==='true-false'))assert.deepEqual(s.orders[q.id],['true','false']);
  for(let i=0;i<60;i++){
    const q=s.questions[s.index],answer=i%2?q.choices.find(c=>c.id!==q.correctChoiceId).id:q.correctChoiceId;
    submitAnswer(h,s,answer,now+i*1000);if(i===14){const store=memory();saveState(store,h,s,'3');assert.deepEqual(loadState(store,fp3).active,s);}nextQuestion(s);
  }
  assert.deepEqual(h.records,{});const result=finishSession(h,s,now+60000);assert.equal(result.correct,30);assert.equal(result.answered,60);assert.equal(finishSession(h,s),false);
});
test('3級お試し模試は12問18分、2級の既存60問120分は維持する',()=>{
  const s=createSession(fp3,emptyHistory(),{...options,mode:'mock',count:12},now,rng);assert.equal(s.deadline-now,18*60000);
  for(const f of fp3.fields)assert.equal(s.questions.filter(q=>q.fieldId===f.id).length,2);
  assert.equal(createSession(fp2,emptyHistory(),{...options,mode:'mock',count:60},now,rng).deadline-now,120*60000);
});
test('3級の全モードは3級IDのみ抽出し、要確認に変更した問題を除外する',()=>{
  const b=structuredClone(fp3),h=emptyHistory();const q=b.questions[0];q.needsReview=true;
  for(const mode of ['random','field','unit','review','mock']){
    const setting={mode,count:10,fieldIds:[q.fieldId],unitId:q.unitId};
    h.records[q.id]={reviewPending:true};const pool=poolFor(b,h,setting);assert.ok(pool.every(p=>p.id.startsWith('fp3-')&&p.id!==q.id));
  }
});
test('3級計算18問の正解を独立した算式で照合する',()=>{
  const cases={
    'life-039':[600-480,'120万円の黒字。'], 'life-040':[800+2200-1600-200,'1,200万円。'], 'life-048':[200*60,'1万2,000円。'],
    'risk-041':[2000-600,'1,400万円。'],'risk-045':[5000*12,'6万円。'],'risk-046':[8000*20,'16万円。'],'risk-048':[10*60,'600万円。'],
    'finance-039':[2400/120,'20倍。'],'finance-040':[1500/1000,'1.5倍。'],'finance-042':[60/2000*100,'3％。'],
    'tax-039':[900-550,'350万円。'],'tax-040':[300-180,'120万円。'],'tax-044':[30-5-10,'15万円。'],'tax-046':[60,'60万円。'],
    'estate-040':[150*2,'300㎡。'],'estate-045':[120/2000*100,'6％。'],
    'inheritance-041':[3000+600*3,'4,800万円。'],'inheritance-049':[100+80-110,'70万円。']
  };
  const expected=[120,1200,12000,1400,60000,160000,600,20,1.5,3,350,120,15,60,300,6,4800,70];
  Object.entries(cases).forEach(([ref,[value,text]],i)=>{assert.equal(value,expected[i]);const q=fp3.questions.find(q=>q.format==='three-choice'&&q.audit.adaptedFrom===ref);assert.ok(q,ref);assert.equal(q.choices.find(c=>c.id===q.correctChoiceId).text,text);});
});
test('3級の保存済み○×順序の破損は再開を中止し、確定した履歴を保持する',()=>{
  const h=emptyHistory(),s=createSession(fp3,h,{...options,mode:'mock',count:12},now,rng);s.orders[s.questions[0].id].reverse();assert.throws(()=>validateActive(s,fp3));
  const store=memory();saveState(store,h,s,'3');const loaded=loadState(store,fp3);assert.equal(loaded.active,null);assert.deepEqual(loaded.history,h);assert.ok(loaded.warning);
});

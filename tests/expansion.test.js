import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateBank, emptyHistory, aggregate, createSession, submitAnswer, nextQuestion, finishSession, saveState, loadState, exportBackup, importBackup, poolFor} from '../core.js';
const read = file => JSON.parse(readFileSync(new URL(file,import.meta.url),'utf8'));
const bank = validateBank(read('../questions.json'));
const initial = validateBank(read('./fixtures/initial-12.json'));
const now = Date.parse('2026-10-11T06:00:00Z');
const settings = (mode,count,fieldIds=[],unitId='') => ({mode,count,fieldIds,unitId});
const answer = id => {const q=bank.questions.find(q=>q.id===id); return q.choices.find(c=>c.id===q.correctChoiceId).text;};
function number(text) {
  const value=text.replaceAll(',','').replace(/^(?:約)/,'');
  const m=value.match(/^(\d+(?:\.\d+)?)(?:万(\d+(?:\.\d+)?))?/);
  assert.ok(m,text); return value.includes('万') ? Number(m[1])*10000+Number(m[2]||0) : Number(m[1]);
}

test('全300問の問題文と各問題の選択肢は重複せず、全小単元に問題がある',()=>{
  assert.equal(new Set(bank.questions.map(q=>q.prompt)).size,300);
  for(const q of bank.questions) assert.equal(new Set(q.choices.map(c=>c.text)).size,4,q.id);
  for(const f of bank.fields) for(const u of f.units) assert.ok(bank.questions.some(q=>q.unitId===u.id),u.id);
  for(const f of bank.fields) for(let i=1;i<=50;i++) assert.ok(bank.questions.some(q=>q.id===`${f.id}-${String(i).padStart(3,'0')}`));
});
test('初期12問のID・分野・小単元・正解IDを保持し、本文は検証後の内容を使う',()=>{
  for(const q of initial.questions) {
    const current=bank.questions.find(n=>n.id===q.id);
    for(const key of ['id','fieldId','unitId','correctChoiceId']) assert.equal(current[key],q[key],q.id);
    assert.deepEqual(current.choices.map(c=>c.id),q.choices.map(c=>c.id));
  }
});
test('12問版の履歴・復習待ちは移行し、校正前の途中問題は再開しない',()=>{
  const history=emptyHistory();
  const session=createSession(initial,history,settings('random',10),now,()=>0.42);
  const q=session.questions[0];
  submitAnswer(history,session,q.choices.find(c=>c.id!==q.correctChoiceId).id,now+1000);
  const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
  saveState(storage,history,session);
  const restored=loadState(storage,bank);
  assert.deepEqual(restored.history,history); assert.equal(restored.active,null); assert.match(restored.warning,/検証・校正/);
  assert.equal(poolFor(bank,restored.history,settings('review',10))[0].id,q.id);
  assert.equal(aggregate(bank.questions,restored.history).total,300);
  assert.equal(aggregate(bank.questions,restored.history).attempts,1);
  assert.deepEqual(importBackup(JSON.stringify(exportBackup(history,initial.dataVersion))),history);
});
test('60問模試を再読込して全問回答・採点し、累計と復習を一度だけ更新する',()=>{
  const history=emptyHistory(),session=createSession(bank,history,settings('mock',60),now,()=>0.42);
  assert.equal(new Set(session.questions.map(q=>q.id)).size,60);
  assert.equal(session.deadline-now,7200000);
  const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
  for(let i=0;i<30;i++) {
    const q=session.questions[session.index]; submitAnswer(history,session,q.correctChoiceId,now+1000+i); nextQuestion(session);
  }
  assert.equal(aggregate(bank.questions,history).attempts,0);
  saveState(storage,history,session);
  const restored=loadState(storage,bank);
  for(let i=30;i<60;i++) {
    const q=restored.active.questions[restored.active.index];
    submitAnswer(restored.history,restored.active,q.choices.find(c=>c.id!==q.correctChoiceId).id,now+1000+i);
    nextQuestion(restored.active);
  }
  const result=finishSession(restored.history,restored.active,now+2000);
  assert.equal(result.total,60); assert.equal(result.answered,60); assert.equal(result.correct,30);
  assert.equal(aggregate(bank.questions,restored.history).accuracy,50);
  assert.equal(aggregate(bank.questions,restored.history).pending,30);
  assert.equal(finishSession(restored.history,restored.active),false);
});
test('各分野50問の重複なし演習と、全小単元の不足数での出題ができる',()=>{
  for(const f of bank.fields) {
    const s=createSession(bank,emptyHistory(),settings('field',60,[f.id]),now);
    const eligible=bank.questions.filter(q=>q.fieldId===f.id&&!q.needsReview).length;
    assert.equal(s.questions.length,eligible); assert.ok(s.questions.every(q=>q.fieldId===f.id&&!q.needsReview));
    assert.equal(new Set(s.questions.map(q=>q.id)).size,eligible);
    for(const u of f.units) {
      const pool=poolFor(bank,emptyHistory(),settings('unit',60,[],u.id));
      const subset=createSession(bank,emptyHistory(),settings('unit',60,[],u.id),now);
      assert.equal(subset.questions.length,pool.length); assert.ok(subset.questions.every(q=>q.unitId===u.id));
    }
  }
});

// 問題データ生成コードから独立した算式で72問の正解を照合する。
const calculations={
  life:[((40*12+120)-(30*12+120))*10000,(600+200+2200-1600-200)*10000,Math.round(1000000*1.02**3),2000000*.9151,200000*5.2040,1000000*.1922,600000*4.7135,5000000*.2122,Math.round(((280000*6+320000*6)/12)/30*2/3),200*60,12000000/120+(12000000-12000000/120)*.03/12,1000000*1.02**2],
  risk:[(5000-2000-500-800)*10000,(20*12*10+600-144*10-400)*10000,2000*.7*10000,'600万円以上1,000万円以下。',Math.min(12000*.5,5000)*10000,Math.min(3000*.5,1000)*10000,5000*Math.min(18-5,12),8000*(5+20),Math.min(80-5,70)*10000,10*Math.max((15-10)*12,2*12)*10000,(300-120-50)/2*10000,(8*60+100-200)*10000],
  finance:[2400/(120000000/1000000),1500/(1000000000/1000000),800/((8000+12000)/2)*100,(20+40)/2000*100,50000000/200000000*100,2/80*100,Math.round((2+(100-95)/5)/95*10000)/100,1000*1.02*155-1000*150,Math.round(20000/(10000/1000+10000/500)),4*.6+1*.4,(1400000000-200000000)/1000000000*10000,'株式を10万円売り、債券を10万円買う。'],
  tax:[(900-450-100)*10000,(300-150-30)*10000,(1200-40*Math.ceil(17+8/12))/2*10000,(800+70*(Math.ceil(24+8/12)-20))*10000,(200-20-50)/2*10000,(10-5+20-10)*10000,(13-Math.min(1,2)-Math.min(10,100*.05))*10000,(48+12)*10000,Math.min(60000,50000),(650-200-50)*10000*.2-427500,50000-2000,10000000*.2*.5],
  estate:[(220-20)*.6,150*Math.min(2,4*.6),Math.min(200,4*.4*100),(200-20)*Math.min(3,5*.4),(4-3)/2*10,(2000*.03+6)*10000,120/2000*100,(240-45-15)/3000*100,12000000/6,(4000-1400-100-200)*10000,30000000*.05,(5000-1400-200-3000)*10000],
  inheritance:[6000*.5/2*10000,9000*2/3*10000,(3000+600*3)*10000,500*3*10000,(2000-500*3)*10000,(8000-3000-600*2)*10000,200000*.95*150,10000000*1.1,Math.min(1200,1100,1150,1050)*100,50000000*.2,(100+80-110)*10000,(2600-110-(2500-400))*.2*10000]
};
for(const [field,values] of Object.entries(calculations)) {
  test(`${field}の計算・事例12問を独立した算式と照合`,()=>{
    values.forEach((expected,i)=>{
      const id=`${field}-${String(i+39).padStart(3,'0')}`,actual=answer(id);
      if(typeof expected==='string') assert.equal(actual,expected,id);
      else assert.ok(Math.abs(number(actual)-expected)<0.000001,`${id}: ${actual}, expected ${expected}`);
    });
  });
}

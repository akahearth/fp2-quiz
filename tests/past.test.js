import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {validatePastBank,emptyPastState,startPast,answerPast,scorePast,finishPast,pastExpired,validatePastState,loadPastState,PAST_KEY,createPastUI} from '../past.js';
const data=validatePastBank(JSON.parse(readFileSync(new URL('../past-exams.json',import.meta.url),'utf8')));
const now=Date.parse('2026-10-12T01:00:00Z');
const clone=x=>structuredClone(x);

test('過去問は両級各60問、公式の形式・順序と2025年基準日、120画像とPDFを持つ',()=>{
  assert.equal(data.exams.length,2);
  for(const e of data.exams){
    assert.equal(e.lawBasisDate,'2025-04-01');assert.equal(e.questions.length,60);assert.ok(existsSync(new URL('../'+e.questionPdf,import.meta.url)));
    for(const q of e.questions){assert.equal(q.images.length,1);assert.ok(q.text.length>20);assert.ok(q.images.every(p=>existsSync(new URL('../'+p,import.meta.url))));assert.ok(!/正解\s*[1-4○〇×]/.test(q.text));}
    assert.deepEqual(e.questions.map(q=>q.number),Array.from({length:60},(_,i)=>i+1));
    assert.equal(e.questions.filter(q=>q.format==='true-false').length,e.grade==='3'?30:0);
  }
  assert.equal(data.exams[0].questions[25].correct,'2'); // 公表問題の投資指標
  assert.equal(data.exams[1].questions[51].correct,'2'); // 公表問題の容積率
  assert.equal(data.exams[1].questions[56].correct,'3'); // 親族関係図
});
test('過去問データの重複セット・誤った正解・回答数・画像パスを拒否',()=>{
  for(const mutate of [d=>d.exams.push(clone(d.exams[0])),d=>d.exams[1].questions[0].correct='1',d=>d.exams[0].questions[0].choices=['1','2'],d=>d.exams[0].questions[0].images=['https://bad.test/image.png'],d=>d.exams[0].questions[0].text+='正解 3)']){const d=clone(data);mutate(d);assert.throws(()=>validatePastBank(d));}
});
test('過去問の1問練習は確定後に書き換えず、原文の選択肢番号で採点する',()=>{
  const e=data.exams[0],s=startPast(e,'practice',now);
  assert.equal(answerPast(s,e,e.questions[0].correct,now+1),true);
  assert.equal(answerPast(s,e,'1',now+2),false);
  assert.deepEqual(scorePast(s,e),{total:60,answered:1,correct:1,incorrect:0,unanswered:59,score:1,passed:false});
});
test('両級の本番形式は全60問を解いて36点を採点、二重終了しない',()=>{
  for(const e of data.exams){const s=startPast(e,'mock',now);for(let i=0;i<60;i++){s.index=i;const q=e.questions[i];answerPast(s,e,i<36?q.correct:q.choices.find(c=>c!==q.correct),now+100+i);}const r=finishPast(s,e,now+1000);assert.equal(r.score.correct,36);assert.equal(r.score.incorrect,24);assert.equal(r.score.unanswered,0);assert.equal(r.score.passed,true);assert.equal(finishPast(s,e,now+1001),false);}
});
test('35点は合格基準未達であり、未回答のある結果を60点満点で扱う',()=>{
  const e=data.exams[1],s=startPast(e,'mock',now);for(let i=0;i<35;i++){s.index=i;answerPast(s,e,e.questions[i].correct,now+1);}const r=finishPast(s,e,now+2);assert.equal(r.score.passed,false);assert.equal(r.score.unanswered,25);assert.equal(r.score.total,60);
});
test('本番形式は戻って回答を変更でき、時間切れ後の確定を拒否する',()=>{
  for(const e of data.exams){const s=startPast(e,'mock',now);assert.equal(s.deadline-now,e.grade==='2'?7200000:5400000);answerPast(s,e,e.questions[0].choices.find(c=>c!==e.questions[0].correct),now+1);answerPast(s,e,e.questions[0].correct,now+2);assert.equal(scorePast(s,e).correct,1);assert.equal(pastExpired(s,s.deadline-1),false);assert.equal(pastExpired(s,s.deadline),true);assert.throws(()=>answerPast(s,e,e.questions[0].correct,s.deadline));}
});
test('過去問の級ごとの途中保存と結果を再読込し、オリジナル問題の保存に触れない',()=>{
  const state=emptyPastState();for(const e of data.exams){state.active[e.grade]=startPast(e,'practice',now);answerPast(state.active[e.grade],e,e.questions[0].correct,now+1);}
  const map=new Map([['fp2-trainer:v1','existing-2'],['fp3-trainer:v1','existing-3']]);const storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
  storage.setItem(PAST_KEY,JSON.stringify(state));assert.deepEqual(loadPastState(storage,data),state);assert.equal(map.get('fp2-trainer:v1'),'existing-2');assert.equal(map.get('fp3-trainer:v1'),'existing-3');
  const r=finishPast(state.active['2'],data.exams[0],now+100);state.results.push(r);delete state.active['2'];assert.deepEqual(validatePastState(state,data),state);
});
test('過去問の復元で不明なセット・級違い・改ざんスコア・期限・回答キーを拒否する',()=>{
  const state=emptyPastState(),e=data.exams[0];state.active['2']=startPast(e,'mock',now);
  for(const mutate of [s=>s.active['2'].examId='missing',s=>s.active['2'].grade='3',s=>s.active['2'].deadline++,s=>s.active['2'].answers['61']='1',s=>Object.defineProperty(s.active['2'].answers,'__proto__',{value:'1',enumerable:true}),s=>s.active['2'].selected='○',s=>delete s.active['2'].id]){const s=clone(state);mutate(s);assert.throws(()=>validatePastState(s,data));}
  const r=finishPast(state.active['2'],e,now+100);state.results=[r];state.active={};state.results[0].score.correct=60;assert.throws(()=>validatePastState(state,data));
});
test('破損した過去問の保存を読み込んでも元データを書き換えない',()=>{
  let writes=0;const storage={getItem:()=>'{broken',setItem:()=>writes++};assert.throws(()=>loadPastState(storage,data));assert.equal(writes,0);
});
test('破損した過去問データを保護しながら有効なバックアップで復元できる',async()=>{
  const previousWindow=globalThis.window;globalThis.window={addEventListener:()=>{}};
  try{
    let raw='{broken',writes=0,change;const notices=[];
    const storage={getItem:()=>raw,setItem:(k,v)=>{assert.equal(k,PAST_KEY);raw=v;writes++;}};
    const main={addEventListener:(name,fn)=>{if(name==='change')change=fn;}};
    const ui=createPastUI({data,storage,main,getGrade:()=> '2',go:()=>{},render:()=>{},showNotice:m=>notices.push(m),confirmAction:async()=>true,download:()=>{}});
    assert.equal(writes,0);assert.match(ui.view('past'),/元データを書き出す/);
    const restored=emptyPastState();restored.active['3']=startPast(data.exams[1],'practice',now);
    await change({target:{id:'past-import',value:'file',files:[{size:100,text:async()=>JSON.stringify({app:'fp-past-exams',schemaVersion:1,exportedAt:new Date(now).toISOString(),state:restored})}]}});
    assert.equal(writes,1);assert.deepEqual(loadPastState(storage,data),restored);assert.ok(notices.includes('過去問の履歴を復元しました。'));assert.ok(!ui.view('past').includes('元データを書き出す'));
  }finally{if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;}
});

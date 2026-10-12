import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {APP_RELEASE,createUpdateManager} from '../pwa.js';
import {validateBank,emptyHistory,createSession,submitAnswer,saveState,loadState} from '../core.js';
import {GRADES} from '../grades.js';
class Events {
  listeners={};
  addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
  fire(name,data={}){for(const fn of this.listeners[name]||[])fn(data);}
}
class Worker extends Events {
  constructor(state='installed'){super();this.state=state;this.messages=[];}
  postMessage(data,ports){this.messages.push({data,ports});}
  change(state){this.state=state;this.fire('statechange');}
}
function fixture(options={}) {
  const sw=new Events(),win=new Events(),doc=new Events(),reg=new Events(),states=[],contents=[],timers=new Map();let tick=0,updates=0,reloads=0,online=true,visible=true,block=null;
  sw.controller=options.first?null:new Worker('activated');reg.active=options.first?null:sw.controller;reg.waiting=options.waiting||null;reg.installing=options.installing||null;
  reg.update=async()=>{updates++;if(options.update)await options.update(reg,sw);};
  sw.register=async(url,config)=>{assert.equal(url,'./sw.js');assert.equal(config.updateViaCache,'none');if(options.registerError)throw Error('registration failed');return reg;};
  let port;
  const m=createUpdateManager({serviceWorker:options.unsupported?null:sw,online:()=>online,visible:()=>visible,canReload:()=>options.safety?options.safety():block,reload:()=>reloads++,onState:s=>states.push(s),onCoreReady:()=>{},onContent:c=>contents.push(c),fetchVersion:async()=>{if(options.versionError)throw Error('network failure');return {release:options.release||APP_RELEASE};},windowEvents:win,documentEvents:doc,
    setTimer:(fn,ms)=>{const id=++tick;timers.set(id,{fn,ms});return id;},clearTimer:id=>timers.delete(id),channelFactory:()=>{port={onmessage:null,close:()=>{}};return {port1:port,port2:{}};}
  });
  return {m,sw,reg,win,doc,states,contents,timers,setOnline:v=>online=v,setVisible:v=>visible=v,setBlock:v=>block=v,get updates(){return updates;},get reloads(){return reloads;},get port(){return port;}};
}
test('起動・バックグラウンド復帰・pageshow・オンライン復帰で更新確認を実行する',async()=>{
  const f=fixture();await f.m.start();assert.equal(f.updates,1);assert.equal(f.m.state.phase,'current');
  f.doc.fire('visibilitychange');await f.m.check();assert.equal(f.updates,2);
  f.win.fire('pageshow');await f.m.check();assert.equal(f.updates,3);
  f.win.fire('online');await f.m.check();assert.equal(f.updates,4);
  f.setVisible(false);f.doc.fire('visibilitychange');f.win.fire('pageshow');assert.equal(f.updates,4);
});
test('オフラインではネットワーク更新せず、状況を表示する',async()=>{
  const f=fixture();f.setOnline(false);await f.m.start();assert.equal(f.updates,0);assert.equal(f.m.state.phase,'offline');assert.match(f.m.state.message,/保存済み/);
  f.setOnline(true);f.win.fire('online');await f.m.check();assert.equal(f.updates,1);
});
test('同時に発生した更新確認をまとめ、二重にupdateしない',async()=>{
  let release,entered;const invoked=new Promise(r=>entered=r);const f=fixture({update:()=>new Promise(r=>{release=r;entered();})});const start=f.m.start();
  await invoked;const second=f.m.check();release();await Promise.all([start,second]);assert.equal(f.updates,1);
});
test('待機済みの新版を起動直後に検出し、利用者の操作までは有効化しない',async()=>{
  const waiting=new Worker();const f=fixture({waiting});await f.m.start();assert.equal(f.m.state.phase,'waiting');
  assert.ok(f.states.at(-1).canApply);assert.equal(waiting.messages.length,0);assert.equal(f.reloads,0);
});
test('registerの時点でインストール中でも監視し、installedとredundantを区別する',async()=>{
  const w=new Worker('installing'),f=fixture({installing:w,release:'next'});await f.m.start();assert.equal(f.m.state.phase,'installing');
  f.reg.waiting=w;f.reg.installing=null;w.change('installed');assert.equal(f.m.state.phase,'waiting');
  const bad=new Worker('installing');f.reg.waiting=null;f.reg.installing=bad;f.reg.fire('updatefound');bad.change('redundant');assert.equal(f.m.state.phase,'failed');assert.match(f.m.state.message,/インストールに失敗/);
});
test('公開版が新しいのにinstallerもwaitingもない場合は最新版と誤表示しない',async()=>{
  const f=fixture({release:'new-server-release'});await f.m.start();assert.equal(f.m.state.phase,'failed');assert.match(f.m.state.message,/インストールを確認できません/);
});
test('登録・通信・未対応の失敗とインストールのタイムアウトを知らせる',async()=>{
  for(const option of [{registerError:true},{versionError:true},{unsupported:true}]){const f=fixture(option);await f.m.start();assert.equal(f.m.state.phase,'failed');assert.equal(f.reloads,0);assert.ok(!f.m.state.message.includes('network failure'));}
  const worker=new Worker('installing'),f=fixture({installing:worker});await f.m.start();
  const pending=[...f.timers.values()].find(t=>t.ms===40000);assert.ok(pending);pending.fn();assert.equal(f.m.state.phase,'failed');
  f.reg.waiting=worker;f.reg.installing=null;worker.change('installed');assert.equal(f.m.state.phase,'waiting');
});
test('演習中・保存失敗では更新ボタンから有効化せず、履歴にも触れない',async()=>{
  const waiting=new Worker(),f=fixture({waiting});await f.m.start();
  for(const reason of ['途中の演習があります','保存失敗があります']){f.setBlock(reason);assert.equal(f.m.apply(),false);assert.equal(waiting.messages.length,0);assert.equal(f.reloads,0);assert.equal(f.m.state.message,reason);}
});
test('明示的な有効化が完了し、安全を再確認できた場合だけ1回再読み込みする',async()=>{
  const waiting=new Worker(),f=fixture({waiting});await f.m.start();assert.equal(f.m.apply(),true);assert.equal(waiting.messages[0].data.type,'ACTIVATE_UPDATE');assert.equal(f.reloads,0);
  f.sw.controller=waiting;f.sw.fire('controllerchange');assert.equal(f.reloads,1);f.sw.fire('controllerchange');assert.equal(f.reloads,1);
});
test('他の画面から有効化されても、演習中にcontrollerchangeで強制再読み込みしない',async()=>{
  const f=fixture({waiting:new Worker()});await f.m.start();f.setBlock('途中保存を保持しています');f.sw.fire('controllerchange');assert.equal(f.reloads,0);assert.equal(f.m.state.phase,'waiting');
  assert.equal(f.m.apply(),false);f.setBlock(null);assert.equal(f.m.apply(),true);assert.equal(f.reloads,1);
});
test('更新要求後に別の演習が始まった場合も、再読み込みせず安全な更新待ちに戻る',async()=>{
  const f=fixture({waiting:new Worker()});await f.m.start();f.m.apply();f.setBlock('別の演習が進行中です');f.sw.fire('controllerchange');assert.equal(f.reloads,0);assert.equal(f.m.activating,false);
  f.setBlock(null);f.m.apply();assert.equal(f.reloads,1);
});
test('初回のcontrollerchangeは再読み込みを起こさず、切替えの無応答は失敗として表示',async()=>{
  const first=fixture({first:true});await first.m.start();first.sw.fire('controllerchange');assert.equal(first.reloads,0);
  const f=fixture({waiting:new Worker()});await f.m.start();f.m.apply();const timer=[...f.timers.values()].find(t=>t.ms===20000);assert.ok(timer);timer.fn();assert.equal(f.m.state.phase,'failed');assert.equal(f.m.activating,false);
});
test('追加保存の進捗・部分失敗・再試行・応答なしを更新状態と分けて通知する',async()=>{
  const f=fixture();await f.m.start();const pending=f.m.download('fp2-202605');assert.equal(f.m.downloadBusy,true);
  f.port.onmessage({data:{type:'CONTENT_PROGRESS',total:61,processed:30,saved:30,failed:0}});
  f.port.onmessage({data:{type:'CONTENT_DONE',total:61,processed:61,saved:60,failed:1}});
  await pending;assert.equal(f.m.downloadBusy,false);assert.equal(f.contents.at(-1).failed,1);assert.equal(f.m.state.phase,'current');
  const retry=f.m.download('fp2-202605');const timeout=[...f.timers.values()].find(t=>t.ms===40000);timeout.fn();await retry;assert.equal(f.contents.at(-1).type,'CONTENT_FAILED');
});
test('実際のapp.jsの保護は別の級の途中保存・復習記録・正答率を読み取りだけで保持する',async()=>{
  const banks={'2':validateBank(JSON.parse(readFileSync(new URL('../questions.json',import.meta.url),'utf8'))),'3':validateBank(JSON.parse(readFileSync(new URL('../questions-fp3.json',import.meta.url),'utf8')))};
  const map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)},h2=emptyHistory(),h3=emptyHistory();
  const settings={mode:'random',count:10},now=Date.parse('2026-10-12T01:00:00Z');
  const s2=createSession(banks['2'],h2,settings,now),s3=createSession(banks['3'],h3,settings,now);
  submitAnswer(h2,s2,s2.questions[0].correctChoiceId,now+1);saveState(storage,h2,null,'2');
  submitAnswer(h3,s3,s3.questions[0].choices.find(c=>c.id!==s3.questions[0].correctChoiceId).id,now+1);saveState(storage,h3,s3,'3');
  const app=readFileSync(new URL('../app.js',import.meta.url),'utf8'),body=app.slice(app.indexOf('function updateBlockReason()'),app.indexOf('function dataView()'));
  const context={dialog:{open:false},active:null,pastUI:{hasActive:()=>false,updateBlocked:()=>false},storageFailed:false,protectedStorage:false,conflictingTab:false,unsavedGrades:new Map(),storage,banks,GRADES,loadState,pwa:null};
  const reason=()=>vm.runInNewContext(body+';updateBlockReason()',context),before=[...map.entries()];assert.match(reason(),/別の級/);assert.deepEqual([...map.entries()],before);
  const f=fixture({waiting:new Worker(),safety:reason});context.pwa=f.m;await f.m.start();assert.equal(f.m.apply(),false);assert.deepEqual([...map.entries()],before);
  saveState(storage,h3,null,'3');const completed=[...map.entries()];assert.equal(reason(),null);f.m.apply();f.sw.fire('controllerchange');assert.equal(f.reloads,1);assert.deepEqual([...map.entries()],completed);
  assert.equal(loadState(storage,banks['2']).history.records[s2.questions[0].id].correct,1);assert.equal(loadState(storage,banks['3']).history.records[s3.questions[0].id].reviewPending,true);
});

test('初回インストールのinstalled・active切替えを、有効化待ちと誤認しない',async()=>{
  const worker=new Worker('installing'),f=fixture({first:true,installing:worker});await f.m.start();
  f.reg.active=worker;f.reg.installing=null;f.sw.controller=worker;worker.change('installed');worker.change('activated');f.sw.fire('controllerchange');
  assert.equal(f.reloads,0);assert.equal(f.states.at(-1).canApply,false);assert.equal(f.m.state.phase,'current');
});

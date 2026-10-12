import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash,webcrypto} from 'node:crypto';
import vm from 'node:vm';
const source=readFileSync(new URL('../sw.js',import.meta.url),'utf8'),scope='https://example.test/learning/fp2-quiz/';
const manifest=JSON.parse(readFileSync(new URL('../content-manifest.json',import.meta.url),'utf8'));
const pastData=JSON.parse(readFileSync(new URL('../past-exams.json',import.meta.url),'utf8'));
function environment(script=source) {
  const handlers={},maps=new Map(),requests=[],modes=[],messages=[];let online=true,skipped=0,claimed=0,quota=false;
  const fail=new Set(),wrong=new Set();
  const network=async request=>{
    if(!online)throw new TypeError('offline');
    const url=typeof request==='string'?request:request.url;requests.push(url);modes.push(request.cache);
    const relative=new URL(url).pathname.replace('/learning/fp2-quiz/','')||'index.html';
    if(fail.has(relative))return new Response('unavailable',{status:503});
    const file=new URL('../'+relative,import.meta.url);
    return new Response(wrong.has(relative)?'wrong content':existsSync(file)?readFileSync(file):'not found',{status:existsSync(file)?200:404});
  };
  const caches={
    open:async name=>{
      if(!maps.has(name))maps.set(name,new Map());const map=maps.get(name);
      return {
        addAll:async rs=>{const fetched=await Promise.all(rs.map(async r=>{const p=await network(r);if(!p.ok)throw Error('install failed');return [r.url,p];}));fetched.forEach(([u,r])=>map.set(u,r));},
        match:async r=>map.get(typeof r==='string'?r:r.url)?.clone(),
        put:async(k,v)=>{if(quota)throw Error('quota');map.set(typeof k==='string'?k:k.url,v.clone());}
      };
    },
    keys:async()=>[...maps.keys()],delete:async key=>maps.delete(key)
  };
  const self={registration:{scope},location:{origin:new URL(scope).origin},clients:{claim:async()=>{claimed++;},get:async()=>({postMessage:m=>messages.push(m)})},skipWaiting:()=>{skipped++;},addEventListener:(n,f)=>handlers[n]=f};
  vm.runInNewContext(script,{self,caches,fetch:network,URL,Request,Response,crypto:webcrypto,AbortController,setTimeout,clearTimeout,Uint8Array});
  const dispatch=async(name,props={})=>{let pending;handlers[name]({...props,waitUntil:p=>pending=p,respondWith:p=>pending=p});return pending?await pending:undefined;};
  const save=async group=>{const progress=[];await dispatch('message',{data:{type:'CACHE_CONTENT',examId:group},ports:[{postMessage:p=>progress.push(p)}],source:{id:'test-client'}});return progress;};
  return {maps,requests,modes,messages,fail,wrong,caches,dispatch,save,setOnline:v=>online=v,setQuota:v=>quota=v,get skipped(){return skipped;},get claimed(){return claimed;}};
}
const request=file=>new Request(scope+file);
test('インストールは必須17件だけ取得し、PDF・画像・検証記録の失敗を切り離す',async()=>{
  const w=environment();w.fail.add('past-exams/fp2-202605-q01-1.png');await w.dispatch('install');
  assert.equal(w.requests.length,17);assert.equal(new Set(w.requests).size,17);
  assert.ok(!w.requests.some(p=>p.includes('/past-exams/')));assert.ok(w.requests.includes(scope+'pwa.js'));assert.equal(w.skipped,0);assert.ok(w.modes.every(m=>m==='reload'));
});
test('必須ファイル失敗では新版installが失敗し、旧キャッシュは一切消さない',async()=>{
  const w=environment(),legacy='fp2:'+scope+':legacy';await w.caches.open(legacy);w.fail.add('questions.json');
  await assert.rejects(w.dispatch('install'));assert.deepEqual([...w.maps.keys()],[legacy]);assert.equal(w.claimed,0);
});
test('公開版情報の不一致では新版を有効化しない',async()=>{
  const w=environment(source.replace(/const CACHE_VERSION = '[^']+';/,"const CACHE_VERSION = 'mismatched';"));
  await assert.rejects(w.dispatch('install'));assert.equal(w.maps.size,0);
});
test('基本問題・画面・相対URLはインストール直後からオフラインで取得できる',async()=>{
  const w=environment();await w.dispatch('install');await w.dispatch('activate');w.setOnline(false);
  for(const file of ['','index.html?source=home','style.css','app.js','pwa.js','core.js','grades.js','memo.js','past.js','questions.json','questions-fp3.json','past-exams.json','manifest.webmanifest','icons/icon-192.png','content-manifest.json']){
    const response=await w.dispatch('fetch',{request:request(file)});assert.equal(response.status,200,file);assert.ok((await response.arrayBuffer()).byteLength);
  }
  assert.equal(w.requests.length,17);assert.equal(w.claimed,1);
});
test('過去問全6回を別キャッシュに保存し、全360画像・6PDFをオフライン取得できる',async()=>{
  const w=environment();await w.dispatch('install');const progress=await w.save('all');assert.equal(progress.at(-1).saved,366);assert.equal(progress.at(-1).failed,0);assert.ok(progress.some(p=>p.processed>0&&p.processed<366));
  w.setOnline(false);for(const e of pastData.exams)for(const path of [e.questionPdf,...e.questions.flatMap(q=>q.images)]){const response=await w.dispatch('fetch',{request:request(path.slice(2))});assert.equal(response.status,200);}
  assert.equal(w.requests.length,383);
});
test('過去問の部分失敗を通知し、再試行は保存済み分を再取得しない',async()=>{
  const w=environment();await w.dispatch('install');const path='past-exams/fp2-202605-q02-1.png';w.fail.add(path);
  const first=await w.save('fp2-202605');assert.equal(first.at(-1).saved,60);assert.equal(first.at(-1).failed,1);
  const count=w.requests.length;w.fail.delete(path);const second=await w.save('fp2-202605');assert.equal(second.at(-1).saved,61);assert.equal(w.requests.length-count,1);
});
test('容量不足でもオンライン表示を返し、保存失敗を利用者に通知する',async()=>{
  const w=environment();await w.dispatch('install');w.setQuota(true);
  const response=await w.dispatch('fetch',{request:request('past-exams/fp2-202605-q01-1.png'),clientId:'test-client'});
  assert.equal(response.status,200);assert.match(w.messages[0].message,/保存できません/);
  assert.ok([...w.maps.keys()].some(n=>n.includes('shell:')));
});
test('旧版の一括キャッシュはSHA-256で一致を確認し、オフラインでも画像を再利用する',async()=>{
  const w=environment();const path='past-exams/fp2-202605-q01-1.png',cache=await w.caches.open('fp2:'+scope+':2026-10-12-v19-past-three-sets');
  await cache.put(scope+path,new Response(readFileSync(new URL('../'+path,import.meta.url))));
  await w.dispatch('install');await w.dispatch('activate');w.setOnline(false);
  const r=await w.dispatch('fetch',{request:request(path)});assert.equal(r.status,200);assert.equal(w.requests.length,17);
  assert.ok([...w.maps.keys()].some(k=>k.endsWith('v19-past-three-sets')));
});
test('旧キャッシュの別内容や壊れた新しい画像を採用せず、未保存・取得失敗を区別する',async()=>{
  const w=environment(),path='past-exams/fp2-202605-q01-1.png';const legacy=await w.caches.open('fp2:'+scope+':legacy');await legacy.put(scope+path,new Response('wrong'));
  await w.dispatch('install');w.wrong.add(path);
  const wrong=await w.dispatch('fetch',{request:request(path),clientId:'test-client'});assert.equal(wrong.status,503);assert.ok(w.messages.length);
  w.setOnline(false);const offline=await w.dispatch('fetch',{request:request(path),clientId:'test-client'});assert.equal(offline.status,503);
});
test('追加資料も利用時に保存され、オフラインで取得できる',async()=>{
  const w=environment();await w.dispatch('install');assert.equal((await w.dispatch('fetch',{request:request('AUDIT.md')})).status,200);
  w.setOnline(false);assert.equal((await w.dispatch('fetch',{request:request('AUDIT.md')})).status,200);
});
test('更新時は前の必須版と旧一括版・追加キャッシュを保持し、他アプリに触れない',async()=>{
  const w=environment(),prefix='fp2:'+scope+':';
  for(const key of [prefix+'shell:oldest',prefix+'shell:previous',prefix+'legacy',prefix+'content:v1','other-app'])await w.caches.open(key);
  await w.dispatch('install');await w.dispatch('activate');assert.ok(!w.maps.has(prefix+'shell:oldest'));
  for(const key of [prefix+'shell:previous',prefix+'legacy',prefix+'content:v1','other-app'])assert.ok(w.maps.has(key));
});
test('自動skipWaitingせず、明示的な更新要求でだけ有効化する',async()=>{
  const w=environment();await w.dispatch('install');assert.equal(w.skipped,0);
  await w.dispatch('message',{data:{type:'UNRELATED'}});assert.equal(w.skipped,0);
  await w.dispatch('message',{data:{type:'ACTIVATE_UPDATE'}});assert.equal(w.skipped,1);
});
test('公開版情報・sw.js・外部・スコープ外・POSTをキャッシュから返さない',async()=>{
  const w=environment();for(const r of [request('version.json?check=1'),request('sw.js'),new Request('https://www.nta.go.jp/'),new Request('https://example.test/other/'),new Request(scope,{method:'POST'})])assert.equal(await w.dispatch('fetch',{request:r}),undefined);
});
test('不明なページや別階層のindexに無関係な起動画面を返さない',async()=>{
  const w=environment();await w.dispatch('install');for(const p of ['missing.html','unknown/index.html'])assert.equal((await w.dispatch('fetch',{request:request(p)})).status,404);
});
test('追加一覧の全375ファイルの内容ハッシュ・級・回・公開版が正しい',()=>{
  assert.equal(manifest.assets.length,375);assert.equal(new Set(manifest.assets.map(a=>a.url)).size,375);
  for(const a of manifest.assets){const bytes=readFileSync(new URL('../'+a.url,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),a.sha256,a.url);assert.equal(bytes.length,a.bytes);}
  for(const e of pastData.exams)assert.equal(manifest.assets.filter(a=>a.group===e.id).length,61);
});
test('manifest・HTMLの内部参照は相対パスで存在し、iPhoneホーム画面に対応する',()=>{
  const m=JSON.parse(readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));assert.equal(m.start_url,'./index.html');assert.equal(m.scope,'./');assert.equal(m.display,'standalone');
  m.icons.forEach(i=>assert.ok(existsSync(new URL('../'+i.src,import.meta.url))));
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');for(const [,p] of html.matchAll(/(?:src|href)="([^"#]+)"/g)){assert.ok(p.startsWith('./'));assert.ok(existsSync(new URL('../'+p,import.meta.url)));}
  assert.ok(html.includes('viewport-fit=cover'));assert.ok(html.includes('apple-mobile-web-app-capable'));assert.ok(html.includes('aria-live="polite"'));
});

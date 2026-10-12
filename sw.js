// 公開するたびに同じURLのこのファイルとversion.jsonの版を更新する。
const CACHE_VERSION = 'v1.5.0-8712c12c0cf9';
const PREFIX = `fp2:${self.registration.scope}:`;
const CACHE = PREFIX + 'shell:' + CACHE_VERSION;
const CONTENT_CACHE = PREFIX + 'content:v1';
const FILES = ['./index.html','./style.css','./app.js','./core.js','./grades.js','./memo.js','./pwa.js','./past.js','./questions.json','./questions-fp3.json','./past-exams.json','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/apple-touch-icon.png','./version.json','./content-manifest.json'];
const absolute = path => new URL(path, self.registration.scope).href;
let manifestPromise;
function manifest() {
  if (!manifestPromise) manifestPromise = caches.open(CACHE).then(cache => cache.match(absolute('./content-manifest.json'))).then(async response => {
    if (!response) throw new Error('追加コンテンツの一覧を取得できません。');
    const data = await response.json();
    if (data.release !== CACHE_VERSION) throw new Error('公開ファイルの版が一致していません。');
    return data.assets;
  }).catch(error => { manifestPromise = null; throw error; });
  return manifestPromise;
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      await cache.addAll(FILES.map(path => new Request(absolute(path), {cache:'reload'})));
      const version = await (await cache.match(absolute('./version.json'))).json();
      if (version.release !== CACHE_VERSION) throw new Error('公開版が一致していません。');
      await manifest();
      // 自動でskipWaitingしない。現在の演習を続けられる待機状態へ進む。
    } catch (error) {
      await caches.delete(CACHE); // 失敗した新しいキャッシュだけを破棄。旧版・学習記録には触れない。
      throw error;
    }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // 前の必須キャッシュを1版保持。旧一括キャッシュも残し、画像・PDFを必要時に検証して再利用する。
    const oldShells = keys.filter(key => key.startsWith(PREFIX+'shell:') && key !== CACHE);
    await Promise.all(oldShells.slice(0,-1).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
const assetKey = asset => absolute(asset.url) + '?asset=' + asset.sha256;
async function valid(response, asset) {
  if (!response?.ok) return false;
  const bytes = await response.clone().arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('') === asset.sha256;
}
async function notify(clientId, message) {
  if (!clientId) return;
  const client = await self.clients.get(clientId);
  client?.postMessage(message);
}
async function assetResponse(asset, clientId) {
  const cache = await caches.open(CONTENT_CACHE), key = assetKey(asset);
  const cached = await cache.match(key);
  if (cached) return {response:cached,saved:true};
  let response;
  // 旧版の一括保存を消さず、内容の一致したファイルだけを再利用。
  for (const name of await caches.keys()) {
    if (!name.startsWith(PREFIX) || name === CONTENT_CACHE || name.startsWith(PREFIX+'shell:')) continue;
    const old = await (await caches.open(name)).match(absolute(asset.url));
    if (await valid(old, asset)) { response = old; break; }
  }
  if (!response) {
    const abort = new AbortController(), timer = setTimeout(()=>abort.abort(),20000);
    try { response = await fetch(new Request(absolute(asset.url), {cache:'reload',signal:abort.signal})); }
    finally { clearTimeout(timer); }
    if (!await valid(response,asset)) throw new Error('取得ファイルの内容・公開版が一致しません。');
  }
  try { await cache.put(key,response.clone()); return {response,saved:true}; }
  catch {
    await notify(clientId,{type:'CONTENT_ERROR',message:'追加コンテンツを端末に保存できません。オンライン表示は利用できます。空き容量を確認し、オフライン保存を再試行してください。'});
    return {response,saved:false};
  }
}
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') { self.skipWaiting(); return; }
  if (event.data?.type !== 'CACHE_CONTENT' || !event.ports?.[0]) return;
  const port = event.ports[0], requested = event.data.examId;
  event.waitUntil((async () => {
    const assets = (await manifest()).filter(a=>requested==='all' ? a.group.startsWith('fp') : a.group===requested);
    if (!assets.length) throw new Error('保存対象の過去問がありません。');
    let next=0,processed=0,saved=0,failed=0;
    const progress = ()=>port.postMessage({type:'CONTENT_PROGRESS',total:assets.length,processed,saved,failed});
    progress();
    await Promise.all([0,1].map(async()=> {
      while (next<assets.length) {
        const asset=assets[next++];
        try { const result=await assetResponse(asset,event.source?.id); if(result.saved)saved++; else failed++; }
        catch { failed++; }
        processed++; progress();
      }
    }));
    port.postMessage({type:'CONTENT_DONE',total:assets.length,processed,saved,failed});
  })().catch(error=>port.postMessage({type:'CONTENT_FAILED',message:error.message})));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url), root=new URL('./',self.registration.scope), index=new URL('./index.html',root);
  if (event.request.method!=='GET' || url.origin!==self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  // 公開版の確認とSW本体は常にネットワーク。旧キャッシュによる更新妨害を避ける。
  if (url.pathname===new URL('./version.json',root).pathname || url.pathname===new URL('./sw.js',root).pathname) return;
  event.respondWith((async()=>{
    const key=url.pathname===root.pathname || url.pathname===index.pathname ? index.href : url.origin+url.pathname;
    const cache=await caches.open(CACHE), cached=await cache.match(key);
    if (cached) return cached;
    const asset=(await manifest()).find(a=>absolute(a.url)===key);
    if (!asset) return fetch(event.request);
    try { return (await assetResponse(asset,event.clientId)).response; }
    catch {
      await notify(event.clientId,{type:'CONTENT_ERROR',message:'この図表・PDFは端末に保存されていません。オンラインで開くか、「データ・設定」から対象回をオフライン保存してください。学習履歴は保持されています。'});
      return new Response('追加コンテンツを取得できません。オンラインで保存後に再試行してください。',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
    }
  })());
});

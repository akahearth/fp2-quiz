import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const scope = 'https://example.test/learning/fp2-quiz/';
const pastData = JSON.parse(readFileSync(new URL('../past-exams.json',import.meta.url),'utf8'));
const pastFiles = pastData.exams.flatMap(e=>[e.questionPdf,...e.questions.flatMap(q=>q.images)]).map(p=>p.replace(/^\.\//,''));
function workerEnvironment(script = source) {
  const handlers = {}, cachesMap = new Map(), requests = [], cacheModes = [];
  let online = true, skipped = 0, claimed = 0;
  const networkFetch = async request => {
    if (!online) throw new TypeError('offline');
    const url = typeof request === 'string' ? request : request.url;
    requests.push(url);
    cacheModes.push(typeof request === 'string' ? null : request.cache);
    const pathname = new URL(url).pathname;
    const relative = pathname.replace('/learning/fp2-quiz/', '') || 'index.html';
    const fileURL = new URL('../' + relative, import.meta.url);
    if (!existsSync(fileURL)) return new Response('not found', { status: 404 });
    return new Response(readFileSync(fileURL));
  };
  const caches = {
    open: async name => {
      if (!cachesMap.has(name)) cachesMap.set(name, new Map());
      const contents = cachesMap.get(name);
      return {
        addAll: async requests => { const responses = await Promise.all(requests.map(async r => { const response = await networkFetch(r); if (!response.ok) throw new Error('cache install failed'); return [r.url, response]; })); responses.forEach(([url, response]) => contents.set(url, response)); },
        match: async request => contents.get(typeof request === 'string' ? request : request.url)?.clone()
      };
    },
    keys: async () => [...cachesMap.keys()],
    delete: async key => cachesMap.delete(key)
  };
  const self = { registration: { scope }, location: { origin: new URL(scope).origin }, clients: { claim: async () => { claimed++; } }, skipWaiting: () => { skipped++; }, addEventListener: (name, handler) => handlers[name] = handler };
  vm.runInNewContext(script, { self, caches, fetch: networkFetch, URL, Request, Promise });
  async function dispatch(name, properties = {}) {
    let promise;
    handlers[name]({ ...properties, waitUntil: p => promise = p, respondWith: p => promise = p });
    return promise ? await promise : undefined;
  }
  return { dispatch, requests, cacheModes, cachesMap, caches, setOnline: value => online = value, get skipped() { return skipped; }, get claimed() { return claimed; } };
}
test('Service Workerは両級・過去問120画像と問題PDFを含む146リソースをプリキャッシュする', async () => {
  const w = workerEnvironment(); await w.dispatch('install');
  assert.equal(w.requests.length, 146); assert.ok(w.requests.every(url => url.startsWith(scope)));
  assert.ok(pastFiles.every(p=>w.requests.includes(scope+p)));assert.equal(new Set(w.requests).size,146);
  assert.ok(w.requests.includes(scope + 'questions.json')); assert.ok(w.requests.includes(scope + 'core.js'));
  assert.equal(w.skipped, 0); // 更新はユーザー操作まで待機。
});
test('サーバー切断後もHTML・CSS・JS・問題JSON・アイコンをキャッシュから返す', async () => {
  const w = workerEnvironment(); await w.dispatch('install'); await w.dispatch('activate'); w.setOnline(false);
  for (const file of ['', 'index.html', 'style.css', 'app.js', 'core.js', 'grades.js', 'memo.js', 'questions.json', 'questions-fp3.json', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'AUDIT.md', 'AUDIT.json', 'SOURCES.md', 'AUDIT-FP3.md', 'AUDIT-FP3.json', 'SOURCES-FP3.md', 'past.js','past-exams.json','REVISION.md','REVISION.json','PAST-EXAMS.md',...pastFiles]) {
    const response = await w.dispatch('fetch', { request: new Request(scope + file) }); assert.equal(response.status, 200); assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  assert.equal(w.requests.length, 146); assert.equal(w.claimed, 1);
});
test('URLに検索パラメータがあってもサブディレクトリの起動画面をキャッシュから開く', async () => {
  const w = workerEnvironment(); await w.dispatch('install'); w.setOnline(false);
  const response = await w.dispatch('fetch', { request: new Request(scope + '?from=home') }); assert.ok((await response.text()).includes('FP2級'));
});
test('更新時は同じアプリの旧キャッシュだけを削除する', async () => {
  const w = workerEnvironment();
  await w.caches.open('fp2:' + scope + ':old'); await w.caches.open('other-site-cache'); await w.caches.open('fp2:https://example.test/other/:old');
  await w.dispatch('install'); await w.dispatch('activate');
  assert.equal(w.cachesMap.has('fp2:' + scope + ':old'), false);
  assert.equal(w.cachesMap.has('other-site-cache'), true); assert.equal(w.cachesMap.has('fp2:https://example.test/other/:old'), true);
});
test('アプリ更新メッセージ受信時だけskipWaitingする', async () => {
  const w = workerEnvironment(); await w.dispatch('install'); assert.equal(w.skipped, 0);
  await w.dispatch('message', { data: { type: 'UNRELATED' } }); assert.equal(w.skipped, 0);
  await w.dispatch('message', { data: { type: 'ACTIVATE_UPDATE' } }); assert.equal(w.skipped, 1);
});
test('新しい版は更新JSONを再取得する（cache reload）', async () => {
  const w = workerEnvironment(source.replace(/const CACHE_VERSION = '[^']+';/, "const CACHE_VERSION = 'test-new-version';")); await w.dispatch('install');
  assert.ok([...w.cachesMap.keys()].some(key => key.endsWith('test-new-version')));
  assert.ok(w.requests.includes(scope + 'questions.json'));
  assert.ok(w.cacheModes.every(mode => mode === 'reload'));
});
test('外部資料・スコープ外・POSTを横取りしない', async () => {
  const w = workerEnvironment();
  for (const request of [new Request('https://www.nta.go.jp/'), new Request('https://example.test/other/'), new Request(scope, { method: 'POST' })]) assert.equal(await w.dispatch('fetch', { request }), undefined);
});
test('存在しないページに無関係な起動画面を返さない', async () => {
  const w = workerEnvironment(); await w.dispatch('install');
  const response = await w.dispatch('fetch', { request: new Request(scope + 'missing.html') }); assert.equal(response.status, 404);
});
test('manifestとHTMLのアプリ内リソースがすべて相対パスで存在する', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.start_url, './index.html'); assert.equal(manifest.scope, './'); assert.equal(manifest.display, 'standalone');
  manifest.icons.forEach(i => { assert.ok(i.src.startsWith('./')); assert.ok(existsSync(new URL('../' + i.src, import.meta.url))); const bytes = readFileSync(new URL('../' + i.src, import.meta.url)); assert.equal(bytes.readUInt32BE(16), Number(i.sizes.split('x')[0])); });
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(match => match[1]);
  refs.forEach(path => { assert.ok(path.startsWith('./'), path); assert.ok(existsSync(new URL('../' + path, import.meta.url))); });
  assert.ok(html.includes('viewport-fit=cover')); assert.ok(html.includes('apple-mobile-web-app-capable'));
});

// JSONを含むアプリ一式を同じ版で保存。ファイル変更時はCACHE_VERSIONを必ず上げる。
const CACHE_VERSION = '2026-10-12-v17-revision-past';
const PREFIX = `fp2:${self.registration.scope}:`;
const CACHE = PREFIX + CACHE_VERSION;
const FILES = ["./","./index.html","./style.css","./app.js","./core.js","./grades.js","./memo.js","./questions.json","./questions-fp3.json","./manifest.webmanifest","./icons/icon-192.png","./icons/icon-512.png","./icons/apple-touch-icon.png","./AUDIT.md","./AUDIT.json","./SOURCES.md","./AUDIT-FP3.md","./AUDIT-FP3.json","./SOURCES-FP3.md","./past.js","./past-exams.json","./PAST-EXAMS.md","./REVISION.md","./REVISION.json","./past-exams/fp2-202605-questions.pdf","./past-exams/fp2-202605-q01-1.png","./past-exams/fp2-202605-q02-1.png","./past-exams/fp2-202605-q03-1.png","./past-exams/fp2-202605-q04-1.png","./past-exams/fp2-202605-q05-1.png","./past-exams/fp2-202605-q06-1.png","./past-exams/fp2-202605-q07-1.png","./past-exams/fp2-202605-q08-1.png","./past-exams/fp2-202605-q09-1.png","./past-exams/fp2-202605-q10-1.png","./past-exams/fp2-202605-q11-1.png","./past-exams/fp2-202605-q12-1.png","./past-exams/fp2-202605-q13-1.png","./past-exams/fp2-202605-q14-1.png","./past-exams/fp2-202605-q15-1.png","./past-exams/fp2-202605-q16-1.png","./past-exams/fp2-202605-q17-1.png","./past-exams/fp2-202605-q18-1.png","./past-exams/fp2-202605-q19-1.png","./past-exams/fp2-202605-q20-1.png","./past-exams/fp2-202605-q21-1.png","./past-exams/fp2-202605-q22-1.png","./past-exams/fp2-202605-q23-1.png","./past-exams/fp2-202605-q24-1.png","./past-exams/fp2-202605-q25-1.png","./past-exams/fp2-202605-q26-1.png","./past-exams/fp2-202605-q27-1.png","./past-exams/fp2-202605-q28-1.png","./past-exams/fp2-202605-q29-1.png","./past-exams/fp2-202605-q30-1.png","./past-exams/fp2-202605-q31-1.png","./past-exams/fp2-202605-q32-1.png","./past-exams/fp2-202605-q33-1.png","./past-exams/fp2-202605-q34-1.png","./past-exams/fp2-202605-q35-1.png","./past-exams/fp2-202605-q36-1.png","./past-exams/fp2-202605-q37-1.png","./past-exams/fp2-202605-q38-1.png","./past-exams/fp2-202605-q39-1.png","./past-exams/fp2-202605-q40-1.png","./past-exams/fp2-202605-q41-1.png","./past-exams/fp2-202605-q42-1.png","./past-exams/fp2-202605-q43-1.png","./past-exams/fp2-202605-q44-1.png","./past-exams/fp2-202605-q45-1.png","./past-exams/fp2-202605-q46-1.png","./past-exams/fp2-202605-q47-1.png","./past-exams/fp2-202605-q48-1.png","./past-exams/fp2-202605-q49-1.png","./past-exams/fp2-202605-q50-1.png","./past-exams/fp2-202605-q51-1.png","./past-exams/fp2-202605-q52-1.png","./past-exams/fp2-202605-q53-1.png","./past-exams/fp2-202605-q54-1.png","./past-exams/fp2-202605-q55-1.png","./past-exams/fp2-202605-q56-1.png","./past-exams/fp2-202605-q57-1.png","./past-exams/fp2-202605-q58-1.png","./past-exams/fp2-202605-q59-1.png","./past-exams/fp2-202605-q60-1.png","./past-exams/fp3-202605-questions.pdf","./past-exams/fp3-202605-q01-1.png","./past-exams/fp3-202605-q02-1.png","./past-exams/fp3-202605-q03-1.png","./past-exams/fp3-202605-q04-1.png","./past-exams/fp3-202605-q05-1.png","./past-exams/fp3-202605-q06-1.png","./past-exams/fp3-202605-q07-1.png","./past-exams/fp3-202605-q08-1.png","./past-exams/fp3-202605-q09-1.png","./past-exams/fp3-202605-q10-1.png","./past-exams/fp3-202605-q11-1.png","./past-exams/fp3-202605-q12-1.png","./past-exams/fp3-202605-q13-1.png","./past-exams/fp3-202605-q14-1.png","./past-exams/fp3-202605-q15-1.png","./past-exams/fp3-202605-q16-1.png","./past-exams/fp3-202605-q17-1.png","./past-exams/fp3-202605-q18-1.png","./past-exams/fp3-202605-q19-1.png","./past-exams/fp3-202605-q20-1.png","./past-exams/fp3-202605-q21-1.png","./past-exams/fp3-202605-q22-1.png","./past-exams/fp3-202605-q23-1.png","./past-exams/fp3-202605-q24-1.png","./past-exams/fp3-202605-q25-1.png","./past-exams/fp3-202605-q26-1.png","./past-exams/fp3-202605-q27-1.png","./past-exams/fp3-202605-q28-1.png","./past-exams/fp3-202605-q29-1.png","./past-exams/fp3-202605-q30-1.png","./past-exams/fp3-202605-q31-1.png","./past-exams/fp3-202605-q32-1.png","./past-exams/fp3-202605-q33-1.png","./past-exams/fp3-202605-q34-1.png","./past-exams/fp3-202605-q35-1.png","./past-exams/fp3-202605-q36-1.png","./past-exams/fp3-202605-q37-1.png","./past-exams/fp3-202605-q38-1.png","./past-exams/fp3-202605-q39-1.png","./past-exams/fp3-202605-q40-1.png","./past-exams/fp3-202605-q41-1.png","./past-exams/fp3-202605-q42-1.png","./past-exams/fp3-202605-q43-1.png","./past-exams/fp3-202605-q44-1.png","./past-exams/fp3-202605-q45-1.png","./past-exams/fp3-202605-q46-1.png","./past-exams/fp3-202605-q47-1.png","./past-exams/fp3-202605-q48-1.png","./past-exams/fp3-202605-q49-1.png","./past-exams/fp3-202605-q50-1.png","./past-exams/fp3-202605-q51-1.png","./past-exams/fp3-202605-q52-1.png","./past-exams/fp3-202605-q53-1.png","./past-exams/fp3-202605-q54-1.png","./past-exams/fp3-202605-q55-1.png","./past-exams/fp3-202605-q56-1.png","./past-exams/fp3-202605-q57-1.png","./past-exams/fp3-202605-q58-1.png","./past-exams/fp3-202605-q59-1.png","./past-exams/fp3-202605-q60-1.png"];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // ブラウザのHTTPキャッシュを避け、全ファイル成功時のみインストール完了。
    await cache.addAll(FILES.map(path => new Request(new URL(path, self.registration.scope), { cache: 'reload' })));
    // 待機して既存の演習を守る。初回のみ通常のライフサイクルで有効化する。
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => { if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const path = url.pathname;
    const isShell = path === new URL('./', self.registration.scope).pathname || path.endsWith('/index.html');
    const key = isShell ? new URL('./index.html', self.registration.scope).href : url.origin + path;
    const cached = await cache.match(key);
    if (cached) return cached;
    // このアプリ以外のページには、無関係なindex.htmlを返さない。
    return fetch(event.request);
  })());
});

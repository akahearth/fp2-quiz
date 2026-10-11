// JSONを含むアプリ一式を同じ版で保存。ファイル変更時はCACHE_VERSIONを必ず上げる。
const CACHE_VERSION = '2026-10-11-v12-home-title';
const PREFIX = `fp2:${self.registration.scope}:`;
const CACHE = PREFIX + CACHE_VERSION;
const FILES = ['./', './index.html', './style.css', './app.js', './core.js', './grades.js', './memo.js', './questions.json', './questions-fp3.json', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './AUDIT.md', './AUDIT.json', './SOURCES.md', './AUDIT-FP3.md', './AUDIT-FP3.json', './SOURCES-FP3.md'];
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

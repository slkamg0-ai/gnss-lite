// 네트워크 우선(업데이트 즉시 반영) → 실패(오프라인/현장 음영) 시 캐시. 앱 셸 전체를 설치 시 미리 캐시.
const V = 'gnsslite-v10', FILES = ['./', 'index.html', 'style.css', 'core.js', 'dxf.js', 'nlu.js', 'vendor/anthropic.bundle.js', 'app.js', 'data/kngeo24.ggf', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(FILES.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});

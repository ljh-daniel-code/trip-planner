// 서비스 워커: 앱 화면 파일을 캐시해 빠르게 열리도록 함 (데이터는 항상 서버에서)
const CACHE = 'trip-planner-v1';
const SHELL = ['./', 'index.html', 'css/style.css', 'js/app.js', 'js/trip.js', 'js/store.js', 'js/ui.js',
  'js/map.js', 'js/regions.js', 'js/config.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 같은 사이트 파일만: 네트워크 우선, 실패 시 캐시 (업데이트가 바로 반영되도록)
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});

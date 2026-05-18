/**
 * FitTrack Service Worker — offline shell + güvenli cache.
 * ----------------------------------------------------------------------------
 * Strateji:
 *   • Sadece beyaz listedeki statik dosyalar pre-cache edilir.
 *   • API (/.netlify/functions/*), auth ve kullanıcıya özel istekler ASLA
 *     cache'lenmez — daima ağa gider; çevrimdışıysa SW dokunmaz, tarayıcı
 *     normal ağ hatasını döner ve uygulama kendi fallback'lerini çalıştırır.
 *   • Navigasyon istekleri: network-first → başarısızsa cache'teki app shell
 *     (index.html) → o da yoksa minimal inline offline sayfası.
 *   • Statik asset istekleri (CSS/JS/SVG/manifest): stale-while-revalidate.
 *   • Aynı-origin dışı (CDN, üçüncü taraf) istekleri SW'ye bırakılır;
 *     `event.respondWith` çağrılmaz → tarayıcı normal akışı kullanır.
 *
 * Versiyonlama:
 *   • CACHE_VERSION bump'lanırsa `activate` eski cache'leri temizler.
 *   • PRECACHE_URLS'e yeni statik eklenirse versiyonu yükselt.
 */

'use strict';

const CACHE_VERSION = 'fittrack-v1';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/manifest.json',
  '/public/icons/icon-192.svg',
  '/public/icons/icon-512.svg',
  '/public/icons/maskable-icon-192.svg',
  '/public/icons/maskable-icon-512.svg',
  '/public/icons/apple-touch-icon.svg',
];

// Hızlı path-içeriyor mu? kontrolü için Set.
const PRECACHE_SET = new Set(PRECACHE_URLS);

/**
 * Asla cache'lenmemesi gereken yol pattern'leri.
 * - Netlify functions (AI endpoint vb.)
 * - Olası /api/* endpoint'leri
 * - "auth" içeren path'ler (auth.js bu dosyayı yine de cache'leyebilir; bu
 *   pattern URL path bazlı çalışır, dosya adı değil — auth.js de listede yok).
 */
const NEVER_CACHE_PATTERNS = [
  /^\/\.netlify\/functions\//i,
  /^\/api\//i,
  /\/auth\//i,
  /\/session\//i,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // Toleranslı pre-cache: tek bir URL fail olursa diğerleri eklensin.
      // `cache.addAll` atomicdir; tek başarısızlık tüm batch'i düşürür.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
          } catch (err) {
            // Üretimde sessiz; geliştirmede konsolda görünür.
            // eslint-disable-next-line no-console
            console.warn('[SW] pre-cache atlandı:', url, err && err.message);
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name !== CACHE_VERSION)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Sadece GET istekleriyle ilgileniyoruz. POST/PUT/DELETE her zaman ağa gider.
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (_e) {
    return;
  }

  // Cross-origin: SW dokunmaz.
  if (url.origin !== self.location.origin) return;

  // Asla cache'lenmemesi gereken path'ler: SW dokunmaz, normal ağ akışı.
  if (NEVER_CACHE_PATTERNS.some((pattern) => pattern.test(url.pathname))) return;

  // Navigasyon (HTML doküman) — network-first + app shell fallback.
  if (req.mode === 'navigate') {
    event.respondWith(handleNavigate(req));
    return;
  }

  // Pre-cache'lenen statikler — stale-while-revalidate.
  if (PRECACHE_SET.has(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Diğer aynı-origin GET istekleri: SW dokunmaz, tarayıcı yönetir.
});

/**
 * Navigasyon handler.
 * Önce ağdan dene → başarısızsa cache'teki app shell → o da yoksa minimal HTML.
 */
async function handleNavigate(req) {
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      // Yeni navigasyonu app-shell cache'i olarak da güncelle.
      const cache = await caches.open(CACHE_VERSION);
      cache.put('/index.html', fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (_err) {
    const cache = await caches.open(CACHE_VERSION);
    const cached =
      (await cache.match(req)) ||
      (await cache.match('/index.html')) ||
      (await cache.match('/'));
    if (cached) return cached;
    return new Response(offlineFallbackHTML(), {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

/**
 * Stale-while-revalidate: cache varsa hemen onu döner, paralelde ağ güncellemesi
 * yapar; ağ başarılıysa cache'i tazeler. Cache yoksa ağı bekler.
 */
async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(req);
  const networkPromise = fetch(req)
    .then((res) => {
      // Sadece sağlıklı, same-origin, basic response'ları cache'le.
      if (res && res.ok && res.type === 'basic') {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => null);

  return cached || (await networkPromise) || new Response('', { status: 504 });
}

/**
 * Pre-cache hiç yapılamamışsa (ör. ilk install başarısız ve kullanıcı offline'a
 * düştü) gösterilecek minimal yedek HTML. Tek bir Response gövdesi; ek istek yok.
 */
function offlineFallbackHTML() {
  return (
    '<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Çevrimdışı — FitTrack</title><style>' +
    'html,body{margin:0;height:100%;background:#0a0f1c;color:#f8fafc;' +
    'font-family:Segoe UI,system-ui,-apple-system,BlinkMacSystemFont,sans-serif;}' +
    '.wrap{height:100%;display:flex;flex-direction:column;align-items:center;' +
    'justify-content:center;gap:0.85rem;padding:2rem;text-align:center}' +
    '.dot{width:12px;height:12px;border-radius:50%;background:#fb923c;' +
    'box-shadow:0 0 16px rgba(251,146,60,0.6)}' +
    '.t{font-weight:700;font-size:1.2rem;margin:0}' +
    '.s{color:#a8b4c8;max-width:440px;line-height:1.55;margin:0}' +
    '.r{margin-top:0.5rem;padding:0.55rem 1.1rem;border:1px solid rgba(251,146,60,0.5);' +
    'background:transparent;color:#f8fafc;border-radius:10px;font-weight:600;cursor:pointer}' +
    '.r:hover{background:rgba(251,146,60,0.12)}' +
    '</style></head><body><div class="wrap">' +
    '<span class="dot"></span>' +
    '<p class="t">İnternet bağlantısı yok</p>' +
    '<p class="s">Şu an çevrimdışısın. Yerel verilerin güvende; bağlantı dönünce kaldığın yerden devam edebilirsin.</p>' +
    '<button class="r" onclick="location.reload()">Tekrar Dene</button>' +
    '</div></body></html>'
  );
}

/**
 * İsteğe bağlı: ana sayfa "yeni SW hazır, yenile" mesajı göndermek isterse
 * postMessage ile haberleşebilir. Şu an pasif; ileride update banner için.
 */
self.addEventListener('message', (event) => {
  if (event && event.data === 'fittrack:skip-waiting') {
    self.skipWaiting();
  }
});

/**
 * FitTrack — Dekoratif arka plan parallax kancası
 * ---------------------------------------------------------------------------
 * - `window.scrollY` değerini bir CSS değişkeni `--scroll-y` olarak yazar.
 * - Tüm parallax çalışması CSS tarafında `transform: translate3d(...)` ile
 *   yapılır (`calc(var(--scroll-y, 0) * -0.18px)` gibi). JS yalnızca değişkeni
 *   günceller, layout veya stil hesaplaması tetiklemez.
 * - `requestAnimationFrame` ile zamanlanır; ardışık scroll olaylarında en fazla
 *   bir kareye bir update yapılır.
 * - `prefers-reduced-motion: reduce` aktifse parallax tamamen kapatılır
 *   (CSS kuralları zaten transform’u sıfırlıyor; burada da değişkeni 0’da
 *   sabitliyoruz).
 * - Hiçbir harici kütüphane veya animasyon kütüphanesi kullanılmaz.
 */

(function () {
  'use strict';

  if (!('requestAnimationFrame' in window)) return;

  var root = document.documentElement;
  if (!root || !root.style) return;

  // Varsayılan değer — JS hiç çalışmasa bile CSS calc’ı bozulmasın.
  root.style.setProperty('--scroll-y', '0');

  var reduceMotionMQ =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  var reduceMotion = !!(reduceMotionMQ && reduceMotionMQ.matches);

  var ticking = false;
  var lastY = 0;

  function applyUpdate() {
    // Tek bir CSS değişkeni güncellemesi → reflow/layout YOK, sadece composite.
    root.style.setProperty('--scroll-y', String(Math.round(lastY)));
    ticking = false;
  }

  function onScroll() {
    if (reduceMotion) return;
    lastY = window.pageYOffset || window.scrollY || 0;
    if (!ticking) {
      window.requestAnimationFrame(applyUpdate);
      ticking = true;
    }
  }

  // İlk pozisyon — sayfa zaten kaydırılmış olarak yüklenmiş olabilir.
  onScroll();

  // Pasif dinleyici: scroll performansını engellemeyiz.
  window.addEventListener('scroll', onScroll, { passive: true });

  // Reduced motion ayarı sayfa açıkken değişirse uyumlu kal.
  if (reduceMotionMQ) {
    var onPrefChange = function (e) {
      reduceMotion = !!e.matches;
      if (reduceMotion) {
        root.style.setProperty('--scroll-y', '0');
      } else {
        onScroll();
      }
    };
    if (typeof reduceMotionMQ.addEventListener === 'function') {
      reduceMotionMQ.addEventListener('change', onPrefChange);
    } else if (typeof reduceMotionMQ.addListener === 'function') {
      reduceMotionMQ.addListener(onPrefChange);
    }
  }
})();

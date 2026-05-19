/**
 * FitTrack — Demo Auth & Admin Panel
 * ---------------------------------------------------------------------------
 * UYARI: BU GERÇEK GÜVENLİ AUTH DEĞİLDİR.
 *
 * - Tüm kullanıcılar tarayıcı `localStorage`’ında saklanır.
 * - Şifreler frontend’de düz metin olarak tutulur (yalnızca demo amaçlı).
 * - Gerçek projelerde Supabase Auth / Firebase Auth / kendi backend’iniz
 *   gibi bir backend kimlik doğrulama sistemi kullanılmalıdır.
 *
 * Anahtarlar:
 *   fittrack_users_v1         → Kullanıcı listesi (Array<User>)
 *   fittrack_current_user_v1  → O anki oturum (User | null)
 *
 * Demo Admin:
 *   admin@fittrack.com / admin123
 *
 * Diğer modüller (script.js) `fittrack:user-change` olayını dinler;
 * giriş / çıkış sonrası `window.FitTrackApp.reload()` ile fitness verisi
 * yeniden yüklenir.
 */

(function () {
  'use strict';

  var USERS_KEY = 'fittrack_users_v1';
  var CURRENT_KEY = 'fittrack_current_user_v1';

  var ADMIN_EMAIL = 'admin@fittrack.com';
  var ADMIN_PASSWORD = 'admin123';
  var ADMIN_ID = 'usr-admin-demo';

  var DEMO_EMAIL = 'demo@fittrack.com';
  var DEMO_PASSWORD = 'demo1234';
  var DEMO_ID = 'usr-demo-fittrack';
  var DEMO_NAME = 'Demo Kullanıcı';

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // --- Depolama yardımcıları ---------------------------------------------

  function readUsers() {
    try {
      var raw = localStorage.getItem(USERS_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter(isValidUserShape) : [];
    } catch (e) {
      return [];
    }
  }

  function writeUsers(users) {
    try {
      localStorage.setItem(USERS_KEY, JSON.stringify(users));
    } catch (e) {
      toast('Kullanıcı listesi kaydedilemedi (depolama dolu olabilir).', false);
    }
  }

  function isValidUserShape(u) {
    return (
      u &&
      typeof u === 'object' &&
      typeof u.id === 'string' &&
      typeof u.email === 'string' &&
      typeof u.name === 'string' &&
      typeof u.password === 'string' &&
      (u.role === 'user' || u.role === 'admin')
    );
  }

  function getCurrentUser() {
    try {
      var raw = localStorage.getItem(CURRENT_KEY);
      if (!raw) return null;
      var u = JSON.parse(raw);
      if (u && typeof u.id === 'string') return u;
    } catch (e) {}
    return null;
  }

  function setCurrentUser(u) {
    if (u) {
      var safe = {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        createdAt: u.createdAt || null
      };
      try {
        localStorage.setItem(CURRENT_KEY, JSON.stringify(safe));
      } catch (e) {}
    } else {
      try {
        localStorage.removeItem(CURRENT_KEY);
      } catch (e) {}
    }
  }

  function emitUserChange() {
    try {
      window.dispatchEvent(new Event('fittrack:user-change'));
    } catch (e) {
      // Eski tarayıcılar için yedek
      var ev = document.createEvent('Event');
      ev.initEvent('fittrack:user-change', true, true);
      window.dispatchEvent(ev);
    }
  }

  function uid(prefix) {
    return (
      (prefix || 'usr') +
      '-' +
      Date.now().toString(36) +
      '-' +
      Math.random().toString(36).slice(2, 8)
    );
  }

  // --- Toast (style.css içindeki #toast’u kullanır) -----------------------

  var toastTimer = null;
  function toast(message, success) {
    var el = document.getElementById('toast');
    if (!el) return;
    if (toastTimer) clearTimeout(toastTimer);
    el.textContent = message;
    el.classList.remove('success', 'error', 'visible');
    el.classList.add(success ? 'success' : 'error', 'visible');
    el.setAttribute('aria-hidden', 'false');
    toastTimer = setTimeout(function () {
      el.classList.remove('visible');
      el.setAttribute('aria-hidden', 'true');
    }, 3200);
  }

  // --- Demo admin tohumlama -----------------------------------------------

  function seedAdmin() {
    var users = readUsers();
    var hasAdmin = users.some(function (u) {
      return u.email.toLowerCase() === ADMIN_EMAIL;
    });
    if (hasAdmin) return;
    users.push({
      id: ADMIN_ID,
      name: 'Demo Admin',
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      role: 'admin',
      createdAt: new Date().toISOString()
    });
    writeUsers(users);
  }

  function seedDemoUser() {
    var users = readUsers();
    var existing = users.find(function (u) {
      return u.email.toLowerCase() === DEMO_EMAIL;
    });
    if (existing) return existing;
    var demoUser = {
      id: DEMO_ID,
      name: DEMO_NAME,
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      role: 'user',
      createdAt: new Date().toISOString()
    };
    users.push(demoUser);
    writeUsers(users);
    return demoUser;
  }

  function handleDemoLogin() {
    var user = seedDemoUser();
    setCurrentUser(user);
    if (window.FitTrackApp && typeof window.FitTrackApp.seedDemoPresentationData === 'function') {
      window.FitTrackApp.seedDemoPresentationData();
    }
    closeAllModals();
    updateAuthUI();
    emitUserChange();
    toast('Demo hesabıyla giriş yapıldı. Örnek veriler yüklendi.', true);
    var dash = document.getElementById('dashboard');
    if (dash) {
      dash.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function findUserByEmail(email) {
    var lower = String(email || '').trim().toLowerCase();
    var users = readUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].email.toLowerCase() === lower) return users[i];
    }
    return null;
  }

  // --- Modal yönetimi -----------------------------------------------------

  function openModal(id) {
    var m = document.getElementById(id);
    if (!m) return;
    closeAllModals();
    m.removeAttribute('hidden');
    m.setAttribute('aria-hidden', 'false');
    document.body.classList.add('has-open-modal');
    var input = m.querySelector('input, button');
    if (input && typeof input.focus === 'function') {
      setTimeout(function () {
        input.focus();
      }, 30);
    }
  }

  function closeModal(id) {
    var m = document.getElementById(id);
    if (!m) return;
    m.setAttribute('hidden', '');
    m.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.modal-overlay:not([hidden])')) {
      document.body.classList.remove('has-open-modal');
    }
  }

  function closeAllModals() {
    var open = document.querySelectorAll('.modal-overlay:not([hidden])');
    for (var i = 0; i < open.length; i++) {
      open[i].setAttribute('hidden', '');
      open[i].setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('has-open-modal');
  }

  // --- Doğrulama yardımcıları --------------------------------------------

  function isValidEmail(s) {
    return EMAIL_RE.test(String(s || '').trim());
  }

  // --- Auth aksiyonları --------------------------------------------------

  function handleRegister(e) {
    e.preventDefault();
    var nameEl = document.getElementById('register-name');
    var emailEl = document.getElementById('register-email');
    var passEl = document.getElementById('register-password');
    var pass2El = document.getElementById('register-password-2');
    if (!nameEl || !emailEl || !passEl || !pass2El) return;

    var name = nameEl.value.trim();
    var email = emailEl.value.trim();
    var pass = passEl.value;
    var pass2 = pass2El.value;

    if (!name) {
      toast('Ad Soyad alanı boş bırakılamaz.', false);
      nameEl.focus();
      return;
    }
    if (name.length > 80) {
      toast('Ad Soyad en fazla 80 karakter olabilir.', false);
      nameEl.focus();
      return;
    }
    if (!email) {
      toast('E-posta alanı boş bırakılamaz.', false);
      emailEl.focus();
      return;
    }
    if (!isValidEmail(email)) {
      toast('Geçerli bir e-posta adresi gir (örn: ad@site.com).', false);
      emailEl.focus();
      return;
    }
    if (!pass || pass.length < 6) {
      toast('Şifre en az 6 karakter olmalı.', false);
      passEl.focus();
      return;
    }
    if (pass.length > 100) {
      toast('Şifre en fazla 100 karakter olabilir.', false);
      passEl.focus();
      return;
    }
    if (pass !== pass2) {
      toast('Şifreler eşleşmiyor; lütfen kontrol et.', false);
      pass2El.focus();
      return;
    }
    if (findUserByEmail(email)) {
      toast('Bu e-posta zaten kayıtlı. Farklı bir e-posta dene veya giriş yap.', false);
      emailEl.focus();
      return;
    }

    var users = readUsers();
    var newUser = {
      id: uid('usr'),
      name: name,
      email: email.toLowerCase(),
      password: pass,
      role: 'user',
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    writeUsers(users);

    setCurrentUser(newUser);
    closeAllModals();
    var form = document.getElementById('form-register');
    if (form) form.reset();

    updateAuthUI();
    emitUserChange();
    toast('Kayıt başarılı. Hoş geldin ' + newUser.name + '!', true);
  }

  function handleLogin(e) {
    e.preventDefault();
    var emailEl = document.getElementById('login-email');
    var passEl = document.getElementById('login-password');
    if (!emailEl || !passEl) return;

    var email = emailEl.value.trim();
    var pass = passEl.value;

    if (!email || !pass) {
      toast('E-posta ve şifre boş bırakılamaz.', false);
      (!email ? emailEl : passEl).focus();
      return;
    }
    if (!isValidEmail(email)) {
      toast('Geçerli bir e-posta adresi gir.', false);
      emailEl.focus();
      return;
    }

    var user = findUserByEmail(email);
    if (!user || user.password !== pass) {
      toast('E-posta veya şifre hatalı.', false);
      passEl.focus();
      passEl.value = '';
      return;
    }

    setCurrentUser(user);
    closeAllModals();
    var form = document.getElementById('form-login');
    if (form) form.reset();

    updateAuthUI();
    emitUserChange();
    toast('Giriş başarılı. Tekrar hoş geldin ' + user.name + '!', true);
  }

  function handleLogout() {
    var u = getCurrentUser();
    setCurrentUser(null);
    closeAllModals();
    updateAuthUI();
    emitUserChange();
    toast(
      u ? (u.name + ' oturumu kapatıldı.') : 'Oturum kapatıldı.',
      true
    );
  }

  function deleteUser(targetId) {
    var current = getCurrentUser();
    if (!current || current.role !== 'admin') {
      toast('Bu işlem için admin yetkisi gerekiyor.', false);
      return;
    }
    if (targetId === current.id) {
      toast('Admin kendi hesabını silemez.', false);
      return;
    }
    var users = readUsers();
    var target = users.find(function (u) {
      return u.id === targetId;
    });
    if (!target) {
      toast('Kullanıcı bulunamadı.', false);
      return;
    }
    var ok = window.confirm(
      '“' + target.name + '” (' + target.email + ') kalıcı olarak silinsin mi?\n\n' +
        'Bu işlem geri alınamaz. Kullanıcının fitness verisi de tarayıcıdan kaldırılacaktır.'
    );
    if (!ok) return;

    var remaining = users.filter(function (u) {
      return u.id !== targetId;
    });
    writeUsers(remaining);

    // Kullanıcıya ait fitness ve sohbet anahtarlarını da temizle.
    try {
      localStorage.removeItem('fittrack_state_v1_' + targetId);
      localStorage.removeItem('fittrack_ai_chat_v1_' + targetId);
    } catch (e) {}

    renderAdminPanel();
    toast('Kullanıcı silindi.', true);
  }

  // --- Auth UI (navbar, hero, footer) ------------------------------------

  function setAuthVisibility(el, visible) {
    if (!el) return;
    if (visible) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
  }

  function applyAuthVisibility(selector, visible) {
    var nodes = document.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) {
      setAuthVisibility(nodes[i], visible);
    }
  }

  /**
   * Oturum durumuna göre navbar, hero ve footer üyelik CTA’larını günceller.
   * Sayfa yüklemesi, giriş/çıkış ve fittrack:user-change sonrası çağrılır.
   */
  function updateAuthUI() {
    var current = getCurrentUser();
    var isLoggedIn = !!current;
    var isAdmin = isLoggedIn && current.role === 'admin';

    if (document.body) {
      document.body.classList.toggle('is-auth-user', isLoggedIn);
      document.body.classList.toggle('is-auth-guest', !isLoggedIn);
      document.body.classList.toggle('is-auth-admin', isAdmin);
    }

    applyAuthVisibility('[data-auth-show="guest"]', !isLoggedIn);
    applyAuthVisibility('[data-auth-show="user"]', isLoggedIn);
    applyAuthVisibility('[data-auth-show="admin"]', isAdmin);

    var userName = document.getElementById('nav-user-name');
    if (userName) {
      if (isLoggedIn) {
        userName.textContent = current.name;
        userName.setAttribute(
          'title',
          current.email + (isAdmin ? ' · admin' : '')
        );
      } else {
        userName.textContent = '';
        userName.removeAttribute('title');
      }
    }

    var heroAuthBtn = document.getElementById('btn-hero-auth');
    if (heroAuthBtn) {
      setAuthVisibility(heroAuthBtn, true);
      if (isLoggedIn) {
        heroAuthBtn.textContent = 'Panele Git';
        heroAuthBtn.className = 'btn btn-outline hero-btn-dashboard btn-cta-arrow';
        heroAuthBtn.removeAttribute('data-modal-switch');
        heroAuthBtn.setAttribute('aria-label', 'Dashboard bölümüne git');
        heroAuthBtn.setAttribute('type', 'button');
      } else {
        heroAuthBtn.textContent = 'Üye Ol';
        heroAuthBtn.className = 'btn btn-secondary hero-btn-signup btn-cta-arrow';
        heroAuthBtn.setAttribute('data-modal-switch', 'modal-register');
        heroAuthBtn.setAttribute('aria-label', 'Üye ol modalını aç');
        heroAuthBtn.setAttribute('type', 'button');
      }
    }
  }

  function renderNavAuth() {
    updateAuthUI();
  }

  // --- Admin paneli ------------------------------------------------------

  /**
   * Belirli bir kullanıcının fitness state’inden toplamları hesaplar.
   * Kullanıcı bazlı `fittrack_state_v1_<id>` anahtarındaki kayıtları okur.
   */
  function readUserAggregates(userId) {
    var key = 'fittrack_state_v1_' + userId;
    var agg = { calories: 0, water: 0, exerciseMinutes: 0 };
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return agg;
      var st = JSON.parse(raw);
      if (!st || typeof st !== 'object') return agg;
      var hist = st.activityHistory && typeof st.activityHistory === 'object' ? st.activityHistory : {};
      Object.keys(hist).forEach(function (date) {
        var row = hist[date];
        if (!row || typeof row !== 'object') return;
        agg.calories += Math.max(0, Math.floor(Number(row.calories) || 0));
        agg.water += Math.max(0, Math.floor(Number(row.water) || 0));
        agg.exerciseMinutes += Math.max(0, Math.floor(Number(row.exerciseMinutes) || 0));
      });
      // Bugünün canlı verisi: activityHistory’ye yazılmadıysa eksik kalmasın.
      // saveState her güncellemede syncLiveIntoHistoryToday çağırdığı için
      // pratikte tarihte zaten var; yine de güvence olarak ekleme yapmıyoruz
      // çünkü iki kez sayma riski olur.
      return agg;
    } catch (e) {
      return agg;
    }
  }

  function renderAdminPanel() {
    var statsRoot = document.getElementById('admin-stats');
    var tbody = document.getElementById('admin-user-tbody');
    if (!statsRoot || !tbody) return;

    var current = getCurrentUser();
    if (!current || current.role !== 'admin') {
      statsRoot.innerHTML = '';
      tbody.innerHTML = '';
      return;
    }

    var users = readUsers();
    var adminCount = 0;
    var userCount = 0;
    var totals = { calories: 0, water: 0, exerciseMinutes: 0 };

    users.forEach(function (u) {
      if (u.role === 'admin') adminCount++;
      else userCount++;
      var agg = readUserAggregates(u.id);
      totals.calories += agg.calories;
      totals.water += agg.water;
      totals.exerciseMinutes += agg.exerciseMinutes;
    });

    // Stat kartları
    statsRoot.innerHTML = '';
    var stats = [
      { label: 'Toplam Kullanıcı', value: users.length, modifier: 'admin-stat-total' },
      { label: 'Normal Kullanıcı', value: userCount, modifier: 'admin-stat-user' },
      { label: 'Admin', value: adminCount, modifier: 'admin-stat-admin' },
      {
        label: 'Toplam Egzersiz (dk)',
        value: totals.exerciseMinutes.toLocaleString('tr-TR'),
        modifier: 'admin-stat-ex'
      },
      {
        label: 'Toplam Su (bardak)',
        value: totals.water.toLocaleString('tr-TR'),
        modifier: 'admin-stat-water'
      },
      {
        label: 'Toplam Kalori Girişi',
        value: totals.calories.toLocaleString('tr-TR'),
        modifier: 'admin-stat-cal'
      }
    ];
    stats.forEach(function (s) {
      var card = document.createElement('article');
      card.className = 'admin-stat-card ' + s.modifier;
      var v = document.createElement('span');
      v.className = 'admin-stat-value';
      v.textContent = s.value;
      var l = document.createElement('span');
      l.className = 'admin-stat-label';
      l.textContent = s.label;
      card.appendChild(v);
      card.appendChild(l);
      statsRoot.appendChild(card);
    });

    // Kullanıcı tablosu
    tbody.innerHTML = '';
    var sorted = users.slice().sort(function (a, b) {
      var ax = a.createdAt || '';
      var bx = b.createdAt || '';
      return bx.localeCompare(ax);
    });

    sorted.forEach(function (u) {
      var tr = document.createElement('tr');

      var tdName = document.createElement('td');
      tdName.textContent = u.name + (u.id === current.id ? ' (sen)' : '');
      tr.appendChild(tdName);

      var tdMail = document.createElement('td');
      tdMail.className = 'admin-cell-email';
      tdMail.textContent = u.email;
      tr.appendChild(tdMail);

      var tdRole = document.createElement('td');
      var roleBadge = document.createElement('span');
      roleBadge.className = 'admin-role-badge' + (u.role === 'admin' ? ' admin-role-admin' : ' admin-role-user');
      roleBadge.textContent = u.role === 'admin' ? 'admin' : 'user';
      tdRole.appendChild(roleBadge);
      tr.appendChild(tdRole);

      var tdDate = document.createElement('td');
      tdDate.className = 'admin-cell-date';
      tdDate.textContent = formatDate(u.createdAt);
      tr.appendChild(tdDate);

      var tdAct = document.createElement('td');
      tdAct.className = 'admin-cell-actions';
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn-admin-delete';
      del.textContent = 'Sil';
      if (u.id === current.id) {
        del.disabled = true;
        del.setAttribute('aria-disabled', 'true');
        del.title = 'Admin kendi hesabını silemez';
      } else {
        del.addEventListener('click', function () {
          deleteUser(u.id);
        });
      }
      tdAct.appendChild(del);
      tr.appendChild(tdAct);

      tbody.appendChild(tr);
    });
  }

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      var hh = String(d.getHours()).padStart(2, '0');
      var mm = String(d.getMinutes()).padStart(2, '0');
      return day + '.' + m + '.' + y + ' ' + hh + ':' + mm;
    } catch (e) {
      return '—';
    }
  }

  // --- Olay bağlama ------------------------------------------------------

  function bindEvents() {
    // Navbar düğmeleri
    var btnOpenLogin = document.getElementById('btn-open-login');
    if (btnOpenLogin) {
      btnOpenLogin.addEventListener('click', function () {
        openModal('modal-login');
      });
    }
    var btnOpenRegister = document.getElementById('btn-open-register');
    if (btnOpenRegister) {
      btnOpenRegister.addEventListener('click', function () {
        openModal('modal-register');
      });
    }
    var btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', handleLogout);
    }
    var btnOpenAdmin = document.getElementById('btn-open-admin');
    if (btnOpenAdmin) {
      btnOpenAdmin.addEventListener('click', function () {
        var u = getCurrentUser();
        if (!u || u.role !== 'admin') {
          toast('Admin panelini sadece admin görebilir.', false);
          return;
        }
        renderAdminPanel();
        openModal('modal-admin');
      });
    }

    var btnHeroAuth = document.getElementById('btn-hero-auth');
    if (btnHeroAuth) {
      btnHeroAuth.addEventListener('click', function () {
        if (getCurrentUser()) {
          var dash = document.getElementById('dashboard');
          if (dash) {
            dash.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
          return;
        }
        openModal('modal-register');
      });
    }

    var btnDemoLogin = document.getElementById('btn-demo-login');
    if (btnDemoLogin) btnDemoLogin.addEventListener('click', handleDemoLogin);
    var btnDemoLoginModal = document.getElementById('btn-demo-login-modal');
    if (btnDemoLoginModal) btnDemoLoginModal.addEventListener('click', handleDemoLogin);
    var btnDemoLoginHero = document.getElementById('btn-demo-login-hero');
    if (btnDemoLoginHero) btnDemoLoginHero.addEventListener('click', handleDemoLogin);

    // Modal kapatma
    var closeButtons = document.querySelectorAll('[data-modal-close]');
    for (var i = 0; i < closeButtons.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var target = btn.getAttribute('data-modal-close');
          if (target) closeModal(target);
        });
      })(closeButtons[i]);
    }

    // Modal geçişleri (Üye Ol ↔ Giriş Yap) — delegation ile dinamik butonlar dahil
    document.addEventListener('click', function (e) {
      var trigger = e.target.closest('[data-modal-switch]');
      if (!trigger) return;
      if (trigger.id === 'btn-hero-auth') return;
      if (getCurrentUser() && trigger.closest('[data-auth-show="guest"]')) return;
      var target = trigger.getAttribute('data-modal-switch');
      if (target) openModal(target);
    });

    // Overlay’e tıklayınca kapan
    var overlays = document.querySelectorAll('.modal-overlay');
    for (var k = 0; k < overlays.length; k++) {
      (function (ov) {
        ov.addEventListener('click', function (e) {
          if (e.target === ov) {
            ov.setAttribute('hidden', '');
            ov.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('has-open-modal');
          }
        });
      })(overlays[k]);
    }

    // ESC ile kapan
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAllModals();
    });

    // Form gönderimleri
    var formLogin = document.getElementById('form-login');
    if (formLogin) formLogin.addEventListener('submit', handleLogin);
    var formRegister = document.getElementById('form-register');
    if (formRegister) formRegister.addEventListener('submit', handleRegister);
  }

  // --- Başlat ------------------------------------------------------------

  function init() {
    seedAdmin();
    bindEvents();
    updateAuthUI();
    window.requestAnimationFrame(updateAuthUI);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('fittrack:user-change', updateAuthUI);
  window.addEventListener('pageshow', updateAuthUI);
  window.addEventListener('storage', function (e) {
    if (e.key === CURRENT_KEY) updateAuthUI();
  });

  // Debug / harici çağrılar için (örn: console).
  window.FitTrackAuth = {
    getCurrentUser: getCurrentUser,
    updateAuthUI: updateAuthUI,
    renderNavAuth: renderNavAuth,
    listUsers: function () {
      return readUsers().map(function (u) {
        return { id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt };
      });
    },
    logout: handleLogout,
    loginAsDemo: handleDemoLogin
  };
})();

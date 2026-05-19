/**
 * FitTrack — Uygulama mantığı
 * ---------------------------------------------------------------------------
 * - Durum `localStorage` içinde `fittrack_state_v1` anahtarıyla saklanır (kökle uyum).
 * - `savedDate` takvim günü değişince günlük sayaçları sıfırlar (kalori, su, egzersiz listesi).
 * - Kilo ve hedef alanları gün değişiminde korunur.
 * - Egzersiz nesneleri: { id, name, minutes, type }; eski kayıtlar için type varsayılanı 'Diğer'.
 * - `activityHistory`: tarih (YYYY-MM-DD) bazlı günlük kalori, su bardığı ve egzersiz dakikası özeti.
 * - `heightCm`: BMI için saklanan boy (cm); isteğe bağlı.
 * - Akıllı Fitness Asistanı: önce Netlify Function (`/.netlify/functions/fittrack-ai`) üzerinden OpenAI, başarısızlıkta kural tabanlı `answerAiQuestion` fallback. Sohbet `fittrack_ai_chat_v1` anahtarıyla (son 20 mesaj) saklanır.
 */

(function () {
  'use strict';

  /**
   * Depolama anahtarı — kullanıcı tabanlı.
   * Giriş yapılmış kullanıcı için: `fittrack_state_v1_<userId>`
   * Demo / misafir mod için (giriş yapılmadıysa): `fittrack_state_v1` (önceki teslimlerle uyumlu).
   * `auth.js` `fittrack_current_user_v1` anahtarını yönetir; burası sadece okur.
   */
  var AUTH_CURRENT_USER_KEY = 'fittrack_current_user_v1';
  var STORAGE_KEY_BASE = 'fittrack_state_v1';
  var AI_CHAT_KEY_BASE = 'fittrack_ai_chat_v1';
  var DEMO_USER_EMAIL = 'demo@fittrack.com';

  function currentUserIdSafe() {
    try {
      var raw = localStorage.getItem(AUTH_CURRENT_USER_KEY);
      if (!raw) return null;
      var u = JSON.parse(raw);
      if (u && typeof u.id === 'string' && u.id) return u.id;
    } catch (e) {}
    return null;
  }

  function getStorageKey() {
    var id = currentUserIdSafe();
    return id ? STORAGE_KEY_BASE + '_' + id : STORAGE_KEY_BASE;
  }

  /** Geçerli egzersiz türleri */
  var EXERCISE_TYPES = ['Kardiyo', 'Ağırlık', 'Esneme', 'Yürüyüş', 'Diğer'];

  /** Tek seferde eklemeye izin verilen üst kalori sınırı */
  var CAL_SINGLE_MAX = 8000;

  /** Şüpheli yüksek tek giriş eşiği (bilgilendirme) */
  var CAL_WARN_THRESHOLD = 2500;

  /** Günlük bardak üst sınırı (mantıksız artışları kesmek için) */
  var WATER_GLASSES_HARD_MAX = 40;

  /** Tek kayıtta uzun süre uyarı eşiği (dakika) */
  var EX_DURATION_WARN = 120;

  /** Varsayılan durum */
  function defaultState() {
    var today = todayISO();
    return {
      savedDate: today,
      calorieGoal: 2200,
      caloriesConsumed: 0,
      waterGoal: 8,
      waterGlasses: 0,
      exerciseGoalMinutes: 45,
      exercises: [],
      currentWeight: 78,
      goalWeight: 72,
      heightCm: null,
      activityHistory: {}
    };
  }

  /** YYYY-MM-DD (yerel saat) */
  function todayISO() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  /** Haftalık grafik etiketleri (Pazartesi = indeks 0) */
  var WEEKDAY_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
  var WEEKDAY_LONG = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];

  var ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function dateToISO(d) {
    var y = d.getFullYear();
    var mo = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + mo + '-' + day;
  }

  /** Durumdaki egzersiz listesinden toplam dakika */
  function exerciseMinutesFromState(st) {
    if (!Array.isArray(st.exercises)) return 0;
    return st.exercises.reduce(function (acc, x) {
      return acc + (x.minutes || 0);
    }, 0);
  }

  function normalizeActivityHistory(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (key) {
      if (!ISO_DATE_RE.test(key)) return;
      var v = raw[key];
      if (!v || typeof v !== 'object') return;
      out[key] = {
        calories: Math.max(0, Math.floor(Number(v.calories) || 0)),
        water: Math.max(0, Math.floor(Number(v.water) || 0)),
        exerciseMinutes: Math.max(0, Math.floor(Number(v.exerciseMinutes) || 0))
      };
    });
    return out;
  }

  function readDayFromHistory(st, isoDate) {
    var row = st.activityHistory && st.activityHistory[isoDate];
    if (!row || typeof row !== 'object') {
      return { calories: 0, water: 0, exerciseMinutes: 0 };
    }
    return {
      calories: Math.max(0, Math.floor(Number(row.calories) || 0)),
      water: Math.max(0, Math.floor(Number(row.water) || 0)),
      exerciseMinutes: Math.max(0, Math.floor(Number(row.exerciseMinutes) || 0))
    };
  }

  function writeDayToHistory(st, isoDate, calories, waterGlasses, exerciseMinutes) {
    if (!st.activityHistory || typeof st.activityHistory !== 'object') st.activityHistory = {};
    st.activityHistory[isoDate] = {
      calories: Math.max(0, Math.floor(Number(calories) || 0)),
      water: Math.max(0, Math.floor(Number(waterGlasses) || 0)),
      exerciseMinutes: Math.max(0, Math.floor(Number(exerciseMinutes) || 0))
    };
  }

  /** Bugünün canlı değerlerini geçmişe yazar */
  function syncLiveIntoHistoryToday(st) {
    var t = todayISO();
    if (st.savedDate !== t) return;
    writeDayToHistory(st, t, st.caloriesConsumed, st.waterGlasses, exerciseMinutesFromState(st));
  }

  /** Depolama boyutunu sınırlamak için eski kayıtları siler */
  function pruneActivityHistory(st, keepDays) {
    if (!st.activityHistory) return;
    var days = typeof keepDays === 'number' ? keepDays : 120;
    var cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - days);
    var cutoffStr = dateToISO(cutoff);
    Object.keys(st.activityHistory).forEach(function (k) {
      if (k < cutoffStr) delete st.activityHistory[k];
    });
  }

  /** Geçmiş senkronu + kalıcı kayıt */
  function persistState(st) {
    syncLiveIntoHistoryToday(st);
    pruneActivityHistory(st);
    saveState(st);
  }

  function mondayOfWeekContaining(reference) {
    var d = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
    var dow = d.getDay();
    var delta = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + delta);
    return d;
  }

  function getCurrentWeekIsoDates() {
    var mon = mondayOfWeekContaining(new Date());
    var list = [];
    for (var i = 0; i < 7; i++) {
      var x = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i);
      list.push(dateToISO(x));
    }
    return list;
  }

  /**
   * Bu haftanın günlük satırları ve toplamları.
   * Bugün için `savedDate === bugün` ise canlı sayaçlar kullanılır.
   */
  function getWeekActivityData() {
    var today = todayISO();
    var weekDates = getCurrentWeekIsoDates();
    var totals = { calories: 0, water: 0, exerciseMinutes: 0 };
    var daily = [];
    var dailyEx = [];

    for (var i = 0; i < 7; i++) {
      var iso = weekDates[i];
      var row = readDayFromHistory(state, iso);
      if (iso === today && state.savedDate === today) {
        row = {
          calories: state.caloriesConsumed,
          water: state.waterGlasses,
          exerciseMinutes: exerciseMinutesFromState(state)
        };
      }
      totals.calories += row.calories;
      totals.water += row.water;
      totals.exerciseMinutes += row.exerciseMinutes;
      daily.push({
        date: iso,
        calories: row.calories,
        water: row.water,
        exerciseMinutes: row.exerciseMinutes
      });
      dailyEx.push(row.exerciseMinutes);
    }

    return {
      weekDates: weekDates,
      daily: daily,
      dailyEx: dailyEx,
      totals: totals
    };
  }

  /** Egzersiz kaydını güvenli biçimde normalize et */
  function normalizeExercise(raw) {
    var type = typeof raw.type === 'string' ? raw.type : 'Diğer';
    if (EXERCISE_TYPES.indexOf(type) === -1) type = 'Diğer';
    return {
      id: raw.id || uid(),
      name: typeof raw.name === 'string' ? raw.name : 'Egzersiz',
      minutes: Number.isFinite(raw.minutes) ? Math.max(0, Math.floor(raw.minutes)) : 0,
      type: type
    };
  }

  /** Tam sayı hedef doğrulama */
  function parseGoalInt(value, min, max) {
    var n = Number(String(value).trim());
    if (!Number.isFinite(n) || Math.floor(n) !== n) return null;
    if (n < min || n > max) return null;
    return n;
  }

  /** localStorage yaz */
  function saveState(state) {
    try {
      localStorage.setItem(getStorageKey(), JSON.stringify(state));
    } catch (err) {
      showToast('Kayıt yapılamadı: tarayıcı depolaması dolu olabilir veya gizli mod aktif.', false);
    }
  }

  /** localStorage oku + gün kontrolü */
  function loadState() {
    var base = defaultState();
    var raw = localStorage.getItem(getStorageKey());
    if (!raw) return base;

    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return base;
    }

    var state = Object.assign({}, base, parsed);
    state.activityHistory = normalizeActivityHistory(state.activityHistory);

    if (state.heightCm != null) {
      var hc = Number(state.heightCm);
      if (!Number.isFinite(hc) || hc < 80 || hc > 250) state.heightCm = null;
      else state.heightCm = Math.round(hc * 10) / 10;
    } else {
      state.heightCm = null;
    }

    if (!Array.isArray(state.exercises)) state.exercises = [];
    state.exercises = state.exercises.map(normalizeExercise);

    if (!Number.isFinite(state.exerciseGoalMinutes)) state.exerciseGoalMinutes = base.exerciseGoalMinutes;

    var today = todayISO();
    if (state.savedDate !== today) {
      writeDayToHistory(
        state,
        state.savedDate,
        state.caloriesConsumed,
        state.waterGlasses,
        exerciseMinutesFromState(state)
      );
      state.savedDate = today;
      state.caloriesConsumed = 0;
      state.waterGlasses = 0;
      state.exercises = [];
    }

    syncLiveIntoHistoryToday(state);
    pruneActivityHistory(state);
    saveState(state);

    return state;
  }

  var state = loadState();

  // --- DOM referansları ---
  var elToast = document.getElementById('toast');
  var elMotivation = document.getElementById('motivation-text');
  var elYear = document.getElementById('year');

  var dashCalCurrent = document.getElementById('dash-cal-current');
  var dashCalGoal = document.getElementById('dash-cal-goal');
  var dashCalBar = document.getElementById('dash-cal-bar');
  var dashWaterCurrent = document.getElementById('dash-water-current');
  var dashWaterGoal = document.getElementById('dash-water-goal');
  var dashWaterBar = document.getElementById('dash-water-bar');
  var dashExCount = document.getElementById('dash-ex-count');
  var dashExMinutes = document.getElementById('dash-ex-minutes');
  var dashExGoal = document.getElementById('dash-ex-goal');
  var dashExBar = document.getElementById('dash-ex-bar');
  var dashCalPct = document.getElementById('dash-cal-pct');
  var dashWaterPct = document.getElementById('dash-water-pct');
  var dashExPct = document.getElementById('dash-ex-pct');
  var dashWeightCurrent = document.getElementById('dash-weight-current');
  var dashWeightGoal = document.getElementById('dash-weight-goal');
  var dashWeightProgress = document.getElementById('dash-weight-progress');

  var calConsumed = document.getElementById('cal-consumed');
  var calGoalDisplay = document.getElementById('cal-goal-display');
  var calProgressWrap = document.getElementById('cal-progress-wrap');
  var calProgressFill = document.getElementById('cal-progress-fill');
  var formCalorie = document.getElementById('form-calorie');
  var calorieInput = document.getElementById('calorie-input');

  var waterCount = document.getElementById('water-count');
  var waterGoalDisplay = document.getElementById('water-goal-display');
  var waterProgressWrap = document.getElementById('water-progress-wrap');
  var waterProgressFill = document.getElementById('water-progress-fill');
  var btnWaterPlus = document.getElementById('btn-water-plus');
  var btnWaterReset = document.getElementById('btn-water-reset');

  var formExercise = document.getElementById('form-exercise');
  var exName = document.getElementById('ex-name');
  var exDuration = document.getElementById('ex-duration');
  var exType = document.getElementById('ex-type');
  var exerciseList = document.getElementById('exercise-list');
  var exTotalMinutes = document.getElementById('ex-total-minutes');
  var exTotalCount = document.getElementById('ex-total-count');
  var exEmptyState = document.getElementById('ex-empty-state');
  var exProgressCurrent = document.getElementById('ex-progress-current');
  var exProgressGoal = document.getElementById('ex-progress-goal');
  var exProgressWrap = document.getElementById('ex-progress-wrap');
  var exProgressFill = document.getElementById('ex-progress-fill');

  var weightCurrentDisplay = document.getElementById('weight-current-display');
  var weightGoalDisplay = document.getElementById('weight-goal-display');
  var weightMessage = document.getElementById('weight-message');
  var formWeight = document.getElementById('form-weight');
  var weightInput = document.getElementById('weight-input');
  var formGoalWeight = document.getElementById('form-goal-weight');
  var goalWeightInput = document.getElementById('goal-weight-input');

  var formGoals = document.getElementById('form-goals');
  var goalCalorieInput = document.getElementById('goal-calorie-input');
  var goalWaterInput = document.getElementById('goal-water-input');
  var goalExerciseInput = document.getElementById('goal-exercise-input');
  var goalWeightSettingsInput = document.getElementById('goal-weight-settings-input');

  var formHeight = document.getElementById('form-height');
  var heightInput = document.getElementById('height-input');
  var bmiValueEl = document.getElementById('bmi-value');
  var bmiStatusEl = document.getElementById('bmi-status');

  var badgeWater = document.getElementById('badge-water');
  var badgeActiveDay = document.getElementById('badge-active-day');
  var badgeBalanced = document.getElementById('badge-balanced');
  var badgeWeekly = document.getElementById('badge-weekly');

  var summaryLines = document.getElementById('summary-lines');

  var btnExportWeek = document.getElementById('btn-export-week');
  var btnClearAllHistory = document.getElementById('btn-clear-all-history');

  var btnStartToday = document.getElementById('btn-start-today');
  var btnWeeklyReport = document.getElementById('btn-weekly-report');
  var btnResetDay = document.getElementById('btn-reset-day');

  var btnAiSuggest = document.getElementById('btn-ai-suggest');
  var btnAiChatClear = document.getElementById('btn-ai-chat-clear');
  var aiChatBox = document.getElementById('ai-chat-box');
  var aiQuestionForm = document.getElementById('ai-question-form');
  var aiQuestionInput = document.getElementById('ai-question-input');

  var heroStatCal = document.getElementById('hero-stat-cal');
  var heroStatWater = document.getElementById('hero-stat-water');
  var heroStatEx = document.getElementById('hero-stat-ex');

  var toastTimer;

  /** Bildirim göster */
  function showToast(message, success) {
    if (!elToast) return;
    clearTimeout(toastTimer);
    elToast.textContent = message;
    elToast.classList.remove('success', 'error', 'visible');
    elToast.classList.add(success ? 'success' : 'error', 'visible');
    elToast.setAttribute('aria-hidden', 'false');
    toastTimer = setTimeout(function () {
      elToast.classList.remove('visible');
      elToast.setAttribute('aria-hidden', 'true');
    }, 3200);
  }

  /** Yüzde 0–100 */
  function clampPercent(value) {
    return Math.max(0, Math.min(100, value));
  }

  /** Pozitif tam sayı */
  function parsePositiveInt(str, max) {
    var n = Number(String(str).trim());
    if (!Number.isFinite(n) || n <= 0 || Math.floor(n) !== n) return null;
    if (typeof max === 'number' && n > max) return null;
    return n;
  }

  /** Kilo */
  function parseWeight(str) {
    var n = Number(String(str).replace(',', '.'));
    if (!Number.isFinite(n) || n < 30 || n > 250) return null;
    return Math.round(n * 10) / 10;
  }

  /** Boy (cm) */
  function parseHeightCm(str) {
    var n = Number(String(str).replace(',', '.'));
    if (!Number.isFinite(n) || n < 80 || n > 250) return null;
    return Math.round(n * 10) / 10;
  }

  function computeBmi(weightKg, heightCm) {
    if (!Number.isFinite(weightKg) || !Number.isFinite(heightCm) || heightCm <= 0) return null;
    var m = heightCm / 100;
    var bmi = weightKg / (m * m);
    return Math.round(bmi * 10) / 10;
  }

  function bmiCategoryLabel(bmi) {
    if (bmi < 18.5) return 'Zayıf';
    if (bmi <= 24.9) return 'Normal';
    if (bmi <= 29.9) return 'Fazla kilolu';
    return 'Obez';
  }

  function uid() {
    return 'ex-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function totalExerciseMinutes() {
    return state.exercises.reduce(function (acc, item) {
      return acc + (item.minutes || 0);
    }, 0);
  }

  function exerciseGoalSafe() {
    var g = state.exerciseGoalMinutes;
    return Number.isFinite(g) && g > 0 ? g : 1;
  }

  /** Kilo ile ilgili kısa mesaj */
  function weightProgressText() {
    var cur = state.currentWeight;
    var goal = state.goalWeight;
    if (!Number.isFinite(cur) || !Number.isFinite(goal)) {
      return 'Mevcut ve hedef kilonu girerek ilerlemeni netleştirebilirsin.';
    }

    var diff = cur - goal;
    var abs = Math.abs(diff);
    if (abs < 0.05) return 'Hedef kilona çok yakınsın; bu dengeyi korumak harika olur.';
    if (diff > 0) {
      return 'Hedefe yaklaşmak için yaklaşık ' + abs.toFixed(1) + ' kg daha var.';
    }
    return 'Hedef kilonun yaklaşık ' + abs.toFixed(1) + ' kg altındasın; hedefini güncellemek isteyebilirsin.';
  }

  /** Özet listesine tek satır ekle */
  function addSummaryLine(lines, html, className) {
    lines.push({ html: html, className: className });
  }

  /** Günlük özet maddeleri */
  function renderSummary() {
    if (!summaryLines) return;

    var calGoal = state.calorieGoal > 0 ? state.calorieGoal : 1;
    var waterGoal = state.waterGoal > 0 ? state.waterGoal : 1;
    var exGoal = exerciseGoalSafe();
    var calPct = (state.caloriesConsumed / calGoal) * 100;
    var waterPct = (state.waterGlasses / waterGoal) * 100;
    var exMin = totalExerciseMinutes();
    var exPct = (exMin / exGoal) * 100;

    var lines = [];

    // Kalori mesajları
    var calBaseClass = 'summary-item';
    if (calPct > 110) calBaseClass += ' alert';
    else if (calPct > 95) calBaseClass += ' warning';

    if (calPct <= 0) {
      addSummaryLine(
        lines,
        '<strong>Kalori:</strong> Henüz kayıt yok. İlk öğününden sonra tahmini kaloriyi eklemeyi unutma.',
        'summary-item'
      );
    } else if (calPct > 100) {
      addSummaryLine(
        lines,
        '<strong>Kalori:</strong> Bugün kalori hedefinin %' +
          Math.round(calPct) +
          ' kadarını tamamladın (hedefi aştın). Kalori hedefini aşmamaya dikkat et; yarın için dengeyi gözden geçir.',
        calBaseClass
      );
    } else if (calPct >= 92 && calPct <= 100) {
      addSummaryLine(
        lines,
        '<strong>Kalori:</strong> Bugün kalori hedefinin yaklaşık %' +
          Math.round(calPct) +
          ' kadarını tamamladın. Kalori hedefini aşmamaya dikkat et; son öğününde hafif seçimler iyi olur.',
        calBaseClass + ' warning'
      );
    } else {
      addSummaryLine(
        lines,
        '<strong>Kalori:</strong> Bugün kalori hedefinin yaklaşık %' +
          Math.round(calPct) +
          ' kadarını tamamladın.',
        'summary-item'
      );
    }

    // Su
    addSummaryLine(
      lines,
      '<strong>Su:</strong> Bugün su hedefinin yaklaşık %' +
        Math.round(waterPct) +
        ' kadarını tamamladın.' +
        (waterPct >= 100 ? ' Hidrasyon hedefine ulaştın.' : ''),
      waterPct >= 100 ? 'summary-item' : 'summary-item warning'
    );

    // Egzersiz
    var exClass = 'summary-item';
    var exMsg =
      '<strong>Egzersiz:</strong> Bugün egzersiz hedefinin yaklaşık %' + Math.round(exPct) + ' kadarını tamamladın.';
    if (exPct >= 85) {
      exMsg += ' Egzersiz hedefinde iyi gidiyorsun.';
    } else if (exMin <= 0) {
      exMsg =
        '<strong>Egzersiz:</strong> Bugün egzersiz hedefinin %0 kadarını tamamladın. Kısa bir tempolu yürüyüş bile işe yarar.';
      exClass += ' warning';
    } else if (exPct < 50) {
      exMsg +=
        ' Biraz daha hareket, günlük dakika hedefini yakalamana yardım eder.';
      exClass += ' warning';
    }

    addSummaryLine(lines, exMsg, exClass);

    // Kilo
    var wCur = state.currentWeight;
    var wGoal = state.goalWeight;
    var wHtml;
    var wClass = 'summary-item';
    if (!Number.isFinite(wCur) || !Number.isFinite(wGoal)) {
      wHtml =
        '<strong>Kilo:</strong> Kilo hedefi durumunu görmek için mevcut ve hedef kilonu güncelle.';
      wClass += ' warning';
    } else {
      var delta = wCur - wGoal;
      wHtml =
        '<strong>Kilo:</strong> Mevcut ' +
        wCur +
        ' kg · Hedef ' +
        wGoal +
        ' kg. ';
      if (Math.abs(delta) < 0.05) {
        wHtml += 'Hedef kilona çok yakınsın.';
      } else if (delta > 0) {
        wHtml += 'Hedefe yaklaşık ' + Math.abs(delta).toFixed(1) + ' kg mesafe var.';
      } else {
        wHtml += 'Hedef kilonun altındasın; hedefini güncellemek isteyebilirsin.';
      }
    }
    addSummaryLine(lines, wHtml, wClass);

    summaryLines.innerHTML = '';
    lines.forEach(function (item) {
      var li = document.createElement('li');
      li.className = item.className;
      li.innerHTML = item.html;
      summaryLines.appendChild(li);
    });
  }

  function applyBadgeState(el, active) {
    if (!el) return;
    el.classList.toggle('badge--active', active);
    el.classList.toggle('badge--inactive', !active);
    el.setAttribute('aria-current', active ? 'true' : 'false');
  }

  /** Başarı rozetleri (bugün + bu hafta) */
  function renderBadges() {
    var weekData = getWeekActivityData();
    var waterOk = state.waterGoal > 0 && state.waterGlasses >= state.waterGoal;
    var exMin = totalExerciseMinutes();
    var activeDayOk = state.exerciseGoalMinutes > 0 && exMin >= state.exerciseGoalMinutes;
    var balancedOk =
      state.caloriesConsumed > 0 &&
      state.calorieGoal > 0 &&
      state.caloriesConsumed <= state.calorieGoal;
    var weeklyNearOk = weekData.totals.exerciseMinutes > 150;

    applyBadgeState(badgeWater, waterOk);
    applyBadgeState(badgeActiveDay, activeDayOk);
    applyBadgeState(badgeBalanced, balancedOk);
    applyBadgeState(badgeWeekly, weeklyNearOk);
  }

  /** BMI kartı */
  function renderBMI() {
    if (!heightInput || !bmiValueEl || !bmiStatusEl) return;

    if (state.heightCm != null && Number.isFinite(state.heightCm)) {
      heightInput.value = String(state.heightCm);
    } else {
      heightInput.value = '';
    }

    var w = state.currentWeight;
    var h = state.heightCm;
    var bmi = computeBmi(w, h);

    if (bmi === null) {
      bmiValueEl.textContent = '—';
      if (h == null || !Number.isFinite(h)) {
        bmiStatusEl.textContent = 'Boy bilgisini kaydettiğinde BMI hesaplanır.';
      } else if (!Number.isFinite(w)) {
        bmiStatusEl.textContent = 'Mevcut kiloyu girdiğinde BMI hesaplanır.';
      } else {
        bmiStatusEl.textContent = 'BMI hesaplanamadı.';
      }
      return;
    }

    bmiValueEl.textContent = String(bmi);
    bmiStatusEl.textContent = 'Durum: ' + bmiCategoryLabel(bmi);
  }

  /**
   * Akıllı Fitness Asistanı için günlük + haftalık özet (harici API yok).
   */
  function getFitnessInsights() {
    var weekData = getWeekActivityData();
    var exMin = totalExerciseMinutes();
    var totals = weekData.totals;

    var hasTracking =
      state.caloriesConsumed > 0 ||
      state.waterGlasses > 0 ||
      exMin > 0 ||
      totals.calories > 0 ||
      totals.water > 0 ||
      totals.exerciseMinutes > 0;

    var bmi = computeBmi(state.currentWeight, state.heightCm);

    return {
      caloriesConsumed: state.caloriesConsumed,
      calorieGoal: state.calorieGoal,
      waterGlasses: state.waterGlasses,
      waterGoal: state.waterGoal,
      exerciseMinutes: exMin,
      exerciseGoal: state.exerciseGoalMinutes,
      currentWeight: state.currentWeight,
      goalWeight: state.goalWeight,
      bmi: bmi,
      bmiCategory: bmi === null ? null : bmiCategoryLabel(bmi),
      weeklyExerciseMinutes: totals.exerciseMinutes,
      weeklyTotals: totals,
      hasTracking: hasTracking
    };
  }

  /** Kural tabanlı öneriler — gerçek yapay zekâ API’si kullanılmaz */
  function generateAiSuggestions() {
    var ins = getFitnessInsights();
    var tips = [];

    if (!ins.hasTracking) {
      tips.push(
        'Henüz yeterli veri yok. Kalori, su ve egzersiz bilgisi ekledikçe sana daha iyi öneriler sunabilirim.'
      );
      return tips;
    }

    if (ins.weeklyExerciseMinutes > 150) {
      tips.push(
        'Bu hafta aktif bir performans göstermişsin. Haftalık egzersiz hedefin oldukça iyi ilerliyor.'
      );
    }

    if (ins.calorieGoal > 0 && ins.caloriesConsumed > ins.calorieGoal) {
      tips.push(
        'Kalori hedefini aşmışsın. Günün kalanında daha hafif öğünler tercih edebilirsin.'
      );
    } else if (
      ins.calorieGoal > 0 &&
      ins.caloriesConsumed > 0 &&
      ins.caloriesConsumed < ins.calorieGoal * 0.35
    ) {
      tips.push(
        'Bugün çok az kalori girmişsin. Verilerin doğruysa dengeli beslenmeye dikkat etmelisin.'
      );
    }

    if (ins.waterGoal > 0 && ins.waterGlasses < ins.waterGoal) {
      tips.push(
        'Bugün su hedefinin gerisindesin. Gün içinde 2-3 bardak daha su içmeyi deneyebilirsin.'
      );
    }

    if (ins.exerciseGoal > 0 && ins.exerciseMinutes < ins.exerciseGoal) {
      tips.push(
        'Bugünkü egzersiz hedefin henüz tamamlanmadı. Kısa bir yürüyüş veya esneme iyi bir başlangıç olabilir.'
      );
    }

    if (ins.bmiCategory === 'Normal') {
      tips.push(
        'BMI değerine göre dengeli bir aralıktasın. Düzenli egzersiz ve su takibini sürdürmen iyi olur.'
      );
    } else if (ins.bmiCategory && ins.bmiCategory !== 'Normal') {
      tips.push(
        'BMI yalnızca genel bir referanstır; kendini iyi hissettiğin rutinlere odaklanmak uzun vadede daha sürdürülebilir olur.'
      );
    }

    if (tips.length === 0) {
      tips.push(
        'Bugünkü kayıtlarına göre hedeflerine yakınsın veya onları tamamlamışsın. Bu dengeli tempoyu sürdürmek harika bir seçim olur.'
      );
    }

    return tips;
  }

  /**
   * Sohbet geçmişi — fitness state’ten bağımsız temel anahtar (son 20 mesaj).
   * Giriş yapılmış kullanıcı için kullanıcı bazlı son ekle bağlanır.
   */
  function getAiChatStorageKey() {
    var id = currentUserIdSafe();
    return id ? AI_CHAT_KEY_BASE + '_' + id : AI_CHAT_KEY_BASE;
  }

  /** Netlify üzerinde OpenAI çağrısı (yerelde `npx netlify dev` → localhost:8888). */
  var FITTRACK_AI_URL = '/.netlify/functions/fittrack-ai';

  var aiChatBusy = false;
  var typingIndicatorEl = null;

  function scrollChatToBottom() {
    if (!aiChatBox) return;
    aiChatBox.scrollTop = aiChatBox.scrollHeight;
  }

  function removeTypingIndicator() {
    if (typingIndicatorEl && typingIndicatorEl.parentNode) {
      typingIndicatorEl.parentNode.removeChild(typingIndicatorEl);
    }
    typingIndicatorEl = null;
  }

  function showTypingIndicator() {
    removeTypingIndicator();
    if (!aiChatBox) return;
    var wrap = document.createElement('div');
    wrap.className = 'ai-message ai-message-bot ai-typing-indicator';
    wrap.setAttribute('aria-live', 'polite');
    wrap.setAttribute('aria-busy', 'true');

    var label = document.createElement('div');
    label.className = 'ai-message-label';
    label.textContent = 'FitTrack AI';

    var body = document.createElement('div');
    body.className = 'ai-message-body ai-typing-body';
    body.textContent = 'Yazıyor...';

    wrap.appendChild(label);
    wrap.appendChild(body);
    aiChatBox.appendChild(wrap);
    typingIndicatorEl = wrap;
    scrollChatToBottom();
  }

  /** Asistana gönderilecek güvenli fitness özeti (OpenAI bağlamı). */
  function buildFitnessDataPayloadForAi() {
    var week = getWeekActivityData();
    var ins = getFitnessInsights();
    var sc = computeDailyFitTrackScore();
    var bmiVal = computeBmi(state.currentWeight, state.heightCm);
    return {
      calories: state.caloriesConsumed,
      calorieGoal: state.calorieGoal,
      water: state.waterGlasses,
      waterGoal: state.waterGoal,
      exerciseMinutes: ins.exerciseMinutes,
      exerciseGoalMinutes: state.exerciseGoalMinutes,
      weight: Number.isFinite(state.currentWeight) ? state.currentWeight : null,
      targetWeight: Number.isFinite(state.goalWeight) ? state.goalWeight : null,
      bmi: bmiVal,
      weeklySummary: {
        totalCalories: week.totals.calories,
        totalWater: week.totals.water,
        totalExerciseMinutes: week.totals.exerciseMinutes
      },
      score: sc.total
    };
  }

  /**
   * OpenAI için önceki mesajlar (son eklenen kullanıcı mesajı çıkarılır — API `message` alanında taşınır).
   */
  function buildChatHistoryForOpenAI() {
    var msgs = loadAiChatMessages();
    if (msgs.length > 0 && msgs[msgs.length - 1].role === 'user') {
      msgs = msgs.slice(0, -1);
    }
    return msgs.slice(-12).map(function (m) {
      return {
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.text
      };
    });
  }

  function buildChatHistoryForOpenAISuggest() {
    return loadAiChatMessages()
      .slice(-12)
      .map(function (m) {
        return {
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.text
        };
      });
  }

  function fetchFittrackAi(messageText, chatHistory) {
    return fetch(FITTRACK_AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        message: messageText,
        fitnessData: buildFitnessDataPayloadForAi(),
        chatHistory: chatHistory || []
      })
    })
      .then(function (res) {
        return res.text().then(function (text) {
          var data = {};
          try {
            data = text ? JSON.parse(text) : {};
          } catch (e) {
            return { error: 'Sunucu yanıtı okunamadı.' };
          }
          if (!res.ok) {
            return { error: (data && data.error) || 'İstek başarısız (' + res.status + ').' };
          }
          if (data && typeof data.reply === 'string' && data.reply.trim()) {
            return { reply: data.reply.trim() };
          }
          return { error: (data && data.error) || 'Yanıt alınamadı.' };
        });
      })
      .catch(function (err) {
        return { error: err && err.message ? err.message : 'Ağ hatası.' };
      });
  }

  function tryCloudAiThenFallback(userQuestion, getHistoryFn, fallbackFn) {
    showTypingIndicator();
    aiChatBusy = true;
    var history = typeof getHistoryFn === 'function' ? getHistoryFn() : [];
    return fetchFittrackAi(userQuestion, history)
      .then(function (result) {
        removeTypingIndicator();
        if (result.reply) {
          renderChatMessage('bot', result.reply);
          scrollChatToBottom();
          return;
        }
        showToast('AI servisine ulaşılamadı, yerel öneri gösteriliyor.', false);
        var ans = fallbackFn(userQuestion);
        if (ans) {
          renderChatMessage('bot', ans);
          scrollChatToBottom();
        }
      })
      .catch(function () {
        removeTypingIndicator();
        showToast('AI servisine ulaşılamadı, yerel öneri gösteriliyor.', false);
        var ans = fallbackFn(userQuestion);
        if (ans) {
          renderChatMessage('bot', ans);
          scrollChatToBottom();
        }
      })
      .finally(function () {
        removeTypingIndicator();
        aiChatBusy = false;
      });
  }

  function loadAiChatMessages() {
    try {
      var raw = localStorage.getItem(getAiChatStorageKey());
      if (!raw) return [];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .filter(function (x) {
          return x && (x.role === 'user' || x.role === 'bot') && typeof x.text === 'string';
        })
        .slice(-20);
    } catch (err) {
      return [];
    }
  }

  function saveAiChatMessages(messages) {
    try {
      localStorage.setItem(getAiChatStorageKey(), JSON.stringify(messages.slice(-20)));
    } catch (err) {
      showToast('Sohbet geçmişi kaydedilemedi (depolama dolu olabilir).', false);
    }
  }

  function appendAiChatRecord(role, text) {
    var msgs = loadAiChatMessages();
    msgs.push({ role: role, text: text });
    saveAiChatMessages(msgs);
  }

  function clearAiChatHistory() {
    try {
      localStorage.removeItem(getAiChatStorageKey());
    } catch (err) {}
    removeTypingIndicator();
    if (aiChatBox) aiChatBox.innerHTML = '';
    showToast('Sohbet geçmişi temizlendi.', true);
  }

  function restoreAiChatFromStorage() {
    if (!aiChatBox) return;
    aiChatBox.innerHTML = '';
    loadAiChatMessages().forEach(function (m) {
      renderChatMessage(m.role === 'user' ? 'user' : 'bot', m.text, true);
    });
    scrollChatToBottom();
  }

  /** Günlük FitTrack skoru (100 üzerinden); alt bileşenler su 25, egzersiz 35, kalori dengesi 25, kilo/BMI 15 */
  function computeDailyFitTrackScore() {
    var ins = getFitnessInsights();
    var waterPts = 0;
    if (ins.waterGoal > 0) {
      waterPts = Math.round(Math.min(1, ins.waterGlasses / ins.waterGoal) * 25);
    }

    var exPts = 0;
    if (ins.exerciseGoal > 0) {
      exPts = Math.round(Math.min(1, ins.exerciseMinutes / ins.exerciseGoal) * 35);
    }

    var calPts = 0;
    var g = ins.calorieGoal;
    var c = ins.caloriesConsumed;
    if (g > 0) {
      var ratio = c / g;
      if (c <= 0) calPts = 5;
      else if (ratio > 1.15) calPts = 8;
      else if (ratio > 1.05) calPts = 14;
      else if (ratio >= 0.35 && ratio <= 1.05) calPts = 25;
      else calPts = 12;
    } else {
      calPts = 10;
    }

    var wbPts = 0;
    if (Number.isFinite(ins.currentWeight)) wbPts += 7;
    if (ins.bmi !== null) wbPts += 8;
    wbPts = Math.min(15, wbPts);

    var total = Math.min(100, waterPts + exPts + calPts + wbPts);
    return {
      total: total,
      water: waterPts,
      exercise: exPts,
      calorie: calPts,
      weightBmi: wbPts
    };
  }

  function scoreSummaryLine(scoreObj) {
    var ins = getFitnessInsights();
    var parts = [];
    if (ins.waterGoal > 0) {
      if (scoreObj.water >= 22) parts.push('su tarafı güçlü');
      else if (scoreObj.water < 12) parts.push('su tarafında payını artırabilirsin');
    }
    if (ins.exerciseGoal > 0) {
      if (scoreObj.exercise >= 28) parts.push('egzersiz hedefine yakınsın');
      else if (scoreObj.exercise < 14) parts.push('egzersiz için bugün hâlâ payın var');
    }
    if (parts.length === 0) return 'Kayıtlarını güncelledikçe skor daha da anlamlı olur.';
    return parts.slice(0, 2).join('; ') + '.';
  }

  function formatAiReply(statusLine, recommendationLine, motivationLine) {
    return (
      'Durum:\n' +
      statusLine +
      '\n\nÖneri:\n' +
      recommendationLine +
      '\n\nMotivasyon:\n' +
      motivationLine
    );
  }

  function randomMotivationPick() {
    var pool = [
      'Küçük adımlar büyük alışkanlıkları oluşturur.',
      'İlerleme mükemmellik değil; tutarlılıktır.',
      'Bugün gösterdiğin çaba yarının enerjisidir.',
      'Verini güncel tutmak kararlarını kolaylaştırır.',
      'Her bardak su ve her dakika hareket bir yatırım.'
    ];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function buildSmartDailyRecommendation() {
    var ins = getFitnessInsights();
    var tips = [];
    if (ins.waterGoal > 0 && ins.waterGlasses < ins.waterGoal) {
      tips.push(
        'Su için hedefine yaklaşmak adına gün içinde birkaç bardak daha planlayabilirsin.'
      );
    }
    if (ins.exerciseGoal > 0 && ins.exerciseMinutes < ins.exerciseGoal) {
      tips.push('10–15 dakikalık tempolu yürüyüş veya esneme egzersiz payını tamamlamana yardım eder.');
    }
    if (ins.calorieGoal > 0 && ins.caloriesConsumed > ins.calorieGoal) {
      tips.push('Kalori hedefinin üzerindeysen bir sonraki öğünde hafif seçimler dengeyi korur.');
    } else if (ins.calorieGoal > 0 && ins.caloriesConsumed > 0 && ins.caloriesConsumed < ins.calorieGoal * 0.35) {
      tips.push('Kalori girişin düşük görünüyorsa öğünlerini tahmini olarak eklemeyi unutma.');
    }
    if (tips.length === 0 && ins.hasTracking) {
      tips.push('Bugün genel hatlarıyla dengeli görünüyorsun; kayıtlarını güncel tutmaya devam.');
    }
    if (tips.length === 0) {
      tips.push('Kalori, su veya egzersiz ekleyerek kişisel önerileri güçlendirebilirsin.');
    }
    return tips.slice(0, 2).join(' ');
  }

  function normalizeAiQuestion(raw) {
    return String(raw || '').trim().toLowerCase();
  }

  function keywordHit(q, words) {
    for (var i = 0; i < words.length; i++) {
      if (q.indexOf(words[i]) !== -1) return true;
    }
    return false;
  }

  /**
   * Soruyu anahtar kelime sırasına göre sınıflandırır (harici API yok).
   * @returns {'empty'|'score'|'motivation'|'gaps'|'progress'|'weekly'|'water'|'exercise'|'calorie'|'weight'|'daily_summary'|'general'|'unknown'}
   */
  function analyzeUserQuestion(question) {
    var q = normalizeAiQuestion(question);
    if (!q) return 'empty';

    var scoreKw = ['fittrack skorum', 'fittrack skor', 'skorum kaç', 'skor kaç', 'günlük skorum', 'skorum nedir'];
    var motivationKw = ['motivasyon', 'motive', 'moral', 'sıkıldım', 'devam edemiyorum', 'pes etmek', 'vazgeçmek'];
    var gapsKw = ['eksiklerim', 'eksikler', 'eksik kalan', 'ne eksik', 'zayıf taraf'];
    var progressKw = [
      'hedeflerime ne kadar',
      'hedeflerim nasıl',
      'hedefime yakın',
      'ne kadar yakınsın',
      'ne kadar yakın',
      'ilerlem',
      'hedefe uzaklık'
    ];
    var weeklyKw = [
      'haftalık',
      'bu hafta',
      'haftam',
      'hafta durumum',
      'performans',
      'rapor',
      'gelişim'
    ];
    var waterKw = ['su', 'bardak', 'içtim', 'susuz', 'hidrasyon', 'su durum'];
    var exerciseKw = [
      'egzersiz',
      'spor',
      'antrenman',
      'yürüyüş',
      'kardiyo',
      'hareket',
      'ağırlık',
      'ne çalışayım',
      'çalışayım'
    ];
    var calorieKw = ['kalori', 'yemek', 'beslenme', 'fazla', 'enerji', 'fazla yedim', 'kalori durum', 'dengeli mi'];
    var weightKw = ['kilo', 'bmi', 'vücut kitle', 'hedef kilo', 'zayıflama', 'kilo vermek', 'vücut ağırlık'];

    var dailyKw = [
      'durumumu analiz',
      'bugünkü durum',
      'genel durum',
      'durumum nasıl',
      'durumumu özet',
      'bugün özet'
    ];
    var generalKw = ['bugün ne yapmalıyım', 'ne yapmalıyım', 'öneri', 'tavsiye', 'plan', 'bugün için'];

    if (keywordHit(q, scoreKw)) return 'score';
    if (keywordHit(q, motivationKw)) return 'motivation';
    if (keywordHit(q, gapsKw)) return 'gaps';
    if (keywordHit(q, progressKw)) return 'progress';
    if (keywordHit(q, weeklyKw)) return 'weekly';
    if (keywordHit(q, waterKw)) return 'water';
    if (keywordHit(q, exerciseKw)) return 'exercise';

    var calorieHit = keywordHit(q, calorieKw);
    if (
      !calorieHit &&
      q.indexOf('biraz') === -1 &&
      (q.indexOf(' az ') !== -1 || q.indexOf('az ') === 0)
    ) {
      calorieHit = true;
    }
    if (calorieHit) return 'calorie';

    if (keywordHit(q, weightKw)) return 'weight';
    if (keywordHit(q, dailyKw)) return 'daily_summary';
    if (keywordHit(q, generalKw)) return 'general';
    return 'unknown';
  }

  function collectGapBullets() {
    var ins = getFitnessInsights();
    var sc = computeDailyFitTrackScore();
    var gaps = [];

    if (ins.waterGoal > 0 && ins.waterGlasses < ins.waterGoal) {
      gaps.push('Su hedefin henüz dolmamış (' + ins.waterGlasses + '/' + ins.waterGoal + ' bardak).');
    }
    if (ins.exerciseGoal > 0 && ins.exerciseMinutes < ins.exerciseGoal) {
      gaps.push(
        'Günlük egzersiz payında eksik var (' + ins.exerciseMinutes + '/' + ins.exerciseGoal + ' dk).'
      );
    }
    if (ins.calorieGoal > 0 && ins.caloriesConsumed <= 0) {
      gaps.push('Kalori tarafında bugün henüz kayıt yok.');
    } else if (ins.calorieGoal > 0 && ins.caloriesConsumed > ins.calorieGoal * 1.05) {
      gaps.push('Kalori kaydın günlük hedefinin biraz üzerinde görünüyor.');
    } else if (ins.calorieGoal > 0 && ins.caloriesConsumed > 0 && ins.caloriesConsumed < ins.calorieGoal * 0.35) {
      gaps.push('Kalori girişin hedefe göre düşük kalabilir (kayıtları kontrol etmek iyi olur).');
    }
    if (!Number.isFinite(ins.currentWeight)) {
      gaps.push('Kilo takibi için güncel kilo eklenmemiş.');
    }
    if (ins.bmi === null && Number.isFinite(ins.currentWeight)) {
      gaps.push('BMI özeti için boy (cm) bilgisi eksik.');
    }
    if (ins.weeklyExerciseMinutes > 0 && ins.weeklyExerciseMinutes < 90) {
      gaps.push('Haftalık hareket toplamı orta seviyenin altında; küçük günlük eklemeler fark yaratır.');
    }

    if (gaps.length === 0) {
      if (!ins.hasTracking) {
        gaps.push('Henüz kalori, su veya egzersiz kaydı az; takip ekledikçe eksikler daha net görünür.');
      } else if (sc.total >= 85) {
        gaps.push('Bugün için belirgin bir boşluk görmüyorum; tempoyu korumak mantıklı.');
      } else {
        gaps.push('Genel hatlar iyi; FitTrack skorunu yükseltmek için su ve hareket payına bakabilirsin.');
      }
    }
    return gaps.slice(0, 4);
  }

  function buildScoreAnswerText() {
    var sc = computeDailyFitTrackScore();
    var ins = getFitnessInsights();
    var status =
      'Günlük FitTrack skorun ' +
      sc.total +
      '/100. (Su ' +
      sc.water +
      '/25, egzersiz ' +
      sc.exercise +
      '/35, kalori dengesi ' +
      sc.calorie +
      '/25, kilo/BMI bilgisi ' +
      sc.weightBmi +
      '/15.) ' +
      scoreSummaryLine(sc);

    var rec =
      buildSmartDailyRecommendation() +
      (ins.hasTracking ? '' : ' Daha net öneriler için bugünkü kalori, su ve egzersizi güncellemeyi deneyebilirsin.');

    return formatAiReply(status, rec, randomMotivationPick());
  }

  function buildMotivationAnswerText() {
    var ins = getFitnessInsights();
    var sc = computeDailyFitTrackScore();
    var status =
      'Motivasyon için önce küçük bir kazanın seçmek işe yarar. FitTrack skorun ' +
      sc.total +
      '/100; verdiğin kayıtlar zaten bir yön gösteriyor.';

    var recParts = [];
    if (ins.exerciseGoal > 0 && ins.exerciseMinutes < ins.exerciseGoal) {
      recParts.push('Bugün için 10 dakikalık bir yürüyüş bile momentumu geri getirir.');
    }
    if (ins.waterGoal > 0 && ins.waterGlasses < ins.waterGoal) {
      recParts.push('Su içmek basit bir “kazan kontrol listesi” öğesi olabilir.');
    }
    if (recParts.length === 0) {
      recParts.push('Kayıtlarına bakıp tek bir alanı (su veya hareket) seçip bugün tamamlamaya odaklan.');
    }

    return formatAiReply(status, recParts.slice(0, 2).join(' '), randomMotivationPick());
  }

  function buildGapsAnswerText() {
    var gaps = collectGapBullets();
    var status = 'Kayıtlarına göre öne çıkan boşluklar bunlar:';
    var rec =
      gaps.map(function (g, idx) {
        return idx + 1 + ') ' + g;
      }).join('\n') +
      '\n\n' +
      buildSmartDailyRecommendation();

    return formatAiReply(status, rec, randomMotivationPick());
  }

  function buildProgressAnswerText() {
    var ins = getFitnessInsights();
    var lines = [];
    if (ins.calorieGoal > 0) {
      var cp = Math.round(Math.min(100, (ins.caloriesConsumed / ins.calorieGoal) * 100));
      lines.push('Kalori hedefine yaklaşık %' + cp + ' mesafede görünüyorsun (' + ins.caloriesConsumed + '/' + ins.calorieGoal + ' kcal).');
    }
    if (ins.waterGoal > 0) {
      var wp = Math.round(Math.min(100, (ins.waterGlasses / ins.waterGoal) * 100));
      lines.push('Su hedefin yaklaşık %' + wp + ' (' + ins.waterGlasses + '/' + ins.waterGoal + ' bardak).');
    }
    if (ins.exerciseGoal > 0) {
      var ep = Math.round(Math.min(100, (ins.exerciseMinutes / ins.exerciseGoal) * 100));
      lines.push('Egzersiz payın yaklaşık %' + ep + ' (' + ins.exerciseMinutes + '/' + ins.exerciseGoal + ' dk).');
    }
    if (Number.isFinite(ins.currentWeight) && Number.isFinite(ins.goalWeight)) {
      var diff = ins.currentWeight - ins.goalWeight;
      if (Math.abs(diff) < 0.05) {
        lines.push('Kilo ve hedef kilon birbirine çok yakın görünüyor.');
      } else if (diff > 0) {
        lines.push(
          'Hedef kilona göre yaklaşık ' +
            Math.abs(diff).toFixed(1) +
            ' kg fark var (genel takip çerçevesinde).'
        );
      } else {
        lines.push('Kayıtlı hedef kilonun üzerindesin; bu yalnızca rakamsal fark olarak not edilir.');
      }
    }

    if (lines.length === 0) {
      lines.push(
        'Hedeflerini görebilmem için ayarlardaki kalori / su / egzersiz hedefleri ve kilo bilgisini güncel tutman yeterli.'
      );
    }

    var sc = computeDailyFitTrackScore();
    var status =
      'Hedeflerine uzaklık günlük kayıtlar üzerinden kabaca şöyle özetlenebilir: ' +
      lines.join(' ') +
      ' Günlük FitTrack skorun ' +
      sc.total +
      '/100.';

    return formatAiReply(status, buildSmartDailyRecommendation(), randomMotivationPick());
  }

  function buildDailySummaryAnswerText() {
    var ins = getFitnessInsights();
    var sc = computeDailyFitTrackScore();
    var bits = [];
    bits.push('FitTrack skoru ' + sc.total + '/100.');
    if (ins.calorieGoal > 0) {
      bits.push('Kalori ' + ins.caloriesConsumed + '/' + ins.calorieGoal + ' kcal.');
    }
    if (ins.waterGoal > 0) {
      bits.push('Su ' + ins.waterGlasses + '/' + ins.waterGoal + ' bardak.');
    }
    if (ins.exerciseGoal > 0) {
      bits.push('Egzersiz ' + ins.exerciseMinutes + '/' + ins.exerciseGoal + ' dk.');
    }
    var status =
      'Bugünün genel görünümü: ' + bits.join(' ') + ' ' + scoreSummaryLine(sc);

    return formatAiReply(status, buildSmartDailyRecommendation(), randomMotivationPick());
  }

  function buildWeeklyAnswerText() {
    var wb = getWeekActivityData();
    var t = wb.totals;
    var ins = getFitnessInsights();

    var status =
      'Bu hafta toplamda yaklaşık ' +
      t.exerciseMinutes +
      ' dk egzersiz, ' +
      t.water +
      ' bardak su ve ' +
      t.calories +
      ' kcal kaydı görünüyor.';

    var bestIdx = -1;
    var bestEx = -1;
    var i;
    for (i = 0; i < wb.daily.length; i++) {
      var ex = wb.daily[i].exerciseMinutes;
      if (ex > bestEx) {
        bestEx = ex;
        bestIdx = i;
      }
    }

    var recParts = [];
    if (bestIdx >= 0 && bestEx > 0) {
      recParts.push(
        'En aktif görünen günün ' + WEEKDAY_LONG[bestIdx] + ' (' + bestEx + ' dk egzersiz); küçük tutarlılıklar haftayı taşır.'
      );
    } else {
      recParts.push(
        'Bu hafta grafikte belirgin egzersiz dakikası henüz yok; kısa yürüyüşle ilk kaydı eklemek iyi bir başlangıç olur.'
      );
    }

    if (t.exerciseMinutes > 150) {
      recParts.push('Haftalık hareket toplamın güçlü; dinlenme ve su takibini de sürdürmek dengeyi korur.');
    } else if (t.exerciseMinutes > 0 && t.exerciseMinutes < 90) {
      recParts.push('Haftalık egzersiz hâlâ ortanın altında; günlük 10–15 dk eklemeler hedefe yaklaştırır.');
    }

    if (ins.waterGoal > 0 && ins.waterGlasses < ins.waterGoal) {
      recParts.push('Bugün su tarafında hedefe tam yaklaşmak için birkaç bardak daha ekleyebilirsin.');
    }

    return formatAiReply(status, recParts.slice(0, 3).join(' '), randomMotivationPick());
  }

  function buildWaterAnswerText() {
    var g = state.waterGoal;
    var cur = state.waterGlasses;
    var sc = computeDailyFitTrackScore();
    if (!Number.isFinite(g) || g <= 0) {
      return formatAiReply(
        'Su hedefin henüz tanımlı değil; bardak hedefi olunca takibi kolaylaşır.',
        'Hedef Ayarlarından günlük bardak sayını ayarlayıp yeniden sorabilirsin.',
        randomMotivationPick()
      );
    }
    if (cur >= g) {
      return formatAiReply(
        'Bugün ' + cur + '/' + g + ' bardak ile su hedefini tamamlamış görünüyorsun. Günlük FitTrack skorunda su katkın tam.',
        'Öğün aralarında da küçük yudumlar alışkanlığı sürdürmene yardım eder.',
        randomMotivationPick()
      );
    }
    var left = g - cur;
    var pct = Math.round((cur / g) * 100);
    return formatAiReply(
      'Bugün su hedefinin yaklaşık %' +
        pct +
        "'sini tamamladın (" +
        cur +
        '/' +
        g +
        ' bardak). Günlük skorda su katkın ' +
        sc.water +
        '/25.',
      left +
        ' bardak daha eklemek hedefe yaklaştırır; telefonuna basit bir hatırlatıcı koymak işe yarayabilir.',
      randomMotivationPick()
    );
  }

  function buildExerciseAnswerText() {
    var goal = state.exerciseGoalMinutes;
    var min = totalExerciseMinutes();
    var sc = computeDailyFitTrackScore();
    if (!Number.isFinite(goal) || goal <= 0) {
      return formatAiReply(
        'Günlük egzersiz dakika hedefi ayarlanmadığı için bugünkü payını yüzde olarak netleştiremiyorum.',
        'Hedefi tanımlayıp kısa bir yürüyüş veya esneme ile başlayabilirsin.',
        randomMotivationPick()
      );
    }
    if (min >= goal) {
      return formatAiReply(
        'Bugün ' +
          min +
          '/' +
          goal +
          ' dk ile egzersiz hedefini tamamlamışsın; skorda egzersiz katkın ' +
          sc.exercise +
          '/35.',
        'İstersen düşük şiddette mobilite veya esneme ile günü yumuşakça kapatabilirsin.',
        randomMotivationPick()
      );
    }
    var left = goal - min;
    return formatAiReply(
      'Şu an ' +
        min +
        ' dk hareket kaydın var; günlük hedefin ' +
        goal +
        ' dk ve yaklaşık ' +
        left +
        ' dk pay kaldı. Skorda egzersiz katkın ' +
        sc.exercise +
        '/35.',
      '• 10 dk tempolu yürüyüş\n• 5–8 dk esneme\n• Kısa merdiven / hafif tempolu hareket\nBu seçeneklerden biri günü dengeler.',
      randomMotivationPick()
    );
  }

  function buildCalorieAnswerText() {
    var goal = state.calorieGoal;
    var c = state.caloriesConsumed;
    var sc = computeDailyFitTrackScore();
    if (!Number.isFinite(goal) || goal <= 0) {
      return formatAiReply(
        'Kalori hedefi tanımlı değil; günlük dengeni yüzde olarak yorumlamak zor.',
        'Hedefini girip öğün kayıtlarını güncellediğinde daha net geri bildirim verebilirim.',
        randomMotivationPick()
      );
    }
    if (c > goal) {
      return formatAiReply(
        'Bugün ' +
          c +
          '/' +
          goal +
          ' kcal kaydı var; hedefin biraz üzerindesin. Kalori dengesi skor katkın ' +
          sc.calorie +
          '/25.',
        'Günün kalanında doyurucu ama daha hafif seçimler ve tek porsiyon odaklı kararlar dengeyi kolaylaştırır.',
        randomMotivationPick()
      );
    }
    if (c > 0 && c < goal * 0.35) {
      return formatAiReply(
        'Bugün ' +
          c +
          '/' +
          goal +
          ' kcal görünüyor; hedefe göre giriş düşük kalabilir (kayıtları doğrulamak iyi olur). Kalori skor katkın ' +
          sc.calorie +
          '/25.',
        'Öğün atlama yerine düzenli ve dengeli öğünleri tahmini olarak işaretlemek takibi düzeltir.',
        randomMotivationPick()
      );
    }
    if (c <= 0) {
      return formatAiReply(
        'Bugün için henüz kalori kaydı yok; kalori skor katkın düşük başlıyor.',
        'İlk öğününden sonra yaklaşık değeri eklemek günlük görünümü netleştirir.',
        randomMotivationPick()
      );
    }
    var pct = Math.round((c / goal) * 100);
    return formatAiReply(
      'Kalori kaydın ' +
        c +
        '/' +
        goal +
        ' kcal (yaklaşık %' +
        pct +
        '). Dengeli bir aralıkta görünüyorsun; kalori skor katkın ' +
        sc.calorie +
        '/25.',
        'Aynı tempoda protein-lif dengesine dikkat etmek gün boyu tokluğu destekler (genel yaşam tarzı önerisi).',
      randomMotivationPick()
    );
  }

  function buildWeightBmiAnswerText() {
    var cur = state.currentWeight;
    var gw = state.goalWeight;
    var bmi = computeBmi(cur, state.heightCm);
    var sc = computeDailyFitTrackScore();

    var statusParts = [];
    if (Number.isFinite(cur)) {
      statusParts.push('Mevcut kilon yaklaşık ' + cur + ' kg.');
    } else {
      statusParts.push('Güncel kilo kaydı yok; kilo/BMI skor katkın sınırlı kalır.');
    }
    if (Number.isFinite(gw)) {
      statusParts.push('Kayıtlı hedef kilon ' + gw + ' kg.');
    }

    if (bmi !== null) {
      var cat = bmiCategoryLabel(bmi);
      statusParts.push(
        'BMI yaklaşık ' +
          bmi +
          ' (FitTrack referans etiketi: ' +
          cat +
          '). Skorda kilo/BMI katkısı ' +
          sc.weightBmi +
          '/15.'
      );
      if (cat === 'Normal') {
        statusParts.push('Bu genel bir referanstır; mevcut rutini sürdürmek ve su/hareketi korumak mantıklı.');
      } else {
        statusParts.push(
          'Bu yalnızca genel çerçevedir; sürdürülebilir tempoda beslenme ve hareket düzenine odaklanmak uzun vadede daha rahattır.'
        );
      }
    } else {
      statusParts.push('BMI için hem kilo hem boy (cm) gerekiyor; bilgi tamamlanınca özet netleşir.');
    }

    var rec =
      'Kişisel hedefler için uzman görüşü her zaman değerlidir; FitTrack verilerini düzenli güncellemek genel yaşam tarzı takibini kolaylaştırır.';

    return formatAiReply(statusParts.join(' '), rec, randomMotivationPick());
  }

  function buildGeneralPlanAnswerText() {
    var tips = generateAiSuggestions().slice(0, 3);
    var pad = [
      'Kısa molalarda su içmeyi hatırlayabilirsin.',
      '10 dakikalık bir yürüyüş günü ferahlatır.',
      'Kayıtlarını gün sonunda gözden geçirmek motivasyonunu güçlendirir.'
    ];
    var i = 0;
    while (tips.length < 3 && i < pad.length) {
      tips.push(pad[i]);
      i++;
    }

    var sc = computeDailyFitTrackScore();
    var bullet =
      tips
        .map(function (line, idx) {
          return idx + 1 + ') ' + line;
        })
        .join('\n') +
      '\n\n' +
      buildSmartDailyRecommendation();

    return formatAiReply(
      'Bugün için özet plan: günlük FitTrack skorun ' + sc.total + '/100; verilerine göre şu adımlar öne çıkıyor.',
      bullet,
      randomMotivationPick()
    );
  }

  function buildUnknownAnswerText() {
    var lines = [
      'Bu konuda net bir analiz yapamadım. Kalori, su, egzersiz, kilo/BMI veya haftalık durumunla ilgili sorarsan daha iyi yardımcı olurum.',
      '',
      'Örnek sorular:',
      '• Bugünkü durumum nasıl?',
      '• Su hedefim ne durumda?',
      '• Bana egzersiz önerir misin?'
    ];

    return formatAiReply(lines[0], lines.slice(2).join('\n'), randomMotivationPick());
  }

  /** Veriye göre doğal dilde cevap üretir (kural tabanlı). */
  function answerAiQuestion(question) {
    if (window.FT_SAFETY && window.FT_SAFETY.isBlocked(question)) {
      return window.FT_SAFETY.blockedReply();
    }
    if (window.FT_SAFETY && window.FT_SAFETY.needsDoctorWarning(question)) {
      var platformAns =
        window.FT_COACH && window.FT_COACH.tryAnswer
          ? window.FT_COACH.tryAnswer(question)
          : null;
      var prefix = window.FT_SAFETY.doctorWarningPrefix();
      if (platformAns) return prefix + platformAns;
    }
    if (window.FT_COACH && typeof window.FT_COACH.tryAnswer === 'function') {
      var coachAns = window.FT_COACH.tryAnswer(question);
      if (coachAns) return coachAns;
    }
    var cat = analyzeUserQuestion(question);
    switch (cat) {
      case 'empty':
        return '';
      case 'score':
        return buildScoreAnswerText();
      case 'motivation':
        return buildMotivationAnswerText();
      case 'gaps':
        return buildGapsAnswerText();
      case 'progress':
        return buildProgressAnswerText();
      case 'daily_summary':
        return buildDailySummaryAnswerText();
      case 'weekly':
        return buildWeeklyAnswerText();
      case 'water':
        return buildWaterAnswerText();
      case 'exercise':
        return buildExerciseAnswerText();
      case 'calorie':
        return buildCalorieAnswerText();
      case 'weight':
        return buildWeightBmiAnswerText();
      case 'general':
        return buildGeneralPlanAnswerText();
      default:
        return buildUnknownAnswerText();
    }
  }

  /** @param {'user'|'bot'} type */
  function renderChatMessage(type, text, skipPersist) {
    if (!aiChatBox || text === undefined || text === null || text === '') return;

    var wrap = document.createElement('div');
    wrap.className = 'ai-message ' + (type === 'user' ? 'ai-message-user' : 'ai-message-bot');

    var label = document.createElement('div');
    label.className = 'ai-message-label';
    label.textContent = type === 'user' ? 'Sen' : 'FitTrack AI';

    var body = document.createElement('div');
    body.className = 'ai-message-body';
    body.textContent = text;

    wrap.appendChild(label);
    wrap.appendChild(body);
    aiChatBox.appendChild(wrap);
    scrollChatToBottom();

    if (!skipPersist) {
      appendAiChatRecord(type === 'user' ? 'user' : 'bot', text);
    }
  }

  function handleAiQuestionSubmit(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (!aiQuestionInput) return;
    if (aiChatBusy) return;

    var q = aiQuestionInput.value.trim();
    if (!q) {
      showToast('Lütfen asistana bir soru yaz.', false);
      aiQuestionInput.focus();
      return;
    }

    renderChatMessage('user', q);
    aiQuestionInput.value = '';
    tryCloudAiThenFallback(q, buildChatHistoryForOpenAI, answerAiQuestion);
  }

  function buildLocalSuggestReply() {
    var items = generateAiSuggestions().slice(0, 4);
    var smart = buildSmartDailyRecommendation();
    var sc = computeDailyFitTrackScore();
    var bullets = items
      .map(function (line, idx) {
        return idx + 1 + ') ' + line;
      })
      .join('\n');

    return formatAiReply(
      'Kayıtlarına göre günlük FitTrack skorun ' + sc.total + '/100; aşağıdaki maddeler bugün için öne çıkıyor.',
      bullets + (smart ? '\n\nEk günlük öneri: ' + smart : ''),
      randomMotivationPick()
    );
  }

  function handleAiSuggestClick() {
    if (aiChatBusy) return;
    var prompt =
      'Güncel FitTrack verilerime göre bugün için Durum, Öneri ve Motivasyon başlıklarıyla kısa ve net bir özet ver. "Öneri Al" düğmesine basıldı.';
    tryCloudAiThenFallback(prompt, buildChatHistoryForOpenAISuggest, function () {
      return buildLocalSuggestReply();
    });
  }

  /** Dashboard mini haftalık egzersiz grafiği */
  function renderDashWeeklyChart() {
    var root = document.getElementById('dash-week-chart');
    if (!root) return;

    var weekBundle = getWeekActivityData();
    var dailyEx = weekBundle.dailyEx;
    var weekDates = weekBundle.weekDates;
    var today = todayISO();
    var hasData =
      weekBundle.totals.exerciseMinutes +
        weekBundle.totals.calories +
        weekBundle.totals.water >
      0;

    if (!hasData) {
      root.innerHTML =
        '<p class="dash-week-chart-empty">Bu hafta veri ekledikçe grafik dolacak.</p>';
      return;
    }

    var maxEx = 0;
    for (var m = 0; m < 7; m++) maxEx = Math.max(maxEx, dailyEx[m]);
    var scaleMax = maxEx > 0 ? maxEx : 1;

    root.innerHTML = '';
    for (var j = 0; j < 7; j++) {
      var ex = dailyEx[j];
      var col = document.createElement('div');
      col.className = 'dash-week-col';
      if (weekDates[j] === today) col.classList.add('is-today');

      var track = document.createElement('div');
      track.className = 'dash-week-track';

      var bar = document.createElement('span');
      bar.className = 'dash-week-bar';
      var hPct =
        ex <= 0 ? 8 : Math.max(12, Math.round((ex / scaleMax) * 100));
      bar.style.height = hPct + '%';

      track.appendChild(bar);

      var lab = document.createElement('span');
      lab.className = 'dash-week-label';
      lab.textContent = WEEKDAY_SHORT[j];

      col.appendChild(track);
      col.appendChild(lab);
      root.appendChild(col);
    }
  }

  /** Haftalık grafik ve özet (activityHistory + bugünün canlı verisi) */
  function renderWeeklyReport() {
    var root = document.getElementById('week-chart-root');
    var emptyEl = document.getElementById('weekly-empty-msg');
    var panelEl = document.getElementById('weekly-chart-panel');
    var sumEl = document.getElementById('weekly-summary-lines');
    if (!root || !emptyEl || !panelEl || !sumEl) return;

    var weekBundle = getWeekActivityData();
    var weekDates = weekBundle.weekDates;
    var totals = weekBundle.totals;
    var dailyEx = weekBundle.dailyEx;
    var today = todayISO();

    var hasData = totals.calories + totals.water + totals.exerciseMinutes > 0;

    if (!hasData) {
      emptyEl.hidden = false;
      panelEl.hidden = true;
      root.innerHTML = '';
      sumEl.innerHTML = '';
      return;
    }

    emptyEl.hidden = true;
    panelEl.hidden = false;

    var maxEx = 0;
    for (var m = 0; m < 7; m++) maxEx = Math.max(maxEx, dailyEx[m]);
    var scaleMax = maxEx > 0 ? maxEx : 1;

    root.innerHTML = '';
    for (var j = 0; j < 7; j++) {
      var isoD = weekDates[j];
      var ex = dailyEx[j];

      var col = document.createElement('div');
      col.className = 'week-col';
      if (isoD === today) col.classList.add('is-today');

      var track = document.createElement('div');
      track.className = 'week-bar-track';

      var bar = document.createElement('div');
      bar.className = 'week-bar';
      var hPct;
      if (maxEx <= 0) {
        hPct = 6;
      } else if (ex <= 0) {
        hPct = 8;
      } else {
        hPct = Math.max(10, Math.round((ex / scaleMax) * 100));
      }
      bar.style.height = hPct + '%';
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', String(scaleMax));
      bar.setAttribute('aria-valuenow', String(ex));
      bar.setAttribute(
        'aria-label',
        WEEKDAY_SHORT[j] + ' günü ' + ex + ' dakika egzersiz'
      );

      track.appendChild(bar);

      var val = document.createElement('span');
      val.className = 'week-value';
      val.textContent = ex + ' dk';

      var lab = document.createElement('span');
      lab.className = 'week-label';
      lab.textContent = WEEKDAY_SHORT[j];

      col.appendChild(track);
      col.appendChild(val);
      col.appendChild(lab);
      root.appendChild(col);
    }

    var bestIdx = -1;
    if (maxEx > 0) {
      for (var b = 0; b < 7; b++) {
        if (dailyEx[b] > 0 && (bestIdx < 0 || dailyEx[b] > dailyEx[bestIdx])) bestIdx = b;
      }
    }

    sumEl.innerHTML = '';
    var p1 = document.createElement('p');
    p1.className = 'weekly-stat-card';
    p1.textContent = 'Bu hafta toplam ' + totals.exerciseMinutes + ' dakika egzersiz yaptın.';
    sumEl.appendChild(p1);

    var p2 = document.createElement('p');
    p2.className = 'weekly-stat-card';
    p2.textContent = 'Bu hafta toplam ' + totals.water + ' bardak su içtin.';
    sumEl.appendChild(p2);

    var p3 = document.createElement('p');
    p3.className = 'weekly-stat-card';
    p3.textContent = 'Bu hafta toplam ' + totals.calories + ' kcal kaydettin.';
    sumEl.appendChild(p3);

    var p4 = document.createElement('p');
    p4.className = 'weekly-stat-card';
    if (bestIdx >= 0) {
      p4.textContent = 'En aktif günün ' + WEEKDAY_LONG[bestIdx] + ' oldu.';
    } else {
      p4.textContent =
        'Bu hafta grafikte egzersiz dakikası görünmüyor; hareket ekledikçe çubuklar yükselir.';
    }
    sumEl.appendChild(p4);
  }

  /** İlerleme çubuğu yüzdesini uygula */
  function applyProgress(fillEl, wrapEl, ratioPercent) {
    var pct = clampPercent(ratioPercent);
    if (fillEl) fillEl.style.width = pct + '%';
    if (wrapEl) wrapEl.setAttribute('aria-valuenow', String(Math.round(pct)));
  }

  /** Görünümü güncelle */
  function render() {
    if (
      !dashCalCurrent ||
      !dashWaterCurrent ||
      !calConsumed ||
      !waterCount ||
      !exerciseList ||
      !calProgressFill ||
      !waterProgressFill ||
      !exProgressFill
    ) {
      return;
    }

    var calGoal = state.calorieGoal > 0 ? state.calorieGoal : 1;
    var waterGoal = state.waterGoal > 0 ? state.waterGoal : 1;
    var exGoal = exerciseGoalSafe();
    var minutes = totalExerciseMinutes();

    dashCalCurrent.textContent = state.caloriesConsumed;
    dashCalGoal.textContent = state.calorieGoal;
    dashWaterCurrent.textContent = state.waterGlasses;
    dashWaterGoal.textContent = state.waterGoal;

    dashExCount.textContent = state.exercises.length;
    dashExMinutes.textContent = minutes;
    dashExGoal.textContent = state.exerciseGoalMinutes;

    var calP = (state.caloriesConsumed / calGoal) * 100;
    var calPctRounded = clampPercent(calP);
    dashCalBar.style.width = calPctRounded + '%';
    if (dashCalPct) dashCalPct.textContent = calPctRounded + '%';

    var waterP = (state.waterGlasses / waterGoal) * 100;
    var waterPctRounded = clampPercent(waterP);
    dashWaterBar.style.width = waterPctRounded + '%';
    if (dashWaterPct) dashWaterPct.textContent = waterPctRounded + '%';

    var exP = (minutes / exGoal) * 100;
    var exPctRounded = clampPercent(exP);
    dashExBar.style.width = exPctRounded + '%';
    if (dashExPct) dashExPct.textContent = exPctRounded + '%';

    if (dashWeightCurrent) {
      dashWeightCurrent.textContent = Number.isFinite(state.currentWeight) ? state.currentWeight : '—';
    }
    if (dashWeightGoal) {
      dashWeightGoal.textContent = Number.isFinite(state.goalWeight) ? state.goalWeight : '—';
    }
    if (dashWeightProgress) {
      dashWeightProgress.textContent = weightProgressText();
    }

    calConsumed.textContent = state.caloriesConsumed;
    calGoalDisplay.textContent = state.calorieGoal;
    applyProgress(calProgressFill, calProgressWrap, calP);

    waterCount.textContent = state.waterGlasses;
    waterGoalDisplay.textContent = state.waterGoal;
    applyProgress(waterProgressFill, waterProgressWrap, waterP);

    exProgressCurrent.textContent = minutes;
    exProgressGoal.textContent = state.exerciseGoalMinutes;
    applyProgress(exProgressFill, exProgressWrap, exP);

    weightCurrentDisplay.textContent = Number.isFinite(state.currentWeight) ? state.currentWeight : '—';
    weightGoalDisplay.textContent = Number.isFinite(state.goalWeight) ? state.goalWeight : '—';
    weightMessage.textContent = weightProgressText();

    if (goalCalorieInput) goalCalorieInput.value = String(state.calorieGoal);
    if (goalWaterInput) goalWaterInput.value = String(state.waterGoal);
    if (goalExerciseInput) goalExerciseInput.value = String(state.exerciseGoalMinutes);
    if (goalWeightSettingsInput)
      goalWeightSettingsInput.value = Number.isFinite(state.goalWeight) ? String(state.goalWeight) : '';

    exTotalMinutes.textContent = minutes;
    exTotalCount.textContent = state.exercises.length;

    exerciseList.innerHTML = '';
    if (state.exercises.length === 0) {
      if (exEmptyState) exEmptyState.classList.remove('hidden');
    } else {
      if (exEmptyState) exEmptyState.classList.add('hidden');
      state.exercises.forEach(function (ex) {
        var li = document.createElement('li');
        li.className = 'ex-item';

        var info = document.createElement('div');
        info.className = 'ex-info';

        var strong = document.createElement('strong');
        strong.textContent = ex.name;

        var meta = document.createElement('div');
        meta.className = 'ex-meta-line';
        meta.textContent = ex.minutes + ' dakika';

        var tag = document.createElement('span');
        tag.className = 'ex-tag';
        tag.textContent = ex.type;

        info.appendChild(strong);
        info.appendChild(meta);
        info.appendChild(tag);

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-danger-outline';
        btn.setAttribute('aria-label', ex.name + ' egzersiz kaydını listeden kaldır');
        btn.textContent = 'Sil';
        btn.addEventListener('click', function () {
          state.exercises = state.exercises.filter(function (x) {
            return x.id !== ex.id;
          });
          persistState(state);
          render();
          showToast('Egzersiz kaydı silindi.', true);
        });

        li.appendChild(info);
        li.appendChild(btn);
        exerciseList.appendChild(li);
      });
    }

    renderSummary();
    renderBadges();
    renderBMI();
    renderWeeklyReport();
    renderDashWeeklyChart();
    updateHeroQuickStats();
    try {
      window.dispatchEvent(new CustomEvent('fittrack:render'));
    } catch (e) {}
  }

  function getWeekSummaryLine() {
    var week = getWeekActivityData();
    var t = week.totals;
    if (!t.exerciseMinutes && !t.calories && !t.water) {
      return 'Bu hafta henüz kayıt yok. Takip bölümünden veri ekleyebilirsin.';
    }
    return (
      t.exerciseMinutes +
      ' dk egzersiz · ' +
      t.calories +
      ' kcal · ' +
      t.water +
      ' bardak su (bu hafta)'
    );
  }

  function askCoach(question) {
    var q = String(question || '').trim();
    if (!q) return;
    var section = document.getElementById('ai-koc');
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (aiChatBusy) return;
    renderChatMessage('user', q);
    tryCloudAiThenFallback(q, buildChatHistoryForOpenAI, answerAiQuestion);
  }

  /** Hero özet kartları (dashboard ile aynı veri, ekstra id ile senkron). */
  function updateHeroQuickStats() {
    if (!heroStatCal && !heroStatWater && !heroStatEx) return;
    var minutes = totalExerciseMinutes();
    if (heroStatCal) {
      heroStatCal.textContent = state.caloriesConsumed + ' / ' + state.calorieGoal + ' kcal';
    }
    if (heroStatWater) {
      heroStatWater.textContent = state.waterGlasses + ' / ' + state.waterGoal + ' bardak';
    }
    if (heroStatEx) {
      heroStatEx.textContent = minutes + ' / ' + state.exerciseGoalMinutes + ' dk';
    }
  }

  /** Günün motivasyon cümlesi */
  function pickMotivation() {
    if (!elMotivation) return;
    var quotes = [
      'Küçük adımlar, büyük alışkanlıkları oluşturur.',
      'Bugün gösterdiğin çaba, yarın hissedeceğin enerjidir.',
      'İlerleme mükemmellik değil; tutarlılıktır.',
      'Verilerini düzenli tutmak, kararlarını kolaylaştırır.',
      'Her bardak su ve her dakika hareket bir yatırım.'
    ];
    var i = Math.floor(Math.random() * quotes.length);
    elMotivation.textContent = '“' + quotes[i] + '”';
  }

  // --- Olay dinleyicileri ---
  if (formCalorie && calorieInput) {
    formCalorie.addEventListener('submit', function (e) {
      e.preventDefault();
      var raw = calorieInput.value.trim();
      if (!raw) {
        showToast('Kalori alanı boş bırakılamaz.', false);
        calorieInput.focus();
        return;
      }
      var val = parsePositiveInt(raw, CAL_SINGLE_MAX);
      if (val === null) {
        showToast('Geçerli bir pozitif tam sayı gir (1–' + CAL_SINGLE_MAX + ' kcal).', false);
        calorieInput.focus();
        return;
      }
      state.caloriesConsumed += val;
      persistState(state);
      calorieInput.value = '';
      render();

      var ratio = state.calorieGoal > 0 ? state.caloriesConsumed / state.calorieGoal : 0;
      var msg = val + ' kcal listeye eklendi.';
      var ok = true;
      if (val >= CAL_WARN_THRESHOLD) {
        msg += ' Bu miktar beklenenden yüksek; doğru olduğundan emin misin?';
        ok = false;
      }
      if (ratio > 1.05) {
        msg += ' Kalori hedefini aşmamaya dikkat et.';
        ok = false;
      }
      showToast(msg, ok);
    });
  }

  if (btnWaterPlus) {
    btnWaterPlus.addEventListener('click', function () {
      if (state.waterGlasses >= WATER_GLASSES_HARD_MAX) {
        showToast('Günlük bardak sayısı makul üst sınıra ulaştı (' + WATER_GLASSES_HARD_MAX + ').', false);
        return;
      }
      state.waterGlasses += 1;
      persistState(state);
      render();
      showToast('Bir bardak su eklendi.', true);
    });
  }

  if (btnWaterReset) {
    btnWaterReset.addEventListener('click', function () {
      state.waterGlasses = 0;
      persistState(state);
      render();
      showToast('Su sayacı sıfırlandı.', true);
    });
  }

  if (formExercise && exName && exDuration && exerciseList) {
    formExercise.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = exName.value.trim();
      var mins = parsePositiveInt(exDuration.value.trim(), 480);
      var typeVal = exType ? exType.value : 'Diğer';

      if (!name) {
        showToast('Egzersiz adı boş olamaz.', false);
        exName.focus();
        return;
      }
      if (mins === null) {
        showToast('Süre için 1 ile 480 arasında tam dakika gir.', false);
        exDuration.focus();
        return;
      }
      if (EXERCISE_TYPES.indexOf(typeVal) === -1) typeVal = 'Diğer';

      state.exercises.push(normalizeExercise({ id: uid(), name: name, minutes: mins, type: typeVal }));
      persistState(state);
      exName.value = '';
      exDuration.value = '';
      if (exType) exType.value = 'Diğer';
      render();
      var okMsg = true;
      var toastMsg = 'Egzersiz kaydı eklendi.';
      if (mins >= EX_DURATION_WARN) {
        toastMsg +=
          ' Süre oldukça uzun görünüyor (' +
          mins +
          ' dk); yanlışlıkla fazla sıfır yazmadığından emin ol.';
        okMsg = false;
      }
      showToast(toastMsg, okMsg);
    });
  }

  if (formWeight && weightInput) {
    formWeight.addEventListener('submit', function (e) {
      e.preventDefault();
      var raw = weightInput.value.trim();
      if (!raw) {
        showToast('Mevcut kilo alanı boş bırakılamaz.', false);
        weightInput.focus();
        return;
      }
      var w = parseWeight(raw);
      if (w === null) {
        showToast('30 ile 250 kg arasında geçerli bir değer gir (örn: 76.4).', false);
        weightInput.focus();
        return;
      }
      state.currentWeight = w;
      persistState(state);
      weightInput.value = '';
      render();
      showToast('Mevcut kilo güncellendi.', true);
    });
  }

  if (formGoalWeight && goalWeightInput) {
    formGoalWeight.addEventListener('submit', function (e) {
      e.preventDefault();
      var raw = goalWeightInput.value.trim();
      if (!raw) {
        showToast('Hedef kilo alanı boş bırakılamaz.', false);
        goalWeightInput.focus();
        return;
      }
      var g = parseWeight(raw);
      if (g === null) {
        showToast('30 ile 250 kg arasında geçerli bir hedef gir.', false);
        goalWeightInput.focus();
        return;
      }
      state.goalWeight = g;
      persistState(state);
      goalWeightInput.value = '';
      render();
      showToast('Hedef kilo güncellendi.', true);
    });
  }

  if (
    formGoals &&
    goalCalorieInput &&
    goalWaterInput &&
    goalExerciseInput &&
    goalWeightSettingsInput
  ) {
    formGoals.addEventListener('submit', function (e) {
      e.preventDefault();

      var gCal = parseGoalInt(goalCalorieInput.value, 1000, 5000);
      var gWater = parseGoalInt(goalWaterInput.value, 1, 24);
      var gEx = parseGoalInt(goalExerciseInput.value, 5, 300);
      var gWeightRaw = goalWeightSettingsInput.value.trim();
      if (!gWeightRaw) {
        showToast('Hedef kilo boş bırakılamaz.', false);
        goalWeightSettingsInput.focus();
        return;
      }
      var gWeight = parseWeight(gWeightRaw);

      if (gCal === null) {
        showToast('Kalori hedefi 1000 ile 5000 arasında tam sayı olmalı.', false);
        goalCalorieInput.focus();
        return;
      }
      if (gWater === null) {
        showToast('Su hedefi 1 ile 24 bardak arasında olmalı.', false);
        goalWaterInput.focus();
        return;
      }
      if (gEx === null) {
        showToast('Egzersiz hedefi 5 ile 300 dakika arasında olmalı.', false);
        goalExerciseInput.focus();
        return;
      }
      if (gWeight === null) {
        showToast('Hedef kilo 30–250 kg aralığında olmalı.', false);
        goalWeightSettingsInput.focus();
        return;
      }

      state.calorieGoal = gCal;
      state.waterGoal = gWater;
      state.exerciseGoalMinutes = gEx;
      state.goalWeight = gWeight;

      persistState(state);
      render();
      showToast(
        'Hedef ayarların başarıyla kaydedildi. Kalori, su ve egzersiz çubukları yeni hedeflere göre güncellendi.',
        true
      );
    });
  }

  if (formHeight && heightInput) {
    formHeight.addEventListener('submit', function (e) {
      e.preventDefault();
      var raw = heightInput.value.trim();
      if (!raw) {
        showToast('Boy alanı boş bırakılamaz.', false);
        heightInput.focus();
        return;
      }
      var h = parseHeightCm(raw);
      if (h === null) {
        showToast('80 ile 250 cm arasında geçerli bir boy gir (örn: 175 veya 175.5).', false);
        heightInput.focus();
        return;
      }
      state.heightCm = h;
      persistState(state);
      render();
      showToast('Boy bilgisi kaydedildi.', true);
    });
  }

  if (btnExportWeek) {
    btnExportWeek.addEventListener('click', function () {
      var data = getWeekActivityData();
      var payload = {
        exportedAt: new Date().toISOString(),
        weekRange: {
          start: data.weekDates[0],
          end: data.weekDates[6]
        },
        dailyCalories: data.daily.map(function (d) {
          return { date: d.date, calories: d.calories };
        }),
        dailyWater: data.daily.map(function (d) {
          return { date: d.date, waterGlasses: d.water };
        }),
        dailyExerciseMinutes: data.daily.map(function (d) {
          return { date: d.date, exerciseMinutes: d.exerciseMinutes };
        }),
        weekTotals: {
          totalCalories: data.totals.calories,
          totalWaterGlasses: data.totals.water,
          totalExerciseMinutes: data.totals.exerciseMinutes
        }
      };

      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'fittrack-haftalik-' + data.weekDates[0] + '.json';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Haftalık veri JSON olarak indirildi.', true);
    });
  }

  if (btnClearAllHistory) {
    btnClearAllHistory.addEventListener('click', function () {
      var ok = window.confirm(
        'Tüm aktivite geçmişi ve bugünün kalori / su / egzersiz kayıtları silinecek.\n\nGünlük hedef değerlerin (kalori, su, egzersiz dakikası, hedef kilo) ve mevcut kilon korunur.\n\nBu işlem geri alınamaz. Devam etmek istiyor musun?'
      );
      if (!ok) return;

      state.activityHistory = {};
      state.caloriesConsumed = 0;
      state.waterGlasses = 0;
      state.exercises = [];
      persistState(state);
      render();
      showToast('Geçmiş ve bugünün kayıtları temizlendi; hedefler korundu.', true);
    });
  }

  if (btnResetDay) {
    btnResetDay.addEventListener('click', function () {
      var ok = window.confirm(
        'Bu işlem GERİ ALINAMAZ.\n\nBugün eklediğin tüm kalori kayıtları, içilen bardak sayısı ve egzersiz listesi silinecek. Bugünün haftalık rapor satırı da sıfırlanır; önceki günlerin özeti korunur.\n\nKilo bilgin ve hedef ayarların korunur.\n\nDevam etmek istiyor musun?'
      );
      if (!ok) return;
      state.caloriesConsumed = 0;
      state.waterGlasses = 0;
      state.exercises = [];
      persistState(state);
      render();
      showToast('Günlük kayıtlar sıfırlandı.', true);
    });
  }

  if (btnStartToday) {
    btnStartToday.addEventListener('click', function () {
      var target = document.getElementById('takip');
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  if (btnWeeklyReport) {
    btnWeeklyReport.addEventListener('click', function () {
      var rap = document.getElementById('rapor');
      if (!rap) return;
      rap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  if (btnAiSuggest) {
    btnAiSuggest.addEventListener('click', handleAiSuggestClick);
  }

  if (btnAiChatClear) {
    btnAiChatClear.addEventListener('click', function () {
      clearAiChatHistory();
    });
  }

  var quickBtns = document.querySelectorAll('[data-ai-quick]');
  for (var qi = 0; qi < quickBtns.length; qi++) {
    quickBtns[qi].addEventListener('click', function () {
      var qt = this.getAttribute('data-ai-quick');
      if (!qt || aiChatBusy) return;
      renderChatMessage('user', qt);
      tryCloudAiThenFallback(qt, buildChatHistoryForOpenAI, answerAiQuestion);
    });
  }

  if (aiQuestionForm) {
    aiQuestionForm.addEventListener('submit', handleAiQuestionSubmit);
  }

  if (aiQuestionInput) {
    aiQuestionInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (aiChatBusy) return;
        if (aiQuestionForm) aiQuestionForm.requestSubmit();
      }
    });
  }

  if (elYear) elYear.textContent = String(new Date().getFullYear());

  ensureDemoPresentationIfNeeded();
  state = loadState();
  pickMotivation();
  render();
  restoreAiChatFromStorage();

  /**
   * Dış (auth.js) tarafından çağrılan yeniden yükleme kancası.
   * Giriş / çıkış sonrası yeni kullanıcının `fittrack_state_v1_<id>` verisi yüklenir
   * ve tüm ekran (dashboard, takip, rapor, AI sohbeti) yeni veriyle yeniden çizilir.
   */
  /**
   * Demo sunum hesabı için örnek haftalık + bugünkü veri yükler.
   * auth.js handleDemoLogin sonrası çağrılır.
   */
  function seedDemoPresentationData() {
    state = loadState();
    var today = todayISO();
    var weekDates = getCurrentWeekIsoDates();
    var hist = {};
    var calSamples = [1680, 1920, 2050, 1840, 2100, 1560, 0];
    var waterSamples = [6, 7, 8, 7, 8, 5, 0];
    var exSamples = [20, 35, 0, 40, 50, 25, 0];

    for (var i = 0; i < 7; i++) {
      var iso = weekDates[i];
      if (iso === today) continue;
      hist[iso] = {
        calories: calSamples[i],
        water: waterSamples[i],
        exerciseMinutes: exSamples[i]
      };
    }

    state.savedDate = today;
    state.calorieGoal = 2200;
    state.caloriesConsumed = 1250;
    state.waterGoal = 8;
    state.waterGlasses = 5;
    state.exerciseGoalMinutes = 45;
    state.exercises = [
      { id: 'demo-ex-1', name: 'Koşu bandı', minutes: 20, type: 'Kardiyo' },
      { id: 'demo-ex-2', name: 'HIIT', minutes: 10, type: 'Kardiyo' }
    ];
    state.currentWeight = 78;
    state.goalWeight = 72;
    state.heightCm = 175;
    state.activityHistory = hist;
    persistState(state);
  }

  function isDemoUserSession() {
    try {
      var raw = localStorage.getItem(AUTH_CURRENT_USER_KEY);
      if (!raw) return false;
      var u = JSON.parse(raw);
      return (
        u &&
        typeof u.email === 'string' &&
        u.email.toLowerCase() === DEMO_USER_EMAIL
      );
    } catch (e) {
      return false;
    }
  }

  /** Demo hesabı boşsa sunum verisini otomatik doldurur (sayfa yenileme / eski oturum). */
  function ensureDemoPresentationIfNeeded() {
    if (!isDemoUserSession()) return;
    var loaded = loadState();
    var histLen = loaded.activityHistory
      ? Object.keys(loaded.activityHistory).length
      : 0;
    var hasLive =
      (loaded.caloriesConsumed || 0) > 0 ||
      (loaded.waterGlasses || 0) > 0 ||
      (loaded.exercises && loaded.exercises.length > 0);
    if (hasLive && histLen >= 2) return;
    seedDemoPresentationData();
  }

  function reloadForUserChange() {
    ensureDemoPresentationIfNeeded();
    state = loadState();
    pickMotivation();
    render();
    if (aiChatBox) aiChatBox.innerHTML = '';
    removeTypingIndicator();
    restoreAiChatFromStorage();
  }

  window.FitTrackApp = window.FitTrackApp || {};
  window.FitTrackApp.reload = reloadForUserChange;
  window.FitTrackApp.computeDailyFitTrackScore = computeDailyFitTrackScore;
  window.FitTrackApp.buildSmartDailyRecommendation = buildSmartDailyRecommendation;
  window.FitTrackApp.getWeekSummaryLine = getWeekSummaryLine;
  window.FitTrackApp.askCoach = askCoach;
  window.FitTrackApp.renderDashWeeklyChart = renderDashWeeklyChart;
  window.FitTrackApp.seedDemoPresentationData = seedDemoPresentationData;

  window.addEventListener('fittrack:user-change', reloadForUserChange);
  window.addEventListener('fittrack:user-change', function () {
    if (window.FitTrackAuth && typeof window.FitTrackAuth.updateAuthUI === 'function') {
      window.FitTrackAuth.updateAuthUI();
    }
  });

  if (window.FitTrackAuth && typeof window.FitTrackAuth.updateAuthUI === 'function') {
    window.FitTrackAuth.updateAuthUI();
  }

  /** Açılış splash: 3 sn göster, fade-out, DOM'dan kaldır. */
  function initAppSplash() {
    var splash = document.getElementById('app-splash');
    if (!splash) return;

    document.body.classList.add('app-splash-active');

    var reducedMotion = false;
    try {
      reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {}

    if (reducedMotion) {
      splash.classList.add('app-splash--reduced-motion');
    }

    var displayMs = 3000;
    var fadeMs = reducedMotion ? 200 : 520;

    function removeSplash() {
      if (splash.parentNode) {
        splash.parentNode.removeChild(splash);
      }
      document.body.classList.remove('app-splash-active');
    }

    function startHide() {
      splash.classList.add('app-splash--hiding');
      splash.setAttribute('aria-hidden', 'true');

      var finished = false;
      function finish() {
        if (finished) return;
        finished = true;
        removeSplash();
      }

      function onTransitionEnd(ev) {
        if (ev.target !== splash) return;
        splash.removeEventListener('transitionend', onTransitionEnd);
        finish();
      }

      splash.addEventListener('transitionend', onTransitionEnd);
      window.setTimeout(finish, fadeMs + 80);
    }

    window.setTimeout(startHide, displayMs);
  }

  /** Hero ve bölüm kartlarında hafif fade/slide (prefers-reduced-motion uyumlu) */
  function initRevealAnimations() {
    var els = document.querySelectorAll('.reveal-fade');
    if (!els.length) return;

    var reduced = false;
    try {
      reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {}

    function reveal(el) {
      el.classList.add('is-revealed');
    }

    if (reduced || typeof IntersectionObserver === 'undefined') {
      for (var i = 0; i < els.length; i++) reveal(els[i]);
      return;
    }

    var io = new IntersectionObserver(
      function (entries) {
        for (var j = 0; j < entries.length; j++) {
          if (entries[j].isIntersecting) {
            reveal(entries[j].target);
            io.unobserve(entries[j].target);
          }
        }
      },
      { root: null, rootMargin: '0px 0px -8% 0px', threshold: 0.06 }
    );

    for (var k = 0; k < els.length; k++) {
      if (els[k].closest('.hero-shell')) {
        window.requestAnimationFrame(function (el) {
          return function () {
            reveal(el);
          };
        }(els[k]));
      } else {
        io.observe(els[k]);
      }
    }
  }

  initRevealAnimations();
  initAppSplash();
})();

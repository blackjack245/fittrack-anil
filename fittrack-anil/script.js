/**
 * FitTrack — Uygulama mantığı
 * ---------------------------------------------------------------------------
 * - Durum `localStorage` içinde `fittrack_state_v1` anahtarıyla saklanır (kökle uyum).
 * - `savedDate` takvim günü değişince günlük sayaçları sıfırlar (kalori, su, egzersiz listesi).
 * - Kilo ve hedef alanları gün değişiminde korunur.
 * - Egzersiz nesneleri: { id, name, minutes, type }; eski kayıtlar için type varsayılanı 'Diğer'.
 * - `activityHistory`: tarih (YYYY-MM-DD) bazlı günlük kalori, su bardığı ve egzersiz dakikası özeti.
 * - `heightCm`: BMI için saklanan boy (cm); isteğe bağlı.
 */

(function () {
  'use strict';

  /** Depolama anahtarı — önceki teslimlerle uyumlu */
  var STORAGE_KEY = 'fittrack_state_v1';

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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      showToast('Kayıt yapılamadı: tarayıcı depolaması dolu olabilir veya gizli mod aktif.', false);
    }
  }

  /** localStorage oku + gün kontrolü */
  function loadState() {
    var base = defaultState();
    var raw = localStorage.getItem(STORAGE_KEY);
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
  var btnResetDay = document.getElementById('btn-reset-day');

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
    p1.textContent = 'Bu hafta toplam ' + totals.exerciseMinutes + ' dakika egzersiz yaptın.';
    sumEl.appendChild(p1);

    var p2 = document.createElement('p');
    p2.textContent = 'Bu hafta toplam ' + totals.water + ' bardak su içtin.';
    sumEl.appendChild(p2);

    var p3 = document.createElement('p');
    p3.textContent = 'Bu hafta toplam ' + totals.calories + ' kcal kaydettin.';
    sumEl.appendChild(p3);

    var p4 = document.createElement('p');
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
    dashCalBar.style.width = clampPercent(calP) + '%';

    var waterP = (state.waterGlasses / waterGoal) * 100;
    dashWaterBar.style.width = clampPercent(waterP) + '%';

    var exP = (minutes / exGoal) * 100;
    dashExBar.style.width = clampPercent(exP) + '%';

    dashWeightCurrent.textContent = Number.isFinite(state.currentWeight) ? state.currentWeight : '—';
    dashWeightGoal.textContent = Number.isFinite(state.goalWeight) ? state.goalWeight : '—';
    dashWeightProgress.textContent = weightProgressText();

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
      var target = document.getElementById('dashboard');
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  if (elYear) elYear.textContent = String(new Date().getFullYear());

  pickMotivation();
  render();
})();

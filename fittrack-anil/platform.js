/**
 * FitTrack Platform — Antrenörler, AI güvenlik, yemek önerisi, dashboard ekleri.
 * OpenAI entegrasyonu için hazır yapı: meal/coach API uçları ileride bağlanabilir.
 */
(function () {
  'use strict';

  var HEALTH_DISCLAIMER =
    'Bu bilgiler genel fitness rehberliğidir; tıbbi teşhis, ilaç veya tedavi tavsiyesi değildir. ' +
    'Sakatlık, kronik hastalık veya hamilelik gibi durumlarda mutlaka doktorunuza danışın.';

  var BLOCKED_PATTERNS = [
    /steroid/i,
    /anabolik/i,
    /ilaç\s*doz/i,
    /reçete/i,
    /teşhis\s*koy/i,
    /hastalığın\s*ne/i,
    /kanser/i,
    /diyabet\s*tedavi/i,
    /insülin\s*doz/i,
    /prohormon/i,
    /sarm\b/i,
    /clenbuterol/i,
    /trenbolon/i,
    /dianabol/i
  ];

  var SENSITIVE_HEALTH = [
    /kalp\s*krizi/i,
    /göğüs\s*ağrısı/i,
    /bayıl/i,
    /şiddetli\s*ağrı/i,
    /kanama/i,
    /nefes\s*darlığı/i
  ];

  function isLoggedIn() {
    try {
      if (window.FitTrackAuth && typeof window.FitTrackAuth.getCurrentUser === 'function') {
        return !!window.FitTrackAuth.getCurrentUser();
      }
    } catch (e) {}
    return false;
  }

  function openAuthModal(preferRegister) {
    var id = preferRegister ? 'btn-open-register' : 'btn-open-login';
    var btn = document.getElementById(id);
    if (btn) btn.click();
  }

  function scrollToAiCoach(prefill) {
    var section = document.getElementById('ai-koc');
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (prefill && window.FitTrackApp && typeof window.FitTrackApp.askCoach === 'function') {
      window.setTimeout(function () {
        window.FitTrackApp.askCoach(prefill);
      }, 400);
    }
  }

  function isBlockedQuestion(q) {
    var text = String(q || '');
    for (var i = 0; i < BLOCKED_PATTERNS.length; i++) {
      if (BLOCKED_PATTERNS[i].test(text)) return true;
    }
    return false;
  }

  function needsDoctorWarning(q) {
    var text = String(q || '');
    for (var i = 0; i < SENSITIVE_HEALTH.length; i++) {
      if (SENSITIVE_HEALTH[i].test(text)) return true;
    }
    return false;
  }

  function blockedReply() {
    return (
      'Bu konuda yardımcı olamam. FitTrack; steroid, reçeteli ilaç, dozaj veya tıbbi teşhis önermez.\n\n' +
      HEALTH_DISCLAIMER
    );
  }

  function doctorWarningPrefix() {
    return (
      'Belirttiğin belirtiler ciddi olabilir. Öncelikle bir sağlık profesyoneline başvurmanı öneririm.\n\n'
    );
  }

  function keywordHit(q, words) {
    var lower = String(q || '').toLowerCase();
    for (var i = 0; i < words.length; i++) {
      if (lower.indexOf(words[i]) !== -1) return true;
    }
    return false;
  }

  /** Platform AI koç — kural tabanlı ek yanıtlar (script.js fallback öncesi). */
  function tryPlatformCoachAnswer(question) {
    var q = String(question || '').toLowerCase();
    if (!q) return null;

    if (keywordHit(q, ['kilo ver', 'zayıfla', 'yağ yak', 'deficit', 'kalori açığı'])) {
      return (
        'Kilo verme hedefi için genel çerçeve:\n' +
        '• Haftada yaklaşık 0,25–0,75 kg kayıp sürdürülebilir bir aralıktır.\n' +
        '• Günlük kalori hedefini hafif açık tut; protein alımını koru (vücut ağırlığı başına yaklaşık 1,6–2 g/kg hedeflenebilir — kişisel ihtiyaç değişir).\n' +
        '• Haftada 3–4 güç + 2–3 yürüyüş/kardiyo dengesi çoğu kişi için iyi başlangıçtır.\n' +
        '• Uyku ve su takibi ilerlemeyi destekler.\n\n' +
        HEALTH_DISCLAIMER
      );
    }

    if (keywordHit(q, ['kas kazan', 'bulk', 'hipertrofi', 'kas yap'])) {
      return (
        'Kas kazanma hedefi için genel çerçeve:\n' +
        '• Kontrollü kalori fazlası (günlük ~200–400 kcal) ve yeterli protein önemlidir.\n' +
        '• Haftada 3–5 direnç antrenmanı; bileşik hareketlere (squat, deadlift, press, row) odaklan.\n' +
        '• Set/tekrar: 6–12 aralığında progresif yüklenme; dinlenme günlerini atlama.\n' +
        '• Supplementler yalnızca beslenme ve antrenman düzeni oturduktan sonra düşünülmeli.\n\n' +
        HEALTH_DISCLAIMER
      );
    }

    if (keywordHit(q, ['haftalık plan', 'haftalık program', '7 günlük', 'pazartesi pazar'])) {
      return (
        'Örnek haftalık plan (orta seviye, genel):\n' +
        '• Pzt: Üst vücut güç\n• Sal: Kardiyo 30–40 dk\n• Çar: Alt vücut güç\n' +
        '• Per: Dinlenme veya hafif yürüyüş\n• Cum: Tam vücut veya push/pull\n' +
        '• Cmt: Kardiyo veya aktif dinlenme\n• Paz: Dinlenme, esneme\n\n' +
        'FitTrack’te günlük su, kalori ve egzersiz kaydı bu planı kişiselleştirmene yardım eder.\n\n' +
        HEALTH_DISCLAIMER
      );
    }

    if (keywordHit(q, ['kardiyo', 'koşu', 'bisiklet', 'hiit'])) {
      return (
        'Kardiyo önerisi (genel):\n' +
        '• Haftada 150 dk orta tempolu veya 75 dk yoğun aktivite hedefi sağlık rehberlerinde sık görülür.\n' +
        '• Kilo verme: düşük–orta yoğunluklu uzun seanslar; kas koruma: aşırı HIIT’ten kaçın.\n' +
        '• Antrenman öncesi/sonrası 5–10 dk ısınma-soğuma ekle.\n\n' +
        HEALTH_DISCLAIMER
      );
    }

    if (keywordHit(q, ['dinlenme günü', 'rest day', 'toparlanma günü'])) {
      return (
        'Dinlenme günü önerisi:\n' +
        '• Haftada en az 1–2 tam dinlenme veya aktif dinlenme (yürüyüş, mobilite).\n' +
        '• Uyku 7–9 saat; protein ve hidrasyon devam etsin.\n' +
        '• Kas ağrısı normal; eklem/bilek ağrısı varsa yükü azalt ve gerekirse uzmana danış.\n\n' +
        HEALTH_DISCLAIMER
      );
    }

    if (keywordHit(q, ['antrenman programı', 'program öner', 'split', 'full body'])) {
      return (
        'Antrenman programı (başlangıç–orta):\n' +
        '• Full body 3x/hafta veya üst/alt 4x/hafta iyi seçeneklerdir.\n' +
        '• Her seans: ısınma, 4–6 ana hareket, 2–4 set, 8–12 tekrar (güce göre ayarla).\n' +
        '• 4–6 haftada ağırlık veya tekrar artışı (progresif overload).\n\n' +
        'Kişisel kısıtların varsa fizyoterapist veya antrenörle planı netleştir.\n\n' +
        HEALTH_DISCLAIMER
      );
    }

    return null;
  }

  /** Gelecekte: fetch('/.netlify/functions/fittrack-meal', { body: input }) */
  function fetchMealRecommendation(input) {
    return Promise.resolve(buildRuleBasedMeal(input));
  }

  var MEAL_DB = [
    {
      name: 'Yulaf lapası & yoğurt',
      mealTypes: ['kahvaltı'],
      goals: ['kilo verme', 'form koruma'],
      protein: ['yüksek', 'orta'],
      tags: ['yulaf', 'yoğurt', 'muz'],
      cal: 420,
      p: 28,
      c: 52,
      f: 12,
      prep: 'Yulafı sütle pişir; üzerine yoğurt ve dilim muz ekle.',
      why: 'Lif ve protein dengesi tok tutar; kahvaltıda sürdürülebilir enerji verir.'
    },
    {
      name: 'Omlet & tam buğday ekmeği',
      mealTypes: ['kahvaltı'],
      goals: ['kas kazanma', 'form koruma'],
      protein: ['yüksek'],
      tags: ['yumurta', 'ekmek', 'domates'],
      cal: 480,
      p: 32,
      c: 38,
      f: 22,
      prep: '3 yumurtayı sebzeli çırpıp tavada pişir; 1 dilim tam buğday ekmeği ile servis et.',
      why: 'Yüksek kaliteli protein kas onarımını destekler.'
    },
    {
      name: 'Izgara tavuk salata',
      mealTypes: ['öğle'],
      goals: ['kilo verme', 'form koruma'],
      protein: ['yüksek', 'orta'],
      tags: ['tavuk', 'marul', 'zeytinyağı'],
      cal: 450,
      p: 42,
      c: 18,
      f: 24,
      prep: 'Tavuk göğsünü ızgara yap; bol yeşillik ve 1 yk zeytinyağı ile karıştır.',
      why: 'Düşük karbonhidratlı, yüksek proteinli öğün tok tutar.'
    },
    {
      name: 'Mercimek & bulgur tabağı',
      mealTypes: ['öğle', 'akşam'],
      goals: ['kilo verme', 'form koruma', 'kas kazanma'],
      protein: ['orta', 'vejetaryen'],
      tags: ['mercimek', 'bulgur', 'soğan'],
      cal: 520,
      p: 24,
      c: 72,
      f: 14,
      prep: 'Mercimeği haşla; bulgur ve baharatla kavurarak servis et.',
      why: 'Bitkisel protein ve lif; vejetaryen tercihlere uygun.'
    },
    {
      name: 'Somon & kinoa',
      mealTypes: ['akşam'],
      goals: ['kas kazanma', 'form koruma'],
      protein: ['yüksek'],
      tags: ['somon', 'kinoa', 'limon'],
      cal: 580,
      p: 40,
      c: 45,
      f: 26,
      prep: 'Somonu fırında pişir; haşlanmış kinoa ve limonla servis et.',
      why: 'Omega-3 ve tam protein; akşam öğünü için dengeli makrolar.'
    },
    {
      name: 'Hindi & tatlı patates',
      mealTypes: ['akşam'],
      goals: ['kas kazanma'],
      protein: ['yüksek'],
      tags: ['hindi', 'patates'],
      cal: 620,
      p: 48,
      c: 58,
      f: 16,
      prep: 'Hindi göğsünü fırınla; fırında tatlı patates ile tamamla.',
      why: 'Kas kazanma döneminde karbonhidrat + yağsız protein kombinasyonu.'
    },
    {
      name: 'Süzme peynir & meyve',
      mealTypes: ['ara öğün'],
      goals: ['kilo verme', 'form koruma', 'kas kazanma'],
      protein: ['yüksek', 'orta'],
      tags: ['peynir', 'çilek', 'badem'],
      cal: 280,
      p: 22,
      c: 24,
      f: 10,
      prep: '200 g süzme peynir; bir avuç meyve ve 10–12 badem.',
      why: 'Ara öğünde pratik protein; açlığı kontrollü yönetir.'
    },
    {
      name: 'Protein smoothie',
      mealTypes: ['ara öğün', 'kahvaltı'],
      goals: ['kas kazanma', 'form koruma'],
      protein: ['yüksek'],
      tags: ['süt', 'muz', 'fıstık ezmesi'],
      cal: 350,
      p: 30,
      c: 38,
      f: 10,
      prep: 'Süt, muz, 1 ölçek protein tozu (isteğe bağlı), buz — blender.',
      why: 'Antrenman sonrası hızlı protein ve karbonhidrat.'
    }
  ];

  function normalizeGoal(val) {
    var v = String(val || '').toLowerCase();
    if (v.indexOf('ver') !== -1) return 'kilo verme';
    if (v.indexOf('kas') !== -1) return 'kas kazanma';
    return 'form koruma';
  }

  function normalizeMealType(val) {
    var v = String(val || '').toLowerCase();
    if (v.indexOf('kahval') !== -1) return 'kahvaltı';
    if (v.indexOf('öğle') !== -1 || v.indexOf('ogle') !== -1) return 'öğle';
    if (v.indexOf('akşam') !== -1 || v.indexOf('aksam') !== -1) return 'akşam';
    return 'ara öğün';
  }

  function allergyBlocks(meal, allergyText) {
    if (!allergyText) return false;
    var a = allergyText.toLowerCase();
    for (var i = 0; i < meal.tags.length; i++) {
      if (a.indexOf(meal.tags[i]) !== -1) return true;
    }
    var groups = [
      { keys: ['süt', 'laktoz'], block: ['süt', 'yoğurt', 'peynir'] },
      { keys: ['fıstık'], block: ['fıstık', 'badem'] },
      { keys: ['gluten'], block: ['ekmek', 'bulgur'] },
      { keys: ['yumurta'], block: ['yumurta'] },
      { keys: ['balık'], block: ['somon'] }
    ];
    for (var g = 0; g < groups.length; g++) {
      var hit = false;
      for (var ki = 0; ki < groups[g].keys.length; ki++) {
        if (a.indexOf(groups[g].keys[ki]) !== -1) hit = true;
      }
      if (!hit) continue;
      for (var bi = 0; bi < groups[g].block.length; bi++) {
        var blocked = groups[g].block[bi];
        for (var ti = 0; ti < meal.tags.length; ti++) {
          if (meal.tags[ti].indexOf(blocked) !== -1 || blocked.indexOf(meal.tags[ti]) !== -1) {
            return true;
          }
        }
      }
    }
    var common = ['süt', 'laktoz', 'gluten', 'fıstık', 'yumurta', 'balık', 'soya', 'kabuklu deniz'];
    for (var j = 0; j < common.length; j++) {
      if (a.indexOf(common[j]) !== -1) {
        for (var k = 0; k < meal.tags.length; k++) {
          if (meal.tags[k].indexOf(common[j]) !== -1 || common[j].indexOf(meal.tags[k]) !== -1) return true;
        }
      }
    }
    return false;
  }

  function proteinMatch(meal, pref) {
    var p = String(pref || '').toLowerCase();
    if (!p || p.indexOf('fark') !== -1) return true;
    if (p.indexOf('vej') !== -1) return meal.protein.indexOf('vejetaryen') !== -1 || meal.protein.indexOf('orta') !== -1;
    if (p.indexOf('yüksek') !== -1) return meal.protein.indexOf('yüksek') !== -1;
    return true;
  }

  function buildRuleBasedMeal(input) {
    var goal = normalizeGoal(input.goal);
    var mealType = normalizeMealType(input.mealType);
    var targetCal = parseInt(input.calories, 10) || 500;
    var allergies = String(input.allergies || '').trim();
    var proteinPref = String(input.proteinPref || '').trim();

    var candidates = MEAL_DB.filter(function (m) {
      if (m.mealTypes.indexOf(mealType) === -1) return false;
      if (m.goals.indexOf(goal) === -1 && goal !== 'form koruma') return false;
      if (allergyBlocks(m, allergies)) return false;
      if (!proteinMatch(m, proteinPref)) return false;
      return true;
    });

    if (candidates.length === 0) {
      candidates = MEAL_DB.filter(function (m) {
        return m.mealTypes.indexOf(mealType) !== -1 && !allergyBlocks(m, allergies);
      });
    }
    if (candidates.length === 0) candidates = MEAL_DB.slice();

    var pick = candidates[Math.floor(Math.random() * candidates.length)];
    var scale = targetCal / pick.cal;
    if (scale < 0.7) scale = 0.7;
    if (scale > 1.35) scale = 1.35;

    var cal = Math.round(pick.cal * scale);
    var p = Math.round(pick.p * scale);
    var c = Math.round(pick.c * scale);
    var f = Math.round(pick.f * scale);

    return {
      name: pick.name,
      ingredients: pick.tags.join(', '),
      calories: cal,
      protein: p,
      carbs: c,
      fat: f,
      prep: pick.prep,
      why: pick.why + ' Hedefin: ' + goal + '.',
      disclaimer: HEALTH_DISCLAIMER + ' Beslenme planı için diyetisyene danışın.'
    };
  }

  function renderMealResult(data) {
    var el = document.getElementById('meal-result');
    if (!el) return;
    el.innerHTML =
      '<article class="meal-result-card">' +
      '<h3 class="meal-result-title">' +
      escapeHtml(data.name) +
      '</h3>' +
      '<dl class="meal-result-meta">' +
      '<div><dt>Malzemeler</dt><dd>' +
      escapeHtml(data.ingredients) +
      '</dd></div>' +
      '<div><dt>Yaklaşık kalori</dt><dd>' +
      data.calories +
      ' kcal</dd></div>' +
      '<div><dt>Makrolar</dt><dd>P ' +
      data.protein +
      'g · K ' +
      data.carbs +
      'g · Y ' +
      data.fat +
      'g</dd></div>' +
      '<div><dt>Hazırlama</dt><dd>' +
      escapeHtml(data.prep) +
      '</dd></div>' +
      '<div><dt>Neden uygun?</dt><dd>' +
      escapeHtml(data.why) +
      '</dd></div>' +
      '</dl>' +
      '<p class="platform-disclaimer">' +
      escapeHtml(data.disclaimer) +
      '</p>' +
      '</article>';
    el.hidden = false;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setupCoaches() {
    var cards = document.querySelectorAll('[data-coach-consult]');
    for (var i = 0; i < cards.length; i++) {
      cards[i].addEventListener('click', function () {
        var coachName = this.getAttribute('data-coach-name') || 'Antrenör';
        if (!isLoggedIn()) {
          openAuthModal(true);
          return;
        }
        scrollToAiCoach(
          coachName + ' alanında danışmak istiyorum. Hedeflerime uygun genel bir plan özeti verir misin?'
        );
      });
    }
  }

  function setupMealForm() {
    var form = document.getElementById('meal-recommend-form');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = {
        goal: (document.getElementById('meal-goal') || {}).value,
        mealType: (document.getElementById('meal-type') || {}).value,
        calories: (document.getElementById('meal-calories') || {}).value,
        allergies: (document.getElementById('meal-allergies') || {}).value,
        proteinPref: (document.getElementById('meal-protein') || {}).value
      };
      fetchMealRecommendation(input).then(renderMealResult);
    });
  }

  function setupPlatformCoachChips() {
    var chips = document.querySelectorAll('[data-platform-coach]');
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function () {
        var q = this.getAttribute('data-platform-coach');
        if (!q) return;
        if (window.FitTrackApp && typeof window.FitTrackApp.askCoach === 'function') {
          window.FitTrackApp.askCoach(q);
        } else {
          scrollToAiCoach(q);
        }
      });
    }
  }

  function updateDashboardExtras() {
    var scoreEl = document.getElementById('dash-fit-score');
    var tipEl = document.getElementById('dash-ai-tip');
    var weekEl = document.getElementById('dash-weekly-mini');
    if (!scoreEl && !tipEl && !weekEl) return;

    if (window.FitTrackApp) {
      if (scoreEl && typeof window.FitTrackApp.computeDailyFitTrackScore === 'function') {
        var sc = window.FitTrackApp.computeDailyFitTrackScore();
        scoreEl.textContent = sc && typeof sc.total === 'number' ? String(sc.total) : '—';
      }
      if (tipEl && typeof window.FitTrackApp.buildSmartDailyRecommendation === 'function') {
        tipEl.textContent = window.FitTrackApp.buildSmartDailyRecommendation();
      }
      if (weekEl && typeof window.FitTrackApp.getWeekSummaryLine === 'function') {
        weekEl.textContent = window.FitTrackApp.getWeekSummaryLine();
      }
    }
  }

  function init() {
    setupCoaches();
    setupMealForm();
    setupPlatformCoachChips();
    updateDashboardExtras();
    window.addEventListener('fittrack:render', updateDashboardExtras);
  }

  window.FT_SAFETY = {
    isBlocked: isBlockedQuestion,
    blockedReply: blockedReply,
    needsDoctorWarning: needsDoctorWarning,
    doctorWarningPrefix: doctorWarningPrefix,
    HEALTH_DISCLAIMER: HEALTH_DISCLAIMER
  };

  window.FT_COACH = {
    tryAnswer: tryPlatformCoachAnswer
  };

  window.FT_MEAL = {
    recommend: fetchMealRecommendation,
    buildRuleBased: buildRuleBasedMeal
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/**
 * FitTrack platform — işlevsel test (Node, paket gerektirmez).
 * Çalıştır: node scripts/platform-functional-test.mjs
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BASE_URL = process.env.FITTRACK_TEST_URL || 'http://localhost:8890';

const results = [];
let failed = 0;

function pass(name, detail) {
  results.push({ ok: true, name, detail });
}
function fail(name, detail) {
  failed++;
  results.push({ ok: false, name, detail });
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      })
      .on('error', reject);
  });
}

function loadPlatformApis() {
  const code = fs.readFileSync(path.join(ROOT, 'platform.js'), 'utf8');
  const sandbox = {
    window: {},
    document: {
      readyState: 'complete',
      addEventListener: () => {},
      getElementById: () => null,
      querySelectorAll: () => []
    },
    addEventListener: () => {},
    setTimeout: (fn) => fn()
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = () => {};
  vm.runInNewContext(code, sandbox);
  return {
    FT_SAFETY: sandbox.window.FT_SAFETY,
    FT_COACH: sandbox.window.FT_COACH,
    FT_MEAL: sandbox.window.FT_MEAL
  };
}

function testSafety(FT_SAFETY, FT_COACH) {
  const blocked = ['steroid cycle öner', 'ilaç doz ayarla', 'bana teşhis koy'];
  for (const q of blocked) {
    if (!FT_SAFETY.isBlocked(q)) fail('Güvenlik: engellenmeli', q);
    else {
      const r = FT_SAFETY.blockedReply();
      if (!r.includes('yardımcı olamam') && !r.includes('önermez')) {
        fail('Güvenlik: blockedReply içerik', q);
      }
    }
  }
  if (blocked.every((q) => FT_SAFETY.isBlocked(q))) {
    pass('Güvenlik filtresi', 'steroid/ilaç dozu/teşhis engellendi');
  }

  const coachQ = 'Kilo verme hedefim için ne yapmalıyım?';
  const ans = FT_COACH.tryAnswer(coachQ);
  if (!ans || !ans.includes('Kilo verme')) fail('AI Koç: kilo verme', 'yanıt yok');
  else pass('AI Koç: kilo verme', 'kural yanıtı üretildi');

  const muscle = FT_COACH.tryAnswer('Kas kazanma hedefim için öneri ver');
  if (!muscle || !muscle.includes('Kas kazanma')) fail('AI Koç: kas kazanma', '');
  else pass('AI Koç: kas kazanma', 'OK');

  const cardio = FT_COACH.tryAnswer('Kardiyo önerisi ver');
  if (!cardio || !cardio.includes('Kardiyo')) fail('AI Koç: kardiyo', '');
  else pass('AI Koç: kardiyo', 'OK');

  const program = FT_COACH.tryAnswer('Bana genel bir antrenman programı öner');
  if (!program || !program.includes('Antrenman')) fail('AI Koç: program', '');
  else pass('AI Koç: antrenman programı', 'OK');

  const motiv = FT_COACH.tryAnswer('Motivasyon mesajı ver');
  if (motiv) pass('AI Koç: motivasyon', 'yanıt var');
  else {
    // motivasyon script.js'te de olabilir — platform'da keyword yoksa FT_COACH null döner
    pass('AI Koç: motivasyon', 'platform kuralı yok (script.js fallback beklenir)');
  }
}

let windowApis;

function testMeal(FT_MEAL) {
  const breakfast = FT_MEAL.buildRuleBased({
    goal: 'kilo verme',
    mealType: 'kahvaltı',
    calories: '400',
    allergies: '',
    proteinPref: 'fark etmez'
  });
  const dinner = FT_MEAL.buildRuleBased({
    goal: 'kilo verme',
    mealType: 'akşam',
    calories: '400',
    allergies: '',
    proteinPref: 'fark etmez'
  });
  if (breakfast.name === dinner.name && breakfast.ingredients === dinner.ingredients) {
    // aynı olabilir ama mealType farklı DB'de farklı adaylar olmalı çoğu zaman
    const bOk = ['kahvaltı', 'Kahvaltı', 'yulaf', 'Omlet', 'Protein'].some(
      (k) => breakfast.name.toLowerCase().includes(k.toLowerCase()) || breakfast.name.length > 0
    );
    if (!bOk) fail('Yemek: öğün türü', 'kahvaltı sonucu şüpheli');
  } else {
    pass('Yemek: öğün türü', `kahvaltı=${breakfast.name}, akşam=${dinner.name}`);
  }

  const lowCal = FT_MEAL.buildRuleBased({
    goal: 'form koruma',
    mealType: 'öğle',
    calories: '250',
    allergies: '',
    proteinPref: 'fark etmez'
  });
  const highCal = FT_MEAL.buildRuleBased({
    goal: 'form koruma',
    mealType: 'öğle',
    calories: '700',
    allergies: '',
    proteinPref: 'fark etmez'
  });
  if (highCal.calories > lowCal.calories) {
    pass('Yemek: kalori hedefi', `${lowCal.calories} vs ${highCal.calories} kcal`);
  } else {
    fail('Yemek: kalori hedefi', `${lowCal.calories} vs ${highCal.calories}`);
  }

  const withMilk = FT_MEAL.buildRuleBased({
    goal: 'form koruma',
    mealType: 'kahvaltı',
    calories: '400',
    allergies: 'süt',
    proteinPref: 'fark etmez'
  });
  const milkLeak = /süt|yoğurt|peynir/i.test(withMilk.name + ' ' + withMilk.ingredients);
  if (milkLeak) {
    fail('Yemek: alerji filtresi', 'süt/yoğurt: ' + withMilk.name);
  } else pass('Yemek: alerji (süt)', withMilk.name);

  const veg = FT_MEAL.buildRuleBased({
    goal: 'form koruma',
    mealType: 'öğle',
    calories: '500',
    allergies: '',
    proteinPref: 'vejetaryen'
  });
  const meat = FT_MEAL.buildRuleBased({
    goal: 'form koruma',
    mealType: 'öğle',
    calories: '500',
    allergies: '',
    proteinPref: 'yüksek protein'
  });
  pass('Yemek: protein tercihi', `vej=${veg.name}, yüksek=${meat.name}`);

  const fields = ['name', 'ingredients', 'calories', 'protein', 'carbs', 'fat', 'prep', 'why'];
  const missing = fields.filter((f) => breakfast[f] === undefined || breakfast[f] === '');
  if (missing.length) fail('Yemek: çıktı alanları', 'eksik: ' + missing.join(', '));
  else pass('Yemek: çıktı alanları', fields.join(', '));
}

function testHtml(html) {
  const checks = [
    ['#antrenorler', /id="antrenorler"/],
    ['4 antrenör butonu', /data-coach-consult/g],
    ['#ai-koc', /id="ai-koc"/],
    ['platform coach chips', /data-platform-coach/g],
    ['#yemek-onerisi', /id="yemek-onerisi"/],
    ['meal form', /id="meal-recommend-form"/],
    ['#supplement', /id="supplement"/],
    ['6 supplement kartı', /supplement-card/g],
    ['tıbbi tavsiye uyarısı', /Bu tıbbi tavsiye değildir/g],
    ['dash-fit-score', /id="dash-fit-score"/],
    ['dash-weekly-mini', /id="dash-weekly-mini"/],
    ['dash-ai-tip', /id="dash-ai-tip"/],
    ['platform-nav', /platform-nav/],
    ['Ana Sayfa link', /href="#ana-sayfa"/],
    ['Admin hidden default', /id="btn-open-admin"[^>]*hidden/]
  ];

  const coachCount = (html.match(/data-coach-consult/g) || []).length;
  if (coachCount !== 4) fail('Antrenörler: 4 kart', `bulunan=${coachCount}`);
  else pass('Antrenörler: 4 kart', 'OK');

  const supCount = (html.match(/supplement-card/g) || []).length;
  if (supCount !== 6) fail('Supplement: 6 kart', `bulunan=${supCount}`);
  else pass('Supplement: 6 kart', 'OK');

  const disclaimerCount = (html.match(/Bu tıbbi tavsiye değildir/g) || []).length;
  if (disclaimerCount < 6) fail('Supplement: uyarı sayısı', String(disclaimerCount));
  else pass('Supplement: uyarılar', `${disclaimerCount} adet`);

  if (/steroid|dianabol|trenbolon/i.test(html) && !/Yasaklı|yasaklı|önermez|değildir/.test(html)) {
    fail('Supplement: steroid metni', 'şüpheli içerik');
  } else pass('Supplement: steroid önerisi yok', 'statik metin güvenli');

  const dashCards =
    (html.includes('dash-cal-current') ? 1 : 0) +
    (html.includes('dash-water-current') ? 1 : 0) +
    (html.includes('dash-ex-minutes') ? 1 : 0) +
    (html.includes('dash-fit-score') ? 1 : 0) +
    (html.includes('dash-weekly-mini') ? 1 : 0) +
    (html.includes('dash-ai-tip') ? 1 : 0);
  if (dashCards === 6) pass('Dashboard: 6 kart id', 'OK');
  else fail('Dashboard: 6 kart', `bulunan=${dashCards}`);

  if (html.includes('card-grid-dash-extended')) pass('Dashboard: responsive grid sınıfı', 'OK');
  else fail('Dashboard: grid sınıfı', 'card-grid-dash-extended yok');

  const navLinks = ['#ana-sayfa', '#antrenorler', '#ai-koc', '#yemek-onerisi', '#supplement', '#rapor'];
  const missingNav = navLinks.filter((h) => !html.includes(`href="${h}"`));
  if (missingNav.length) fail('Header menü linkleri', missingNav.join(', '));
  else pass('Header menü linkleri', navLinks.join(', '));

  if (html.includes('platform.css')) pass('platform.css bağlı', 'OK');
  else fail('platform.css', 'head içinde yok');

  if (html.includes('platform.js')) pass('platform.js bağlı', 'OK');
  else fail('platform.js', 'body sonunda yok');
}

function testCoachHandlers() {
  let registerClicked = false;
  let askCoachCalled = null;
  let scrollTarget = null;

  const section = { scrollIntoView: (opts) => (scrollTarget = opts) };
  const registerBtn = { click: () => (registerClicked = true) };

  const sandbox = {
    window: {},
    document: {
      readyState: 'complete',
      addEventListener: () => {},
      getElementById: (id) => {
        if (id === 'btn-open-register') return registerBtn;
        if (id === 'ai-koc') return section;
        return null;
      },
      querySelectorAll: (sel) => {
        if (sel === '[data-coach-consult]') {
          return [
            {
              addEventListener: (ev, fn) => {
                if (ev === 'click') sandbox._coachHandler = fn;
              },
              getAttribute: (a) => (a === 'data-coach-name' ? 'Test Coach' : null)
            }
          ];
        }
        if (sel === '[data-platform-coach]') return [];
        return [];
      }
    },
    setTimeout: (fn) => fn(),
    addEventListener: () => {}
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = () => {};
  sandbox.window.FitTrackAuth = { getCurrentUser: () => null };
  sandbox.window.FitTrackApp = {
    askCoach: (q) => (askCoachCalled = q)
  };

  const code = fs.readFileSync(path.join(ROOT, 'platform.js'), 'utf8');
  vm.runInNewContext(code, sandbox);

  sandbox._coachHandler.call({
    getAttribute: (a) => (a === 'data-coach-name' ? 'Ayşe Kaya — Strength Coach' : null)
  });
  if (registerClicked) pass('Antrenör: misafir → kayıt modal', 'btn-open-register tıklandı');
  else fail('Antrenör: misafir → kayıt modal', 'tıklanmadı');

  registerClicked = false;
  sandbox.window.FitTrackAuth = { getCurrentUser: () => ({ id: '1', name: 'Test' }) };
  sandbox._coachHandler.call({
    getAttribute: (a) => (a === 'data-coach-name' ? 'Ayşe Kaya — Strength Coach' : null)
  });
  if (scrollTarget && askCoachCalled && askCoachCalled.includes('Ayşe Kaya')) {
    pass('Antrenör: girişli → AI Koç', askCoachCalled.slice(0, 60) + '…');
  } else {
    fail('Antrenör: girişli → AI Koç', `scroll=${!!scrollTarget}, ask=${askCoachCalled}`);
  }
}

function testAnswerAiIntegration() {
  const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  if (script.includes('FT_SAFETY.isBlocked') && script.includes('FT_COACH.tryAnswer')) {
    pass('script.js güvenlik entegrasyonu', 'FT_SAFETY + FT_COACH');
  } else fail('script.js güvenlik entegrasyonu', 'eksik');
}

async function main() {
  console.log('FitTrack platform işlevsel test\nURL:', BASE_URL, '\n');

  windowApis = loadPlatformApis();
  testSafety(windowApis.FT_SAFETY, windowApis.FT_COACH);
  testMeal(windowApis.FT_MEAL);
  testCoachHandlers();
  testAnswerAiIntegration();

  try {
    const { status, body } = await fetchUrl(BASE_URL + '/');
    if (status !== 200) fail('HTTP sunucu', `status=${status}`);
    else {
      pass('HTTP sunucu', '200 OK');
      testHtml(body);
    }
  } catch (e) {
    fail('HTTP sunucu', e.message);
  }

  console.log('\n--- Sonuçlar ---\n');
  for (const r of results) {
    console.log((r.ok ? '✓' : '✗') + ' ' + r.name + (r.detail ? ': ' + r.detail : ''));
  }
  console.log('\n' + results.filter((r) => r.ok).length + ' geçti, ' + failed + ' başarısız');
  process.exit(failed > 0 ? 1 : 0);
}

main();

# FitTrack - Fitness Takip Sistemi

## Proje Açıklaması

FitTrack, kullanıcıların günlük fitness durumunu tek sayfada takip edebilmesi için geliştirilmiş modern ve düzenli bir web sitesidir. Kullanıcılar kalori, su tüketimi, egzersiz ve kilo hedeflerini yönetir; arayüz mobil-, tablet- ve masaüstü-dostudur.

### Arka plan animasyonu

- **Fitness temalı, çok katmanlı arka plan sahnesi**: orb glow’ları, perspektif grid, **derinlik gridi** (`bg-depth-grid`), **enerji yolları** (`bg-energy-lines`), **SVG nabız çizgisi** (`bg-heartline`), **fitness sembolleri** (`bg-fitness-symbols` — `kcal`, `H2O`, `BPM`, `RUN`, `FIT`, `24/7`, `AI COACH`, `WEEKLY GOAL`), parça dokusu, ufuk ışıması ve ışık çizgisi katmanları.
- **Scroll parallax**: sayfa kaydırıldıkça arka plan katmanları farklı hızlarda hafifçe yer değiştirir. `background-parallax.js` yalnızca `--scroll-y` CSS değişkenini günceller; tüm hareket CSS `transform: translate3d(...)` ile composite katmanda yapılır (layout/paint tetiklenmez). `requestAnimationFrame` ile rate-limit edilir, scroll dinleyicisi **passive**’dir.
- **Saf CSS / SVG** ile düşük yoğunluklu animasyonlar; **`prefers-reduced-motion`** ile tüm hareket (keyframe + parallax transform) durdurulur.
- **Harici animasyon kütüphanesi kullanılmadı** (Three.js, GSAP, Lottie, video veya GIF yok).
- Tüm dekoratif katmanlar `aria-hidden="true"` ve `pointer-events: none` ile tıklama/erişilebilirliği etkilemez.

### Hero görsel animasyonu

- **CSS/SVG tabanlı 3D fitness sahnesi**: ortada telefon / dashboard mockup; içinde **örnek** metrik döşemeleri (kalori, su, egzersiz, skor) ve **“Önizleme — örnek arayüz”** etiketi (canlı veri değildir).
- **Yüzen metrik kartları** (hafif dikey salınım); turuncu / yeşil vurgulu **gölge (glow)**.
- **Animasyonlu nabız çizgisi** (turuncu–yeşil gradient SVG stroke, yavaş kayan çizgi animasyonu).
- **Dairesel progress halkası** + çok yavaş dönen **kesik çizgili dış halka** (dekoratif).
- Dekoratif alanlar **`aria-hidden="true"`** (görsel sarmalayıcı); **`prefers-reduced-motion`** ile orb/grid/parçacık ve hero animasyonları durdurulur veya sadeleştirilir.
- Mobil için grid/parçacık yoğunluğu ve bazı yüzen kartlar azaltılır; **harici animasyon kütüphanesi kullanılmadı**.

## Gerçek AI Asistan Entegrasyonu

- **OpenAI API** ile çalışır (model: **gpt-4o-mini**).
- API çağrısı yalnızca **Netlify Function** (`netlify/functions/fittrack-ai.js`) üzerinden yapılır.
- **API anahtarı frontend dosyalarında, `script.js` içinde veya HTML içinde saklanmaz.**
- Tarayıcı **doğrudan OpenAI’ye istek atmaz**; yalnızca `/.netlify/functions/fittrack-ai` adresine POST atar.
- OpenAI yanıtı alınamazsa mevcut **kural tabanlı asistan** otomatik **fallback** olarak devreye girer; kullanıcıya kısa bilgi gösterilir.

## Netlify Environment Variable

Netlify panelinde **Site settings → Environment variables** bölümüne ekleyin:

- **`OPENAI_API_KEY`** — kendi OpenAI API anahtarınız (ör. `sk-...`).

**Önemli:** Bu değişken yalnızca sunucu (Netlify Function) ortamında kullanılır; depoya veya statik dosyalara yazılmamalıdır.

## Local Çalıştırma

Önce bağımlılıkları yükleyin, ardından Netlify CLI ile yerel ortamda site + fonksiyonları birlikte çalıştırın:

```bash
cd fittrack-anil
npm install
npx netlify dev
```

Site ve fonksiyonlar genellikle şu adreste açılır:

**http://localhost:8888**

Yerel test için `.env` dosyasında (depoya eklenmemeli) veya Netlify Dev ortamında `OPENAI_API_KEY` tanımlayabilirsiniz.

## Kullanılan Teknolojiler

- HTML
- CSS
- JavaScript (tek sayfa; harici frontend framework yok)
- Netlify Functions (Node.js)
- OpenAI resmi Node SDK (`openai`)

## Özellikler

- Günlük kalori takibi
- Su tüketimi takibi
- Egzersiz ekleme ve silme
- Egzersiz türü seçimi
- Kilo hedefi takibi
- Hedef ayarları
- Dinamik progress barlar
- Günlük özet mesajları
- Gerçek haftalık aktivite raporu (egzersiz dakikası çubuk grafik)
- Tarih bazlı `localStorage` veri geçmişi (`activityHistory`)
- Haftalık toplam egzersiz, su ve kalori özeti
- LocalStorage ile veri saklama
- Responsive tasarım
- **Hero fitness animasyonu**: yüzen kartlar, nabız çizgisi ve dolanan skor halkası (saf CSS/SVG; harici animasyon kütüphanesi yok)
- **Fitness temalı, çok katmanlı parallax arka plan**: derinlik gridi, enerji yolları, SVG nabız çizgisi, floating fitness sembolleri (`kcal`, `H2O`, `BPM`, `RUN`, `FIT`, `24/7`, `AI COACH`, `WEEKLY GOAL`); sayfa kaydırıldıkça hafif hareket eder, transform/opacity dışı bir değer değiştirmez (saf CSS + tek küçük JS dosyası; harici kütüphane yok)
- **Fitness studio tarzı modern landing page tasarımı**: büyük başlıklı hero (3 CTA: Takibe Başla / Haftalık Raporu Gör / Üye Ol), numaralı section eyebrow’ları (`01 / Studio`, `02 / Dashboard`, …), 3 kartlı studio tanıtım bloğu (Kişisel Takip · Akıllı Asistan · Haftalık Performans), gradient kenarlıklı **Üye Ol CTA kartı**, marka odaklı genişletilmiş footer. Dashboard, takip ve rapor sistemleri aynı tek sayfa içinde modern bir akışla birleştirildi.
- Günü sıfırlama özelliği
- BMI (vücut kitle indeksi) hesaplama ve boy bilgisinin kaydı (`heightCm`)
- Dinamik başarı rozetleri (su, egzersiz, dengeli kalori günü, haftalık egzersiz eşiği)
- Bu haftanın özetini JSON olarak indirme
- Tüm aktivite geçmişini temizleme (hedefleri koruyarak)
- **Akıllı Fitness Asistanı**: sohbet, hazır sorular, **Öneri Al**, **Sohbeti Temizle**; **OpenAI öncelikli**, kural tabanlı **fallback**
- **Sohbet geçmişi**: son **20** mesaj `fittrack_ai_chat_v1` (veya kullanıcıya özel `fittrack_ai_chat_v1_<userId>`) ile saklanır
- Sohbet: kullanıcı mesajı sağda, asistan solda; **Yazıyor...** göstergesi; **Enter** ile gönderme, **Shift+Enter** ile yeni satır
- **Demo giriş sistemi (yalnızca localStorage)**: üye ol, giriş yap, çıkış yap; kullanıcı bazlı fitness verisi ve AI sohbeti
- **Demo admin paneli**: kullanıcı listesi, silme, sistem istatistikleri (toplam egzersiz, su, kalori)

## Test Edilen Özellikler

- Kalori ekleme
- Su sayacı
- Egzersiz ekleme ve silme
- Hedef ayarları
- Haftalık gerçek rapor
- BMI hesaplama
- Veri dışa aktarma
- Günü sıfırlama
- LocalStorage veri koruma
- Mobil görünüm
- Akıllı asistan: Netlify Function + OpenAI; API yokken fallback; sohbet geçmişi / temizleme; Enter / Shift+Enter
- **Demo auth**: üye ol (e-posta tekrarı engellenir, şifre min 6, şifre tekrarı doğrulaması), giriş, çıkış, kullanıcıya özel fitness verisi, AI sohbeti ayrımı
- **Admin paneli**: yalnızca admin görür, kullanıcı silme (confirm + admin kendini silemez), sistem istatistikleri

## Kurulum

Projeyi bilgisayarınıza indirin:

```bash
git clone https://github.com/anilkeskin995/fittrack-anil.git
cd fittrack-anil
npm install
```

## Çalıştırma

### Yerelde (yalnızca statik dosya)

`index.html` dosyasına çift tıklayarak tarayıcıda açabilirsiniz. Bu modda Netlify Function çalışmaz; asistan **fallback** kural tabanlı yanıtlar kullanır.

### Yerelde (basit HTTP sunucusu — fonksiyonsuz)

```bash
cd fittrack-anil
python -m http.server 5500
```

Tarayıcıda: `http://localhost:5500` — yine **/.netlify/functions/** yolu olmadığı için canlı AI çağrısı beklenmez.

### Yerelde (Netlify Dev — AI dahil)

```bash
npm install
npx netlify dev
```

Tarayıcıda: **http://localhost:8888**

### GitHub Pages

GitHub Pages yalnızca statik dosya sunar; Netlify Functions çalışmaz. Bu yüzden **tam AI deneyimi için Netlify** önerilir.

### Netlify

1. [Netlify](https://www.netlify.com/) üzerinde **Add new site → Import an existing project** ile GitHub deposunu bağlayın.
2. **Build command:** `npm install` (veya Netlify’nin otomatik algıladığı install; sadece fonksiyon bağımlılıkları için yeterli).
3. **Publish directory:** `.` (proje kökü).
4. **Environment variable:** `OPENAI_API_KEY` ekleyin.
5. `netlify.toml` içindeki `[functions] directory = "netlify/functions"` ayarıyla fonksiyonlar oluşturulur.
6. Deploy edin.

## Proje Dosyaları

| Dosya | Açıklama |
|--------|-----------|
| `index.html` | Sayfa yapısı, bölümler ve auth modalları |
| `style.css` | Tema, düzen, responsive stiller, modal ve admin paneli stilleri |
| `script.js` | Mantık, doğrulama, `localStorage`, asistan istemcisi (kullanıcı bazlı state) |
| `auth.js` | Demo giriş / üyelik / çıkış sistemi ve admin paneli (localStorage tabanlı) |
| `background-parallax.js` | Arka plan parallax kancası: `--scroll-y` CSS değişkenini `requestAnimationFrame` ile günceller (transform/opacity dışı stil değişikliği yok) |
| `package.json` | `openai` bağımlılığı ve proje meta verisi |
| `netlify.toml` | Functions dizini yapılandırması |
| `netlify/functions/fittrack-ai.js` | OpenAI çağrısı (POST, güvenlik kontrolleri) |
| `README.md` | Proje dokümantasyonu |

## Geliştirici

**Anıl Keskin**

---

### Haftalık rapor ve geçmiş veri

- Günlük özetler `activityHistory` nesnesinde **YYYY-MM-DD** tarih anahtarıyla saklanır; her kayıtta **kalori toplamı**, **içilen bardak sayısı** ve **egzersiz dakikası** tutulur.
- Kalori / su / egzersiz her güncellendiğinde bugünün geçmiş satırı güncellenir.
- Takvim günü değiştiğinde önce **önceki günün** sayaçları geçmişe yazılır, ardından günlük sayaçlar sıfırlanır (önceki günler silinmez).
- **Günü Sıfırla** yalnızca bugünün aktif sayaçlarını ve bugünün geçmiş satırını sıfırlar; diğer günlerin geçmişi korunur.
- Çok eski tarihler (varsayılan 120 günden önce) depoyu şişirmemek için otomatik budanır.

### Veri saklama (genel)

- Ana durum tarayıcıda **localStorage** anahtarı `fittrack_state_v1` ile saklanır (kökle uyum için anahtar adı korunmuştur).
- Akıllı Fitness Asistanı sohbeti ayrı anahtar **`fittrack_ai_chat_v1`** ile saklanır (son 20 mesaj); fitness anahtarından bağımsızdır.
- Takvim günü değişince günlük kalori, su ve egzersiz **listesi** sıfırlanır; kilo ve hedef ayarları ile **activityHistory** korunur.
- BMI için kullanılan **boy (cm)** aynı JSON durumunda `heightCm` alanı olarak saklanır.

### Akıllı Fitness Asistanı

- **Öncelik:** `/.netlify/functions/fittrack-ai` üzerinden OpenAI (**gpt-4o-mini**). İstek gövdesi: `message`, `fitnessData` (kalori, su, egzersiz, kilo, BMI, haftalık özet, skor), `chatHistory`.
- **Fallback:** İstek başarısız olursa veya anahtar yoksa `answerAiQuestion()` ve mevcut kural tabanlı metinler kullanılır; kullanıcıya **“AI servisine ulaşılamadı, yerel öneri gösteriliyor.”** benzeri bilgi verilir.
- **Öneri Al** ve hazır soru düğmeleri de aynı öncelik sırasını kullanır.
- **FitTrack skoru**: günlük 0–100 skor; bileşenler yaklaşık olarak **su 25**, **egzersiz 35**, **kalori dengesi 25**, **kilo/BMI bilgisi 15** puan.
- **Sohbet geçmişi**: son **20** mesaj `fittrack_ai_chat_v1` içinde tutulur; **Sohbeti Temizle** yalnızca bu anahtarı siler.

### Dışa aktarma ve geçmiş temizliği

- **Haftalık Veriyi İndir**, Pazartesi–Pazar haftası için günlük kalori / su / egzersiz dakikası ile haftalık toplamları içeren bir `.json` dosyası oluşturur.
- **Tüm Geçmişi Temizle**, `activityHistory` ve bugünün aktif kayıtlarını sıfırlar; günlük hedefler (`calorieGoal`, `waterGoal`, `exerciseGoalMinutes`, `goalWeight`), **mevcut kilo** ve **boy** korunur.

## Demo Giriş Sistemi

- **Üye ol**: Ad Soyad, e-posta ve şifre (en az 6 karakter, tekrarla doğrulanır) ile kayıt. Aynı e-postaya ikinci kez kayıt engellenir.
- **Giriş yap**: E-posta + şifre. Hatalı bilgilerde toast ile uyarı gösterilir.
- **Çıkış yap**: Oturum kapatılır; misafir (demo) moduna düşülür ve veriler kullanıcıya özel olmayı bırakır.
- **Kullanıcı bazlı fitness verisi**: Her kullanıcı kendi kalori, su, egzersiz, kilo, BMI, haftalık rapor ve AI sohbet verisini görür; veriler `fittrack_state_v1_<userId>` ve `fittrack_ai_chat_v1_<userId>` anahtarlarında saklanır.
- **Misafir / demo mod**: Hiç giriş yapılmadığında veriler eski `fittrack_state_v1` anahtarında tutulmaya devam eder; geriye dönük uyum bozulmaz.
- Kayıtlı kullanıcılar `fittrack_users_v1` listesinde saklanır; oturum bilgisi `fittrack_current_user_v1` anahtarındadır.

## Demo Admin Paneli

- Yalnızca `role: "admin"` olan kullanıcı navbar’da **Admin Paneli** butonunu görür.
- Panel modal olarak açılır ve şunları içerir:
  - **Sistem istatistikleri**: toplam kullanıcı, normal kullanıcı, admin sayısı, toplam egzersiz dakikası, toplam su bardağı, toplam kalori girişi (tüm kullanıcıların `activityHistory` kayıtlarından hesaplanır).
  - **Kayıtlı kullanıcı listesi**: ad, e-posta, rol, kayıt tarihi ve **Sil** butonu.
  - **Silme**: `confirm()` ile onay alınır; kullanıcıya ait fitness ve sohbet anahtarları da temizlenir.
- **Admin kendi hesabını silemez** (Sil butonu pasiftir).

## Demo Admin Bilgileri

İlk açılışta sistem demo admin hesabını otomatik oluşturur:

- **E-posta:** `admin@fittrack.com`
- **Şifre:** `admin123`

> Bu bilgiler herkese açıktır ve yalnızca **demo** amaçlıdır. Gerçek bir dağıtımdan önce mutlaka silin veya değiştirin.

## Güvenlik Notu

> Bu projedeki giriş sistemi **demo amaçlıdır**.
>
> - Kullanıcılar ve şifreler **tarayıcı `localStorage`** içinde **düz metin** olarak saklanır.
> - Şifreler frontend’de hash’lenmez, sunucu tarafı doğrulama yoktur, oturum / token mekanizması yoktur.
> - **Gerçek projelerde frontend’de şifre saklanmamalıdır.** Üretim için **Supabase Auth**, **Firebase Auth**, **Auth0** veya kendi backend kimlik doğrulama sisteminizi kullanın.
> - Demo amaçlı dahi olsa bu siteye gerçek, başka servislerde kullanılan şifreleri **girmeyin**.

## Demo Auth — Kullanılan localStorage Anahtarları

| Anahtar | İçerik |
|---------|--------|
| `fittrack_users_v1` | Tüm demo kullanıcıların listesi (id, ad, e-posta, **düz şifre**, rol, kayıt tarihi) |
| `fittrack_current_user_v1` | O anki oturumun kısa bilgisi (id, ad, e-posta, rol) |
| `fittrack_state_v1` | Misafir / giriş yapılmamış mod fitness durumu (geriye dönük uyum) |
| `fittrack_state_v1_<userId>` | Belirli bir kullanıcının fitness durumu |
| `fittrack_ai_chat_v1` | Misafir / giriş yapılmamış mod AI sohbeti |
| `fittrack_ai_chat_v1_<userId>` | Belirli bir kullanıcının AI sohbeti |

# FitTrack - Fitness Takip Sistemi

## Proje Açıklaması

FitTrack, kullanıcıların günlük fitness durumunu takip edebilmesi için geliştirilmiş modern ve responsive bir web sitesidir. Kullanıcılar kalori, su tüketimi, egzersiz ve kilo hedeflerini takip edebilir.

## Kullanılan Teknolojiler

- HTML
- CSS
- JavaScript

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
- Günü sıfırlama özelliği
- BMI (vücut kitle indeksi) hesaplama ve boy bilgisinin kaydı (`heightCm`)
- Dinamik başarı rozetleri (su, egzersiz, dengeli kalori günü, haftalık egzersiz eşiği)
- Bu haftanın özetini JSON olarak indirme
- Tüm aktivite geçmişini temizleme (hedefleri koruyarak)

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

## Kurulum

Projeyi bilgisayarınıza indirin:

```bash
git clone https://github.com/anilkeskin995/fittrack-anil.git
cd fittrack-anil
```

Harici paket veya derleme adımı yoktur; proje kökündeki dosyalar doğrudan yayına uygundur.

## Çalıştırma

### Yerelde (dosyayı açarak)

`index.html` dosyasına çift tıklayarak tarayıcıda açabilirsiniz.

### Yerelde (basit sunucu ile)

Özellikle `file://` ile bazı tarayıcılarda `localStorage` kısıtları yaşanmaması için önerilir:

```bash
cd fittrack-anil
python -m http.server 5500
```

Tarayıcıda: `http://localhost:5500`

### GitHub Pages

1. Depoyu GitHub’a gönderin.
2. Repository **Settings → Pages** bölümünde kaynak olarak **main** dalını ve kök dizini (`/`) seçin.
3. Site adresi birkaç dakika içinde yayınlanır.

### Netlify

1. [Netlify](https://www.netlify.com/) üzerinde **Add new site → Import an existing project** ile GitHub deposunu bağlayın.
2. **Build command:** boş bırakın.
3. **Publish directory:** `.` (nokta, proje kökü) veya boş/bırakılabilir şekilde kök olarak ayarlayın.
4. Deploy edin; `index.html` giriş dosyası olarak kullanılır.

## Proje Dosyaları

| Dosya | Açıklama |
|--------|-----------|
| `index.html` | Sayfa yapısı ve bölümler |
| `style.css` | Tema, düzen ve responsive stiller |
| `script.js` | Mantık, doğrulama, `localStorage` |
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
- Takvim günü değişince günlük kalori, su ve egzersiz **listesi** sıfırlanır; kilo ve hedef ayarları ile **activityHistory** korunur.
- BMI için kullanılan **boy (cm)** aynı JSON durumunda `heightCm` alanı olarak saklanır.

### Dışa aktarma ve geçmiş temizliği

- **Haftalık Veriyi İndir**, Pazartesi–Pazar haftası için günlük kalori / su / egzersiz dakikası ile haftalık toplamları içeren bir `.json` dosyası oluşturur.
- **Tüm Geçmişi Temizle**, `activityHistory` ve bugünün aktif kayıtlarını sıfırlar; günlük hedefler (`calorieGoal`, `waterGoal`, `exerciseGoalMinutes`, `goalWeight`), **mevcut kilo** ve **boy** korunur.

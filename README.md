# Lexis — IELTS kelime ve kalıp antrenörü

Yunus için yapılmış kişisel bir PWA (ana ekrana eklenebilen web uygulaması). Bilmediğin kelime, kalıp ve gramer hatalarını kaydedersin; uygulama onları **FSRS aralıklı tekrar** algoritmasıyla, unutmak üzereyken tekrar gösterir.

- Sunucu yok, hesap yok, API anahtarı yok. Tüm veriler iPhone'da (IndexedDB) durur.
- İnternet yokken de çalışır (service worker).
- Sözlük bilgisi (IPA, telaffuz, İngilizce tanım) ücretsiz servislerden otomatik gelir: dictionaryapi.dev, yedek olarak Datamuse.
- Türkçe anlam, collocation ve boşluk doldurma cümleleri **Claude ile kopyala-yapıştır** yöntemiyle eklenir.

## Çalışma modları

| Öğe | Mod | Ne yaparsın |
|---|---|---|
| Kelime/kalıp — tanıma | Tanıma | Kelimeyi görürsün, anlamını hatırlarsın, kendini değerlendirirsin |
| | Dinle & yaz | Kelimeyi sadece duyarsın, yazarsın (oranı Profil'den ayarlanır) |
| Kelime/kalıp — üretim | Üretim | Türkçe anlam ve İngilizce tanımı görürsün, İngilizcesini yazarsın |
| | Boşluk doldur | Cümledeki boşluğa kelimeyi yazarsın (senin bağlam cümlen ya da Claude'un cümleleri) |
| | Collocation | "____ the risk" gibi kalıbı tamamlarsın |
| Hata defteri | Düzelt | Kendi yanlış cümleni görürsün, doğrusunu yazarsın |

Yeni bir kelime önce **tanıma** kartı olarak gelir, ertesi gün **üretim** kartı açılır. Aynı kelimenin iki kartı aynı gün gösterilmez.

**Yaz** sekmesi: tekrar aşamasındaki kelimelerinden 10 tanesiyle IELTS Task 2 tarzı bir soruya paragraf yazarsın. Claude band tahmini verir, hataların tek dokunuşla hata defterine eklenir.

## iPhone'a kurulum

1. Uygulama GitHub Pages'te yayınlanır: **https://yunusemrecirak.github.io/lexis/**
2. iPhone'da bu adresi **Safari** ile aç (Chrome ile olmaz).
3. Paylaş ⬆︎ → **Ana Ekrana Ekle** → Ekle.
4. Artık ana ekrandaki **Lexis** ikonundan aç. Veriler bu ikona bağlıdır; Safari sekmesindeki kopya ayrı bir depolamadır.

## Kelime havuzu

Uygulamanın içinde Türkçe anlamı, örneği, boşluk cümlesi ve collocation'larıyla **hazır** gelen üç havuz var (Claude zenginleştirmesi gerekmez):

| Havuz | Kart | İçerik |
|---|---|---|
| IELTS konu kelimeleri | 190 | Task 2 / Speaking Part 3'ün 16 konusundan C1 kelimeler (çevre, eğitim, teknoloji, sağlık, iş, toplum, hukuk, ekonomi, bilim, medya, şehir, küreselleşme, suç, aile, turizm, kültür) |
| Türk öğrencilerin tipik hataları | 61 | Ana dil etkisinden kaynaklanan hatalar (edat, article, uyum, sayılabilirlik, zaman, cümle yapısı, kelime seçimi); “düzelt” kartı olarak |
| IELTS akademik kalıplar | 109 | Writing Task 1/2 ve Speaking kalıpları |

Günlük yeni kartlar konulara karışık gelir; Profil → Kelime havuzu'ndan her kaynağı açıp kapatabilir, sıklığını (×1–×3) ayarlayabilirsin.

AWL (570) ve Oxford 5000 B2–C1 (2.721) listeleri telif nedeniyle bu açık depoda **yoktur**; ayrı bir dosya olarak yüklenir:

1. `TOEFL_IELTS_Hazirlik/Lexis_Havuz_Paketi.json` dosyasını iPhone'a aktar (OneDrive uygulaması → Paylaş → Dosyalar'a Kaydet, ya da AirDrop).
2. Lexis → Profil → **Havuz paketini yükle** → dosyayı seç.

Havuz sadece günlük yeni kart kotan kendi kelimelerinle dolmadığında devreye girer. Bildiğin bir havuz kelimesine "Bunu zaten biliyorum" de; kotadan düşmeden atlanır.

## Claude ile zenginleştirme

Bugün → **Claude ile zenginleştir** → Komutu kopyala → Claude uygulamasına yapıştır → gelen JSON cevabı kopyala → **Panodan uygula**. Bilgisayarda Claude Code'a da yapıştırabilirsin.

## Yedek

Profil → **Yedekle** ile JSON dosyasını iCloud Drive'a kaydet (haftada bir; uygulama hatırlatır). iOS güncellemeleri nadiren web verisini silebilir; yedek, tek güvencen.

## Güncelleme yayınlamak (geliştirici notu)

1. Değişikliği yap.
2. `js/version.js` içindeki `APP_VERSION` ile `sw.js` içindeki `CACHE` değerini birlikte artır (ör. `1.0.1` / `lexis-v1.0.1`).
3. `git commit` + `git push`. Uygulama bir sonraki açılışta "Yeni sürüm hazır → Güncelle" gösterir. Görünmezse uygulamadan çıkıp tekrar gir.
4. Yeni bir yerleşik havuz eklerken ya da mevcut birini değiştirirken `js/data/*.js` içindeki `*_VERSION` değerini artır; uygulama o havuzu bir kez yeniden içe aktarır (zaten karta dönüşmüş kelimeler atlanır).

Yerel test: `python -m http.server 5317` (bu klasörde) → `http://localhost:5317`.

## Yapı

```
index.html, styles.css, manifest.webmanifest, sw.js
js/app.js            yönlendirici + açılış
js/store.js          IndexedDB + bellek içi durum + yedek
js/srs.js            FSRS, günlük kuyruk, kardeş kart gömme, havuz
js/dict.js           sözlük servisleri
js/tts.js            telaffuz (kayıt / iPhone sesi)
js/prompts.js        Claude komutları ve cevap ayrıştırma
js/views/*.js        ekranlar
js/data/phrases.js   IELTS kalıp havuzu (109)
js/data/topics.js    IELTS konu kelimeleri (190)
js/data/errors.js    tipik Türk öğrenci hataları (61)
js/vendor/ts-fsrs.mjs  FSRS algoritması (MIT, open-spaced-repetition/ts-fsrs 5.4.2)
```

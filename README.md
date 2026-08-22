# WebSCADA

**WebSCADA**, TEİAŞ YTBS (Yük Tevzi Bilgi Sistemi) topoloji modeli ile Superset üzerinden alınan SCADA verilerini tek bir Chrome eklentisi içinde **Datalar**, **Sorgular** ve **Harita** çalışma alanlarında birleştiren bağımsız bir Manifest V3 uygulamasıdır.

> Güncel sürüm: **v0.6.4**
> Eklenti tipi: **Chrome Extension / Manifest V3**  
> Ana dil: **Türkçe**  
> Çalışma modeli: **Yerel YTBS topolojisi + kurum Superset/SCADA verisi**

WebSCADA, daha önce ana otomasyon eklentisi içindeki **Harita Göster / SCADA** alt sisteminden ayrıştırılmıştır. Bu klasör kendi manifest, test, build, veri ve runtime dosyalarına sahiptir; parent repository dışındaki dosyalara runtime bağımlılığı olmadan ayrı bir GitHub repository olarak kullanılabilir.

---

## İçindekiler

- [Amaç](#amaç)
- [Temel özellikler](#temel-özellikler)
- [Uygulama sekmeleri](#uygulama-sekmeleri)
- [SCADA ve Superset mimarisi](#scada-ve-superset-mimarisi)
- [Kimlik doğrulama](#kimlik-doğrulama)
- [YTBS topoloji modeli](#ytbs-topoloji-modeli)
- [Kurulum](#kurulum)
- [Chrome'a yükleme](#chromea-yükleme)
- [Test ve build](#test-ve-build)
- [Paketleme](#paketleme)
- [Proje klasör yapısı](#proje-klasör-yapısı)
- [Sorgular çalışma alanı](#sorgular-çalışma-alanı)
- [Harita / SCADA davranışı](#harita--scada-davranışı)
- [Renk ve yüklenme mantığı](#renk-ve-yüklenme-mantığı)
- [Geçmiş veri](#geçmiş-veri)
- [CSV çıktıları](#csv-çıktıları)
- [Güvenlik](#güvenlik)
- [Yeni GitHub repository oluşturma](#yeni-github-repository-oluşturma)
- [Geliştirme kuralları](#geliştirme-kuralları)
- [Test yaklaşımı](#test-yaklaşımı)
- [Bilinen operasyonel notlar](#bilinen-operasyonel-notlar)
- [Sorun giderme](#sorun-giderme)
- [Sürüm geçmişi](#sürüm-geçmişi)

---

# Amaç

WebSCADA'nın amacı, elektrik iletim şebekesi topolojisi ile gerçek SCADA ölçümlerini aynı çalışma alanında bir araya getirmektir.

Uygulama şu üç ihtiyacı tek arayüzde karşılamayı hedefler:

1. **YTBS topoloji verisini incelemek**
2. **Superset/SCADA zaman serilerini sorgulamak**
3. **Canlı ve geçmiş SCADA değerlerini harita üzerinde izlemek**
4. **Chrome açıkken seçilmiş Hat/Trafo yüklenmelerini arka planda danışmanlık amaçlı izlemek**

WebSCADA doğrudan bir SCADA kontrol sistemi değildir. Uygulama, mevcut veri kaynaklarından aldığı bilgileri **görüntüleme, sorgulama, analiz ve karşılaştırma** amacıyla kullanır.

---

# Temel özellikler

- Chrome Manifest V3 eklentisi
- Bağımsız `Web_SCADA` kaynak yapısı
- Yerel YTBS topoloji modeli
- Superset chart API üzerinden SCADA sorguları
- Canlı SCADA haritası
- Geçmiş SCADA snapshot gösterimi
- Hat MW / MVar
- Trafo MW / MVar
- Bara / TM gerilim gösterimi
- Hat akış yönleri
- Yüklenme renkleri
- YTM ve gerilim seviyesi filtreleri
- SCADA kalite / eşleşme bilgileri
- Çok terminalli hat ve trafo ölçüm çözümü
- Terminal bazlı MW/MVar serileri
- Zaman aralığı sorguları
- İstenen / dönen çözünürlük analizi
- Sorgu sonucu tablosu
- Sorgu grafikleri
- CSV dışa aktarma
- Datalar sekmesinde gerçek sayfalama
- SCADA measurement coverage gösterimi
- Exact-ID ile haritaya odaklanma
- Standalone test/build desteği

---

# Uygulama sekmeleri

WebSCADA üç ana çalışma alanına ayrılır:

```text
Datalar | Sorgular | Alarmlar | Harita
```

## 1. Datalar

**Datalar** sekmesi YTBS topoloji envanterini görüntüler.

Desteklenen temel varlık tipleri:

- Trafo Merkezi
- Hat
- Bara
- Trafo - İletim
- Trafo - Dağıtım
- Santral desteği için mimari alan ayrılmıştır; güncel sürümde aktif değildir.

### Filtreler

- Genel arama
- Varlık tipi
- Yük Tevzi Müdürlüğü (YTM)
- Gerilim seviyesi
- SCADA eşleşme durumu

### SCADA coverage

Bir varlığın yalnızca "eşleşmiş/eşleşmemiş" durumu değil, mümkün olduğunda ilgili measurement coverage bilgisi de gösterilir.

Örnek:

```text
P 2 | Q 2
```

veya:

```text
U 2
```

### Satır işlemleri

Her varlık için:

- **Haritada Göster**
- **Sorgula**
- **Detay**

işlemleri bulunur.

### Sayfalama

Büyük topoloji listelerinin tamamı aynı anda DOM'a basılmaz.

Desteklenen sayfa boyutları:

- 50
- 100
- 250

---

## 2. Sorgular

**Sorgular** sekmesi seçilen YTBS varlığı için Superset/SCADA zaman serilerini sorgular.

### Zaman aralıkları

Hazır aralıklar:

- 1 saat
- 6 saat
- 24 saat
- 3 gün
- 7 gün
- Özel

### Granularity

Desteklenen çözünürlük seçenekleri:

- Otomatik
- 1 dakika
- 5 dakika
- 10 dakika
- 15 dakika
- 30 dakika
- 1 saat

Otomatik seçim zaman aralığına göre uygun çözünürlük önerir.

### Metric desteği

Varlığın gerçek SCADA mapping bilgisine göre uygun metrikler etkinleştirilir.

| Kod | Gösterim |
|---|---|
| `P` | MW |
| `Q` | MVar |
| `U` | Gerilim |
| `S` | Görünür güç, mapping varsa |
| `I` | Akım, mapping varsa |

### Çok terminalli hatlar

Bir hat veya trafonun birden fazla terminal ölçümü bulunabilir.

WebSCADA measurement'ları yalnızca `P` ve `Q` adına göre birleştirmez. Seri kimliği; varlık, terminal, measurement ID ve metric bilgileriyle ayrılır.

Örneğin iki terminalli bir hat için:

```text
DAVUTPAŞA → YILDIZTEPE | MW
YILDIZTEPE → DAVUTPAŞA | MW
DAVUTPAŞA → YILDIZTEPE | MVar
YILDIZTEPE → DAVUTPAŞA | MVar
```

ayrı seriler olarak ele alınabilir.

### Terminal filtresi

Birden fazla terminal varsa kullanıcı terminal bazında sonucu daraltabilir.

### Normalized query modeli

Superset'ten dönen ham satırlar doğrudan tablo/grafiğe verilmez.

WebSCADA bunları normalize ederek aşağıdaki anlamlı alanlarla işler:

- timestamp
- entity
- terminal/source
- measurement ID (`sinsid`)
- metric
- unit
- value
- quality
- series key / series label

Gerçek Superset zaman alanı olan `__timestamp`, Harita modülünde kullanılan SCADA timestamp semantiği ile yorumlanır.

### Sorgu özeti

Sorgu sonucunda mümkün olduğunda şu bilgiler gösterilir:

- Sorgu süresi
- Seçilen entity
- Measurement ID sayısı
- Terminal sayısı
- Seri sayısı
- Toplam satır
- Geçerli satır
- Geçersiz timestamp
- Geçersiz value
- Duplicate logical row
- İstenen çözünürlük
- Dönen/effective çözünürlük
- Batch durumu

### Grafik

Sorgu sonuçları terminal-aware zaman serileri halinde çizilir.

Mevcut grafik altyapısı:

- gerçek timestamp X ekseni
- MW / MVar negatif değer desteği
- terminal bazlı ayrı seriler
- seri legend'i
- seri aç/kapat
- metric family bazlı grafik gruplama
- yoğun seriler için görsel downsampling

Ham tablo ve CSV verisi downsample edilmez.

> Grafik etkileşimleri geliştirme alanıdır. Harita geçmiş grafiklerinde bulunan tüm ileri seviye zoom/pan/hover davranışlarının Sorgular grafiğinde birebir bulunduğu varsayılmamalıdır.

### Sorgu tablosu

Tablo şu bilgileri gösterir:

- Zaman
- Terminal / Kaynak
- Ölçüm
- Değer
- Birim
- Kalite
- SINSID
- Varlık

Sorgu tablosu 50 / 100 / 250 satırlık sayfalama kullanır.

---

## 3. Harita

**Harita** sekmesi mevcut modern YTBS/SCADA harita altyapısını içerir.

### Topoloji katmanları

- Baralar
- Trafo Merkezleri
- Hatlar
- Dağıtım trafoları
- İletim trafoları
- Bara Set

### Filtreler

- 400 kV
- 154 kV
- 66 kV
- YTM filtreleri
- Metin arama
- Katman görünürlüğü

### SCADA modları

- Hat (MW)
- Hat (MVar)
- Trafo (MW)
- Trafo (MVar)
- Gerilim (kV)

### Harita gösterim modları

Hat tarafında:

- Akış
- Isı Haritası
- Mevcut

Noktasal entity tarafında:

- Kutu
- Nokta (Ad)
- Nokta (Adsız)
- Isı Haritası

### Canlı / geçmiş

Harita:

- canlı SCADA
- geçmiş snapshot
- son 24 saat seçim aralığı
- seçilen tarih/saatte **Haritada Göster**
- **Canlıya Dön**

işlevlerini destekler.

---

# SCADA ve Superset mimarisi

Genel akış:

```text
WebSCADA UI
   │
   ├── Datalar
   ├── Sorgular
   └── Harita
          │
          ▼
Chrome MV3 Service Worker
          │
          ▼
Superset Auth / API / Query Service
          │
          ▼
Superset Chart API
          │
          ▼
Normalize / Mapping / SCADA Runtime
          │
          ▼
Harita / Tablo / Grafik / CSV
```

Service worker ana mesajları:

```text
SCADA_FETCH
SCADA_HISTORY_FETCH
SCADA_HISTORICAL_SNAPSHOT_FETCH
WEBSCADA_QUERY
```

Bunlar ayrı kullanım amaçlarına sahiptir:

- `SCADA_FETCH`: canlı/current snapshot
- `SCADA_HISTORY_FETCH`: zaman serisi
- `SCADA_HISTORICAL_SNAPSHOT_FETCH`: seçili geçmiş zamana ait snapshot
- `WEBSCADA_QUERY`: Sorgular sekmesi sorgusu

---

# Kimlik doğrulama

WebSCADA kurum Superset erişiminde **chart-first** yaklaşımı kullanır.

Genel mantık:

```text
Mevcut session/cookie ile chart isteği
        │
        ├── başarılı → veri kullanılır
        │
        └── auth gerekli
               ↓
        session recovery / retry
               ↓
        direct login
               ↓
        chart retry
               ↓
        gerekirse hidden-tab fallback
```

Gerçek chart yanıtı yetkilendirme açısından otoriter sonuçtur.

Hidden-tab login normal çalışma yolu değildir; mevcut session veya direct login yeterli olduğunda Superset sekmesi açılmaz.

---

# YTBS topoloji modeli

Temel runtime veri dosyaları:

```text
data/kml_layers_v2.json
data/mapping.json
```

Bu dosyalar WebSCADA'nın topoloji ve SCADA eşleştirme altyapısını sağlar.

Topoloji store modeli mümkün olduğunca bir kez yükler ve Datalar / Sorgular / Harita çalışma alanlarında paylaşır.

---

# Kurulum

## Gereksinimler

Önerilen geliştirme ortamı:

- Windows 10/11
- Google Chrome
- Node.js
- npm
- PowerShell
- Kurum ağı / Superset erişimi

WebSCADA'nın JavaScript runtime'ı için ayrıca bir frontend framework kurulumu gerekmez.

---

## Auth dosyasını hazırlama

Önce:

```text
data/scada_auth.example.json
```

dosyasını:

```text
data/scada_auth.json
```

olarak kopyalayın.

Örnek şema:

```json
{
  "baseUrl": "https://analytics.teias.gov.tr",
  "username": "",
  "password": "",
  "dashboardId": 89,
  "chartSliceId": 454,
  "enabled": false
}
```

Yerel kullanım için ilgili alanları ortamınıza göre düzenleyin ve `enabled` değerini gerçek kullanımda `true` yapın.

> **UYARI:** `data/scada_auth.json` gerçek kullanıcı adı ve parola içerebilir. Bu dosya Git'e commit edilmemelidir.

---

# Chrome'a yükleme

Build sonrası:

```text
dist/chrome-extension/
```

klasörü oluşur.

Chrome'da:

1. `chrome://extensions` adresini açın.
2. **Geliştirici modu**nu etkinleştirin.
3. **Paketlenmemiş öğe yükle** seçeneğini seçin.
4. `dist/chrome-extension` klasörünü gösterin.
5. WebSCADA ikonuna tıklayın.
6. Uygulama yeni bir Chrome sekmesinde açılır.

---

# Test ve build

## Test

```powershell
npm.cmd test
```

## Build

```powershell
npm.cmd run build
```

Eşdeğer:

```powershell
npm.cmd run build:extension
```

## Standalone doğrulama

WebSCADA'nın parent repository'ye bağımlı olmadığını doğrulamak için:

```powershell
npm.cmd run test:standalone
```

Standalone test, WebSCADA'yı geçici bir klasöre kopyalayıp parent repository dosyalarına ihtiyaç duymadan test ve build çalıştırır.

---

# Paketleme

Build scripti:

```text
scripts/build-extension.ps1
```

tarafından yürütülür.

Build öncesi:

- `data/scada_auth.json` var mı?
- JSON geçerli mi?
- `enabled=true` mi?
- `baseUrl` var mı?
- kullanıcı adı var mı?
- parola var mı?

kontrol edilir.

Eksik auth ile release ZIP oluşturulmaz.

Build çıktısı:

```text
dist/
├── chrome-extension/
└── WebSCADA_0.6.4_YYYYMMDD_HHMMSS.zip
```

Build sonunda SHA256 hesaplanır.

---

# Proje klasör yapısı

```text
Web_SCADA/
│
├── manifest.json
├── package.json
├── README.md
├── CHANGELOG.md
├── .gitignore
├── app.html
├── app.css
├── app.js
│
├── background/
│   ├── service-worker.js
│   ├── superset-auth.js
│   ├── superset-api.js
│   └── query-service.js
│
├── core/
│   ├── topology-store.js
│   ├── selection-store.js
│   ├── scada-utils.js
│   ├── entity-resolver.js
│   ├── query-normalizer.js
│   ├── workspace-utils.js
│   └── log-time.js
│
├── map/
│   ├── map-common.js
│   ├── map-modern.js
│   ├── map-modern.css
│   ├── map-v2-runtime.js
│   ├── scada-common.js
│   ├── scada-client.js
│   ├── scada-flow.js
│   └── scada-v2-runtime.js
│
├── data/
│   ├── kml_layers_v2.json
│   ├── mapping.json
│   ├── scada_auth.example.json
│   └── scada_auth.json
│
├── icons/
├── lib/
├── scripts/
├── tests/
└── dist/
```

---

# Sorgular çalışma alanı

## Superset response normalizasyonu

Gerçek Superset query response'larında aşağıdaki alanlar kullanılabilir:

```text
__timestamp
sinsid
elementName
AVG(maxValue)
```

WebSCADA bu alanları kullanıcı dostu query satırlarına dönüştürür.

`__timestamp` standart browser `Date` varsayımıyla doğrudan işlenmez; Harita SCADA runtime'ında kullanılan timestamp semantiği paylaşılır.

## Measurement descriptor

WebSCADA mümkün olduğunda şu metadata'yı taşır:

- measurement ID
- metric
- unit
- terminal side
- source TM
- target TM
- role
- polarization
- entity ID
- entity name

Bu yapı çok terminalli hatların doğru ayrılması için gereklidir.

## Effective grain

Superset'ten dönen gerçek timestamp aralıkları incelenerek yaklaşık effective grain hesaplanabilir.

Örnek:

```text
İstenen: 5 dk
Dönen: ~1 dk
```

Bu iki değer uyuşmazsa kullanıcı uyarılır.

WebSCADA bu durumda ham veriyi sessizce yeniden ortalamaz.

---

# Harita / SCADA davranışı

Harita kodu WebSCADA içinde bağımsız olarak tutulur.

Önemli davranışlar:

- SCADA stale-response koruması
- snapshot mantığı
- cache
- görünür entity hesapları
- YTM ve kV filtreleri
- hat yönleri
- MW/MVar renkleri
- gerilim representative seçimi
- B1/B2/BT ayrımı
- SCADA ranking paneli
- canlı/geçmiş geçişi

Harita üzerinde çalışan SCADA logic'i yeni özellik geliştirmelerinde gereksiz yere yeniden yazılmamalıdır.

---

# Renk ve yüklenme mantığı

## Hat MW yüklenme

| Yüklenme | Renk |
|---:|---|
| `0–55%` | Yeşil |
| `>55–65%` | Sarı |
| `>65–75%` | Turuncu |
| `>75–80%` | Kırmızı |
| `>80–90%` | Koyu kırmızı |
| `>90%` | Mor |
| Veri yok / invalid / unmatched | Gri |

## Hat MVar

Hat MVar gösterimi MW yüklenme eşiklerini kullanmaz.

Reaktif oran temel yaklaşımı:

```text
|Q| / |P| × 100
```

`|P| < 1 MW` durumunda oran güvenilir kabul edilmez ve hat gri/hesaplanamaz durumda gösterilir.

## Yön belirsizliği

Geçerli yüklenme değeri olup yönü güvenilir şekilde çözülemeyen hat:

- yüklenme rengiyle gösterilebilir,
- flow arrow gösterilmez,
- kullanıcıya yönün belirsiz olduğu belirtilir.

---

# Geçmiş veri

Harita geçmiş modu:

- son 24 saatlik varsayılan aralık
- 5 dakikalık seçim adımı
- slider ile tarih/saat seçimi
- yalnız **Haritada Göster** ile gerçek sorgu
- sorgu tamamlanana kadar mevcut görüntünün korunması
- **Canlıya Dön** işlevi

mantığını kullanır.

---

# CSV çıktıları

Sorgular CSV çıktısı normalize edilmiş alanlardan oluşturulur.

Hedef alanlar:

```text
Zaman
ZamanDilimi
Varlik
VarlikTipi
Terminal
KaynakTM
HedefTM
SINSID
Olcum
Birim
Deger
Kalite
```

CSV:

- `;` delimiter
- UTF-8 BOM

kullanır.

---

# Güvenlik

## Credential güvenliği

Aşağıdaki dosya **asla Git'e eklenmemelidir**:

```text
data/scada_auth.json
```

Mevcut `.gitignore`:

```gitignore
data/scada_auth.json
dist/
build/
node_modules/
```

Kontrol:

```powershell
git check-ignore -v data/scada_auth.json
git ls-files data/scada_auth.json
```

İkinci komutun çıktısı boş olmalıdır.

## Runtime ZIP uyarısı

Release ZIP içinde gerçek `scada_auth.json` bulunabilir.

Bu nedenle release ZIP herkese açık GitHub Releases alanına yüklenmemeli ve kontrolsüz paylaşılmamalıdır.

## Repository görünürlüğü

WebSCADA runtime topoloji ve mapping dosyaları içerir:

```text
data/kml_layers_v2.json
data/mapping.json
```

Bu nedenle yeni repository'nin ilk aşamada **Private** oluşturulması önerilir.

Public repository düşünülüyorsa topoloji, SCADA mapping, kurum host bilgileri ve diğer kurumsal metadata'nın kamusal paylaşım için uygunluğu ayrıca doğrulanmalıdır.

---

# Yeni GitHub repository oluşturma

`Web_SCADA` klasörü parent projeden ayrılarak ayrı repository yapılabilir.

## 1. Klasörü yeni konuma kopyalayın

Örnek:

```text
C:\Projeler\WebSCADA
```

Yeni klasörün içi doğrudan:

```text
manifest.json
package.json
app.html
...
```

ile başlamalıdır.

## 2. Standalone test

Yeni klasörde:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:standalone
```

çalıştırın.

## 3. Git repository başlatın

```powershell
cd C:\Projeler\WebSCADA
git init
git branch -M main
```

## 4. Credential kontrolü

```powershell
git check-ignore -v data/scada_auth.json
git status --short
```

`data/scada_auth.json` staged/tracked olmamalıdır.

## 5. İlk commit

```powershell
git add .
git diff --cached --name-only
```

Listede `data/scada_auth.json` olmadığını doğrulayın.

Ardından:

```powershell
git commit -m "Initial WebSCADA standalone release"
```

## 6. GitHub repository

Önerilen:

```text
Repository name: WebSCADA
Visibility: Private
```

GitHub'da yeni repository'yi oluştururken README/.gitignore/license eklememek işleri kolaylaştırır; bunlar yerelde zaten vardır.

## 7. Remote ve push

```powershell
git remote add origin <YENI_REPOSITORY_URL>
git remote -v
git push -u origin main
```

## 8. Push sonrası kontrol

GitHub web arayüzünde `data/` klasörünü açın.

Şu dosya olmamalıdır:

```text
scada_auth.json
```

---

# Geliştirme kuralları

WebSCADA ayrı repository olduktan sonra:

```text
Eski ana extension = frozen/reference
WebSCADA            = aktif SCADA/Harita geliştirmesi
```

yaklaşımı önerilir.

Yeni WebSCADA geliştirmelerinde parent repository'den sürekli dosya kopyalamak veya karşılıklı cherry-pick yapmak iki projenin tekrar birbirine bağlanmasına neden olabilir.

Regression testleri özellikle şu alanlarda korunmalıdır:

- Superset auth
- chart-first auth
- canlı SCADA
- 60 saniye yenileme
- stale-response
- MW/MVar renkleri
- flow direction
- gerilim representative
- geçmiş snapshot
- multi-terminal query
- Turkey wall-clock timestamp
- normalized CSV

---

# Test yaklaşımı

Testler gerçek Superset response biçimini temsil eden fixture'lar içermelidir.

Önemli alanlar:

```text
__timestamp
sinsid
elementName
AVG(maxValue)
```

Önemli regression başlıkları:

- numeric `__timestamp`
- Turkey wall-clock
- P/Q numeric value
- iki terminalli hat
- dört ayrı seri
- CSV terminal ayrımı
- effective grain
- pagination
- exact-ID map focus
- auth retry
- hidden-tab fallback
- history snapshot
- MW/MVar renk eşikleri
- gerilim representative

---

# Bilinen operasyonel notlar

## Superset çözünürlük davranışı

Kurum ortamında bazı sorgularda payload içinde `PT5M` istenmesine rağmen response timestamplerinin yaklaşık 1 dakikalık çözünürlükte dönebildiği gözlenmiştir.

WebSCADA requested ve effective grain'i ayrı gösterir.

Sunucu davranışı doğrulanmadan client tarafında sessiz yeniden aggregation yapılmamalıdır.

## Kurum ağı

Canlı SCADA/Superset özellikleri kurum ağı ve ilgili Superset erişimi gerektirir.

Unit testlerin PASS olması gerçek Superset erişiminin garanti edildiği anlamına gelmez.

Release öncesi kurum ortamında gerçek test önerilir.

---

# Sorun giderme

## `data/scada_auth.json bulunamadi`

`data/scada_auth.example.json` dosyasını `data/scada_auth.json` olarak kopyalayın ve yerel bilgileri doldurun.

## Auth problemi

Kontrol edin:

1. Kurum ağı erişimi
2. `baseUrl`
3. `enabled=true`
4. kullanıcı adı/parola
5. Superset site erişimi

Çalışan mevcut session varsa chart-first akışta normalde yeni login sekmesi açılması gerekmez.

## SCADA bağlı ama veri eksik

Kontrol:

- measurement mapping
- seçilen metric
- YTM/kV filtreleri
- SCADA kalite bilgisi
- eksik measurement fallback logları
- Denetim CSV / Mismatch raporu

## Sorgu çok büyük

Önerilen başlangıç:

```text
1 entity
24 saat
5 dakika / Otomatik
```

Çok sayıda measurement + 7 gün + 1 dakika gibi sorgular Superset ve browser üzerinde gereksiz yük oluşturabilir.

---

# Sürüm geçmişi

## v0.6.4

- Alarm cadence, latest-current SCADA yolu, partial batch tanılaması ve kısa ömürlü semantik live cache iyileştirildi.

## v0.6.3

- Alarm severity migration, scheduler next-time doğruluğu ve CSV olay bağlamı düzeltildi.

## v0.6.2

- Alarm muafiyetleri, stale-cycle koruması ve ayrıştırılmış background scheduler tanılaması eklendi.

## v0.6.1

- Alarm runtime temizliği, scheduler wake tanılama ve ayrıntılı trafo alarm etiketleri eklendi.

## v0.6.0

- Background SCADA yenileme, alarm ses/bildirim ayarları ve alarm filtre güvenilirliği eklendi.

## v0.5.2

- Alarm workspace controller paketleme ve çalışma zamanı geri bildirim düzeltmeleri.

## v0.5.1

- Superset sorguları tek coordinator üzerinden önceliklendirilir; alarm sorguları ilk sıradadır.
- Alarm kuralları 1, 2, 5, 10 veya 15 dakikada bir denetlenebilir; alarm tekrarı ayrı bir ayardır.

## v0.5.0

- Tek Chrome alarm scheduler'ı, kalıcı alarm kuralları, arka plan yüklenme izleme ve alarm geçmişi eklendi.
- Arka plan izleme Chrome açık ve eklenti etkin iken çalışır; Chrome kapalıyken veya cihaz uykudayken gerçek-zaman garantisi yoktur.

## v0.4.1

- Datalar ayrıntısı artık önceki seçimi değil, tıklanan varlığın SCADA eşleşmesini gösterir.
- TM satırları SCADA eşleşmiş/eşleşmemiş filtrelerinden çıkarılır.

## v0.4.0

- Ortak YTBS hiyerarşisi, canonical YTM/BM filtreleri ve TM alt-varlık gezintisi
- Sorgu seçim tutarlılığı, doğru trafo sınıflaması ve TM için SCADA eşleşmesiz görünüm
- Query grafiğinde zaman ekseni, kapasite/gerilim etiketleri ve native/hesaplanan MVA ayrımı

## v0.3.0

- Veri çalışma alanında hiyerarşik filtreler, özet ve insan-okunur satırlar
- Sorgularda büyük, çok panelli etkileşimli zaman serisi grafikleri
- P/Q eşleşmesinden türetilen MVA grafiği, terminal serileri ve CSV denetim çıktısı
- Harita ile senkron açık/koyu tema

## v0.2.0

- Gerçek Superset `__timestamp` desteği
- Harita ile ortak SCADA timestamp semantiği
- Query row normalizasyonu
- Terminal-aware measurement descriptor
- Çok terminalli P/Q seri ayrımı
- Terminal filtresi
- Dynamic metric availability
- Query summary
- Requested/effective grain karşılaştırması
- Conservative query guardrail
- Query table pagination
- Normalized UTF-8 BOM CSV
- Datalar summary / SCADA coverage
- Gelişmiş detail mapping
- Exact-ID map focus
- Search index + debounce
- Chart-first auth akışının korunması
- Hidden-tab fallback bekleme davranışının iyileştirilmesi

---

# Release kontrol listesi

```text
[ ] WebSCADA testleri PASS
[ ] Standalone test PASS
[ ] Build PASS
[ ] data/scada_auth.json Git tracked değil
[ ] Final ZIP auth dosyasını içeriyor
[ ] Example auth ZIP'e girmiyor
[ ] tests/docs/scripts ZIP'e girmiyor
[ ] Gerçek kurum Superset auth test edildi
[ ] Canlı harita test edildi
[ ] 60 sn refresh test edildi
[ ] Geçmiş snapshot test edildi
[ ] Sorgular timestamp test edildi
[ ] Multi-terminal P/Q test edildi
[ ] CSV kontrol edildi
[ ] Requested/effective grain kontrol edildi
```

---

# Önemli güvenlik özeti

**Git'e eklenebilir:**

```text
manifest.json
app.*
background/
core/
map/
icons/
lib/
tests/
scripts/
README.md
CHANGELOG.md
data/scada_auth.example.json
```

**Git'e eklenmemeli:**

```text
data/scada_auth.json
dist/
build/
node_modules/
```

> Yeni repository'nin ilk sürümde **Private** olması önerilir.

---

# Durum

WebSCADA v0.6.0 bağımsız bir Chrome MV3 extension olarak geliştirilmekte ve parent repository'den ayrılmış yapıdadır.

Yeni geliştirmelerin bağımsız WebSCADA repository üzerinde sürdürülmesi önerilir.

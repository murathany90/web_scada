# WebSCADA — YTBS Mevcut Harita Modeli Güncellemesi

**Tarih:** 24.08.2026
**Kapsam:** yalnız mevcut WebSCADA varlık modeli — **Trafo Merkezi, Hat, Trafo, Bara**
**Yeni kaynak:** `ytbs_model.zip`
**Baseline:** `mevcut_harita_modeli.zip`
**Karar:** **ÜRETİLEBİLİR / PASS**

## 1. Neden artık üretilebilir?

Önceki geniş kapsamlı incelemede model üretimi; Santral Ünitesi ve aktif Fider→Bara kaynaklarının eksikliği nedeniyle bloke edilmişti. Bu blokaj, **Santral/Ünite ve işletme bara-topolojisini yeni modele ekleme** hedefi içindi.

Mevcut WebSCADA runtime'ının kullandığı topoloji ise dört varlık dizisidir:

- `tmPoints`
- `hatLines`
- `trafos`
- `baraNodes`

Bu dar kapsam için yeni YTBS paketi yeterlidir. Santral Ünitesi veya Fider→Bara snapshot'ı, mevcut loader şemasını yeniden üretmek için zorunlu değildir.

## 2. Üretilen model

Repo hedefi:

```text
data/kml_layers_v2.json
```

Model **yalnız yeni YTBS kaynağındaki güncel entity envanterini** aktif topolojiye alır. Kaynakta artık bulunmayan baseline kayıtları aktif modele zorla geri eklenmez; bunun yerine audit dosyalarında korunur.

`data/mapping.json` bu pakette **değiştirilmez**. Mevcut dosya repoda korunmalıdır.

## 3. Sayısal sonuç

| Varlık | Baseline | Yeni YTBS / yeni model | Değişim |
|---|---:|---:|---:|
| Trafo Merkezi | 1.584 | **1.608** | +24 net |
| Bara | 5.960 | **6.048** | +88 net |
| Hat | 2.341 | **2.378** | +37 net |
| Trafo | 3.001 | **3.051** | +50 net |
| **Toplam** | **12.886** | **13.085** | **+199 net** |

Baseline → yeni kaynak sınıflandırması:

- unchanged: **12.387**
- updated: **382**
- added: **316**
- removed-from-source: **117**

`117` eski kayıt aktif yeni modele sessizce taşınmamıştır; `removed_from_source_core.csv` içinde izlenebilir durumdadır.

## 4. Geometri ve parent ilişkileri

Yeni KML / Excel eşleşmesi:

- TM: **1608/1608**
- Hat: **2378/2378**
- mismatch: **0**

Referential integrity:

- Hat başlangıç/bitiş TM orphan: **0**
- Trafo→TM orphan: **0**
- Bara→TM orphan: **0**
- geçersiz Hat LineString: **0**
- geçersiz TM koordinatı: **0**

### BANDIRMA RES isim çakışması

Yeni YTBS'de `BANDIRMA RES` adı TM ID `315` ve `85` için kullanılıyor. İsim benzerliğiyle birleştirme yapılmadı.

Çözüm kanıt tabanlıdır:

- 5 Bara: Bara PSSE kodunun ilk 4 hanesi → TM PSSE kodu
- 2 Trafo: baseline entity-ID → TM-ID eşleşmesi
- 2 Hat ucu: KML LineString uç koordinatı → KML TM koordinatı

Sonuç: duplicate-name nedeniyle unresolved parent **0**.

## 5. SCADA / SINSID yaklaşımı

Model güncellemesi SCADA eşlemesini sıfırdan isim benzerliği ile yeniden kurmaz.

Kullanılan sıra:

1. Baseline `eslesme_tablolari.xlsx` entity→measurement ilişkisinin korunması.
2. Aynı measurement UUID yeni aktif `SISTEM_ESLEME_LISTESI.xlsx` içinde varsa güncel formülasyon/analog metadata'nın alınması.
3. Yeni entity'ler için yalnız **exact** YTBS analog adı + parent/terminal TM eşleşmesi ile yeni aday eklenmesi.
4. Güvenli şekilde yeni ID'ye taşınamayan eski entity-ID eşleşmelerinin otomatik migrate edilmemesi.

Yeni model SCADA coverage:

| Alan | Coverage |
|---|---:|
| Hat aktif güç | **2336 / 2378** |
| Hat reaktif güç | **2337 / 2378** |
| Trafo aktif güç | **2855 / 3051** |
| Trafo reaktif güç | **2855 / 3051** |
| Bara gerilim | **2160 / 6048** |

Hat candidate terminal metadata:

- terminal `start`: **4501** aday
- terminal `end`: **4246** aday
- terminal `unknown`: **0**

Mevcut yeni Sistem Eşleme kaynağında bulunmayan fakat baseline ilişkisinden korunmuş **333 legacy fallback candidate** vardır. Bunlar uydurma yeni ID'ye taşınmaz; mevcut measurement ID ile düşük öncelikli fallback olarak tutulur.

Ayrıca baseline SCADA mapping'i olup yeni entity listesinde aynı ID ile bulunmayan **72** entity vardır. Bunların 18'i exact migration adayı, 54'ü unresolved'dır. Bunlar aktif modele otomatik geçirilmemiştir; `scada_mapping_migration.csv` audit dosyasında bırakılmıştır.

## 6. Loader uyumluluğu

Temel doğrulama:

```text
JSON parse: PASS
TM: 1608
Hat: 2378
Trafo: 3051
Bara: 6048
Toplam entity: 13085
Duplicate ID: 0
Orphan: 0
Bad geometry: 0
Loader-shape smoke: PASS
```

Model mevcut WebSCADA'nın beklediği alanları taşır:

- Hat: `coords`, `bbox`, `startTmId`, `endTmId`, `startTm`, `endTm`, `ytmNames`, kapasite ve SCADA alanları
- TM: `id`, `name`, `kv`, `lon`, `lat`, `ytm`
- Trafo: `tmId`, `tmName`, `primaryKv`, `secondaryKv`, MVA alanları ve SCADA
- Bara: `tmId`, `tmName`, `gerilimKv`, `kullanim`, `turu`, gerilim SCADA

## 7. Repo'ya uygulanacak dosyalar

```text
data/kml_layers_v2.json                         # REPLACE

tools/build_ytbs_map_model.py                  # ADD

docs/YTBS_MODEL_UPDATE_2026-08-24.md           # ADD
docs/ytbs-model-update/model_validation.json   # ADD
docs/ytbs-model-update/entity_change_status_core.csv
docs/ytbs-model-update/removed_from_source_core.csv
docs/ytbs-model-update/scada_mapping_migration.csv
```

**Değiştirme:**

```text
data/mapping.json
```

## 8. Yeniden üretim

Repo kökünden:

```powershell
python tools/build_ytbs_map_model.py `
  --new-package C:\path\ytbs_model.zip `
  --baseline-package C:\path\mevcut_harita_modeli.zip `
  --output data\kml_layers_v2.json `
  --validation docs\ytbs-model-update\model_validation.json
```

Script üçüncü taraf Python paketi gerektirmez.

## 9. Son karar

**Evet. Yalnız mevcut WebSCADA YTBS harita modelinin kapsamı korunursa yeni YTBS verilerinden model güvenle oluşturulabilir.**

Santral/Ünite veya gerçek zamanlı Fider→Bara işletme topolojisi bu sürüme eklenmemiştir. Bu iki alan daha sonra ayrı bir model genişletmesi olarak ele alınmalıdır; mevcut model güncellemesini bloke etmemelidir.

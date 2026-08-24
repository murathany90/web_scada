# YTBS map model builder

`build_ytbs_map_model.py`, mevcut WebSCADA runtime kapsamındaki dört entity için `data/kml_layers_v2.json` üretir:

- TM
- Hat
- Trafo
- Bara

## Kullanım

```powershell
python tools/build_ytbs_map_model.py `
  --new-package C:\temp\ytbs_model.zip `
  --baseline-package C:\temp\mevcut_harita_modeli.zip `
  --output data\kml_layers_v2.json `
  --validation docs\ytbs-model-update\model_validation.json
```

Baseline paket yalnız mevcut SCADA entity→measurement ilişkisini korumak ve kanıtlı duplicate-name çözümünü sürdürmek için kullanılır. Aktif envanter ve geometri yeni YTBS paketinden gelir.

## Bilinçli sınırlar

- fuzzy entity matching yok
- Santral/Ünite üretimi yok
- Fider→Bara ilişkisi uydurulmaz
- `data/mapping.json` değiştirilmez
- removed-from-source entity'ler aktif modele geri sokulmaz

Script sonunda duplicate ID, orphan parent ve KML geometri kontrolü yapar; başarısızsa exit code `2` döndürür.

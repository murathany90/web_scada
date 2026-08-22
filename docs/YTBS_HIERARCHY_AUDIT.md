# YTBS hiyerarşi denetimi — v0.4.0

Kaynak: `data/kml_layers_v2.json` (yerel, credential ve ölçüm kimliği içermez).

| Öğe | Sayı | Kullanılan alanlar |
| --- | ---: | --- |
| Operasyonel YTM | 9 | `tmPoints[].ytm` |
| Bölge Müdürlüğü | 22 | `tmPoints[].bolgeMudurlugu` |
| Trafo Merkezi | 1.583 | `tmPoints` |
| Hat | 2.341 | `hatLines`, `startTmId`, `endTmId`, `ytmNames` |
| İletim trafosu | 368 | `trafos[].gerilimTuru` |
| Dağıtım trafosu | 2.633 | `trafos[].gerilimTuru` |
| Sınıflandırılamayan trafo | 0 | `gerilimTuru`, `trafoTuru`, `tip`, `type`, `category` |
| Bara | 5.960 | `baraNodes[].tmId` |

`Milli YTM` kurumun operasyonel dokuz YTM listesinin dışında tutulan özel bir
kaynak değeridir. `İşletme Dairesi` bir Bölge Müdürlüğü değildir. Bu iki kayıt
veriden silinmez; yalnız canonical YTM/BM filtre seçeneklerine dahil edilmez.

TM, SCADA ölçüm entity’si değil hiyerarşi konteyneridir. Hatlar iki endpoint TM
üzerinden; bara ve trafolar `tmId` üzerinden ilişkilendirilir.

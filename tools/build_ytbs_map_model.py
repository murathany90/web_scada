#!/usr/bin/env python3
"""Build WebSCADA's current YTBS map model from a fresh YTBS export.

Scope is deliberately limited to the entity types already consumed by the
current WebSCADA topology loader: TM, Hat, Trafo and Bara.  Santral/Unite and
historical Fider->Bara topology are intentionally out of scope.

The script has no third-party Python dependency. It reads the simple YTBS XLSX
exports directly from their XML parts and reads KML with ElementTree.

Typical use:
    python tools/build_ytbs_map_model.py \
      --new-package C:/tmp/ytbs_model.zip \
      --baseline-package C:/tmp/mevcut_harita_modeli.zip \
      --output data/kml_layers_v2.json \
      --validation docs/ytbs-model-update/model_validation.json

The baseline package is used only to preserve/prove existing SCADA entity
associations and resolve the one known duplicate TM-name case without guessing.
Active topology inventory and geometry come from the NEW YTBS package only.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import re
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
import xml.etree.ElementTree as ET

XLS_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
KML_NS = {"k": "http://www.opengis.net/kml/2.2"}


def text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def name_key(value: Any) -> str:
    return " ".join(text(value).split()).casefold()


def as_id(value: Any) -> Optional[str]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        return str(int(value))
    s = text(value)
    if re.fullmatch(r"\d+(?:\.0+)?", s):
        return str(int(float(s)))
    return None


def num(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        x = float(str(value).replace(",", "."))
    except Exception:
        return None
    return x if math.isfinite(x) else None


def json_num(value: Any) -> Optional[Any]:
    x = num(value)
    if x is None:
        return None
    return int(x) if float(x).is_integer() else x


def col_index(ref: str) -> int:
    m = re.match(r"([A-Z]+)", ref)
    if not m:
        return 0
    n = 0
    for ch in m.group(1):
        n = n * 26 + ord(ch) - 64
    return n - 1


def _xlsx_rows(data: bytes, sheet_name: Optional[str] = None) -> List[List[Any]]:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        shared: List[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in root.findall(f"{{{XLS_NS}}}si"):
                shared.append("".join((n.text or "") for n in si.iter(f"{{{XLS_NS}}}t")))

        wb = ET.fromstring(zf.read("xl/workbook.xml"))
        sheets = wb.findall(f".//{{{XLS_NS}}}sheet")
        if not sheets:
            return []
        sheet = sheets[0]
        if sheet_name is not None:
            matches = [s for s in sheets if s.attrib.get("name") == sheet_name]
            if not matches:
                raise KeyError(f"XLSX sheet not found: {sheet_name}")
            sheet = matches[0]
        rid = sheet.attrib[f"{{{REL_NS}}}id"]

        rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        target = None
        for rel in rels:
            if rel.attrib.get("Id") == rid:
                target = rel.attrib.get("Target")
                break
        if not target:
            raise RuntimeError("XLSX worksheet relationship not found")
        target = target.lstrip("/")
        if not target.startswith("xl/"):
            target = "xl/" + target

        root = ET.fromstring(zf.read(target))
        rows: List[List[Any]] = []
        width = 0
        sparse_rows: List[Dict[int, Any]] = []
        for row in root.findall(f".//{{{XLS_NS}}}sheetData/{{{XLS_NS}}}row"):
            vals: Dict[int, Any] = {}
            for cell in row.findall(f"{{{XLS_NS}}}c"):
                idx = col_index(cell.attrib.get("r", "A1"))
                kind = cell.attrib.get("t")
                vnode = cell.find(f"{{{XLS_NS}}}v")
                if kind == "inlineStr":
                    value = "".join((n.text or "") for n in cell.iter(f"{{{XLS_NS}}}t"))
                elif vnode is None:
                    value = None
                else:
                    raw = vnode.text or ""
                    if kind == "s":
                        value = shared[int(raw)]
                    elif kind == "b":
                        value = raw == "1"
                    else:
                        try:
                            value = float(raw)
                            if value.is_integer():
                                value = int(value)
                        except Exception:
                            value = raw
                vals[idx] = value
                width = max(width, idx + 1)
            sparse_rows.append(vals)
        for vals in sparse_rows:
            rows.append([vals.get(i) for i in range(width)])
        return rows


def _dict_rows(data: bytes, sheet_name: Optional[str] = None, id_col: str = "ID") -> List[Dict[str, Any]]:
    rows = _xlsx_rows(data, sheet_name=sheet_name)
    if not rows:
        return []
    headers = [text(x) for x in rows[0]]
    out: List[Dict[str, Any]] = []
    for row in rows[1:]:
        item = {headers[i]: row[i] if i < len(row) else None for i in range(len(headers)) if headers[i]}
        if id_col and as_id(item.get(id_col)) is None:
            continue
        out.append(item)
    return out


class Package:
    def __init__(self, path: Path):
        self.path = path
        self.zf = zipfile.ZipFile(path)
        self.members = self.zf.namelist()

    def close(self) -> None:
        self.zf.close()

    def read_basename(self, basename: str) -> bytes:
        candidates = [m for m in self.members if Path(m).name == basename]
        if not candidates:
            raise FileNotFoundError(f"{basename} not found in {self.path}")
        if len(candidates) > 1:
            candidates.sort(key=lambda x: (x.count("/"), len(x)))
        return self.zf.read(candidates[0])

    def maybe_read_basename(self, basename: str) -> Optional[bytes]:
        try:
            return self.read_basename(basename)
        except FileNotFoundError:
            return None


def parse_kml(data: bytes) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    root = ET.fromstring(data)
    points: Dict[str, Dict[str, Any]] = {}
    lines: Dict[str, Dict[str, Any]] = {}
    for pm in root.findall(".//k:Placemark", KML_NS):
        name = text(pm.findtext("k:name", default="", namespaces=KML_NS))
        desc = text(pm.findtext("k:description", default="", namespaces=KML_NS))
        style = text(pm.findtext("k:styleUrl", default="", namespaces=KML_NS))
        if not desc:
            continue
        p = pm.find(".//k:Point/k:coordinates", KML_NS)
        l = pm.find(".//k:LineString/k:coordinates", KML_NS)
        if p is not None and p.text:
            parts = p.text.strip().split(",")
            if len(parts) >= 2:
                points[desc] = {
                    "id": desc,
                    "name": name,
                    "style": style,
                    "coord": [float(parts[0]), float(parts[1])],
                }
        elif l is not None and l.text:
            coords: List[List[float]] = []
            for token in l.text.split():
                parts = token.split(",")
                if len(parts) >= 2:
                    coords.append([float(parts[0]), float(parts[1])])
            lines[desc] = {"id": desc, "name": name, "style": style, "coords": coords}
    return points, lines


def kv_from_style(style: str, fallback: Any = None) -> str:
    m = re.search(r"(\d+)\s*kV", style, flags=re.I)
    if m:
        return m.group(1)
    x = num(fallback)
    if x is None:
        return ""
    if x >= 300:
        return "400"
    if x >= 120:
        return "154"
    if x >= 50:
        return "66"
    return str(int(round(x)))


def bbox(coords: Sequence[Sequence[float]]) -> List[float]:
    xs = [float(c[0]) for c in coords]
    ys = [float(c[1]) for c in coords]
    return [min(xs), min(ys), max(xs), max(ys)]


def formula_sign(raw: str, coefficient: str = "") -> Optional[int]:
    m = re.match(r"^\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*\)", raw or "")
    if m:
        x = float(m.group(1))
        if x > 0:
            return 1
        if x < 0:
            return -1
    c = text(coefficient)
    if c:
        try:
            x = float(c.replace(",", "."))
            if x > 0:
                return 1
            if x < 0:
                return -1
        except Exception:
            pass
    return None


def formula_body(raw: str) -> str:
    return re.sub(r"^\s*\(\s*[+-]?\d+(?:\.\d+)?\s*\)\s*", "", raw or "").strip()


def element_from_metric(metric: str) -> str:
    return {"active": "P", "reactive": "Q", "voltage": "U"}.get(metric, "")


def exact_metric_and_suffix(analog: str) -> Tuple[Optional[str], Optional[str]]:
    prefixes = (
        ("Aktif Güç, ", "active"),
        ("Aktif Güç (MW), ", "active"),
        ("Reaktif Güç, ", "reactive"),
        ("Reaktif Güç (MVAr), ", "reactive"),
        ("Gerilim, ", "voltage"),
        ("Gerilim (kV), ", "voltage"),
    )
    for prefix, metric in prefixes:
        if analog.startswith(prefix):
            return metric, analog[len(prefix):].strip()
    return None, None


def rows_by_measurement(rows: Iterable[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    out: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in rows:
        mid = text(row.get("ÖLÇÜM NOKTASI ID"))
        if mid:
            out[mid].append(row)
    return out


def is_active_scada(row: Dict[str, Any], baseline: bool = False) -> bool:
    if text(row.get("SİSTEM TÜRÜ")).upper() != "SCADA":
        return False
    if baseline and "Durum" not in row:
        return True
    return text(row.get("Durum")).casefold() == "aktif"


def candidate_from_system_row(
    row: Optional[Dict[str, Any]],
    metric: str,
    measurement_id: str,
    formula_table: str = "",
    coefficient: str = "",
) -> Dict[str, Any]:
    formula_raw = text(row.get("ÖLÇÜM NOKTASI FORMÜLASYONU")) if row else ""
    if not formula_raw:
        body = text(formula_table)
        sign = formula_sign("", coefficient)
        if body and sign is not None:
            formula_raw = f"({'+' if sign > 0 else ''}{sign}) {body}"
        else:
            formula_raw = body
    sign = formula_sign(formula_raw, coefficient)
    body = formula_body(formula_raw)
    parts = [p.strip() for p in body.split(",")] if body else []
    return {
        "measurementId": measurement_id,
        "formulaRaw": formula_raw,
        "formulaSign": sign,
        "analogName": text(row.get("ANALOG ÖLÇÜM")) if row else "",
        "sourceTmName": text(row.get("TRAFO MERKEZİ")) if row else "",
        "elementName": element_from_metric(metric),
        "formulaStation": parts[0] if len(parts) > 0 else "",
        "formulaVoltage": parts[1] if len(parts) > 1 else "",
        "formulaTarget": parts[2] if len(parts) > 2 else "",
    }


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def load_inputs(new_pkg: Package, baseline_pkg: Package) -> Dict[str, Any]:
    new = {
        "tm": _dict_rows(new_pkg.read_basename("TRAFO_MERKEZI_LISTESI.xlsx")),
        "bara": _dict_rows(new_pkg.read_basename("BARA_LISTESI.xlsx")),
        "hat": _dict_rows(new_pkg.read_basename("HAT_LISTESI.xlsx")),
        "trafo": _dict_rows(new_pkg.read_basename("TRAFO_LISTESI.xlsx")),
        "smap": _dict_rows(new_pkg.read_basename("SISTEM_ESLEME_LISTESI.xlsx")),
    }
    new["kml_points"], new["kml_lines"] = parse_kml(new_pkg.read_basename("YTBS_Detayli_Harita.kml"))

    baseline = {
        "tm": _dict_rows(baseline_pkg.read_basename("01-TRAFO_MERKEZI_LISTESI.xlsx")),
        "hat": _dict_rows(baseline_pkg.read_basename("09-HAT_LISTESI.xlsx")),
        "smap": _dict_rows(baseline_pkg.read_basename("SISTEM_ESLEME_LISTESI.xlsx")),
    }
    baseline["kml_points"], baseline["kml_lines"] = parse_kml(baseline_pkg.read_basename("20-YTBS_Detayli_Harita (3).kml"))
    mapping_bytes = baseline_pkg.read_basename("eslesme_tablolari.xlsx")
    baseline["hat_mapping"] = _xlsx_rows(mapping_bytes, sheet_name="Hat Eşleşme Tablosu")
    baseline["trafo_mapping"] = _xlsx_rows(mapping_bytes, sheet_name="Trafo Eşleşme Tablosu")
    baseline["bara_mapping"] = _xlsx_rows(mapping_bytes, sheet_name="Gerilim Eşleşme Tablosu")
    return {"new": new, "baseline": baseline}


def build_model(inputs: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    new = inputs["new"]
    base = inputs["baseline"]

    tm_rows: List[Dict[str, Any]] = new["tm"]
    bara_rows: List[Dict[str, Any]] = new["bara"]
    hat_rows: List[Dict[str, Any]] = new["hat"]
    trafo_rows: List[Dict[str, Any]] = new["trafo"]
    points: Dict[str, Dict[str, Any]] = new["kml_points"]
    lines: Dict[str, Dict[str, Any]] = new["kml_lines"]

    tm_by_id = {as_id(r["ID"]): r for r in tm_rows}
    tm_name_ids: Dict[str, List[str]] = defaultdict(list)
    for tid, row in tm_by_id.items():
        tm_name_ids[name_key(row.get("Adı"))].append(tid)

    aliases: Dict[str, set] = defaultdict(set)
    for tid, row in tm_by_id.items():
        aliases[tid].add(name_key(row.get("Adı")))
        old_kml = base["kml_points"].get(tid)
        if old_kml:
            aliases[tid].add(name_key(old_kml.get("name")))
    for row in base["tm"]:
        tid = as_id(row.get("ID"))
        if tid in tm_by_id:
            aliases[tid].add(name_key(row.get("Adı")))

    baseline_trafo_parent: Dict[str, set] = defaultdict(set)
    for row in base["trafo_mapping"][1:]:
        if len(row) >= 4:
            tid, eid = as_id(row[1]), as_id(row[3])
            if tid and eid:
                baseline_trafo_parent[eid].add(tid)
    baseline_bara_parent: Dict[str, set] = defaultdict(set)
    for row in base["bara_mapping"][1:]:
        if len(row) >= 4:
            tid, eid = as_id(row[1]), as_id(row[3])
            if tid and eid:
                baseline_bara_parent[eid].add(tid)

    parent_methods = Counter()
    unresolved_parents: List[Dict[str, Any]] = []

    def resolve_bara_parent(row: Dict[str, Any]) -> Optional[str]:
        eid = as_id(row.get("ID"))
        candidates = list(tm_name_ids.get(name_key(row.get("Trafo Merkezi")), []))
        if len(candidates) == 1:
            parent_methods["bara:name"] += 1
            return candidates[0]
        if len(candidates) > 1:
            psse = as_id(row.get("Psse No")) or ""
            prefix = psse[:4] if len(psse) >= 4 else psse
            matched = []
            for tid in candidates:
                tm_psse = as_id(tm_by_id[tid].get("PSSE NO")) or ""
                if tm_psse == prefix:
                    matched.append(tid)
            if len(matched) == 1:
                parent_methods["bara:psse-prefix"] += 1
                return matched[0]
            old = [tid for tid in baseline_bara_parent.get(eid or "", set()) if tid in candidates]
            if len(old) == 1:
                parent_methods["bara:baseline-mapping"] += 1
                return old[0]
        unresolved_parents.append({"entityType": "Bara", "id": eid, "name": row.get("Adı"), "parent": row.get("Trafo Merkezi")})
        return None

    def resolve_trafo_parent(row: Dict[str, Any]) -> Optional[str]:
        eid = as_id(row.get("ID"))
        candidates = list(tm_name_ids.get(name_key(row.get("Trafo Merkezi")), []))
        if len(candidates) == 1:
            parent_methods["trafo:name"] += 1
            return candidates[0]
        if len(candidates) > 1:
            old = [tid for tid in baseline_trafo_parent.get(eid or "", set()) if tid in candidates]
            if len(old) == 1:
                parent_methods["trafo:baseline-mapping"] += 1
                return old[0]
        unresolved_parents.append({"entityType": "Trafo", "id": eid, "name": row.get("Adı"), "parent": row.get("Trafo Merkezi")})
        return None

    def endpoint_distance(a: Sequence[float], b: Sequence[float]) -> float:
        return math.hypot(float(a[0]) - float(b[0]), float(a[1]) - float(b[1]))

    def resolve_hat_endpoint(row: Dict[str, Any], side: str) -> Optional[str]:
        eid = as_id(row.get("ID"))
        field = "Başlangıç Trafo Merkezi" if side == "start" else "Bitiş Trafo Merkezi"
        candidates = list(tm_name_ids.get(name_key(row.get(field)), []))
        if len(candidates) == 1:
            parent_methods[f"hat-{side}:name"] += 1
            return candidates[0]
        if len(candidates) > 1 and eid in lines and lines[eid].get("coords"):
            coords = lines[eid]["coords"]
            endpoint = coords[0] if side == "start" else coords[-1]
            ranked = sorted(
                (endpoint_distance(endpoint, points[tid]["coord"]), tid)
                for tid in candidates if tid in points
            )
            if ranked and (len(ranked) == 1 or ranked[0][0] + 1e-10 < ranked[1][0]):
                parent_methods[f"hat-{side}:kml-endpoint"] += 1
                return ranked[0][1]
        unresolved_parents.append({"entityType": "Hat", "id": eid, "name": row.get("Adı"), "parent": row.get(field), "side": side})
        return None

    bara_parent = {as_id(r["ID"]): resolve_bara_parent(r) for r in bara_rows}
    trafo_parent = {as_id(r["ID"]): resolve_trafo_parent(r) for r in trafo_rows}
    hat_parent = {
        as_id(r["ID"]): (resolve_hat_endpoint(r, "start"), resolve_hat_endpoint(r, "end"))
        for r in hat_rows
    }
    if unresolved_parents:
        raise RuntimeError(f"Unresolved current-model parents: {unresolved_parents[:10]}")

    # SCADA source indexes. New ACTIVE rows take precedence; baseline supplies
    # metadata for historical/manual candidate associations not rediscovered by
    # an exact current export match.
    new_active_smap = [r for r in new["smap"] if is_active_scada(r, baseline=False)]
    new_by_mid = rows_by_measurement(new_active_smap)
    base_scada_rows = [r for r in base["smap"] if is_active_scada(r, baseline=True)]
    base_by_mid = rows_by_measurement(base_scada_rows)

    # Seed current entity association from the baseline mapping workbook.
    seed: Dict[Tuple[str, str, str], List[Dict[str, Any]]] = defaultdict(list)
    for row in base["hat_mapping"][1:]:
        if len(row) < 8:
            continue
        eid = as_id(row[1])
        if not eid or eid not in {as_id(r["ID"]) for r in hat_rows}:
            continue
        metric = "active" if "Aktif" in text(row[2]) else "reactive" if "Reaktif" in text(row[2]) else None
        if not metric:
            continue
        candidates = ((row[3], row[4], row[5], "primary", "start"), (row[6], "", row[7], "secondary", "end"))
        for mid_value, coef, form, slot, side in candidates:
            mid = text(mid_value)
            if mid:
                seed[("hat", eid, metric)].append({
                    "measurementId": mid,
                    "coefficient": text(coef),
                    "formulaTable": text(form),
                    "slotHint": slot,
                    "sideHint": side,
                    "associationSource": "baseline-mapping-table",
                })
    for row in base["trafo_mapping"][1:]:
        if len(row) < 9:
            continue
        eid = as_id(row[3])
        if not eid or eid not in trafo_parent:
            continue
        metric = "active" if "Aktif" in text(row[5]) else "reactive" if "Reaktif" in text(row[5]) else None
        mid = text(row[6]) if metric else ""
        if mid:
            seed[("trafo", eid, metric)].append({
                "measurementId": mid,
                "coefficient": text(row[7]),
                "formulaTable": text(row[8]),
                "slotHint": "primary",
                "associationSource": "baseline-mapping-table",
            })
    for row in base["bara_mapping"][1:]:
        if len(row) < 8:
            continue
        eid = as_id(row[3])
        if not eid or eid not in bara_parent:
            continue
        mid = text(row[5])
        if mid:
            seed[("bara", eid, "voltage")].append({
                "measurementId": mid,
                "coefficient": text(row[6]),
                "formulaTable": text(row[7]),
                "slotHint": "primary",
                "associationSource": "baseline-mapping-table",
            })

    # Build exact indexes for CURRENT YTBS association discovery. This adds
    # measurements for newly-added entities without fuzzy/name-similarity rules.
    hat_by_id = {as_id(r["ID"]): r for r in hat_rows}
    trafo_by_id = {as_id(r["ID"]): r for r in trafo_rows}
    bara_by_id = {as_id(r["ID"]): r for r in bara_rows}
    hat_name_ids: Dict[str, List[str]] = defaultdict(list)
    for eid, row in hat_by_id.items():
        hat_name_ids[name_key(row.get("Adı"))].append(eid)
    trafo_parent_name: Dict[Tuple[str, str], List[str]] = defaultdict(list)
    for eid, row in trafo_by_id.items():
        trafo_parent_name[(trafo_parent[eid], name_key(row.get("Adı")))].append(eid)
    bara_parent_name: Dict[Tuple[str, str], List[str]] = defaultdict(list)
    for eid, row in bara_by_id.items():
        bara_parent_name[(bara_parent[eid], name_key(row.get("Adı")))].append(eid)

    def source_matches_tm(source_name: str, tid: Optional[str]) -> bool:
        return bool(tid) and name_key(source_name) in aliases.get(tid, set())

    current_exact: Dict[Tuple[str, str, str], List[Dict[str, Any]]] = defaultdict(list)
    current_unmatched = Counter()
    for row in new_active_smap:
        metric, suffix = exact_metric_and_suffix(text(row.get("ANALOG ÖLÇÜM")))
        if not metric or suffix is None:
            current_unmatched["other-prefix"] += 1
            continue
        mid = text(row.get("ÖLÇÜM NOKTASI ID"))
        source = text(row.get("TRAFO MERKEZİ"))
        suffix_key = name_key(suffix)
        matched = False
        if metric in ("active", "reactive"):
            for eid in hat_name_ids.get(suffix_key, []):
                start_id, end_id = hat_parent[eid]
                if source_matches_tm(source, start_id) or source_matches_tm(source, end_id):
                    current_exact[("hat", eid, metric)].append({"measurementId": mid, "systemRow": row})
                    matched = True
            if matched:
                continue

        source_tids = [tid for tid, names in aliases.items() if name_key(source) in names]
        if metric in ("active", "reactive"):
            hits: List[str] = []
            for tid in source_tids:
                hits.extend(trafo_parent_name.get((tid, suffix_key), []))
            hits = list(dict.fromkeys(hits))
            if len(hits) == 1:
                current_exact[("trafo", hits[0], metric)].append({"measurementId": mid, "systemRow": row})
                continue
        if metric == "voltage":
            hits = []
            for tid in source_tids:
                hits.extend(bara_parent_name.get((tid, suffix_key), []))
            hits = list(dict.fromkeys(hits))
            if len(hits) == 1:
                current_exact[("bara", hits[0], metric)].append({"measurementId": mid, "systemRow": row})
                continue
        current_unmatched[metric] += 1

    def best_system_row(mid: str) -> Tuple[Optional[Dict[str, Any]], bool]:
        if new_by_mid.get(mid):
            return new_by_mid[mid][0], True
        if base_by_mid.get(mid):
            return base_by_mid[mid][0], False
        return None, False

    scada: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    all_groups = set(seed) | set(current_exact)
    for key in all_groups:
        kind, eid, metric = key
        by_mid: Dict[str, Dict[str, Any]] = {}
        # Seed first so its entity association is preserved even when current
        # analog labels changed.
        for item in seed.get(key, []):
            mid = item["measurementId"]
            sysrow, is_current = best_system_row(mid)
            cand = candidate_from_system_row(
                sysrow, metric, mid,
                formula_table=item.get("formulaTable", ""),
                coefficient=item.get("coefficient", ""),
            )
            cand.update({
                "associationSource": item.get("associationSource"),
                "currentSystemMapping": bool(is_current),
                "slotHint": item.get("slotHint", "primary"),
                "sideHint": item.get("sideHint", ""),
            })
            by_mid[mid] = cand
        for item in current_exact.get(key, []):
            mid = item["measurementId"]
            if mid in by_mid:
                by_mid[mid]["currentSystemMapping"] = True
                if not by_mid[mid].get("analogName"):
                    by_mid[mid].update(candidate_from_system_row(item["systemRow"], metric, mid))
                continue
            cand = candidate_from_system_row(item["systemRow"], metric, mid)
            cand.update({
                "associationSource": "new-system-exact",
                "currentSystemMapping": True,
                "slotHint": "",
                "sideHint": "",
            })
            by_mid[mid] = cand

        candidates = list(by_mid.values())
        # Terminal semantics for lines. Baseline mapping columns are authoritative
        # fallback for start/end. New rows use exact source TM alias membership.
        if kind == "hat":
            hrow = hat_by_id[eid]
            start_id, end_id = hat_parent[eid]
            start_name = text(tm_by_id[start_id].get("Adı"))
            end_name = text(tm_by_id[end_id].get("Adı"))
            for cand in candidates:
                source = cand.get("sourceTmName", "")
                side = cand.get("sideHint", "")
                basis = "baseline-slot" if side else ""
                if source_matches_tm(source, start_id) and not source_matches_tm(source, end_id):
                    side, basis = "start", "ytbs-source-tm"
                elif source_matches_tm(source, end_id) and not source_matches_tm(source, start_id):
                    side, basis = "end", "ytbs-source-tm"
                if side not in ("start", "end"):
                    side = "unknown"
                pol = 1 if side == "start" else -1 if side == "end" else None
                cand.update({
                    "terminalSide": side,
                    "terminalMatchBasis": basis or "unresolved",
                    "polarizationSign": pol,
                    "polarizationConsistent": (
                        cand.get("formulaSign") == pol
                        if cand.get("formulaSign") in (-1, 1) and pol in (-1, 1)
                        else None
                    ),
                    "sourceSide": side,
                    "targetSide": "end" if side == "start" else "start" if side == "end" else "unknown",
                    "sourceTmName": start_name if side == "start" else end_name if side == "end" else source,
                    "targetTmName": end_name if side == "start" else start_name if side == "end" else "",
                    "b1Name": start_name if side == "start" else end_name if side == "end" else source,
                    "b2Name": str(kv_from_style(lines[eid].get("style", ""), hrow.get("Gerilimi (kV)"))),
                    "b3Name": end_name if side == "start" else start_name if side == "end" else "",
                })

        # Current measurement candidates are ranked before stale legacy fallback.
        # Retain the baseline primary/secondary role when it still exists.
        def sort_key(c: Dict[str, Any]) -> Tuple[int, int, str]:
            current_rank = 0 if c.get("currentSystemMapping") else 1
            slot = c.get("slotHint")
            slot_rank = 0 if slot == "primary" else 1 if slot == "secondary" else 2
            return (current_rank, slot_rank, c.get("measurementId", ""))
        candidates.sort(key=sort_key)

        used_slots: set = set()
        for cand in candidates:
            if not cand.get("currentSystemMapping"):
                slot = "extra"
            else:
                requested = cand.pop("slotHint", "")
                if requested in ("primary", "secondary") and requested not in used_slots:
                    slot = requested
                elif kind == "hat" and cand.get("terminalSide") == "start" and "primary" not in used_slots:
                    slot = "primary"
                elif kind == "hat" and cand.get("terminalSide") == "end" and "secondary" not in used_slots:
                    slot = "secondary"
                elif "primary" not in used_slots:
                    slot = "primary"
                elif "secondary" not in used_slots:
                    slot = "secondary"
                else:
                    slot = "extra"
            used_slots.add(slot)
            cand["candidateSlot"] = slot
            cand.pop("sideHint", None)

        ids = [c["measurementId"] for c in candidates]
        scada[key] = {"ids": ids, "rows": candidates, "ambiguous": len(candidates) > 1}

    # Build output entities.
    child_hat: Dict[str, List[str]] = defaultdict(list)
    child_trafo: Dict[str, List[str]] = defaultdict(list)
    child_bara: Dict[str, List[str]] = defaultdict(list)
    for eid, (a, b) in hat_parent.items():
        child_hat[a].append(eid)
        if b != a:
            child_hat[b].append(eid)
    for eid, tid in trafo_parent.items():
        child_trafo[tid].append(eid)
    for eid, tid in bara_parent.items():
        child_bara[tid].append(eid)

    tm_points: List[Dict[str, Any]] = []
    for tid, row in tm_by_id.items():
        p = points.get(tid)
        if not p:
            raise RuntimeError(f"TM {tid} missing KML point")
        tm_points.append({
            "id": tid,
            "name": text(row.get("Adı")),
            "kmlName": p.get("name", ""),
            "kmlDescriptionId": tid,
            "kv": kv_from_style(p.get("style", "")),
            "lon": p["coord"][0],
            "lat": p["coord"][1],
            "ytm": text(row.get("Yük Tevzi Müdürlüğü")),
            "il": text(row.get("İli")),
            "bm": text(row.get("Bölge Müdürlüğü")),
            "bolgeMudurlugu": text(row.get("Bölge Müdürlüğü")),
            "dagitimSirketi": text(row.get("Dağıtım Şirketi")),
            "mulk": text(row.get("Mülkiyet")),
            "psseNo": as_id(row.get("PSSE NO")) or text(row.get("PSSE NO")),
            "rumuz": text(row.get("Rumuz")),
            "ucteKodu": text(row.get("UCTE Kodu")),
            "saltTuru": text(row.get("ŞALT TÜRÜ")),
            "insaYili": json_num(row.get("İnşa Yılı")),
            "oysId": text(row.get("OYS ID")),
            "rakimM": json_num(row.get("Rakım (m)")),
            "status": text(row.get("Durumu")),
            "sourceStatus": "current",
            "childHatIds": sorted(child_hat.get(tid, []), key=lambda x: int(x)),
            "childTrafoIds": sorted(child_trafo.get(tid, []), key=lambda x: int(x)),
            "childBaraIds": sorted(child_bara.get(tid, []), key=lambda x: int(x)),
        })

    hat_lines: List[Dict[str, Any]] = []
    for eid, row in hat_by_id.items():
        line = lines.get(eid)
        if not line or len(line.get("coords", [])) < 2:
            raise RuntimeError(f"Hat {eid} missing/invalid KML LineString")
        start_id, end_id = hat_parent[eid]
        start_tm = tm_by_id[start_id]
        end_tm = tm_by_id[end_id]
        active = scada.get(("hat", eid, "active"), {"ids": [], "rows": [], "ambiguous": False})
        reactive = scada.get(("hat", eid, "reactive"), {"ids": [], "rows": [], "ambiguous": False})
        hat_lines.append({
            "id": eid,
            "name": text(row.get("Adı")),
            "kmlName": line.get("name", ""),
            "kmlDescriptionId": eid,
            "kv": kv_from_style(line.get("style", ""), row.get("Gerilimi (kV)")),
            "startTmId": start_id,
            "endTmId": end_id,
            "startTm": text(start_tm.get("Adı")),
            "endTm": text(end_tm.get("Adı")),
            "ytmNames": list(dict.fromkeys([text(start_tm.get("Yük Tevzi Müdürlüğü")), text(end_tm.get("Yük Tevzi Müdürlüğü"))])),
            "coords": line["coords"],
            "bbox": bbox(line["coords"]),
            "lengthKm": json_num(row.get("Toplam Uzunluk (km)")),
            "characteristic": text(row.get("Karakteristik")),
            "winterCapacityMva": json_num(row.get("Kış Kapasitesi (MVA)")),
            "summerCapacityMva": json_num(row.get("Yaz Kapasitesi (MVA)")),
            "operatingCapacityMva": json_num(row.get("İşletme Kapasitesi (MVA)")),
            "normalOperation": text(row.get("NORMAL İŞLETME DURUMU")),
            "status": text(row.get("Durumu")),
            "sourceStatus": "current",
            "olcumNoktasiIdAktif": active["ids"][0] if active["ids"] else "",
            "olcumNoktasiIdReaktif": reactive["ids"][0] if reactive["ids"] else "",
            "scada": {"active": active, "reactive": reactive},
        })

    trafos: List[Dict[str, Any]] = []
    for eid, row in trafo_by_id.items():
        tid = trafo_parent[eid]
        tmrow = tm_by_id[tid]
        active = scada.get(("trafo", eid, "active"), {"ids": [], "rows": [], "ambiguous": False})
        reactive = scada.get(("trafo", eid, "reactive"), {"ids": [], "rows": [], "ambiguous": False})
        trafos.append({
            "id": eid,
            "name": text(row.get("Adı")),
            "tmId": tid,
            "tmName": text(tmrow.get("Adı")),
            "ytm": text(tmrow.get("Yük Tevzi Müdürlüğü")),
            "gerilimTuru": text(row.get("Gerilim Türü")),
            "primaryKv": json_num(row.get("Primer Gerilim (kV)")),
            "secondaryKv": json_num(row.get("Sekonder Gerilim (kV)")),
            "onanMva": json_num(row.get("ONAN Gücü (MVA)")),
            "onafMva": json_num(row.get("ONAF Gücü (MVA)")),
            "ofafMva": json_num(row.get("OFAF Gücü (MVA)")),
            "bazGucuMva": json_num(row.get("Baz Gücü (MVA)")),
            "marka": text(row.get("Markası")),
            "imalYili": json_num(row.get("İmal Yılı")),
            "empedansYuzde": json_num(row.get("Empedansı (%uk)")),
            "baglantiTuru": text(row.get("Bağlantı Türü")),
            "normalOperation": text(row.get("Normal İşletme Durumu")),
            "status": text(row.get("Durumu")),
            "sourceStatus": "current",
            "scada": {"active": active, "reactive": reactive},
        })

    bara_nodes: List[Dict[str, Any]] = []
    for eid, row in bara_by_id.items():
        tid = bara_parent[eid]
        tmrow = tm_by_id[tid]
        voltage = scada.get(("bara", eid, "voltage"), {"ids": [], "rows": [], "ambiguous": False})
        bara_nodes.append({
            "id": eid,
            "name": text(row.get("Adı")),
            "tmId": tid,
            "tmName": text(tmrow.get("Adı")),
            "ytm": text(tmrow.get("Yük Tevzi Müdürlüğü")),
            "psseNo": as_id(row.get("Psse No")) or text(row.get("Psse No")),
            "ucteKodu": text(row.get("UCTE Kodu")),
            "gerilimSeviyesi": text(row.get("Gerilim Seviyesi")),
            "gerilimKv": json_num(row.get("Gerilim (kV)")),
            "kullanim": text(row.get("Kullanım")),
            "turu": text(row.get("Türü")),
            "veriToplama": text(row.get("Veri Toplama")),
            "status": text(row.get("Durum")),
            "sourceStatus": "current",
            "scada": {"voltage": voltage},
        })

    for rows in (tm_points, hat_lines, trafos, bara_nodes):
        rows.sort(key=lambda r: int(r["id"]))

    ytm_names = sorted({r["ytm"] for r in tm_points if r.get("ytm")}, key=lambda x: x.casefold())
    model = {
        "version": 2,
        "schema": "web-scada-ytbs-map-v2",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {
            "scope": "current-webscada-entities-only",
            "activeInventory": "new YTBS export",
            "geometry": "new YTBS KML",
            "scadaAssociation": "new active SYSTEM_ESLEME + preserved baseline entity association",
            "excluded": ["Santral", "Santral Ünitesi", "Fider->Bara historical topology"],
        },
        "defaultYtm": "",
        "ytmNames": ytm_names,
        "tmPoints": tm_points,
        "hatLines": hat_lines,
        "trafos": trafos,
        "baraNodes": bara_nodes,
    }

    current_seed_candidates = sum(
        1 for items in seed.values() for item in items
        if item["measurementId"] in new_by_mid
    )
    legacy_seed_candidates = sum(len(v) for v in seed.values()) - current_seed_candidates
    report = {
        "scope": "TM/Hat/Trafo/Bara only",
        "counts": {
            "tm": len(tm_points), "hat": len(hat_lines), "trafo": len(trafos), "bara": len(bara_nodes),
            "kmlTm": len(points), "kmlHat": len(lines), "newActiveScadaRows": len(new_active_smap),
        },
        "parentResolution": dict(parent_methods),
        "unresolvedParents": unresolved_parents,
        "scadaBuild": {
            "baselineCandidateAssociations": sum(len(v) for v in seed.values()),
            "baselineCandidatesStillCurrent": current_seed_candidates,
            "legacyFallbackCandidates": legacy_seed_candidates,
            "newExactAssociationGroups": len(current_exact),
            "newExactUnmatchedRows": dict(current_unmatched),
        },
    }
    return model, report


def validate(model: Dict[str, Any], report: Dict[str, Any]) -> Dict[str, Any]:
    tm = model["tmPoints"]
    hats = model["hatLines"]
    trafos = model["trafos"]
    baras = model["baraNodes"]
    tm_ids = {x["id"] for x in tm}

    def duplicates(rows: Sequence[Dict[str, Any]]) -> List[str]:
        c = Counter(x["id"] for x in rows)
        return sorted([k for k, v in c.items() if v > 1], key=lambda x: int(x))

    orphan_hats = [h["id"] for h in hats if h.get("startTmId") not in tm_ids or h.get("endTmId") not in tm_ids]
    orphan_trafos = [t["id"] for t in trafos if t.get("tmId") not in tm_ids]
    orphan_baras = [b["id"] for b in baras if b.get("tmId") not in tm_ids]
    bad_geometry = [h["id"] for h in hats if not isinstance(h.get("coords"), list) or len(h["coords"]) < 2]
    bad_tm_coords = [t["id"] for t in tm if not all(isinstance(t.get(k), (int, float)) and math.isfinite(float(t[k])) for k in ("lon", "lat"))]

    def coverage(rows: Sequence[Dict[str, Any]], metric: str) -> Dict[str, int]:
        total = len(rows)
        covered = 0
        candidates = 0
        for row in rows:
            obj = row.get("scada", {}).get(metric, {})
            ids = obj.get("ids", []) if isinstance(obj, dict) else []
            if ids:
                covered += 1
                candidates += len(ids)
        return {"covered": covered, "total": total, "candidates": candidates}

    result = {
        **report,
        "parse": "PASS",
        "duplicateIds": {
            "tm": duplicates(tm), "hat": duplicates(hats), "trafo": duplicates(trafos), "bara": duplicates(baras),
        },
        "referentialIntegrity": {
            "orphanHat": orphan_hats,
            "orphanTrafo": orphan_trafos,
            "orphanBara": orphan_baras,
        },
        "geometry": {"badHat": bad_geometry, "badTmCoordinate": bad_tm_coords},
        "scadaCoverage": {
            "hatActive": coverage(hats, "active"),
            "hatReactive": coverage(hats, "reactive"),
            "trafoActive": coverage(trafos, "active"),
            "trafoReactive": coverage(trafos, "reactive"),
            "baraVoltage": coverage(baras, "voltage"),
        },
    }
    failures = []
    if any(result["duplicateIds"].values()): failures.append("duplicate-id")
    if orphan_hats or orphan_trafos or orphan_baras: failures.append("orphan")
    if bad_geometry or bad_tm_coords: failures.append("geometry")
    if report.get("unresolvedParents"): failures.append("unresolved-parent")
    result["validation"] = "PASS" if not failures else "FAIL"
    result["failures"] = failures
    return result


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--new-package", required=True, type=Path)
    ap.add_argument("--baseline-package", required=True, type=Path)
    ap.add_argument("--output", required=True, type=Path)
    ap.add_argument("--validation", required=True, type=Path)
    args = ap.parse_args(argv)

    new_pkg = Package(args.new_package)
    base_pkg = Package(args.baseline_package)
    try:
        inputs = load_inputs(new_pkg, base_pkg)
        model, build_report = build_model(inputs)
    finally:
        new_pkg.close(); base_pkg.close()

    validation = validate(model, build_report)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.validation.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(model, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    validation["output"] = str(args.output)
    validation["sha256"] = sha256_file(args.output)
    validation["bytes"] = args.output.stat().st_size
    with args.validation.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(validation, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(json.dumps({
        "validation": validation["validation"],
        "counts": validation["counts"],
        "scadaCoverage": validation["scadaCoverage"],
        "sha256": validation["sha256"],
        "bytes": validation["bytes"],
    }, ensure_ascii=False, indent=2))
    return 0 if validation["validation"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())

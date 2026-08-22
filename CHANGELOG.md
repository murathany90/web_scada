# Changelog

## 0.6.3

- Defaulted legacy alarm severity to warning, removed Bara from alarm-rule type selection and recorded the true next Chrome scheduler time.
- Added rule/rule-ID/source fields to the alarm-event CSV export.

## 0.6.2

- Prevented stale alarm cycles from committing after a rule or exemption revision, and made filter-group entity type explicit.
- Added persistent alarm exemptions, seeded once with the three TEMELLİ–BAYMİNA Hat exclusions, plus scheduler/manual diagnostic separation.

## 0.6.1

- Reconciled deleted, disabled and out-of-scope alarm runtime/check records so ghost alarms cannot remain active.
- Added detailed transformer display labels, scheduler self-healing/wake diagnostics, independent sound cadence, repeat events and alarm history cleanup controls.

## 0.6.0

- Added worker-owned SCADA auto-refresh, persistent settings, alarm diagnostics, severity-aware notifications and packaged WAV alarm choices.
- Fixed all-Hat/all-Trafo alarm filtering to apply exact YTM/BM/TM/kV/type filters consistently.

## 0.5.2

- Packaged the alarm workspace controller and added build-time validation for every local HTML script and stylesheet asset.
- Kept alarm actions usable when the topology catalog cannot load, with explicit save/run/test feedback.

## 0.5.1

- Added one global Superset request coordinator with priority, deduplication and coalesced map auto-refresh jobs.
- Added per-rule 1/2/5/10/15-minute checks, partial map-snapshot reuse and Hat/Trafo alarm parity corrections.
- Fixed explicit single/multi Trafo selection and Alarm-to-Map/Query entity type routing.

## 0.5.0

- Added persistent advisory background loading alarms with one Chrome alarm scheduler, chart-first SCADA queries, hysteresis, ACK/snooze, repeat control, notification rate limiting and offscreen audio.
- Added compact Hat/Trafo catalog, deduplicated measurement query planning, persistent cycle/event/sample history and the Alarmlar workspace.

## 0.4.1

- Fixed Data detail SCADA descriptors to always use the clicked entity rather than a prior workspace selection.
- Excluded Trafo Merkezi rows from both matched and unmatched SCADA filters; TM remains an inventory/container row only.

## 0.4.0

- Added a shared canonical YTBS hierarchy for operational YTM, BM, TM and child entities.
- Fixed workspace scroll locking, query selector consistency, TM SCADA presentation and transformer classification.
- Improved query MVA provenance, chart time-axis labels and visible reference labels.

## 0.3.0

- Rebuilt the Data workspace around progressive topology filters, compact summaries, and human-readable results.
- Replaced the normal Query table with a focused entity workspace and multi-pane interactive time-series charts.
- Added terminal-aware P/Q-derived MVA panes, reference-capacity lines, CSV audit export, and map-synchronised theming.

## 0.2.0

- Added canonical Superset query normalization and terminal-aware series.
- Added Query/Data coverage, detail, pagination, and exact-ID map focus improvements.
- Kept chart-first authentication; hidden-tab fallback now waits for post-submit navigation.

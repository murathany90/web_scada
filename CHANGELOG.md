# Changelog

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

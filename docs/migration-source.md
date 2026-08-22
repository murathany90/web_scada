# Migration source

- Frozen source commit: `fc7d433abba49da014814d10489ea291553b17d1`
- Source branch: `main`
- Copied current implementation files: `map-modern.html`, `map-modern.css`,
  `map-modern.js`, `map-common.js`, `map-v2-runtime.js`, `scada-common.js`,
  `scada-client.js`, `scada-flow.js`, `scada-v2-runtime.js`, and
  `lib/xlsx.full.min.js`.
- Runtime topology data copied locally: `data/kml_layers_v2.json` and
  `data/mapping.json`.

The map keeps the copied modern implementation and only adapts asset paths and
the topology fetch so the standalone topology store supplies the already-loaded
JSON. No TPYS/YKS/RGDH/dashboard background workflow was migrated.

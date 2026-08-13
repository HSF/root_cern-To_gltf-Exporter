# LHCb Run5: ROOT → glTF (Phoenix)

This example exports LHCb **Run5 / Upgrade II** geometry for [Phoenix](https://github.com/HSF/phoenix), following the same pattern as Run3 (`LHCb.root` + `export_LHCb.html`):

| File | Role |
|------|------|
| `LHCb_run5.root` | Full-detector TGeo geometry |
| `export_LHCb_run5.html` | Export config: volume cleanup + Phoenix menu layout |
| `phoenixExport.js` | Conversion engine (shared in this repository) |

Open the HTML once to produce `LHCb_run5.gltf`. No per-subdetector exports and no `merge.py` are required.

HCAL is **excluded** at export time (dropped in `hide_children`; not listed in `subparts`).

### Geometry version

| Item | Value |
|------|--------|
| Input ROOT | `LHCb_run5.root` |
| Detector compact | **`run5/proto-v00.04`** |
| Top-level XML | `Detector/compact/run5/proto-v00.04/LHCb.xml` |

`LHCb_run5.root` in this example is dumped from **proto-v00.04**. For another compact tag, re-dump the ROOT file and check that the path patterns in `export_LHCb_run5.html` still match.

---

## Producing `LHCb_run5.root`

In a built [LHCb Detector](https://gitlab.cern.ch/lhcb/Detector) project, load the **proto-v00.04** compact description with DD4hep and export TGeo:

```bash
cd /path/to/Detector

./build.<BINARY_TAG>/bin/run geoPluginRun \
  -interpreter \
  -input compact/run5/proto-v00.04/LHCb.xml \
  -plugin DD4hep_DetectorDump
```

At the ROOT prompt:

```cpp
gGeoManager->Export("LHCb_run5.root");
.q
```

Place `LHCb_run5.root` in the repository root next to `export_LHCb_run5.html` and `phoenixExport.js`. A size of a few MB is typical.

---

## HTML configuration

`export_LHCb_run5.html` is not an interactive UI; it is a browser-side export script with three main parts.

### `hide_children`

List of regular expressions. Matching nodes (and their subtrees) are removed before conversion. Used to drop fine detail and to exclude HCAL.

### `subparts`

Defines entries in the Phoenix Detector menu:

- **Key**: `"Subsystem > Item"` (e.g. `"TV > Sensors"`)
- **Value**: `[ [path regexes…], visibility ]`
  - `true`: visible, opaque
  - `0–1`: visible with that opacity
  - `false`: hidden by default

Menus covered: TV, UP, Rich1, Pipe, Magnet, FT, MP, Rich2, NS, PicoCal, Muon.

### `convertGeometry`

```javascript
convertGeometry(
  "LHCb_run5.root",  // input
  "LHCb_run5.gltf",  // output
  10,                // max geometry depth
  subparts,
  hide_children,
  true,              // match full paths
  "default"          // geometry object name in the ROOT file
);
```

See the main [README.md](README.md) and `phoenixExport.js` for implementation details.

---

## Running the export

Dependencies are loaded from CDNs; no local JS install is required. Serve the folder over HTTP (do not open via `file://`):

```bash
# from the repository root
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/export_LHCb_run5.html
```

When conversion finishes, the browser downloads `LHCb_run5.gltf` for import into Phoenix.

---

## Relation to a multi-file merge workflow

An older approach exported each subdetector separately and merged the glTF files. This example matches the official Run3 workflow: **one full-detector ROOT + one HTML**. Menu names can be aligned with a merged package, but the output need not be byte-identical to a previously merged glTF.

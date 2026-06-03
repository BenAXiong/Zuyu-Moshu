# Feature Inventory

Global timestamp: 2026-06-03 17:51 +08:00

Current extension version: 1.4.1

This document is a current-state inventory, not a historical changelog. It lists what is implemented, whether behavior is universal or source-specific, and the main technical entry points.

## Data Sources

| Source | Label | Status | Scope | API path | Notes |
|---|---|---|---|---|---|
| `EPARK` | ePark | Enabled | All configured languages/dialects | `https://ycm-citadel.vercel.app/api/search?mode=DICT&q=...` | Legacy DICT/ePark lookup. Supports AB-to-ZH and ZH-to-AB. May include audio URLs on sentence rows when the API returns them. |
| `KILANG` | Kilang | Enabled | Amis only | `https://ycm-citadel.vercel.app/api/moe_shadow?...&mode=moe` | MoE/Kilang-derived Amis morphology and dictionary data. Supports AB-to-ZH/root-affix insight and ZH-to-AB lookup. No audio currently expected. |
| `ILRDF` | ILRDF | Disabled | Reserved | none active | Present in source config but not available in the UI. |

Source configuration lives in `shared.js` as `SOURCES`. Defaults are Amis + Kilang only.

## Lookup Triggers

| Feature | Scope | Current state | Implementation |
|---|---|---|---|
| Double-click lookup | Universal | Enabled by default unless hover mode replaces it. | `content.js`: `dblclick` listener, `handleSelection()`, `triggerLookup()`. |
| Ctrl + select lookup | Universal | Enabled by default and remains active even when hover mode is enabled. | `content.js`: `mouseup` listener with `e.ctrlKey`. |
| Hover lookup | Universal trigger, source-dependent lookup | Optional. Replaces double-click when enabled, does not replace Ctrl + select. | `content.js`: `mousemove`, `handleHover()`, `triggerCandidateLookup()`. |
| Text input lookup | Universal | Selection lookup works in useful text inputs and textareas. | `content.js`: `getDeepActiveElement()`, `getInputSelection()`. |

## Direction Support

| Direction | ePark | Kilang | Current behavior |
|---|---:|---:|---|
| AB-to-ZH | yes | yes, Amis only | Direct AB lookup can show ePark rows and/or Kilang morphology/sense rows depending on selected sources. |
| ZH-to-AB | yes | yes, Amis only | Chinese selections and CJK hover candidates fan out to enabled zh-capable sources and render normalized AB rows. |
| Alt spelling | yes, Amis only | yes, Amis only | Applies to AB input only. Handles Amis alternates including `f/v`, `u/o`, `l/r`, and caret/glottal variants. |
| Root lookup | no | yes, Amis only | Root chip appears for Kilang AB lookups. Clicking it looks up root results with a back button. |
| Tooltip drilling | yes | yes, Amis only | Click drillable AB words inside tooltip results/examples to replace the current tooltip lookup. Back uses a bounded history stack. |

## Tooltip Rendering

| Feature | Scope | Current state | Implementation |
|---|---|---|---|
| Main result rows | Universal | Compact rows with primary text, optional secondary text, optional dialect/source label, optional row audio. | `content.js`: `appendResultRow()`, `renderResults()`, `renderZhResults()`. |
| ZH-to-AB normalized rows | Universal across enabled zh-capable sources | AB is primary text. ZH definition/translation is secondary text. ePark and Kilang share the row UI. | `content.js`: `normalizeDictZhEntries()`, `normalizeMoeZhEntries()`, `getZhLookupEntries()`. |
| CJK hover candidate groups | Universal across enabled zh-capable sources | Shows at most 6 candidate groups, each with at most 2 unique AB results. Longer candidates are prioritized. | `content.js`: `makeCjkCandidates()`, `triggerCandidateLookup()`, `renderCandidateSections()`. |
| No-results state | Universal | Shows `查無此詞` only if no enabled source/section produced content. | `content.js`: `showNoResultsIfEmpty()`. |
| Header language pill | Universal | Shows selected language, or `所有族語` when no language is selected. | `content.js`: `showTooltip()`. |
| Dialect labels | ePark | Full dialect names when no language is selected; shortened dialect labels when a language is selected. | `content.js`: `getDialectLabel()`. |
| Tooltip drilling | Universal for drillable AB text | AB tokens in examples and ZH-to-AB primary rows are rendered as subtle inline buttons. Clicking drills in the same tooltip panel. | `content.js`: `appendDrillableText()`, `drillLookup()`, `normalizeTooltipNav()`. |

## Kilang Morphology And Sense UI

| Feature | Scope | Current state | Implementation |
|---|---|---|---|
| Kilang AB lookup | Kilang, Amis only | Uses exact lookup first, then conservative affix-stripped fallback candidates. | `background.js`: `fetchMoeInsights()`, `makeMoeFallbackCandidates()`. |
| Kilang ZH lookup | Kilang, Amis only | Uses `exact=false` to search Chinese definitions and examples through Citadel's MoE shadow endpoint. | `background.js`: `fetchMoeZhInsights()`; `content.js`: `getZhLookupEntries()`. |
| Lineage enrichment | Kilang, Amis only | Exact AB lookups enrich one root. ZH lookups enrich up to 8 roots because Chinese terms can match unrelated words. | `background.js`: `enrichMoeRows()`, `fetchMoeLineageRows()`. |
| Root chip | Kilang AB only | Shows ultimate root in the tooltip header. If the headword is already the root, only the red root icon is shown. | `content.js`: `setHeaderRoot()`, `createRootIcon()`. |
| Affix context label | Kilang AB only | Displays the base used for affix analysis plus the affix summary. Example: `hinatala (ka-...-an)` for `kahinatalaan` when the root chip is `tala`. | `content.js`: `getMoeAffixes()`, `formatMoeAffixSummary()`, `formatMoeAffixContextTitle()`. |
| Sense rows | Kilang | One row per displayed zh definition/meaning. Examples stay under their own meaning instead of being globally merged. | `content.js`: `getMoeSenseRows()`, `renderMoeSenseRows()`. |
| Example display | Kilang and ePark rows with examples | Shows up to 3 examples. Kilang sense rows expand when more than 3 examples exist. | `content.js`: `buildExamplesPanel()`, `toggleMoeSenseExamples()`. |
| Source/tier pills | Kilang | Shows compact metadata like `T3 S` next to Kilang sense rows. | `content.js`: `getMoeSourceMeta()`, `getMoeSourceLabel()`. |

## Audio And Copy

| Feature | Scope | Current state | Implementation |
|---|---|---|---|
| Header audio button | ePark AB-to-ZH | Shows only when a main ePark result has audio. Hidden for ZH-to-AB and Kilang-only results. | `content.js`: `getAudioUrl()`, `setHeaderAudioUrl()`. |
| Row audio button | ePark ZH-to-AB and result rows with audio | Shows when an entry has an audio URL. Hidden when absent. | `content.js`: `appendResultRow()`, `createAudioButton()`. |
| Example copy button | Universal examples | Copies AB + ZH text. Icon temporarily changes to a check mark after success. | `content.js`: `createCopyButton()`, `setCopyButtonIcon()`. |

### Audio Universalization Plan

Current strategy:

- Extension work should make audio consumption source-agnostic: direct row/headword audio, row audio, and example audio should render from normalized `audioUrl` fields regardless of source.
- Do not plan around rescraping MoE dictionary audio into Citadel. MoE audio coverage is expected to be weak, and Kilang/MoE rows currently do not expose useful audio URLs.
- Treat ILRDF / 原住民族語言線上辭典 as the likely primary future audio source because it appears to have better coverage. Citadel can later ingest or link ILRDF audio, either by scraping/copying from the planned source or importing from a GitHub repo if available.
- Preferred Citadel API contract remains source-neutral: rows and examples should expose absolute `audio_url` values when known, and `null`/empty values when absent. The extension should not need source-specific URL construction.
- Once Citadel exposes `audio_url` consistently for ILRDF/ePark/Kilang-derived rows or examples, the extension should show audio automatically through the same row/example controls.

## Options And Popup

| Feature | Scope | Current state | Implementation |
|---|---|---|---|
| Source selection | Universal | Sources shown as ePark, Kilang, ILRDF. Kilang is the only enabled default source. | `options.html`, `options.js`, `shared.js`. |
| Kilang availability | Amis only | Kilang source checkbox is disabled outside Amis. Content-side checks also require Amis. | `options.js`: `updateSourceAvailability()`; `content.js`: `canUseMoeKilang()`, `canUseKilangZhToAb()`. |
| Appearance settings | Universal | Theme, font size, bold translations, and dialect display are stored in `chrome.storage.sync`. | `options.js`, `popup.js`, `content.css`. |
| Popup quick controls | Universal | Enables/disables extension, theme/font controls, Amis alt-spelling toggle, hover toggle, and link to full options. | `popup.html`, `popup.js`. |

## Packaging

| Feature | Scope | Current state | Implementation |
|---|---|---|---|
| Chrome upload zip | Project tooling | Run from repo root: `powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\package-extension.ps1`. Output goes to `dev/dist/ycm-popupdict-v<manifest version>.zip`. | `dev/package-extension.ps1`. |
| Generated artifact policy | Project tooling | `dev/dist/`, `dev/scratch/`, and `dev/tmp/` are ignored except the legacy tracked handoff zip under `dev/dist/legacy/`. | `.gitignore`. |

## Current Caveats

- Kilang is Amis-only by design in both UI availability and content-side guards.
- Kilang audio is not implemented because the current Kilang/MoE rows do not expose audio URLs.
- ZH-to-AB Kilang ranking prefers better source ranks (`s`, then `m`, `a`, `old-s`, then `p`) but Chinese definition search can still return broad semantic matches.
- CJK hover multi-source lookup can make several API calls per hover event; caching limits repeat cost, but very broad text can still be heavier than AB lookup.
- PDF support was explicitly dropped.
- ILRDF is configured as a disabled source placeholder, not an active lookup path.

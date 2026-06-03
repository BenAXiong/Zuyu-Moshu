# Feature Inventory

Global timestamp: 2026-06-03 22:40 +08:00

Current extension version: 1.5.0

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
| Saved-list opener | Universal | Tooltip shows a visually separate larger floating button aligned with the top border to the right of the header that opens the saved-items page. | `content.js`: `createOpenSavedButton()`, `showFloatingSavedButton()`; `saved.html`. |

## Kilang Morphology And Sense UI

| Feature | Scope | Current state | Implementation |
|---|---|---|---|
| Kilang AB lookup | Kilang, Amis only | Uses exact lookup first, then a ranked recovery pipeline: full-word spelling alternates, conservative glottal repair, bounded chained affix stripping, then alternates/glottal repair on stripped forms. | `background.js`: `fetchMoeInsights()`, `makeMoeFallbackCandidates()`. |
| Kilang ZH lookup | Kilang, Amis only | Uses `exact=false` to search Chinese definitions and examples through Citadel's MoE shadow endpoint. | `background.js`: `fetchMoeZhInsights()`; `content.js`: `getZhLookupEntries()`. |
| Lineage enrichment | Kilang, Amis only | Exact AB lookups enrich one root. ZH lookups enrich up to 8 roots because Chinese terms can match unrelated words. | `background.js`: `enrichMoeRows()`, `fetchMoeLineageRows()`. |
| Root chip | Kilang AB only | Shows ultimate root in the tooltip header when it adds information. If the headword is already the root, only the red root icon is shown. Pure spelling recovery also keeps the icon-only root marker when the root is just the recovered spelling. | `content.js`: `setHeaderRoot()`, `createRootIcon()`, `renderMoeKilangSection()`. |
| Recovery/affix context label | Kilang AB only | Displays compact relation headers. Pure spelling alternates use `~`, derived or more complex recovery uses the branch marker. Exact lineage can infer forms like `hinatala + ka-...-an`; recovered fallback can use lookup metadata like `'orip + ni- + ka-`. | `content.js`: `getMoeAffixes()`, `formatMoeAffixSummary()`, `getMoeRecoveryAffixSummary()`, `appendMoeRelationHeaders()`. |
| Kilang alt dedupe | Kilang AB only | Suppresses the separate Kilang alt section when the main Kilang recovery already displays the same matched form. ePark alt rows stay independent. | `content.js`: `getMoeMatchKey()`, `removeDuplicateMoeAltSection()`, `renderMoeKilangSection()`, `renderMoeAltSection()`. |
| Sense rows | Kilang | One row per displayed zh definition/meaning. Examples stay under their own meaning instead of being globally merged. | `content.js`: `getMoeSenseRows()`, `renderMoeSenseRows()`. |
| Example display | Kilang and ePark rows with examples | Shows up to 3 examples. Kilang sense rows expand when more than 3 examples exist. | `content.js`: `buildExamplesPanel()`, `toggleMoeSenseExamples()`. |
| Source/tier pills | Kilang | Shows very compact metadata like `T3 S` next to Kilang sense rows. | `content.js`: `getMoeSourceMeta()`, `getMoeSourceLabel()`; `content.css`: `.fdt-moe-source`. |

## Audio And Copy

| Feature | Scope | Current state | Implementation |
|---|---|---|---|
| Header audio button | Source-agnostic direct headword audio | Shows only when the current main headword row has direct audio. It does not borrow nested example audio. | `content.js`: `getAudioUrl()`, `setHeaderAudioUrl()`. |
| Row audio button | Source-agnostic direct row audio | Shows when a result row or Kilang sense row has direct audio. Hidden when absent. | `content.js`: `appendResultRow()`, `renderMoeSenseRows()`, `createAudioButton()`. |
| Example audio button | Source-agnostic example audio | Shows when an example has `audioUrl` / `audio_url`. Kilang examples are audio-ready if Citadel adds audio fields later. | `content.js`: `getExampleRows()`, `getMoeExampleRows()`, `buildExamplesPanel()`. |
| Example copy button | Universal examples | Copies AB + ZH text. It is stacked below the example save button, and the icon temporarily changes to a check mark after success. | `content.js`: `createCopyButton()`, `setCopyButtonIcon()`. |

## Saved Items

| Feature | Scope | Current state | Implementation |
|---|---|---|---|
| Local saved-item storage | Universal | Saves words, Kilang senses, and examples to `chrome.storage.local` under `savedItemsV1`. Items dedupe by a stable source/text/provenance key. | `saved_store.js`: `fdtToggleSavedItem()`, `fdtGetSavedItems()`, `fdtNormalizeSavedItem()`. |
| Tooltip save buttons | Universal | Tooltip header has the current headword/current matched fallback bookmark. Example rows have their own bookmark; clicking a saved bookmark removes it. | `content.js`: `createHeaderSaveButton()`, `setHeaderSaveItem()`, `createSaveButton()`, `buildSavedExample()`. |
| Saved-items page | Universal | Dedicated extension page titled `族語魔書 - 咒語庫`. Supports search, type/language filters, sense-example show/hide toggle, delete, copy one item, copy selected, and copy the current filtered list. | `saved.html`, `saved.css`, `saved.js`. |
| Popup access | Universal | Mini menu includes a link to open the saved-items page. | `popup.html`, `popup.js`. |
| Future export path | Universal | Clipboard export is implemented first. The source-neutral saved item schema keeps room for future IndiHunt, Notion, paragraph-analysis, MT/TTS, and Kilang-tree features. | `saved_store.js`: `fdtFormatSavedItem()`. |

### Audio Universalization Plan

Current strategy:

- Extension audio consumption is source-agnostic: direct row/headword audio, row audio, and example audio render from normalized `audioUrl` fields regardless of source.
- Do not plan around rescraping MoE dictionary audio into Citadel. MoE audio coverage is expected to be weak, and Kilang/MoE rows currently do not expose useful audio URLs.
- Treat ILRDF / 原住民族語言線上辭典 as the likely primary future audio source because it appears to have better coverage. Citadel can later ingest or link ILRDF audio, either by scraping/copying from the planned source or importing from a GitHub repo if available.
- Preferred Citadel API contract remains source-neutral: rows and examples should expose absolute `audio_url` values when known, and `null`/empty values when absent. The extension should not need source-specific URL construction.
- Once Citadel exposes `audio_url` consistently for ILRDF/ePark/Kilang-derived rows or examples, the extension should show audio automatically through the same row/example controls.

Future-work anchor: `AUDIO-ILRDF-CITADEL`

Remaining work under this anchor is Citadel/data-side:

- Ingest or link ILRDF audio into Citadel without depending on a new MoE scrape.
- Decide matching rules between ILRDF entries/audio and Kilang/MoE rows, especially roots, derived forms, and spelling variants.
- Expose absolute `audio_url` on row objects for direct headword/entry audio.
- Expose absolute `audio_url` inside example objects when sentence/example audio is known.
- Keep the API contract source-neutral so the extension consumes `audio_url` rather than constructing source-specific URLs.

## Options And Popup

| Feature | Scope | Current state | Implementation |
|---|---|---|---|
| Source selection | Universal | Sources shown as ePark, Kilang, ILRDF. Kilang is the only enabled default source. | `options.html`, `options.js`, `shared.js`. |
| Kilang availability | Amis only | Kilang source checkbox is disabled outside Amis. Content-side checks also require Amis. | `options.js`: `updateSourceAvailability()`; `content.js`: `canUseMoeKilang()`, `canUseKilangZhToAb()`. |
| Appearance settings | Universal | Theme, font size, bold translations, and dialect display are stored in `chrome.storage.sync`. | `options.js`, `popup.js`, `content.css`. |
| Popup quick controls | Universal | Enables/disables extension, theme/font controls, Amis alt-spelling toggle, hover toggle, and has two icon+label buttons for options and saved items. | `popup.html`, `popup.js`. |

## Packaging

| Feature | Scope | Current state | Implementation |
|---|---|---|---|
| Chrome upload zip | Project tooling | Run from repo root: `powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\package-extension.ps1`. Output goes to `dev/dist/ycm-popupdict-v<manifest version>.zip`. | `dev/package-extension.ps1`. |
| Generated artifact policy | Project tooling | `dev/dist/`, `dev/scratch/`, and `dev/tmp/` are ignored except the legacy tracked handoff zip under `dev/dist/legacy/`. | `.gitignore`. |

## Current Caveats

- Kilang is Amis-only by design in both UI availability and content-side guards.
- Kilang audio rendering is extension-ready, but current Kilang/MoE rows do not expose useful audio URLs.
- Kilang AB fallback is intentionally capped: it keeps the existing affix inventory, allows at most 2 prefix strips and 1 suffix strip, tries at most 4 spelling-swap positions per candidate, and queries at most 20 fallback candidates. Glottal repair currently covers leading/trailing glottals and one internal glottal at known prefix boundaries.
- ZH-to-AB Kilang ranking prefers better source ranks (`s`, then `m`, `a`, `old-s`, then `p`) but Chinese definition search can still return broad semantic matches.
- CJK hover multi-source lookup can make several API calls per hover event; caching limits repeat cost, but very broad text can still be heavier than AB lookup.
- PDF support was explicitly dropped.
- ILRDF is configured as a disabled source placeholder, not an active lookup path.
- Saved items are local to the current Chrome profile/device in v1.5.0. Cross-device sync/export is not implemented yet.

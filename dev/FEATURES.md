# Feature Inventory

Global timestamp: 2026-06-05 01:09 +08:00

Current extension version: 1.5.4

This document is a current-state inventory, not a historical changelog. It lists what is implemented, whether behavior is universal or source-specific, and the main technical entry points.

## Data Sources

| Source | Label | Status | Scope | API path | Notes |
|---|---|---|---|---|---|
| `EPARK` | ePark | Enabled | All configured languages/dialects | `https://ycm-citadel.vercel.app/api/search?mode=DICT&q=...` | Legacy DICT/ePark lookup. Supports AB-to-ZH and ZH-to-AB. May include audio URLs on sentence rows when the API returns them. |
| `KILANG` | Kilang | Enabled | Amis only | `https://ycm-citadel.vercel.app/api/moe_shadow?...&mode=moe` | MoE/Kilang-derived Amis morphology and dictionary data. Supports AB-to-ZH/root-affix insight and ZH-to-AB lookup. No audio currently expected. |
| `ILRDF` | ILRDF | Disabled | Reserved | none active | Present in source config but not available in the UI. |
| `ILRDF_AI` | ILRDF AI Labs | Enabled for saved page AI panel | Amis MT/TTS currently | `https://ai-labs.ilrdf.org.tw/.../gradio_api/call/...` | Saved page `AI MT & TTS` tab calls ILRDF Gradio endpoints directly. Requires `https://ai-labs.ilrdf.org.tw/*` host permission. |

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
| Responsive tooltip width | Universal | Tooltip width can grow from 304px up to 608px, capped by viewport width. Layout is remeasured after results render so the tooltip and floating saved-list button stay clamped. | `content.css`: `#formosan-dict-tooltip`; `content.js`: `positionTooltipAndSavedButton()`, `refreshTooltipLayout()`. |
| ZH-to-AB normalized rows | Universal across enabled zh-capable sources | AB is primary text. ZH definition/translation is secondary text. ePark and Kilang share the row UI. | `content.js`: `normalizeDictZhEntries()`, `normalizeMoeZhEntries()`, `getZhLookupEntries()`. |
| CJK hover candidate groups | Universal across enabled zh-capable sources | Shows at most 6 candidate groups, each with at most 2 unique AB results. Longer candidates are prioritized. | `content.js`: `makeCjkCandidates()`, `triggerCandidateLookup()`, `renderCandidateSections()`. |
| No-results state | Universal | Shows `查無此詞` only if no enabled source/section produced content. | `content.js`: `showNoResultsIfEmpty()`. |
| Header language pill | Universal | Shows selected language, or `所有族語` when no language is selected. | `content.js`: `showTooltip()`. |
| Dialect labels | ePark | Full dialect names when no language is selected; shortened dialect labels when a language is selected. | `content.js`: `getDialectLabel()`. |
| Tooltip drilling | Universal for drillable AB text | AB tokens in examples and ZH-to-AB primary rows are rendered as subtle inline buttons. Clicking drills in the same tooltip panel. | `content.js`: `appendDrillableText()`, `drillLookup()`, `normalizeTooltipNav()`. |
| Floating tooltip actions | Universal | Tooltip shows a visually separate vertical floating action stack aligned with the top border. The top button opens the saved-items page with an external-window icon; the second button exports the current tooltip rows/examples to IndiHunt. | `content.js`: `createOpenSavedButton()`, `createIndiHuntExportButton()`, `exportTooltipToIndiHunt()`, `showFloatingSavedButton()`; `content.css`; `manifest.json`. |

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
| Tooltip save buttons | Universal | Tooltip header has the current headword/current matched fallback bookmark. Alt-spelling section headers, Kilang derived/recovery relation headers, and example rows have their own bookmarks; clicking a saved bookmark removes it. | `content.js`: `createHeaderSaveButton()`, `setHeaderSaveItem()`, `createSaveButton()`, `appendMoeRelationSaveButton()`, `buildSavedExample()`. |
| Saved-items page | Universal plus Amis AI | Dedicated extension page titled `族語魔書` with centered workspace tabs: `咒語庫`, `短章分析`, `短章分析*`, `AI MT & TTS`, `Kilang`, `族語考試`, and `?`. `咒語庫` is functional. `短章分析` tokenizes pasted text, runs bounded-concurrency lookup against Kilang or ePark, and renders a full-width sentence-by-sentence AB/root/ZH table with column-hiding toggles and duplicate hiding. `短章分析*` is now a separate annotated reader panel that renders sentence rows as inline AB text with furigana-style ZH glosses below each analyzed word, optional top annotations for fallback/alt display, optional sentence divider hiding, optional Chinese-gloss/top-annotation hiding, full/split/single layouts, single-sentence previous/next arrows, per-sentence Amis TTS, per-sentence Amis-to-ZH MT, and per-sentence IndiHunt export. Single-sentence mode centers the current sentence in a container that can expand to `80vw`. Reader top annotations format derived/recovered forms as `root + affixes` and prefix alternate-spelling recovery with `~`. Reader MT/TTS use Malan as the fallback Amis dialect; IndiHunt export sends the original sentence and the MT line only when present. Short analysis lookup cap is 500 unique tokens. `AI MT & TTS` supports Amis ZH-to-Amis / Amis-to-ZH translation and Amis TTS through ILRDF AI Labs; the language selector lists 16 language codes but non-Amis currently reports Amis-only support. `Kilang`, `族語考試`, and `?` remain empty shells. | `saved.html`, `saved.css`, `saved.js`. |
| Popup access | Universal | Mini menu includes a link to open the saved-items page. | `popup.html`, `popup.js`. |
| Future export path | Universal | Saved-page and tooltip IndiHunt export open `https://indilog.vercel.app/import#v1:<base64>` with the agreed v1 payload, 16-language code map, flattened example sentence items, and local IndiHunt logo assets. The source-neutral saved item schema keeps room for future Notion, paragraph-analysis, MT/TTS, and Kilang-tree features. | `saved_store.js`: `fdtFormatSavedItem()`; `saved.js`: `exportItemsToIndiHunt()`, `formatIndiHuntItems()`, `openIndiHuntImport()`; `content.js`: `exportTooltipToIndiHunt()`; `assets/indivore/`. |

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
| Unsaved options warning | Universal | Options page prompts with the browser's native leave-page warning when form controls differ from the last loaded/saved settings. | `options.js`: `readCurrentOptions()`, `hasUnsavedOptions()`. |
| Popup quick controls | Universal | Enables/disables extension, theme/font controls, Amis alt-spelling toggle, hover toggle, and has two icon+label buttons for options and saved items. | `popup.html`, `popup.js`. |

## Packaging

| Feature | Scope | Current state | Implementation |
|---|---|---|---|
| Chrome upload zip | Project tooling | Run from repo root: `powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\package-extension.ps1`. Output goes to `dev/dist/ycm-popupdict-v<manifest version>.zip`. | `dev/package-extension.ps1`. |
| Generated artifact policy | Project tooling | `dev/dist/`, `dev/scratch/`, and `dev/tmp/` are ignored except the legacy tracked handoff zip under `dev/dist/legacy/`. | `.gitignore`. |

## v1.5 Release Status

Implemented:

- Built-in saved-items list with local storage, tooltip save buttons, popup access, and copy/delete/export-to-clipboard basics.
- Saved page workspace shell with wired short-text token lookup, future Kilang / 族語考試 / ? tabs, a wired Amis AI MT/TTS panel, plus selected-item IndiHunt direct import. Short-text analysis caps at 500 unique tokens, normalizes pasted text into sentence segments, normalizes curly glottals before lookup, and renders a full-width sentence-by-sentence table with repeated AB/root/ZH columns aligned to the input's two-line rhythm; ZH cells are compact ellipsized cells with full text on hover. `短章分析*` is a separate annotated-reader experiment with inline furigana-style AB/ZH annotations, full/split/single layouts, reader annotation toggles, per-sentence MT/TTS, and per-sentence IndiHunt export. Kilang analysis keeps the best available source rank to avoid noisy raw fallback definitions. The analysis toolbar has column-hiding toggles for 族語/root/中文 plus a duplicate-hiding toggle, and the counter shows analyzed/shown token counts; the saved filter button is present but intentionally not wired yet. Sentence/example lookup and source/tier display are intentionally omitted.
- Options page unsaved-change warning.

Left before publishing:

- Manual smoke test in Chrome after reloading the unpacked extension: options save warning, tooltip save/remove, saved page filters/copy/delete, and popup links.
- Regenerate the Chrome upload zip only when explicitly preparing the dashboard upload.

Deferred beyond v1.5:

- Richer short-text analysis actions such as saving/exporting analyzed rows, annotated-reader copy actions, saved/unknown/duplicate coloring, root/affix symbols, non-Amis AI MT/TTS coverage, Kilang tree panel, cloud/sync storage, and richer export targets such as Notion.

## Current Caveats

- Kilang is Amis-only by design in both UI availability and content-side guards.
- Kilang audio rendering is extension-ready, but current Kilang/MoE rows do not expose useful audio URLs.
- Kilang AB fallback is intentionally capped: it keeps the existing affix inventory, allows at most 2 prefix strips and 1 suffix strip, tries at most 4 spelling-swap positions per candidate, and queries at most 20 fallback candidates. Glottal repair currently covers leading/trailing glottals and one internal glottal at known prefix boundaries.
- ZH-to-AB Kilang ranking prefers better source ranks (`s`, then `m`, `a`, `old-s`, then `p`) but Chinese definition search can still return broad semantic matches.
- CJK hover multi-source lookup can make several API calls per hover event; caching limits repeat cost, but very broad text can still be heavier than AB lookup.
- PDF support was explicitly dropped.
- ILRDF is configured as a disabled source placeholder, not an active lookup path.
- Saved items are local to the current Chrome profile/device in v1.5.4. Cross-device sync/export is not implemented yet.
- The `AI MT & TTS` tab adds `https://ai-labs.ilrdf.org.tw/*` as a host permission and currently only performs live MT/TTS for Amis.

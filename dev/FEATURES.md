# Feature Inventory

Global timestamp: 2026-06-12 03:26 +08:00

Current extension version: 1.6.3

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
| Ctrl + select phrase assist | Universal trigger, source-dependent lookup | Ctrl-selecting 2-16 AB tokens opens phrase mode instead of single-word mode. The selected AB phrase remains in the header, and drillable words are rendered there as inline header tokens. Phrase mode displays tokens of 2 characters or less as pass-through AB text in the gloss row but skips API lookup for them. Longer tokens normalize curly glottals before lookup, then render as a compact plain gloss sequence. Whitespace-only gaps use pipes, while punctuation found in the selected AB phrase replaces the pipe. Ambiguous tokens can show up to 2 slash-separated glosses, such as `八/花蕾`, instead of collapsing to the first sense. Missing longer-token lookups render as `x`. The back button can return from a drilled word tooltip to the original phrase-assist tooltip. Phrase hints strip parentheticals and MoE bracket notes, split wordy definitions, and truncate long chunks. | `content.js`: `lookupRawSelection()`, `triggerPhraseLookup()`, `renderPhraseHeader()`, `lookupPhraseToken()`, `appendPhraseSequence()`, `getPhraseGlossesFromTexts()`, `goBackInTooltip()`. |
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
| Responsive tooltip width | Universal plus phrase mode | Normal tooltip width can grow from 304px up to 608px, capped by viewport width. Phrase-assist tooltips request a wider 920px viewport-capped width to fit selected phrases and ZH hint sequences. Layout is remeasured after results render so the tooltip and floating saved-list button stay clamped. Selection positioning prefers visible range fragments before falling back to the browser bounding rect. | `content.css`: `#formosan-dict-tooltip`, `.fdt-phrase-tooltip`; `content.js`: `getRangeLookupRect()`, `positionTooltipAndSavedButton()`, `refreshTooltipLayout()`. |
| ZH-to-AB normalized rows | Universal across enabled zh-capable sources | AB is primary text. ZH definition/translation is secondary text. ePark and Kilang share the row UI. | `content.js`: `normalizeDictZhEntries()`, `normalizeMoeZhEntries()`, `getZhLookupEntries()`. |
| CJK hover candidate groups | Universal across enabled zh-capable sources | Shows at most 6 candidate groups, each with at most 2 unique AB results. Longer candidates are prioritized. | `content.js`: `makeCjkCandidates()`, `triggerCandidateLookup()`, `renderCandidateSections()`. |
| No-results state | Universal | Shows `查無此詞` only if no enabled source/section produced content. | `content.js`: `showNoResultsIfEmpty()`. |
| Header language pill | Universal | Shows selected language, or `所有族語` when no language is selected. | `content.js`: `showTooltip()`. |
| Dialect labels | ePark | Full dialect names when no language is selected; shortened dialect labels when a language is selected. | `content.js`: `getDialectLabel()`. |
| Tooltip drilling | Universal for drillable AB text | AB tokens in examples, ZH-to-AB primary rows, phrase-assist header tokens, and Kilang derived/recovery relation headers drill in the same tooltip panel. Back history supports both word and phrase-assist return states. | `content.js`: `appendDrillableText()`, `appendMoeDerivedHeader()`, `renderPhraseHeader()`, `drillLookup()`, `normalizeTooltipNav()`, `goBackInTooltip()`. |
| Floating tooltip actions | Universal | Tooltip shows a visually separate vertical floating action stack aligned with the top border. The top button opens the saved-items page with an external-window icon; the second button exports the current tooltip rows/examples to IndiHunt; the Kilang-logo third button opens the current tooltip lookup/phrase in Companion. | `content.js`: `createOpenSavedButton()`, `createIndiHuntExportButton()`, `createKilangExportButton()`, `openTooltipInCompanion()`, `exportTooltipToIndiHunt()`, `showFloatingSavedButton()`; `content.css`; `manifest.json`. |
| Phrase AI tools | Amis AI, popup-gated | When the popup `AI工具` toggle is enabled, phrase-assist tooltips add header buttons for Amis-to-ZH MT and Amis TTS using Malan defaults. MT still runs from the content script and renders a separate AI line below the ZH hint sequence. Phrase tooltip TTS now sends text to the background `playIlrdfTts` service; the background generates/caches the ILRDF audio URL and plays it through the extension offscreen document. | `content.js`: `appendPhraseAiButtons()`, `translatePhrase()`, `speakPhrase()`, `gradioCall()`; `background.js`: `playIlrdfTts()`, `getTtsAudioUrl()`, `playOffscreenAudio()`; `offscreen.html`, `offscreen.js`; `popup.html`, `popup.js`, `shared.js`; `manifest.json`: `offscreen` permission. |

## Kilang Morphology And Sense UI

| Feature | Scope | Current state | Implementation |
|---|---|---|---|
| Kilang AB lookup | Kilang, Amis only | Uses exact lookup first, then a ranked recovery pipeline: full-word spelling alternates, conservative glottal repair, bounded chained affix stripping, then alternates/glottal repair on stripped forms. | `background.js`: `fetchMoeInsights()`, `makeMoeFallbackCandidates()`. |
| Kilang ZH lookup | Kilang, Amis only | Uses `exact=false` to search Chinese definitions and examples through Citadel's MoE shadow endpoint. | `background.js`: `fetchMoeZhInsights()`; `content.js`: `getZhLookupEntries()`. |
| Lineage enrichment | Kilang, Amis only | Exact AB lookups enrich one root. ZH lookups enrich up to 8 roots because Chinese terms can match unrelated words. | `background.js`: `enrichMoeRows()`, `fetchMoeLineageRows()`. |
| Root chip | Kilang AB only | Shows ultimate root in the tooltip header when it adds information. If the headword is already the root, only the red root icon is shown. If spelling/glottal recovery makes the recovered match itself the root, the root pill stays visible with a tilde, e.g. `~ fila'`, so the data is preserved without implying an exact selected-form root. | `content.js`: `setHeaderRoot()`, `createRootIcon()`, `renderMoeKilangSection()`. |
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
| ILRDF TTS playback | Amis AI | Background now owns generated-tooltip/Companion TTS URL generation and caching through `playIlrdfTts`, then plays audio through an extension offscreen document. Tooltip phrase TTS and Companion header/example TTS both use that service. Saved-page AI TTS and `短章分析*` sentence TTS still call ILRDF Gradio directly in `saved.js`; `短章分析*` TTS is confirmed working. | `background.js`: `getTtsAudioUrl()`, `playIlrdfTts()`, `ensureOffscreenAudioDocument()`, `playOffscreenAudio()`; `content.js`: `speakPhrase()`; `sidepanel.js`: `createCompanionTtsButton()`; `offscreen.html`, `offscreen.js`; `saved.js`: `getCachedTtsAudioUrl()`, `playReaderSentenceTts()`, `aiListen()`. |
| Example copy button | Universal examples | Copies AB + ZH text. It is stacked below the example save button, and the icon temporarily changes to a check mark after success. | `content.js`: `createCopyButton()`, `setCopyButtonIcon()`. |

## Saved Items

| Feature | Scope | Current state | Implementation |
|---|---|---|---|
| Local saved-item storage | Universal | Saves words, Kilang senses, and examples to `chrome.storage.local` under `savedItemsV1`. Items dedupe by a stable source/text/provenance key. | `saved_store.js`: `fdtToggleSavedItem()`, `fdtGetSavedItems()`, `fdtNormalizeSavedItem()`. |
| Tooltip save buttons | Universal | Tooltip header has the current headword/current matched fallback bookmark. Alt-spelling section headers, Kilang derived/recovery relation headers, and example rows have their own bookmarks; clicking a saved bookmark removes it. | `content.js`: `createHeaderSaveButton()`, `setHeaderSaveItem()`, `createSaveButton()`, `appendMoeRelationSaveButton()`, `buildSavedExample()`. |
| Saved-items page | Universal plus Amis AI | Dedicated extension page titled `族語魔書` with centered workspace tabs: `咒語庫`, `短章分析`, `短章分析*`, `AI MT & TTS`, `Kilang`, `族語考試`, and `?`. `咒語庫` is functional. `短章分析` tokenizes pasted text, runs bounded-concurrency lookup against Kilang or ePark, and renders a full-width sentence-by-sentence AB/root/ZH table with column-hiding toggles and duplicate hiding. `短章分析*` is now a separate annotated reader panel that renders sentence rows as inline AB text with furigana-style ZH glosses below each analyzed word, optional top annotations for fallback/alt display, optional sentence divider hiding, optional Chinese-gloss/top-annotation hiding, full/split/single layouts, single-sentence previous/next arrows, per-sentence Amis TTS, per-sentence Amis-to-ZH MT, and per-sentence IndiHunt export. Single-sentence mode centers the current sentence in a container that can expand to `80vw`. Reader top annotations format derived/recovered forms as `root + affixes` and prefix alternate-spelling recovery with `~`. Reader MT/TTS use Malan as the fallback Amis dialect; IndiHunt export sends the original sentence and the MT line only when present. Short analysis lookup cap is 500 unique tokens. `AI MT & TTS` supports Amis ZH-to-Amis / Amis-to-ZH translation and Amis TTS through ILRDF AI Labs; the language selector lists 16 language codes but non-Amis currently reports Amis-only support. `Kilang`, `族語考試`, and `?` remain empty shells. | `saved.html`, `saved.css`, `saved.js`. |
| Popup access | Universal | Mini menu includes a link to open the saved-items page. | `popup.html`, `popup.js`. |
| Future export path | Universal | Saved-page and tooltip IndiHunt export open `https://indilog.vercel.app/import#v1:<base64>` with the agreed v1 payload, 16-language code map, flattened example sentence items, and local IndiHunt logo assets. The source-neutral saved item schema keeps room for future Notion, paragraph-analysis, MT/TTS, and Kilang-tree features. | `saved_store.js`: `fdtFormatSavedItem()`; `saved.js`: `exportItemsToIndiHunt()`, `formatIndiHuntItems()`, `openIndiHuntImport()`; `content.js`: `exportTooltipToIndiHunt()`; `assets/indivore/`. |

## Companion

| Feature | Scope | Current state | Implementation |
|---|---|---|---|
| Native Side Panel target | v1.6 in progress | Companion is wired as a Chrome native Side Panel. Popup can choose lookup display target `提示框 / 側欄`, and eligible double-click / Ctrl-select selections route to Companion when selected. Hover remains tooltip-only/off. The content script sends raw selected context to background, background stores it in `chrome.storage.session`, opens the Side Panel, and the Side Panel renders the active `單詞`/`句子` context. The top bar now carries clear and current-view IndiHunt export icon buttons; lookup/reader headers keep inline back, selected title/phrase, save, and optional MT/TTS buttons. The old details disclosure and popup footer Companion button are removed. Companion applies the shared theme/font settings live through `FDT_APPEARANCE` and supports the existing four themes: dark, light, paper, and field. | `manifest.json`: `side_panel`, `sidePanel` permission; `popup.html`, `popup.js`; `content.js`: `sendCompanionContext()`; `background.js`: `openCompanion()`; `appearance.js`; `sidepanel.html`, `sidepanel.css`, `sidepanel.js`. |
| Companion manual input | v1.6.2 in progress | A global input row under the Companion mode tabs lets users type a word, Chinese query, phrase, or sentence. Submit builds the same context shape used by page selection: CJK or one AB token routes to `單詞`, while multi-token AB text routes to `句子`. Companion state is now per-tab: `單詞` and `句子` each keep their own last context, so reading a sentence no longer overwrites the previous word lookup, and drilling from `句子` updates the `單詞` tab while preserving the reader tab. Legacy `companionContext` messages from content scripts are migrated into the newer `companionState` session object. | `sidepanel.html`: `manualSearch`; `sidepanel.js`: `handleManualSearch()`, `buildManualSearchContext()`, `persistCompanionState()`, `applyIncomingContext()`; `sidepanel.css`: `.manual-search`. |
| Companion lookup | v1.6 in progress | Single-word contexts render a Side Panel lookup view. AB lookup supports Kilang and ePark/DICT paths. ZH-to-AB lookup supports enabled ePark/DICT and Kilang `moeZhLookup` sources, then renders drillable AB result rows in white with secondary ZH definitions. In ZH lookup, the header bookmark batch-saves all displayed result rows, warning with `this will save x results` when more than one missing result will be added; row bookmarks still toggle individual results. ZH rows with examples get a small centered chevron, and only the first example-bearing row is expanded by default. Kilang AB lookup now uses a Companion-only expanded candidate endpoint: exact rows are shown first, then up to 8 successful spelling alternate / glottal repair / affix-stripped fallback candidates are grouped below with relation headers. This is intentionally broader than tooltip lookup, which still consumes the compact first-match `moeInsights` behavior. The candidate resolver boundary is now explicit: `background.js` discovers raw candidate rows, `lookup_core.js` normalizes them into exact/alt/repair/fallback candidates with chain/relation metadata, and `sidepanel.js` only renders that normalized shape. Kilang AB results show full sense definitions, examples, compact source/tier metadata in saved/export data only, and a textual chain row at the top only when the returned row has an explicit `parent_word`; the chain row has a passive tree/logo mark aligned right. DB-backed chains are unmarked; inferred recovery/fallback chain links append a `?` marker whose tooltip explains that the displayed entry is in our database but the link was inferred by the extension. AB lookup headers show the tooltip-style root marker only when a Kilang row exposes `ultimate_root` or `stem`; if the current AB headword is already that root, the marker is icon-only; if the root equals a recovered spelling/glottal match different from the typed query, it displays as `~ root`; otherwise it is a clickable root pill. Header bookmark saves a distinct aggregate `word` item for the current headword/result set, while row bookmarks save individual senses/result rows. Row/example bookmarks sit in the stable one-column right rail with borderless/backgroundless floating bookmark icons. Header TTS, row audio, and example audio/TTS sit inline next to the relevant word or example text rather than beside the bookmark column. Generated Companion AI/TTS controls reveal only while hovering or focusing the Companion content body; direct source-audio buttons remain visible. Fallback/alt/derived relation labels use the same `?` marker when the jump is inferred (`~` for pure alt, branch marker plus affix pill for recovery/derived). Visible source pills such as `T2 S` are hidden. Example AB words are drillable; example generated TTS is hidden when direct source audio exists. Source toggles are respected; if only Kilang is enabled, Companion does not call the dictionary endpoint. Companion rows/senses/examples expose bookmark-style save buttons, current-view IndiHunt export from the top bar, and direct source-audio buttons when `audioUrl` exists. | `background.js`: `fetchMoeCandidateInsights()`; `lookup_core.js`: `normalizeMoeCandidateInsights()` and Kilang candidate metadata helpers; `sidepanel.js`: `buildLookupView()`, `fetchWordSections()`, `fetchZhSections()`, `fetchKilangSection()`, `fetchDictSection()`, `appendDrillableAbText()`, `createCompanionTtsButton()`, `createCompanionMtButton()`, `createCompanionSaveButton()`, `createCompanionBatchSaveButton()`, `exportCompanionToIndiHunt()`; `saved_store.js`. |
| Companion reader (`句子`) | v1.6 in progress | Phrase/sentence contexts render an annotated reader section only; the old token grid is removed. Companion re-tokenizes the raw selection up to 80 tokens instead of inheriting the tooltip phrase cap. Tokens of 2 characters or less are pass-through and are not looked up. Longer unique tokens are looked up with bounded concurrency through enabled sources, using Kilang first by default. The reader renders sentence-style AB text with compact ZH annotations below each token and top annotations for alternate/fallback/root hints when available. Below it, an optional tight 3-column word table lists AB, furigana/top annotation, and gloss for each token. Reader tokens and table rows now expose stable status hooks: `status-unknown`, `status-recovered`, `status-fallback`, `status-alt`, and `status-saved`, plus `data-token`, `data-match`, `data-root`, and `data-status`. Saved-token status is computed from local saved words in the active language and live-refreshes when `savedItemsV1` changes; Kilang recovered/alt/fallback status preserves `moeInsights` recovery metadata. Header toggles can hide/show top annotations, Chinese glosses, sentence dividers, and the word table; top/gloss/divider toggles also affect the matching table column or row dividers. Toggle state is persisted locally. MT/TTS live in the reader header rather than repeated on each gloss sentence. Reader punctuation inserts line breaks after `, . ; :` style separators. Top-bar IndiHunt export sends the full current `句子` passage split into sentence items, with the IndiHunt import page handling later filtering. | `sidepanel.html`: `readerControls`; `sidepanel.js`: `buildAnalysisView()`, `annotateReaderRows()`, `refreshReaderSavedStatus()`, `makeReaderView()`, `makeReaderWordTable()`, `lookupAnalysisToken()`, `formatIndiHuntAnalysisItems()`, `applyReaderControls()`; `sidepanel.css`: `.reader-controls`, `.reader-word-table-section`, `.status-unknown`, `.status-recovered`, `.status-fallback`, `.status-alt`, `.status-saved`, `.hide-top-annotations`, `.hide-zh-gloss`, `.hide-dividers`, `.hide-word-table`; `lookup_core.js`: phrase tokenization and short-gloss helpers. |
| Companion drilling | v1.6 in progress | Clicking a Companion reader token, Kilang chain node, dictionary AB line, or AB word inside a Companion example replaces the Side Panel with that word lookup. Chinese gloss/definition text is not drillable. A local `返回` button restores the previous Companion context. New page selections reset this local drill history. | `sidepanel.js`: `drillLookup()`, `goBack()`, `makeDrillButton()`, `appendDrillableAbText()`; `sidepanel.html`, `sidepanel.css`. |
| Shared lookup core | Universal helper layer | A namespaced plain-script helper, `FDT_LOOKUP_CORE`, centralizes safe text cleaning, phrase tokenization, Kilang sense/example grouping, Kilang mixed AB/ZH example repair, Kilang expanded candidate normalization/classification, source metadata, short phrase gloss extraction, dictionary row normalization, and ZH-to-AB row normalization/sorting. It is loaded by both the content script and the Side Panel. Content-side tooltip code keeps its existing local function names, but the duplicated pure implementations now delegate to `FDT_LOOKUP_CORE` where behavior is shared. Tooltip rendering and lookup flow were intentionally left structurally unchanged. | `lookup_core.js`; loaded by `manifest.json` content scripts and `sidepanel.html`; included in `dev/package-extension.ps1`. |
| Shared appearance helper | Universal helper layer | A namespaced plain-script helper, `FDT_APPEARANCE`, centralizes theme/font-size normalization, legacy theme migration (`woven` to `paper`, `forest` to `field`), and class application. Popup and tooltip appearance now use this helper instead of local duplicate class logic. Side Panel loads the helper so Companion themes can be wired without adding another local theme path. | `appearance.js`; loaded by `manifest.json` content scripts, `popup.html`, `options.html`, and `sidepanel.html`; included in `dev/package-extension.ps1`. |

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
| Appearance settings | Universal | Theme, font size, bold translations, and dialect display are stored in `chrome.storage.sync`. Theme/font normalization and class application are centralized in `FDT_APPEARANCE`; tooltip still uses `fdt-*` classes while popup and Companion use body-level theme/font classes. Companion listens to sync changes and updates live. | `appearance.js`, `options.js`, `popup.js`, `content.css`, `sidepanel.css`, `sidepanel.js`. |
| Unsaved options warning | Universal | Options page prompts with the browser's native leave-page warning when form controls differ from the last loaded/saved settings. | `options.js`: `readCurrentOptions()`, `hasUnsavedOptions()`. |
| Popup quick controls | Universal | Enables/disables extension, language/theme/font controls, a full-width `顯示模式` segmented control (`提示框 / 側欄`) placed below language, a compact three-column row for `AI工具` / Amis alt-spelling / hover toggles, and two icon+label buttons for options and saved items. | `popup.html`, `popup.css`, `popup.js`. |

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
- Saved items are local to the current Chrome profile/device in the current v1.6.x line. Cross-device sync/export is not implemented yet.
- The `AI MT & TTS` tab adds `https://ai-labs.ilrdf.org.tw/*` as a host permission and currently only performs live MT/TTS for Amis.

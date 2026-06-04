# Technical Decisions

Departures from or additions to `CHROME_EXT_SPEC.md`, logged here so the spec stays authoritative and context is never lost.

---

## D1 — Trigger changed: Alt+D → double-click + Ctrl+select

**What:** Removed the keyboard shortcut (`Alt+D`) and `commands` API entirely. Replaced with two event-based triggers in the content script:
- `dblclick` on any word
- `mouseup` with `e.ctrlKey === true` (Ctrl + drag-select)

**Why:** Double-click and Ctrl+select are more discoverable — users don't need to read docs to find the feature. More importantly, removing the shortcut eliminates the need for a background service worker entirely (see D2). The original Alt+D could also conflict with OS-level shortcuts (Option+D on Mac types "∂").

**How to apply:** If a keyboard shortcut is ever re-added, restore `commands` in manifest.json and re-add background.js. Do not revert D2 without also reverting D1.

---

## D2 — background.js restored as fetch proxy (CORS fix)

**What:** background.js exists but with a different job from the spec. The spec used it to relay keyboard shortcut commands; now it is a fetch proxy. The content script sends `{ type: 'lookup', word, dialects }` via `chrome.runtime.sendMessage`; the service worker fetches the API and replies with `{ results }`.

**Why:** In MV3, content script fetches are treated as same-site requests and the browser enforces CORS. The Citadel API sends no `Access-Control-Allow-Origin` header, so every content script fetch is silently blocked and `.catch()` fires → "Not found". The spec's note that `host_permissions` bypasses CORS is only true for background service workers in MV3, not for content scripts.

**How to apply:** Any future network request to `ycm-citadel.vercel.app` must go through background.js. Do not add `fetch` calls to content.js for this origin.

---

## D3 — `activeTab` permission removed

**What:** Dropped `"activeTab"` from `manifest.json` permissions.

**Why:** It was unused. `activeTab` is needed for programmatic script injection; this extension injects via declarative `content_scripts`. The API fetch is covered by `host_permissions`.

**How to apply:** Re-add only if a feature requires programmatic injection into the active tab on demand.

---

## D4 — Options page added (new feature)

**What:** Added `options.html` / `options.js` / `options.css` and `"storage"` permission. Settings stored in `chrome.storage.sync` (syncs across devices).

**Settings exposed:**

| Key | Type | Default | Description |
|---|---|---|---|
| `language` | string | `''` | Language filter; `''` = all dialects |
| `showDialect` | bool | `true` | Show dialect tag in tooltip rows |
| `maxResults` | number | `6` | How many rows to show (1–6) |
| `theme` | string | `'dark'` | `'dark'` or `'light'` |
| `fontSize` | string | `'medium'` | `'small'`, `'medium'`, or `'large'` |
| `triggerDblclick` | bool | `true` | Enable double-click trigger |
| `triggerCtrlSelect` | bool | `true` | Enable Ctrl+select trigger |

**How to open:** Right-click extension icon → Options (or `chrome://extensions` → Details → Extension options).

---

## D5 — XSS fix: innerHTML → DOM API

**What:** All API-sourced strings (`e.zh`, `e.dialect_name`) and the user's selected word are now set via `textContent`, never injected via template literals into `innerHTML`.

**Why:** The original spec used `innerHTML` with unescaped values from the API response. Any `<`, `>`, or `"` in a result field would be a stored-XSS vector.

**How to apply:** Never reintroduce `innerHTML` with API-sourced or user-sourced data. If rich HTML is ever needed, sanitize first (e.g., `DOMPurify`) — but for this extension there is no such need.

---

## D6 — Shared constants extracted to shared.js

**What:** `DEFAULTS` and `LANG_TO_DIALECTS` live in `shared.js`, which is loaded before `content.js` (via manifest `content_scripts`) and before `options.js` (via `<script>` tag in options.html).

**Why:** Without a build step, the only DRY option for shared constants across a content script and an options page is a separate script loaded in both contexts. Avoids the dialect map going out of sync between the two files.

**How to apply:** Any constant needed in both contexts goes in shared.js. Keep it pure data — no DOM access, no Chrome API calls.

---

## D7 — Cache key includes language filter

**What:** The in-memory fetch cache uses `word:language` as the key instead of just `word`.

**Why:** If the user changes the language filter in options and then looks up a previously-searched word, the old (all-dialects) results would be served from cache. Keying by language prevents this.

**How to apply:** If more settings affect the API query in the future (e.g., a `domain` filter), extend the cache key to include those too.

---

## D8 — Icon: provided PNG resized, placed in icons/

**What:** `Book_1_nocirc_nobg_crop.png` (365×365, transparent background, pre-cropped) was resized to 16, 48, and 128px using Python/Pillow (Lanczos) and saved to `icons/`.

**Why:** The spec described generating an icon programmatically; the user provided a finished asset instead.

**How to apply:** To regenerate, run the Pillow resize snippet against `Book_1_nocirc_nobg_crop.png`. Both source files stay at repo root.

---

## D10 — UI language: Traditional Chinese (Taiwan Mandarin)

**What:** All user-visible strings (extension name, description, tooltip text, options page labels) are in Traditional Chinese. The extension name is "原住民族語辭典".

**Why:** The extension is designed for Taiwanese users reading Formosan-language content.

**How to apply:** Any new user-facing string added to content.js, options.html, or options.js should be written in Traditional Chinese.

---

## D11 — Source filter: client-side, 6 known sources

**What:** A "資料來源" section in options lets users toggle which of the 6 known sources appear in the tooltip. Filtering happens in `renderResults` after the API response, not as a query param.

**Known sources (as of 2026-05):** 族語線上辭典, 九階教材, 生活會話篇, 閱讀書寫篇, 學習詞表, 每日讀報.

**Why client-side:** The `/api/search` endpoint has no `sources` param. Filtering post-fetch is sufficient since results are small.

**How to apply:** If new sources appear in the API (new publication types), add them to `SOURCES` in shared.js. The filter is a whitelist — anything not in the user's saved `sources` array is hidden.

---

## D12 — Tooltip height: unconstrained; font size: 18px default

**What:** Removed `max-height` and `overflow-y: auto` from `.fdt-body`. The tooltip grows vertically to fit all displayed rows. Base font size raised from 12px to 18px (≈1.5×). Sub-element sizes converted to `em` so they scale proportionally. Tooltip width increased from 240px to 280px to accommodate larger text.

**Why:** At 12px, Chinese characters were too small for comfortable reading. Unconstrained height avoids a scrollbar inside a small floating panel.

**How to apply:** Font size variants (small/medium/large) are 14/18/22px. The "above/below" positioning estimate in `showTooltip` uses a conservative `tooltipH = 200` — if very long result lists cause overflow off the bottom, increase this constant.

---

## D9 — CSS custom properties for theming

**What:** The tooltip's colors are defined as CSS variables on `#formosan-dict-tooltip`. The light theme overrides them via the `.fdt-light` class added by JS.

**Why:** A single set of rules for all themed elements; adding new UI components only requires using the existing variables, not duplicating color values.

**How to apply:** All new tooltip UI should reference `var(--fdt-*)` rather than hard-coded colors.

---

## D13 — Saved page AI MT/TTS uses direct ILRDF Gradio calls

**What:** The saved page `AI MT & TTS` tab calls ILRDF AI Labs Gradio 5 endpoints directly from `saved.js`:
- MT: `https://ai-labs.ilrdf.org.tw/kari-seejiq-tnpusu-ai-hmjil`
- TTS: `https://ai-labs.ilrdf.org.tw/hnang-kari-ai-asi-sluhay`

The tab currently wires Amis translation both directions (`translate_1` for ZH-to-Amis, `translate` for Amis-to-ZH) and Amis TTS (`default_speaker_tts`). The UI lists all 16 language codes for future expansion, but non-Amis currently returns an Amis-only message.

**Why:** The ILRDF Gradio APIs are usable without an extension-side proxy, and keeping this inside the extension page avoids content-script CORS constraints. This requires the host permission `https://ai-labs.ilrdf.org.tw/*`.

**How to apply:** Any future AI provider or expanded language support should keep endpoint-specific code isolated in the saved page AI section or move it behind a small adapter. If ILRDF changes function names, SSE response shape, or auth policy, update `gradioCall()` and the call-site data arrays in `saved.js`.

---

## D14 — Packaging includes saved workspace and assets

**What:** `dev/package-extension.ps1` now includes `saved.html`, `saved.css`, `saved.js`, `saved_store.js`, and the `assets/` directory in addition to the original popup/content/options files and `icons/`.

**Why:** The saved page, IndiHunt logos, and tooltip web-accessible image assets are part of the extension runtime. A zip that omits them can load but will have broken saved/export workflows.

**How to apply:** Whenever a new runtime HTML/CSS/JS file or asset directory is added, update `$payloadFiles` or `$payloadDirs` in `dev/package-extension.ps1` before generating an upload zip.

---

## D15 — Short-text analysis starts as a saved-page shell

**What:** The saved page `短章分析` tab has a minimal whole-text analysis UI: language/source selectors, an Analyze button, a word count, a fixed-height left input column, and a wide right-side table. Analyze normalizes pasted text into one segment plus one placeholder line by treating existing line breaks, tabs, and sentence punctuation as boundaries; placeholder `一` lines are ignored on re-analysis. Token lookup normalizes curly glottals to ASCII apostrophes before hitting the existing background contracts. The table renders one segment per row with repeated AB/root/ZH columns aligned to the input's two-line rhythm; long ZH cells are ellipsized with full text in the native hover tooltip. 族語/root/中文 filter buttons hide their respective table columns, duplicates hides every token after its first appearance, and the saved filter is present as UI only. Kilang analysis keeps the best source rank (`s`, then `m`, `a`, `old-s`, `p`) for cleaner ZH display. Sentence/example lookup and source/tier display are intentionally omitted from this tab. It tokenizes pasted text locally, skips tokens with length 2 or less, caps unique tokens at 500, and runs bounded-concurrency lookups through the existing background message contracts (`moeInsights` for Kilang, `lookup` for ePark).

**Why:** Whole-text analysis can become expensive and UX-sensitive once it performs many lookups. A bounded token cap and concurrency limit keep the first implementation responsive while fixing the workspace shape for later save/export actions or Kilang tree integration.

**How to apply:** Keep future analysis lookup work behind `renderAnalysisShell()` or a replacement analysis pipeline. Preserve explicit token caps, concurrency limits, and caching decisions, because analyzing long text can otherwise fan out into many API calls.

---

## D16 — `短章分析*` is a separate annotated-reader experiment

**What:** The saved page `短章分析*` tab is no longer an alias of `短章分析`. It has its own input, source/language controls, bounded-concurrency lookup flow, and reader-style output. Each sentence renders as inline annotated AB text: every word remains in sentence flow, a short ZH gloss is aligned below analyzed tokens, and the top annotation slot is reserved for fallback/alt display when the looked-up form differs from the visible token. Kilang reader top annotations format derived/recovered forms as `root + affixes` and prefix alternate-spelling recovery with `~`. Sentence rows are visually merged into one output surface, the internal divider lines can be hidden with the `-` toggle, ZH/top annotations can be hidden independently, and the output supports full, split, and single-sentence layouts. Single mode removes the old sentence-number navigation and uses previous/next arrows around the centered sentence in a stage that can expand to `80vw`. Each row has right-aligned TTS, MT, and IndiHunt export buttons. Reader MT/TTS use Malan as the fallback Amis dialect. Reader IndiHunt export sends only the original AB sentence plus the sentence-level MT line when present, not the token-gloss definitions. The reader reuses the short-analysis tokenizer and lookup helpers so curly glottal normalization and Kilang best-source ranking stay consistent.

**Why:** This tab is meant to explore reading/annotation UX, not table alignment. Keeping it separate lets `短章分析` remain a dense analysis table while `短章分析*` can later support color states, root/affix markers, sentence-level translations, and review/export actions.

**How to apply:** Keep tab3-specific state and rendering under the reader functions (`renderReaderShell()`, `renderReader()`, `renderReaderPart()`) instead of coupling it back to the table renderer. Planned follow-ups: copy sentence/token output, color saved words, color unknown words, highlight duplicates, and add compact root/affix symbols.

---

## D17 — Ctrl-select phrase assist is not full sentence translation

**What:** Ctrl-selecting 2-16 non-CJK tokens in page text now opens a phrase-assist tooltip instead of the single-word lookup path. The first rendering step is a compact token-by-token gloss grid that uses the best available enabled-source result for each selected token, preserving short function words such as `o`, `ko`, and `no`. Lookup runs on unique tokens with bounded concurrency and existing caches. If the popup AI tools toggle is enabled, the phrase tooltip header also shows Amis-to-ZH MT and Amis TTS buttons using the same ILRDF Gradio contracts as the saved page, with Malan defaults. MT output is appended as a separate AI line below the token gloss grid.

**Why:** A selected phrase is often too short and context-light for reliable full translation, but token-level glosses plus optional MT/TTS can help users quickly orient themselves without pretending the dictionary rows are a grammatical translation.

**How to apply:** Keep phrase mode behind Ctrl-select only for now. Do not enable phrase mode for hover. Keep token caps and concurrency limits conservative; if phrase selections become longer, route users to the saved-page analysis tools instead of expanding tooltip fanout indefinitely.

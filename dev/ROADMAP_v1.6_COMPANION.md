# v1.6 Companion Roadmap

Status: implementation in progress; Side Panel shell plus first lookup/analysis rendering are implemented
Started: 2026-06-06 +08:00

This document is the source-of-truth roadmap for the v1.6 Companion work. Companion is a native Chrome Side Panel surface for workflows that are too large for tooltips and too immediate for the saved page.

## Objective

Build Companion as a reading and morphology workbench:

- Full definitions and examples for selected words.
- Selected phrase/sentence analysis.
- Textual Kilang chains and morphology drilling.
- Later in-panel clones of useful saved-page tools.
- Later YouTube transcript/subtitle workflows.

Companion is a peer display target to tooltip, not a tooltip child.

## Core Decisions

### Trigger Routing

- Existing trigger availability stays unchanged.
- Double-click and Ctrl-select are eligible lookup triggers.
- Popup controls display target with an explicit control, e.g. `查詢顯示: 提示框 / Companion`.
- If the target is `提示框`, eligible lookups render in tooltip.
- If the target is `Companion`, eligible lookups render in the Side Panel.
- Hover remains tooltip-only or off for v1.6. No hover-to-Companion target.
- Tooltip may include a floating button to promote/open the current lookup in Companion without changing the global popup target.

### Container

- Companion uses the native Chrome Side Panel API.
- If `chrome.sidePanel` is unavailable, keep routing to tooltip and hide/disable the Companion target option.
- asbplayer precedent: asbplayer uses Chrome `sidePanel` permission/API, a dedicated `sidepanel.html` entrypoint, and `browser.sidePanel.open({ windowId })`, coordinating page/video state through extension messaging.

### Context Handoff

- Content script sends raw selected context, not tooltip-rendered or compressed results.
- Minimal payload:
  - `mode`: `word` / `phrase` / `sentences`
  - `rawText`
  - `tokens`
  - page title/url
  - trigger
  - language/source settings
  - timestamp
- Use `chrome.storage.session` as the active Companion context handoff.
- Avoid service-worker memory as source of truth because MV3 service workers sleep.
- Avoid `chrome.storage.local` for transient active context.

### Initial View Routing

- Single word / double-click opens `單詞`.
- Phrase or sentence selection opens `句子`.
- Token drill inside `句子` opens lookup + morphology for that token inside Companion.
- Multiple selected sentences are allowed as selected-text analysis.
- No whole-page analyzer.

### Kilang And Morphology

- Minimal Kilang tree = textual chain of semantically related words connected by affixes.
- Visual Kilang-style tree is valuable, but later.
- Morphology exploration is required, not decorative:
  - root/parent/child jumping
  - derivation drilling
  - affix labels
  - later affix search/filtering
  - later common-affix discovery
  - examples/sentences with filters

### Shared Architecture

- Build cleanly for v1.6 instead of duplicating Companion lookup logic.
- Use existing background fetch/message APIs for lookup.
- Extract a small plain-script shared helper layer before larger UI work gets duplicated.
- Shared boundary should include:
  - text cleaning/tokenization
  - source metadata helpers
  - Kilang sense/chain helpers
  - lookup client wrappers
  - analysis core
  - MT/TTS client utilities
- Phrase-assist TTS is a known v1.5.5 issue and should be fixed early in v1.6.

## v1.6.0 Cut Line

Goal: make Companion a genuinely useful native Side Panel surface, not just a shell.

- Native Chrome Side Panel Companion.
- Popup display target control: `提示框 / Companion`.
- Existing double-click and Ctrl-select route to the active display target.
- Hover remains tooltip-only or off.
- `chrome.storage.session` raw-context handoff.
- Side Panel renders current selected context, page metadata, trigger, and mode.
- Word selection opens `單詞`.
- Phrase/sentence selection opens `句子`.
- Shared text/lookup/TTS utilities begin here.
- Phrase tooltip TTS is fixed or definitively diagnosed.
- Full word definitions and examples render in Companion.
- Basic phrase/sentence token analysis renders in Companion.
- Basic textual Kilang chain for selected word/token.
- Token drill inside Companion switches focus to lookup/morphology for that token.
- Release criterion for phrase tooltip TTS: either phrase tooltip TTS plays sound, or the phrase tooltip TTS button is hidden/disabled with a documented reason. Do not ship a visibly broken phrase TTS button.

Visible v1.6.0 modes:

- `單詞`
- `句子`

Do not expose empty future tabs.

## First Coding Slice

Done in commit `b958410`:

- Add manifest side panel permission/config.
- Add `sidepanel.html`, `sidepanel.js`, and `sidepanel.css`.
- Add popup display target control.
- Add shared default setting for target.
- Content script sends raw context to background when target is Companion.
- Background stores latest context in `chrome.storage.session`.
- Background opens Side Panel.
- Side Panel renders raw selected text, detected mode, page title/url, trigger, and timestamp.

## Second Coding Slice

Done in current v1.6 Companion branch work:

- Added `lookup_core.js` as a namespaced pure helper layer (`FDT_LOOKUP_CORE`) for Companion.
- Loaded `lookup_core.js` into the Side Panel and included it in the packaging manifest script.
- Built Companion `查詢` rendering:
  - enabled-source ordered lookup;
  - Kilang full sense rows;
  - Kilang examples;
  - compact source/tier metadata;
  - first textual root/parent/matched-word chain;
  - dictionary rows when ePark/ILRDF-like dictionary sources are enabled.
- Built Companion `分析` rendering:
  - selected phrase/sentence token grid;
  - skip lookup for tokens of 2 characters or less;
  - bounded-concurrency lookup for longer unique tokens;
  - source-ordered Kilang/dictionary lookup;
  - short ZH glosses and root labels when available.
- Added local Companion drill/back navigation:
  - analysis token click opens that word in `查詢`;
  - Kilang chain nodes drill to their word;
  - dictionary AB lines drill to their word;
  - AB words inside examples drill to their word;
  - `返回` restores the previous Companion context;
  - fresh page selections reset local drill history.
- Added phrase-tooltip TTS offscreen playback:
  - background now generates and caches ILRDF TTS URLs for tooltip phrase TTS;
  - background creates an offscreen audio document on demand;
  - offscreen document plays generated TTS audio outside the page content context.
- Added first Companion TTS implementation:
  - lookup/analysis headers can play the current selected Amis text;
  - Companion examples can play their AB sentence line;
  - background generates/caches ILRDF TTS URLs and reuses offscreen playback.
- Cleaned up generated TTS ownership:
  - tooltip phrase TTS and Companion TTS both call background `playIlrdfTts`;
  - content script no longer has its own generated TTS URL cache/polling path;
  - saved page TTS remains a separate direct Gradio caller for now.
- Added Companion parity items:
  - ZH-to-AB lookup across enabled ePark/DICT and Kilang `moeZhLookup` sources;
  - shared ZH lookup row normalization/sorting helpers in `lookup_core.js`;
  - Kilang relation labels for fallback/alt/derived matches;
  - Companion Amis-to-ZH MT button in lookup/analysis headers, backed by background ILRDF MT.
- Added Companion parity actions:
  - save/bookmark buttons for Companion senses, dictionary rows, ZH result rows, and examples;
  - current-view IndiHunt export from Companion;
  - direct source-audio buttons when rows/examples expose `audioUrl`.
- Added first v1.6.2 reader clone:
  - analysis view now includes an annotated reader section above the token grid;
  - AB tokens render inline with compact ZH glosses below;
  - top annotations show alternate/fallback/root hints where available;
  - Amis sentence blocks expose MT/TTS actions.
- Added Companion polish pass:
  - removed details disclosure and popup footer Companion button;
  - moved back navigation into the Companion lookup/phrase header as an arrow;
  - moved current-view IndiHunt export and header save into the Companion header;
  - switched Companion save controls to bookmark icons;
  - hid visible source/tier pills while preserving source metadata in saved/export payloads;
  - removed MT from single-word lookup headers, keeping it for phrase/sentence contexts;
  - removed the phrase token grid, leaving the annotated reader as the analysis view;
  - changed tooltip Kilang-logo floater to open the current tooltip in Companion.
- Added Companion top-bar polish:
  - renamed popup target label from `Companion` to `側欄`;
  - moved current-view IndiHunt export to the Side Panel top bar beside clear;
  - replaced the clear text label with a non-cross icon;
  - initially hid singleton chain rows when no explicit parent word was present;
  - removed duplicated per-sentence MT/TTS buttons from the annotated reader.
- Revised Companion chain/fallback display:
  - chain row appears at the top of Kilang result cards only when the returned row has an explicit `parent_word`;
  - inferred recovery/fallback links get a `?` marker;
  - marker tooltip describes entries as found "in our database" and reserves inference wording for the extension-generated link.
- Added Companion root header marker:
  - mirrors the tooltip root icon/pill behavior for AB lookups;
  - appears only when the returned database row exposes `ultimate_root` or `stem`;
  - stays hidden when no root/stem is present instead of inferring a root from the chain;
  - renders icon-only when pure alt recovery makes the root equal the recovered spelling.
- Fixed Companion header bookmark semantics:
  - header bookmark now saves an aggregate word/headword item after lookup rows are registered;
  - individual row bookmarks continue to save their specific sense/result rows.
- Refined Companion bookmark layout:
  - row/example bookmarks use a dedicated one-column right rail;
  - bookmark icons are borderless/backgroundless;
  - header TTS, row audio, and example audio/TTS sit inline next to the related word/example text instead of sharing the bookmark/action column;
  - generated AI/TTS buttons reveal on Companion content hover/focus, while direct source audio remains visible.
- Refined popup target controls:
  - renamed the target row to `顯示模式` and moved it directly below language;
  - styled `提示框 / 側欄` like footer buttons;
  - grouped `AI工具`, alt spelling, and hover toggles into a compact three-column row.
- Existing tooltip code is intentionally not migrated to `lookup_core.js` yet.

## Implementation Order

1. Add thin native Side Panel shell.
2. Add popup target routing and `chrome.storage.session` handoff.
3. Verify selection opens/updates Companion with raw context.
4. Extract shared text/lookup core utilities. Done for Companion lookup helpers; TTS utilities started through background/offscreen playback.
5. Build word lookup view. Done.
6. Build phrase/sentence analysis view. Done at MVP/token-grid level.
7. Add morphology textual chain. Started with root/parent/matched-word chain; richer derivation drilling remains pending.

v1.6.0 implementation and smoke testing are complete as of 2026-06-06 +08:00.

Passed smoke tests:

- Popup target toggle: `提示框 / 側欄`.
- Double-click opens Companion lookup.
- Ctrl-select phrase opens Companion analysis.
- Hover stays tooltip-only/off.
- Side Panel lookup/analysis/drill behavior.
- Companion header/example TTS.
- Companion ZH-to-AB lookup.
- Companion fallback/alt/derived relation labels, including expanded Kilang candidate groups without duplicate relation rows.
- Companion MT button.
- Companion save/bookmark and current-view IndiHunt export.
- Companion direct audio button when a source row exposes `audioUrl`.
- Companion annotated reader layout and header MT/TTS.
- Phrase tooltip TTS audio through offscreen playback.

## v1.6.x Sequence

### v1.6.1 — Companion Polish And Parity

Already completed during the v1.6.0 branch work:

- Narrow Side Panel layout polish.
- Save/export actions for lookup rows, examples, header aggregate items, and current-view IndiHunt export.
- Local drill history with a back button.
- Shared `lookup_core.js` resolver/normalization layer for Companion.
- Companion Kilang lookup beyond tooltip conciseness: tooltip remains on first-match `moeInsights`, while Companion renders exact plus multiple successful alt/glottal/fallback candidates from a separate background endpoint.
- TTS/MT behavior stabilized enough for current tooltip and Companion flows.

v1.6.1 decisions and cleanup:

- No explicit copy buttons in Companion for now; save/export are enough.
- No forward-history affordance for now; back-only drilling is enough.
- Expanded candidate noise is acceptable for now.
- Narrow Side Panel overflow passed real-world checks.
- Completed a focused helper cleanup: `lookup_core.js` is now loaded by content scripts, and content-side duplicated pure helper implementations delegate to it where behavior is shared. Tooltip rendering and lookup flow were not structurally changed.
- Added shared repair for rare Kilang examples where the source data puts AB text and ZH translation together in the `zh` field while leaving `ab` empty.

Remaining v1.6.1 work:

- None currently known.

### v1.6.2 — Tab3 Clone / Reading Reader

Goal: turn the current Companion `句子` mode into a more useful selected-text reader, broadly inspired by saved-page `短章分析*`, while staying compact enough for the Side Panel.

Tasks:

- Review the current Companion `句子` reader against saved-page `短章分析*` and decide which controls are worth porting into the Side Panel.
- Add a global Companion manual input row under the mode tabs. Done for the general lookup/reader modes: one AB/CJK word routes to `單詞`, multi-token AB text routes to `句子`/analysis, and later specialized tabs such as AI or Kilang can make the same input mode-aware.
- Split or rename the current general modes so `單詞` handles word/ZH lookup and `句子` handles sentence/phrase reader output. Done at the tab-label/routing level; deeper reader parity remains below.
- Decouple Companion tab state. Done for `單詞` and `句子`: each tab preserves its last context independently, and legacy selection-triggered `companionContext` updates are migrated into per-tab `companionState`.
- Add basic reader display controls if they fit: show/hide Chinese glosses, show/hide top fallback/alt annotations, and possibly hide sentence dividers.
- Add selected-sentence navigation only if long selections are hard to scan in the Side Panel; avoid the full saved-page layout controls unless needed.
- Improve token status hooks: unknown token, recovered/fallback token, alternate-spelling token, and saved-token styling hooks. Done for the current `句子` reader and word table through stable classes/data attributes plus local saved-word matching; saved-token status now live-refreshes when `savedItemsV1` changes.
- Keep per-sentence MT/TTS in the header or a minimal sentence action area; avoid duplicating noisy controls on every token.
- IndiHunt export scope is full current `句子` passage split into sentence items; filtering happens in the IndiHunt import page.
- Keep lookup source behavior aligned with current Companion lookup: Kilang first by default, ePark/DICT only when enabled, no full-page analyzer.
- Smoke-test on short phrases, multi-sentence selections, long paragraph selections, punctuation-heavy examples, and recovered/alt-heavy Amis text.

### v1.6.3 — AI Convenience / Tab4 Clone

- Compact `AI MT & TTS` mode in Companion.
- Direction selector: ZH-to-Amis and Amis-to-ZH.
- Malan default unless dialect context is known.
- Reuse shared MT/TTS client.
- Feed current selected text into AI mode when user switches modes.
- Keep non-Amis as explicit unsupported/future unless an API exists.

### v1.6.4 — Morphology Explorer Phase 1

- Textual Kilang chains with root/parent/child jumping.
- Show affix labels in-chain.
- Drill from chain node to full definitions/examples.
- Show examples attached to the selected node/sense.
- Add compact filters for tier/source if data is already available.
- Keep visual Kilang-style tree out unless the textual version is stable.

### v1.6.5 — Morphology Explorer Phase 2

- Affix search/filter.
- Word filtering by affix, source, tier, and root where supported by data.
- Common-affix list with minimal expansion.
- Examples/sentences filtered by selected affix/root/word.
- Better branch navigation and sibling/descendant browsing.

### v1.6.6 — YouTube Transcript Companion

- YouTube transcript/subtitle mode in Companion.
- Detect current YouTube video context.
- Display available transcript/subtitle lines.
- Click transcript line to analyze that line.
- Optional current-time following if reliable.
- Do not block v1.6.0-1.6.5 on YouTube support.

### v1.6.7+ — Companion Later

- Visual Kilang-style tree UI.
- Rich transcript mining workflow.
- Real-time saved-state synchronization across tooltip, Companion, and saved page:
  - listen to `chrome.storage.onChanged` for `savedItemsV1`;
  - refresh visible bookmark icons when items are saved/deleted elsewhere;
  - update the saved page list without requiring a manual refresh when TT/CPN save new items;
  - preserve saved-page filters/search/selection while syncing.

## v1.7.0 Reserved Scope

v1.7.0 is reserved for dictionary/source expansion work, not Companion UI expansion:

- ILRDF dictionary addition.
- 口語語料庫 addition.
- Dictionary source merge.

## Out Of Scope For v1.6.0

- YouTube transcript mode.
- Visual Kilang tree.
- Affix search/filter UI.
- Common-affix dashboard.
- Export expansion beyond existing IndiHunt patterns.
- Whole-page analyzer.

## Open Questions

None currently blocking implementation.

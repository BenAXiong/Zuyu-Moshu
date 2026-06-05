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

- Single word / double-click opens `查詢`.
- Phrase or sentence selection opens `分析`.
- Token drill inside analysis opens lookup + morphology for that token inside Companion.
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
- Word selection opens `查詢`.
- Phrase/sentence selection opens `分析`.
- Shared text/lookup/TTS utilities begin here.
- Phrase tooltip TTS is fixed or definitively diagnosed.
- Full word definitions and examples render in Companion.
- Basic phrase/sentence token analysis renders in Companion.
- Basic textual Kilang chain for selected word/token.
- Token drill inside Companion switches focus to lookup/morphology for that token.
- Release criterion for phrase tooltip TTS: either phrase tooltip TTS plays sound, or the phrase tooltip TTS button is hidden/disabled with a documented reason. Do not ship a visibly broken phrase TTS button.

Visible v1.6.0 modes:

- `查詢`
- `分析`

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
- Existing tooltip code is intentionally not migrated to `lookup_core.js` yet.

## Implementation Order

1. Add thin native Side Panel shell.
2. Add popup target routing and `chrome.storage.session` handoff.
3. Verify selection opens/updates Companion with raw context.
4. Extract shared text/lookup core utilities. Done for Companion lookup helpers; TTS utilities still pending.
5. Build word lookup view. Done.
6. Build phrase/sentence analysis view. Done at MVP/token-grid level.
7. Add morphology textual chain. Started with root/parent/matched-word chain; richer derivation drilling remains pending.

Remaining v1.6.0 work:

- Fix or hide/disable phrase tooltip TTS before release.
- Add token drill inside Companion.
- Add minimal Companion navigation/back behavior if drilling lands in v1.6.0.
- Smoke-test the Side Panel in Chrome with tooltip target fallback behavior.

## v1.6.x Sequence

### v1.6.1 — Companion Polish And Parity

- Improve narrow Side Panel layout.
- Add save/copy/export actions where they clearly map to existing saved-item and IndiHunt flows.
- Add mode switching and back/forward navigation inside Companion.
- Add pinned context behavior if needed after testing.
- Reduce duplicated code discovered during v1.6.0.
- Stabilize TTS/MT UI behavior across tooltip, Companion, and saved page.

### v1.6.2 — Tab3 Clone / Reading Analysis

- Extend v1.6.0 basic token analysis into a richer reader-like mode.
- In-panel selected-text analysis with inline AB and compact ZH annotations.
- Sentence segmentation for selected text.
- Single/split/full reading layouts only if they fit Side Panel width.
- Token status styling hooks for saved/unknown/duplicate states.
- Per-sentence actions: copy, save/export where appropriate, TTS/MT if shared TTS is stable.
- No full-page analyzer.

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

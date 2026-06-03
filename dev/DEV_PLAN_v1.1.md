# 族語魔書 — v1.1.0 Development Plan

## Status: In Progress

---

## Features Shipped

### F1 — Popup UI reflects active theme and font size
Popup panel now applies `body.light` and `body.font-{size}` classes on load and on every pill click.  
Files: `popup.css` (light theme vars, font-size overrides), `popup.js` (`applyTheme`, `applyFontSize`).

### F5 — Four themes + design system (Claude Design handoff)
Full visual redesign from handoff zip `族語魔書-handoff-v110.zip`.  
Both CSS files rewritten to use CSS custom properties; all hardcoded per-class overrides removed.  
Theme names rationalised: `woven`→`paper` (緋紙), `forest`→`field` (苔野); dark→`夜`, light→`晝`.  
- **Night** (dark default) — `#0f0f12` bg, `#f4f1ea` text/accent.  
- **Day** (light) — `#ffffff` bg, `#2a6fdb` blue accent.  
- **Paper** (緋紙) — `#fbf5e7` parchment bg, `#a8351f` crimson accent.  
- **Field** (苔野) — `#fbf5e7` bg, `#566234` sage accent.  
Tooltip gains `--fdt-surface`, `--fdt-accent-soft`, `--fdt-tag-bg` vars; language label becomes a pill; row hover state; alt section gradient; `→` arrow moved to CSS `::before`.  
Popup gains custom select chevron, grouped pill container, gap-animated `#opts` hover.  
One-time migration in `popup.js` rewrites stale `woven`/`forest` values in storage on next open.  
Files: `popup.css`, `popup.html`, `popup.js`, `content.css`, `options.html`, `options.js`, `content.js`.

### F6 — Leading/trailing glottal-stop recovery on double-click
Browsers treat apostrophes as word boundaries, silently dropping a leading `'` (e.g. `'alofo`) or trailing `'` (e.g. `mafana'`) from double-click selections.  
- `charBefore` / `charAfter` helpers walk up one DOM level when the range lands at a text-node boundary (handles `<b>word</b>'` cross-node case).  
- Covers three apostrophe codepoints: U+0027, U+02BC, U+2019.  
File: `content.js`.

### F7 — Deduplication of identical results
Results with the same `zh` translation are collapsed to one row before the `maxResults` cap is applied.  
Applies to both the main results list and the alt-spelling section.  
File: `content.js`.

### F8 — Combinatorial fuzzy alt-spelling
Previously only one alt spelling was tried (full all-or-nothing swap). Now all partial-swap combinations are generated and looked up in parallel.  
- Up to 4 swappable positions → max 15 variants per lookup.  
- All results merged and deduped into a single alt section; header shows the first variant that matched.  
- Cached hits resolve immediately; uncached fire concurrent API calls.  
File: `content.js`.

### F2 — Enable/disable toggle in popup header
Right side of header: sliding toggle switch + dynamic "啟用"/"停用" label.  
- Toggle state persisted in `chrome.storage.sync` as `enabled` (default: `true`).  
- Disabling instantly dismisses any visible tooltip via `chrome.storage.onChanged` listener.  
- `handleSelection` bails early when `settings.enabled === false`.  
Files: `shared.js` (added `enabled`), `popup.html/js/css`, `content.js`.

### F3 — Bounded cache (Flag 11)
`fetched` changed from an unbounded plain object to a `Map` capped at 200 entries (LRU-evict oldest on overflow).  
File: `content.js`.

### F4 — iframe support (Flag 12)
Added `"all_frames": true` to manifest `content_scripts`.  
Known limitation: clicking outside an iframe tooltip from the *parent* frame does not dismiss it (cross-frame mousedown is not captured). Escape still works.  
File: `manifest.json`.

---

## Bugs Encountered & Fixed

| # | Description | Root cause | Fix |
|---|---|---|---|
| B1 | Linter: `try` highlighted (S2486) | Empty `catch {}` without binding | Replaced try-catch with `if (!chrome.runtime?.id) return` guard |
| B2 | Linter: contrast warning on light-theme pill | `#64748b` on `#f1f5f9` = 4.33:1 (below 4.5:1 WCAG AA) | Changed to `#475569` (6.9:1) |
| B3 | Tooltips still shown after disabling | `handleSelection` check only blocks new tooltips; existing one stays | Added `chrome.storage.onChanged` listener to dismiss on `enabled → false` |
| B4 | "Uncaught Error: Extension context invalidated" at content.js:21 | `chrome.runtime?.id` guard passes (id is still defined) but `chrome.storage.sync.get` throws when the context is invalidated between the guard check and the API call | try-catch with `catch (e) { console.debug(e); }` — error now logged at debug level, not uncaught |

---

## Open Work

### Immediate
- [x] **B4** Fix "Extension context invalidated" uncaught error in trigger handlers
- [x] Additional tooltip themes (beyond dark/light)
- [x] Leading/trailing glottal-stop stripped by double-click selection
- [x] Duplicate results in tooltip
- [x] Combinatorial fuzzy alt-spelling (partial swaps)
- [x] Options page: expose `enabled` toggle (currently popup-only)

### Deferred to v1.2+
- [ ] Cross-session cache (IndexedDB) — current Map cache resets on every page load
- [ ] iframe tooltip dismiss on parent-frame click (requires cross-frame messaging)


### Deferred to v2.0
- [ ] Lookup flexibility — support for other data sources (MoE, Wiki) when available
- [ ] Display tooltip on hover, option in mini menu


---

## Decisions Log

| # | Decision | Reason |
|---|---|---|
| D13 | `all_frames: true` added in v1.1 | Fix Flag 12 (iframe selections silently failing) |
| D14 | Cache capped at 200 entries, oldest evicted | Fix Flag 11 (unbounded growth); 200 covers realistic per-session usage |
| D15 | `enabled` stored in `chrome.storage.sync` not `local` | Syncs disable/enable state across devices like all other preferences |
| D16 | Empty catch replaced with `if (!chrome.runtime?.id) return` for orphaned-context guard | SonarQube S2486 flags empty catch; the id check is sufficient for most invalidated-context cases |
| D17 | GLOTTAL set written with `\u` escapes in source | Smart-quote substitution by editor/IDE kept corrupting the literal characters, causing V8 SyntaxError on load |
| D18 | Alt-spelling cap at 4 swappable positions (max 15 combinations) | Beyond 4 fuzzy chars the word is likely too garbled to be useful; keeps concurrent API calls bounded |
| D19 | Alt results merged into one section, header = first matching variant | Simpler than multiple sections; dedup already applied, so merged list is clean |
| D20 | CSS custom properties for all theme tokens | Design handoff required it; eliminates per-class overrides and makes future theme additions a single `:root`-style block |
| D21 | One-time storage migration `woven→paper`, `forest→field` in popup.js on load | Avoids silent breakage for users who had old values persisted in `chrome.storage.sync` |

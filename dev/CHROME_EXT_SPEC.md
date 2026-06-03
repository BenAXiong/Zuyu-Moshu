# Chrome Extension Spec — Formosan Dictionary Lookup

A standalone Chrome extension that shows a tooltip definition for any selected Formosan-language word via a keyboard shortcut. Shares via direct Chrome Web Store link (unlisted). No login, no backend to build — the dictionary API already exists.

---

## What it does

1. User selects a word on any webpage
2. User presses the shortcut (default: `Alt+D`)
3. A tooltip appears near the selection showing the word's Chinese translation(s) and dialect(s)
4. Pressing the shortcut again, clicking elsewhere, or pressing Escape dismisses it

---

## Repo structure

```
formosan-dict-extension/
├── manifest.json
├── content.js          # injected into every page
├── content.css         # tooltip styles
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png     # simple "契" or similar glyph on dark bg
```

No build step required. Plain JavaScript (MV3). No React, no bundler, no npm.

---

## manifest.json

```json
{
  "manifest_version": 3,
  "name": "Formosan Dictionary",
  "version": "1.0.0",
  "description": "Tooltip definitions for Formosan indigenous language words. Select a word and press Alt+D.",
  "icons": {
    "16":  "icons/icon16.png",
    "48":  "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js":  ["content.js"],
      "css": ["content.css"],
      "run_at": "document_idle"
    }
  ],
  "commands": {
    "lookup": {
      "suggested_key": { "default": "Alt+D", "mac": "Alt+D" },
      "description": "Look up selected Formosan word"
    }
  },
  "background": {
    "service_worker": "background.js"
  },
  "host_permissions": [
    "https://ycm-citadel.vercel.app/*"
  ],
  "permissions": ["activeTab"]
}
```

**Why `host_permissions`:** Chrome extensions bypass CORS for URLs declared in `host_permissions`, so fetches to the Citadel API work from the content script without any server-side CORS config changes.

---

## API

**Endpoint:** `GET https://ycm-citadel.vercel.app/api/search`

**Params:**
| Param | Type | Notes |
|---|---|---|
| `mode` | string | Always `DICT` |
| `q` | string | The word to look up (URL-encoded) |
| `dialects` | string | Optional. Comma-separated dialect names to narrow results (see mapping below) |

**Example:**
```
https://ycm-citadel.vercel.app/api/search?mode=DICT&q=pasiwali
```

**Response shape:**
```json
{
  "results": [
    {
      "ab":          "pasiwali",
      "zh":          "迎靈祭歌",
      "dialect_name": "南勢阿美語",
      "glid":        "...",
      "source":      "...",
      "examples":    [...]
    }
  ]
}
```

The extension only reads `ab`, `zh`, and `dialect_name` from each result. `examples` can be ignored.

**Error / offline:** API returns `{ results: [] }` or a non-200. Always handle gracefully — show "Not found" in the tooltip, never throw.

**Minimum query length:** 2 characters. Skip the fetch and show nothing for single-character selections.

---

## Core logic to port (copy these verbatim from HoverableWord.tsx)

### `cleanWord(w)`
Strips leading/trailing punctuation, lowercases:
```js
function cleanWord(w) {
  return w.replace(/^[,.'";:!?()\[\]{}—–]+|[,.'";:!?()\[\]{}—–]+$/g, '').toLowerCase();
}
```

### `getShortDialect(full)`
Strips trailing 語 and ethnic group suffix for compact display:
```js
function getShortDialect(full) {
  let short = full.replace(/語$/, '');
  short = short.replace(/(阿美|泰雅|排灣|布農|卑南|魯凱|賽夏|達悟|雅美|噶瑪蘭|太魯閣|撒奇萊雅|賽德克|拉阿魯哇|卡那卡那富)$/, '');
  return short || full.replace(/語$/, '');
}
```

### Dialect map (used when page language is known — optional for v1)
In v1 the extension has no way to know what language the page is in, so omit the `dialects` param and search all dialects. Results will include all matching dialects — noisier but correct.

If a future version adds a settings page where the user picks their target language, use this mapping to build the `dialects` param:
```js
const LANG_TO_DIALECTS = {
  'Amis':        '南勢阿美語,秀姑巒阿美語,海岸阿美語,馬蘭阿美語,恆春阿美語',
  'Atayal':      '賽考利克泰雅語,澤敖利泰雅語,汶水泰雅語,萬大泰雅語,四季泰雅語,宜蘭澤敖利泰雅語,賽考利克太魯閣語,斯卡羅泰雅語',
  'Paiwan':      '南排灣語,中排灣語,北排灣語,東排灣語',
  'Bunun':       '卓群布農語,卡群布農語,丹群布農語,巒群布農語,郡群布農語',
  'Puyuma':      '南王卑南語,知本卑南語,西群卑南語,建和卑南語',
  'Rukai':       '霧台魯凱語,茂林魯凱語,多納魯凱語,東魯凱語,萬山魯凱語,大武魯凱語',
  'Tsou':        '鄒語',
  'Saisiyat':    '賽夏語',
  'Tao (Yami)':  '雅美語',
  'Thao':        '邵語',
  'Kavalan':     '噶瑪蘭語',
  'Truku':       '太魯閣語',
  'Sakizaya':    '撒奇萊雅語',
  'Seediq':      '德固達雅賽德克語,都達賽德克語,德鹿谷賽德克語',
  "Hla'alua":    '拉阿魯哇語',
  'Kanakanavu':  '卡那卡那富語',
};
```

---

## content.js — full behaviour

```js
// State
let tooltip = null;
let lastWord = '';
let fetched = {};   // word → results[], cache per page session

// Listen for the shortcut command relayed from background.js
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'lookup') triggerLookup();
});

// Dismiss on click outside or Escape
document.addEventListener('click', (e) => {
  if (tooltip && !tooltip.contains(e.target)) dismissTooltip();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') dismissTooltip();
});

function triggerLookup() {
  const sel = window.getSelection();
  const raw = sel?.toString().trim() ?? '';
  const word = cleanWord(raw);
  if (word.length < 2) return;

  const rect = sel.getRangeAt(0).getBoundingClientRect();
  showTooltip(word, rect);

  if (fetched[word]) {
    renderResults(word, fetched[word]);
    return;
  }

  setLoading(true);
  fetch(`https://ycm-citadel.vercel.app/api/search?mode=DICT&q=${encodeURIComponent(word)}`)
    .then(r => r.json())
    .then(data => {
      const results = data.results ?? [];
      fetched[word] = results;
      renderResults(word, results);
    })
    .catch(() => renderResults(word, []))
    .finally(() => setLoading(false));
}

function showTooltip(word, rect) {
  dismissTooltip();
  tooltip = document.createElement('div');
  tooltip.id = 'formosan-dict-tooltip';

  // Position: below selection if room, otherwise above
  const top = rect.bottom + window.scrollY + 6;
  const left = Math.max(8, Math.min(rect.left + window.scrollX, window.innerWidth - 260));

  tooltip.style.cssText = `position:absolute;top:${top}px;left:${left}px;z-index:2147483647`;
  tooltip.innerHTML = `
    <div class="fdt-header">
      <span class="fdt-word">${word}</span>
      <span class="fdt-label">Formosan</span>
    </div>
    <div class="fdt-body fdt-loading">Looking up…</div>
  `;
  document.body.appendChild(tooltip);
}

function setLoading(on) {
  const body = tooltip?.querySelector('.fdt-body');
  if (!body) return;
  if (on) { body.classList.add('fdt-loading'); body.textContent = 'Looking up…'; }
  else body.classList.remove('fdt-loading');
}

function renderResults(word, results) {
  const body = tooltip?.querySelector('.fdt-body');
  if (!body) return;
  const top6 = results.slice(0, 6);
  if (top6.length === 0) {
    body.innerHTML = '<span class="fdt-empty">Not found</span>';
    return;
  }
  body.innerHTML = top6.map(e => `
    <div class="fdt-row">
      <span class="fdt-zh">${e.zh}</span>
      <span class="fdt-dialect">${getShortDialect(e.dialect_name)}</span>
    </div>
  `).join('');
}

function dismissTooltip() {
  tooltip?.remove();
  tooltip = null;
}
```

---

## background.js

The `commands` API fires in the service worker, not the content script. Relay it:

```js
chrome.commands.onCommand.addListener((command) => {
  if (command === 'lookup') {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'lookup' });
    });
  }
});
```

---

## content.css

```css
#formosan-dict-tooltip {
  width: 240px;
  background: #16162a;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 12px;
  color: #e2e8f0;
  overflow: hidden;
}

.fdt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
}

.fdt-word {
  font-family: monospace;
  font-weight: 600;
  color: #f1f5f9;
}

.fdt-label {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #475569;
}

.fdt-body {
  max-height: 176px;
  overflow-y: auto;
}

.fdt-loading,
.fdt-empty {
  display: block;
  padding: 10px 12px;
  color: #475569;
  font-style: italic;
}

.fdt-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  padding: 6px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}

.fdt-row:last-child { border-bottom: none; }

.fdt-zh {
  color: #34d399;
  font-weight: 500;
  flex-shrink: 0;
}

.fdt-dialect {
  color: #475569;
  font-size: 10px;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

---

## Local development & testing

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked** → select the `formosan-dict-extension/` folder
4. Open any webpage, select a Formosan word, press `Alt+D`
5. To update after editing: click the refresh icon on the extension card

**Test words to try:** `pasiwali`, `inaaw`, `muljiljingaw`, `cimuy`

---

## Chrome Web Store submission (unlisted)

1. Register a developer account at `chrome.google.com/webstore/devconsole` — one-time $5 USD fee
2. Zip the extension folder (exclude `.git`, `docs`, etc.)
3. Upload via **New item** → fill in name, description, screenshots (1280×800 or 640×400)
4. Under **Visibility** → set to **Unlisted** (only accessible via direct link, not searchable)
5. Submit for review — typically 1–3 business days for simple extensions
6. Once approved, share the direct CWS install URL with friends

**Minimum required for submission:** at least one 1280×800 screenshot, a short description, and the 128px icon.

---

## Known limitations / future ideas

- **No language filter in v1** — searches all dialects since the page language is unknown. A settings page where the user picks their primary language would fix this.
- **Selection only** — no hover trigger (content scripts can't reliably intercept hover on arbitrary pages without performance issues)
- **No audio** — Citadel results include `audio_url` fields (Klokah audio). A future version could play a pronunciation clip.
- **Page session cache only** — `fetched` map resets on navigation. IndexedDB could persist it across sessions.

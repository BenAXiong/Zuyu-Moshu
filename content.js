// shared.js is loaded first and provides DEFAULTS and LANG_TO_DIALECTS

const MAX_WORD_LEN = 40;
const MAX_CACHE    = 200;

let tooltip = null;
const fetched = new Map();

// ' (apostrophe) intentionally excluded — it's a glottal stop character in these orthographies
function cleanWord(w) {
  return w.replace(/^[,.";:!?()[\]{}—–]+|[,.";:!?()[\]{}—–]+$/g, '').toLowerCase();
}

function getShortDialect(full) {
  let short = full.replace(/語$/, '');
  short = short.replace(/(阿美|泰雅|排灣|布農|卑南|魯凱|賽夏|達悟|雅美|噶瑪蘭|太魯閣|撒奇萊雅|賽德克|拉阿魯哇|卡那卡那富)$/, '');
  return short || full.replace(/語$/, '');
}

const SWAP = { u:'o', o:'u', l:'r', r:'l', '^':"'" };

// Generate all partial-swap combinations for fuzzy pairs (u↔o, l↔r, ^→')
function makeAltSpellings(word) {
  const pos = [];
  for (let i = 0; i < word.length; i++) {
    if (word[i] in SWAP) pos.push(i);
  }
  if (pos.length === 0) return [];
  const active = pos.slice(0, 4); // cap at 4 → max 15 combinations
  const results = new Set();
  for (let mask = 1; mask < (1 << active.length); mask++) {
    const chars = word.split('');
    for (let b = 0; b < active.length; b++) {
      if (mask & (1 << b)) chars[active[b]] = SWAP[word[active[b]]];
    }
    const v = chars.join('');
    if (v !== word) results.add(v);
  }
  return [...results];
}

// --- Triggers ---

document.addEventListener('dblclick', () => {
  try {
    chrome.storage.sync.get(DEFAULTS, (s) => {
      if (chrome.runtime.lastError) return;
      if (!s.triggerDblclick) return;
      handleSelection(s);
    });
  } catch (e) { console.debug(e); }
});

document.addEventListener('mouseup', (e) => {
  // e.detail >= 2 means this mouseup is part of a dblclick — let that handler take it
  if (!e.ctrlKey || e.detail >= 2) return;
  try {
    chrome.storage.sync.get(DEFAULTS, (s) => {
      if (chrome.runtime.lastError) return;
      if (!s.triggerCtrlSelect) return;
      handleSelection(s);
    });
  } catch (e) { console.debug(e); }
});

// Dismiss any visible tooltip immediately when the extension is disabled
chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled?.newValue === false) dismissTooltip();
});

// --- Dismiss ---

document.addEventListener('mousedown', (e) => {
  if (tooltip && !tooltip.contains(e.target)) dismissTooltip();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') dismissTooltip();
});

// --- Core ---

const GLOTTAL = new Set(["\u0027", "\u02BC", "\u2019"]);

// Walk up one level when the range lands at a text-node boundary (e.g. <b>word</b>’)
function charBefore(range) {
  const n = range.startContainer;
  if (n.nodeType !== Node.TEXT_NODE) return null;
  if (range.startOffset > 0) return n.data[range.startOffset - 1];
  const prev = n.previousSibling ?? n.parentNode?.previousSibling;
  return prev?.textContent?.at(-1) ?? null;
}

function charAfter(range) {
  const n = range.endContainer;
  if (n.nodeType !== Node.TEXT_NODE) return null;
  if (range.endOffset < n.data.length) return n.data[range.endOffset];
  const next = n.nextSibling ?? n.parentNode?.nextSibling;
  return next?.textContent?.[0] ?? null;
}

function handleSelection(settings) {
  if (!settings.enabled) return;
  const sel = globalThis.getSelection();
  const range = sel?.rangeCount > 0 ? sel.getRangeAt(0) : null;
  if (!range) return;
  if (tooltip?.contains(range.commonAncestorContainer)) return;

  let raw = sel.toString().trim();

  // Browsers treat apostrophes as word boundaries so double-click drops leading/trailing glottal stops
  const cb = charBefore(range);
  if (!GLOTTAL.has(raw[0]) && cb && GLOTTAL.has(cb)) raw = cb + raw;
  const ca = charAfter(range);
  if (!GLOTTAL.has(raw.at(-1)) && ca && GLOTTAL.has(ca)) raw = raw + ca;

  const word = cleanWord(raw);
  if (word.length < 2 || word.length > MAX_WORD_LEN) return;

  let rect;
  try { rect = range.getBoundingClientRect(); } catch { return; }
  if (!rect.width && !rect.height) return;

  triggerLookup(word, rect, settings);
}

function triggerLookup(word, rect, settings) {
  showTooltip(word, rect, settings);

  const cacheKey = `${word}:${settings.language}`;
  if (fetched.has(cacheKey)) {
    renderResults(fetched.get(cacheKey), settings);
    if (settings.altSpelling) doAltLookup(word, settings);
    return;
  }

  setLoading(true);

  const dialects = settings.language && LANG_TO_DIALECTS[settings.language]
    ? LANG_TO_DIALECTS[settings.language]
    : '';

  chrome.runtime.sendMessage({ type: 'lookup', word, dialects }, (response) => {
    if (chrome.runtime.lastError) { setLoading(false); return; }
    const results = response?.results ?? [];
    if (fetched.size >= MAX_CACHE) fetched.delete(fetched.keys().next().value);
    fetched.set(cacheKey, results);
    renderResults(results, settings);
    setLoading(false);
    if (settings.altSpelling) doAltLookup(word, settings);
  });
}

function doAltLookup(word, settings) {
  const alts = makeAltSpellings(word);
  if (alts.length === 0) return;

  const dialects = settings.language && LANG_TO_DIALECTS[settings.language]
    ? LANG_TO_DIALECTS[settings.language] : '';

  const combined = [];
  let firstMatch = null;
  let pending = 0;

  function finish() {
    if (pending > 0) return;
    renderAltSection(firstMatch, combined, settings);
  }

  for (const alt of alts) {
    const cacheKey = `${alt}:${settings.language}`;
    if (fetched.has(cacheKey)) {
      const res = fetched.get(cacheKey);
      if (res.length > 0 && !firstMatch) firstMatch = alt;
      combined.push(...res);
      continue;
    }
    pending++;
    chrome.runtime.sendMessage({ type: 'lookup', word: alt, dialects }, (response) => {
      if (!chrome.runtime.lastError) {
        const res = response?.results ?? [];
        if (fetched.size >= MAX_CACHE) fetched.delete(fetched.keys().next().value);
        fetched.set(cacheKey, res);
        if (res.length > 0 && !firstMatch) firstMatch = alt;
        combined.push(...res);
      }
      pending--;
      finish();
    });
  }

  if (pending > 0) renderAltSection(alts[0], null, settings);
  else finish();
}

function showTooltip(word, rect, settings) {
  dismissTooltip();
  tooltip = document.createElement('div');
  tooltip.id = 'formosan-dict-tooltip';
  if (settings.theme !== 'dark') tooltip.classList.add(`fdt-${settings.theme}`);
  if (settings.fontSize !== 'medium') tooltip.classList.add(`fdt-${settings.fontSize}`);
  if (settings.boldText) tooltip.classList.add('fdt-bold');

  const spaceBelow = window.innerHeight - rect.bottom;
  const tooltipH = 200;
  const top = spaceBelow > tooltipH
    ? rect.bottom + window.scrollY + 6
    : rect.top + window.scrollY - tooltipH - 6;
  const left = Math.max(8, Math.min(rect.left + window.scrollX, window.innerWidth - 248));

  tooltip.style.cssText = `position:absolute;top:${top}px;left:${left}px;z-index:2147483647`;

  const header = document.createElement('div');
  header.className = 'fdt-header';

  const wordSpan = document.createElement('span');
  wordSpan.className = 'fdt-word';
  wordSpan.textContent = word;

  const labelSpan = document.createElement('span');
  labelSpan.className = 'fdt-label';
  labelSpan.textContent = settings.language || '原住民族語言';

  header.append(wordSpan, labelSpan);

  const body = document.createElement('div');
  body.className = 'fdt-body fdt-loading';
  body.textContent = '查詢中…';

  tooltip.append(header, body);
  document.body.appendChild(tooltip);
}

function setLoading(on) {
  const body = tooltip?.querySelector('.fdt-body');
  if (!body) return;
  if (on) { body.classList.add('fdt-loading'); body.textContent = '查詢中…'; }
  else body.classList.remove('fdt-loading');
}

function renderResults(results, settings) {
  const body = tooltip?.querySelector('.fdt-body');
  if (!body) return;
  body.innerHTML = '';

  const seen = new Set();
  const deduped = results.filter(e => seen.has(e.zh) ? false : seen.add(e.zh));
  const top = deduped.slice(0, settings.maxResults);
  if (top.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'fdt-empty';
    empty.textContent = '查無此詞';
    body.appendChild(empty);
    return;
  }

  top.forEach(e => {
    const row = document.createElement('div');
    row.className = 'fdt-row';

    const zh = document.createElement('span');
    zh.className = 'fdt-zh';
    zh.textContent = e.zh;
    row.appendChild(zh);

    if (settings.showDialect) {
      const dl = document.createElement('span');
      dl.className = 'fdt-dialect';
      dl.textContent = getShortDialect(e.dialect_name);
      row.appendChild(dl);
    }

    body.appendChild(row);
  });
}

function renderAltSection(altWord, results, settings) {
  const body = tooltip?.querySelector('.fdt-body');
  if (!body) return;

  body.querySelector('.fdt-alt-section')?.remove();

  // Only render if loading or has results — empty results = hide section entirely
  if (results !== null && results.length === 0) return;

  const section = document.createElement('div');
  section.className = 'fdt-alt-section';

  const header = document.createElement('div');
  header.className = 'fdt-alt-header';
  header.textContent = altWord ?? '';
  section.appendChild(header);

  if (results === null) {
    const loading = document.createElement('span');
    loading.className = 'fdt-loading';
    loading.textContent = '查詢中…';
    section.appendChild(loading);
  } else {
    const altSeen = new Set();
    const altTop = results.filter(e => altSeen.has(e.zh) ? false : altSeen.add(e.zh)).slice(0, settings.maxResults);
    altTop.forEach(e => {
      const row = document.createElement('div');
      row.className = 'fdt-row';

      const zh = document.createElement('span');
      zh.className = 'fdt-zh';
      zh.textContent = e.zh;
      row.appendChild(zh);

      if (settings.showDialect) {
        const dl = document.createElement('span');
        dl.className = 'fdt-dialect';
        dl.textContent = getShortDialect(e.dialect_name);
        row.appendChild(dl);
      }

      section.appendChild(row);
    });
  }

  body.appendChild(section);
}

function dismissTooltip() {
  tooltip?.remove();
  tooltip = null;
}

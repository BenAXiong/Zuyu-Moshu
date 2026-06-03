// shared.js is loaded first and provides DEFAULTS and LANG_TO_DIALECTS

const MAX_WORD_LEN = 40;
const MAX_CACHE    = 200;
const ALT_SPELLING_LANGUAGE = 'Amis';
const TEXT_INPUT_TYPES = new Set(['', 'email', 'search', 'tel', 'text', 'url']);
const HOVER_DELAY_MS = 350;
const MAX_CJK_HOVER_CHARS = 4;
const MAX_CJK_CANDIDATE_GROUPS = 6;
const MAX_CJK_RESULTS_PER_GROUP = 2;
const MAX_MOE_ROWS = 3;
const MAX_EXPANDED_EXAMPLES = 3;

let tooltip = null;
let hoverTimer = null;
let lastHoverKey = '';
let activeAudio = null;
let lookupSerial = 0;
let currentTooltipRect = null;
let currentTooltipSettings = null;
let currentTooltipNav = null;
let savedOpenButton = null;
const fetched = new Map();
const moeFetched = new Map();

// ' (apostrophe) intentionally excluded — it's a glottal stop character in these orthographies
function cleanWord(w) {
  return w.replace(/^[,.";:!?()[\]{}—–，。！？；：「」『』、]+|[,.";:!?()[\]{}—–，。！？；：「」『』、]+$/g, '').toLowerCase();
}

function getShortDialect(full) {
  let short = full.replace(/語$/, '');
  short = short.replace(/(阿美|泰雅|排灣|布農|卑南|魯凱|賽夏|達悟|雅美|噶瑪蘭|太魯閣|撒奇萊雅|賽德克|拉阿魯哇|卡那卡那富)$/, '');
  return short || full.replace(/語$/, '');
}

function getDialectLabel(full, settings) {
  return settings.language ? getShortDialect(full) : full;
}

function normalizeAudioUrl(url) {
  return typeof url === 'string' && /^https?:\/\//.test(url) ? url : '';
}

function getAudioUrl(entry) {
  return normalizeAudioUrl(entry?.audioUrl ?? entry?.audio_url ?? entry?.audio);
}

const SWAP = { u:'o', o:'u', l:'r', r:'l', f:'v', v:'f', '^':"'" };

// Generate all partial-swap combinations for fuzzy pairs (u<->o, l<->r, f<->v, ^->')
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

function canUseAltSpelling(settings) {
  return settings.altSpelling && settings.language === ALT_SPELLING_LANGUAGE;
}

function hasEnabledSource(settings, sourceId) {
  const sources = Array.isArray(settings.sources) ? settings.sources : DEFAULTS.sources;
  return sources.includes(sourceId);
}

function canUseMoeKilang(settings, word) {
  return (settings.moeKilangInsights || hasEnabledSource(settings, 'KILANG'))
    && settings.language === ALT_SPELLING_LANGUAGE
    && !hasCjk(word);
}

function canUseKilangZhToAb(settings, word) {
  return (settings.moeKilangInsights || hasEnabledSource(settings, 'KILANG'))
    && settings.language === ALT_SPELLING_LANGUAGE
    && hasCjk(word);
}

function canUseDict(settings) {
  return hasEnabledSource(settings, 'EPARK') || hasEnabledSource(settings, 'ILRDF');
}

function canUseZhToAb(settings, word) {
  return hasCjk(word) && (canUseDict(settings) || canUseKilangZhToAb(settings, word));
}

function clearHoverTimer() {
  clearTimeout(hoverTimer);
  hoverTimer = null;
}

// --- Triggers ---

document.addEventListener('dblclick', () => {
  try {
    chrome.storage.sync.get(DEFAULTS, (s) => {
      if (chrome.runtime.lastError) return;
      if (s.triggerHover) return;
      if (!s.triggerDblclick) return;
      handleSelection(s);
    });
  } catch (e) { console.debug(e); }
});

document.addEventListener('mousemove', (e) => {
  if (e.buttons !== 0 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) {
    clearHoverTimer();
    return;
  }
  if (tooltip?.contains(e.target)) return;
  const { clientX, clientY } = e;
  clearHoverTimer();
  hoverTimer = setTimeout(() => {
    try {
      chrome.storage.sync.get(DEFAULTS, (s) => {
        if (chrome.runtime.lastError) return;
        if (!s.enabled || !s.triggerHover) return;
        handleHover(clientX, clientY, s);
      });
    } catch (err) { console.debug(err); }
  }, HOVER_DELAY_MS);
}, { passive: true });

document.addEventListener('mouseup', (e) => {
  // e.detail >= 2 means this mouseup is part of a dblclick — let that handler take it
  if (!e.ctrlKey || e.detail >= 2) return;
  clearHoverTimer();
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
  clearHoverTimer();
  if (tooltip && !tooltip.contains(e.target) && !savedOpenButton?.contains(e.target)) dismissTooltip();
});

document.addEventListener('keydown', (e) => {
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) clearHoverTimer();
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

function isWordBoundary(ch) {
  return !ch || /[\s,.";:!?()[\]{}<>，。！？；：「」『』、]/.test(ch) || ch === '—' || ch === '–';
}

function isCjk(ch) {
  return /[\u3400-\u9fff]/.test(ch || '');
}

function hasCjk(text) {
  return /[\u3400-\u9fff]/.test(text);
}

function hasLookupLength(word) {
  return hasCjk(word) ? word.length >= 1 : word.length >= 2;
}

function isDrillableWord(word) {
  return !hasCjk(word) && hasLookupLength(word) && word.length <= MAX_WORD_LEN;
}

function makeCjkCandidates(text, index) {
  let start = index;
  let end = index + 1;
  while (start > 0 && isCjk(text[start - 1])) start--;
  while (end < text.length && isCjk(text[end])) end++;

  const candidates = [];
  candidates.push({ raw: text.slice(start, end), start, end });

  for (let len = Math.min(MAX_CJK_HOVER_CHARS, end - start); len >= 1; len--) {
    const minStart = Math.max(start, index - len + 1);
    const maxStart = Math.min(index, end - len);
    for (let s = minStart; s <= maxStart; s++) {
      candidates.push({ raw: text.slice(s, s + len), start: s, end: s + len });
    }
  }

  const seen = new Set();
  return candidates.filter(c => {
    if (seen.has(c.raw)) return false;
    seen.add(c.raw);
    return true;
  });
}

function getCaretFromPoint(x, y) {
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    return pos ? { node: pos.offsetNode, offset: pos.offset } : null;
  }
  const range = document.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

function getHoverSelection(x, y) {
  const caret = getCaretFromPoint(x, y);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return null;

  const text = caret.node.data;
  let index = caret.offset;
  if (isWordBoundary(text[index]) && index > 0 && !isWordBoundary(text[index - 1])) index--;
  if (isWordBoundary(text[index])) return null;

  if (isCjk(text[index])) {
    const candidates = makeCjkCandidates(text, index);
    if (candidates.length === 0) return null;
    const range = document.createRange();
    range.setStart(caret.node, candidates[0].start);
    range.setEnd(caret.node, candidates[0].end);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    return { raw: candidates[0].raw, rect, candidates: candidates.map(c => c.raw) };
  }

  let start = index;
  let end = index + 1;
  while (start > 0 && !isWordBoundary(text[start - 1])) start--;
  while (end < text.length && !isWordBoundary(text[end])) end++;

  const raw = text.slice(start, end).trim();
  if (!raw) return null;

  const range = document.createRange();
  range.setStart(caret.node, start);
  range.setEnd(caret.node, end);
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  return { raw, rect };
}

function getDeepActiveElement(root = document) {
  let active = root.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

function isTextInputControl(el) {
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type);
}

function getInputSelection(el) {
  if (!isTextInputControl(el)) return null;
  let start;
  let end;
  try {
    start = el.selectionStart;
    end = el.selectionEnd;
  } catch {
    return null;
  }
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  if (start === end) return null;

  if (start > end) [start, end] = [end, start];

  let raw = el.value.slice(start, end).trim();
  const before = start > 0 ? el.value[start - 1] : null;
  const after = end < el.value.length ? el.value[end] : null;
  if (!GLOTTAL.has(raw[0]) && before && GLOTTAL.has(before)) raw = before + raw;
  if (!GLOTTAL.has(raw.at(-1)) && after && GLOTTAL.has(after)) raw += after;

  const rect = el.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  return { raw, rect };
}

function handleSelection(settings) {
  if (!settings.enabled) return;

  const inputSelection = getInputSelection(getDeepActiveElement());
  if (inputSelection) {
    lookupRawSelection(inputSelection.raw, inputSelection.rect, settings);
    return;
  }

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

  let rect;
  try { rect = range.getBoundingClientRect(); } catch { return; }
  if (!rect.width && !rect.height) return;

  lookupRawSelection(raw, rect, settings);
}

function handleHover(clientX, clientY, settings) {
  const hovered = getHoverSelection(clientX, clientY);
  if (!hovered) {
    lastHoverKey = '';
    dismissTooltip();
    return;
  }

  const word = cleanWord(hovered.raw);
  if (!hasLookupLength(word) || word.length > MAX_WORD_LEN) return;

  const hoverKey = `${word}:${Math.round(hovered.rect.left)}:${Math.round(hovered.rect.top)}`;
  if (tooltip && hoverKey === lastHoverKey) return;
  lastHoverKey = hoverKey;
  if (hovered.candidates?.length > 1) {
    triggerCandidateLookup(hovered.candidates, hovered.rect, settings);
    return;
  }
  triggerLookup(word, hovered.rect, settings);
}

function lookupRawSelection(raw, rect, settings) {
  const word = cleanWord(raw);
  if (!hasLookupLength(word) || word.length > MAX_WORD_LEN) return;
  lastHoverKey = '';
  triggerLookup(word, rect, settings);
}

function setHeaderWord(word) {
  const wordSpan = tooltip?.querySelector('.fdt-word');
  if (wordSpan) wordSpan.textContent = word;
}

function createRootIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('fdt-root-icon');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M8 13V5.5M8 9.5C5.8 9.5 4.2 8.2 4 6.2c2.1-.2 3.7.7 4 2.4M8 8.4c2.3-.1 4-1.4 4.3-3.6C10 4.6 8.4 5.6 8 7.3');
  svg.appendChild(path);
  return svg;
}

function setHeaderRoot(root, options = {}) {
  const chip = tooltip?.querySelector('.fdt-root-chip');
  const text = chip?.querySelector('.fdt-root-text');
  if (!chip || !text) return;
  const cleanRoot = cleanMoeText(root);
  const iconOnly = !!options.iconOnly;
  const isCurrentRoot = cleanRoot === getHeaderWord();
  text.textContent = cleanRoot;
  chip.dataset.root = cleanRoot;
  chip.hidden = !cleanRoot;
  chip.disabled = !cleanRoot || isCurrentRoot || iconOnly;
  chip.classList.toggle('current', !!cleanRoot && (isCurrentRoot || iconOnly));
  chip.title = isCurrentRoot || iconOnly ? '詞根' : '查詢詞根';
  chip.setAttribute('aria-label', isCurrentRoot || iconOnly ? '詞根' : '查詢詞根');
}

function getHeaderWord() {
  return tooltip?.querySelector('.fdt-word')?.textContent || '';
}

function getPrimaryText(entry) {
  return entry.displayText || (hasCjk(getHeaderWord()) ? entry.ab : entry.zh) || entry.ab || entry.zh || '';
}

function prepareResults(results, query) {
  const chineseQuery = hasCjk(query);
  return results
    .map(entry => ({
      ...entry,
      displayText: chineseQuery ? (entry.ab || '') : (entry.zh || ''),
    }))
    .filter(entry => {
      if (!entry.displayText) return false;
      return chineseQuery ? !hasCjk(entry.displayText) : true;
    });
}

function sendRuntimeMessage(message) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(response);
    });
  });
}

function normalizeDictZhEntries(results) {
  return results
    .map(entry => ({
      ...entry,
      sourceId: 'EPARK',
      displayText: cleanDisplayText(entry.ab || ''),
      secondaryText: cleanDisplayText(entry.zh || ''),
      audioUrl: getAudioUrl(entry),
    }))
    .filter(entry => entry.displayText && !hasCjk(entry.displayText));
}

function getMoeSourceMeta(row) {
  const parts = [];
  if (row.tier) parts.push(`T${row.tier}`);
  parts.push(getMoeSourceLabel(row.dict_code));
  return parts.join(' ');
}

function normalizeMoeZhEntries(rows) {
  const groups = [];
  const byWord = new Map();

  rows
    .filter(row => cleanMoeText(row.word_ab))
    .forEach(row => {
      const word = cleanMoeText(row.word_ab);
      let group = byWord.get(word.toLowerCase());
      if (!group) {
        group = { word, rows: [] };
        byWord.set(word.toLowerCase(), group);
        groups.push(group);
      }
      group.rows.push(row);
    });

  return groups.map(group => {
    const bestRank = Math.min(...group.rows.map(row => getMoeSourceRank(row.dict_code)));
    const bestRows = group.rows.filter(row => getMoeSourceRank(row.dict_code) === bestRank);
    const definitions = [...new Set(
      bestRows.map(row => cleanMoeDefinition(row.definition)).filter(Boolean)
    )];
    const examples = dedupeMoeExamples(bestRows.flatMap(getMoeExampleRows));
    const primary = bestRows[0] || group.rows[0];

    return {
      sourceId: 'KILANG',
      ab: group.word,
      zh: definitions.join('；'),
      displayText: group.word,
      secondaryText: definitions.slice(0, 2).join('；'),
      metaLabel: getMoeSourceMeta(primary),
      audioUrl: getAudioUrl(primary),
      examples,
      moeRows: bestRows,
      root: cleanMoeText(primary?.ultimate_root || primary?.stem || ''),
      sourceRank: bestRank,
    };
  }).filter(entry => entry.displayText);
}

function sortZhEntries(entries, settings) {
  const sourceOrder = Array.isArray(settings.sources) && settings.sources.length > 0
    ? settings.sources
    : DEFAULTS.sources;
  const sourceRank = source => {
    const index = sourceOrder.indexOf(source);
    return index >= 0 ? index : sourceOrder.length;
  };

  return [...entries].sort((a, b) => {
    const bySource = sourceRank(a.sourceId) - sourceRank(b.sourceId);
    if (bySource !== 0) return bySource;
    const byMoeSource = (a.sourceRank ?? 0) - (b.sourceRank ?? 0);
    if (byMoeSource !== 0) return byMoeSource;
    return a.displayText.localeCompare(b.displayText);
  });
}

function dedupeZhEntries(entries) {
  const seen = new Set();
  return entries.filter(entry => {
    const key = `${entry.sourceId}:${entry.displayText}:${entry.secondaryText || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getZhLookupEntries(word, settings) {
  const tasks = [];

  if (canUseDict(settings)) {
    tasks.push((async () => {
      const cacheKey = `${word}:${settings.language}`;
      if (fetched.has(cacheKey)) return normalizeDictZhEntries(fetched.get(cacheKey));

      const dialects = settings.language && LANG_TO_DIALECTS[settings.language]
        ? LANG_TO_DIALECTS[settings.language]
        : '';
      const response = await sendRuntimeMessage({ type: 'lookup', word, dialects });
      const results = response?.results ?? [];
      if (fetched.size >= MAX_CACHE) fetched.delete(fetched.keys().next().value);
      fetched.set(cacheKey, results);
      return normalizeDictZhEntries(results);
    })());
  }

  if (canUseKilangZhToAb(settings, word)) {
    tasks.push((async () => {
      const cacheKey = `moe-zh:${word}`;
      if (moeFetched.has(cacheKey)) return normalizeMoeZhEntries(moeFetched.get(cacheKey)?.rows ?? []);

      const response = await sendRuntimeMessage({ type: 'moeZhLookup', word });
      const insights = response?.insights ?? { query: word, rows: [] };
      if (moeFetched.size >= MAX_CACHE) moeFetched.delete(moeFetched.keys().next().value);
      moeFetched.set(cacheKey, insights);
      return normalizeMoeZhEntries(insights.rows ?? []);
    })());
  }

  const entries = (await Promise.all(tasks)).flat();
  return sortZhEntries(dedupeZhEntries(entries), settings);
}

function triggerLookup(word, rect, settings, nav = null) {
  const lookupId = ++lookupSerial;
  showTooltip(word, rect, settings, nav);
  if (hasCjk(word)) {
    triggerZhLookup(word, settings, lookupId);
    return;
  }

  const dictEnabled = canUseDict(settings);
  const kilangEnabled = canUseMoeKilang(settings, word);

  if (!dictEnabled) {
    clearMainResults();
    let startedLookup = false;
    if (kilangEnabled) {
      doMoeKilangLookup(word, settings, lookupId);
      startedLookup = true;
    }
    if (canUseAltSpelling(settings)) {
      doAltLookup(word, settings);
      startedLookup = startedLookup || kilangEnabled;
    }
    if (!startedLookup) showNoResultsIfEmpty();
    return;
  }

  const cacheKey = `${word}:${settings.language}`;
  if (fetched.has(cacheKey)) {
    renderResults(prepareResults(fetched.get(cacheKey), word), settings);
    if (kilangEnabled) doMoeKilangLookup(word, settings, lookupId);
    if (canUseAltSpelling(settings)) doAltLookup(word, settings);
    return;
  }

  setLoading(true);

  const dialects = settings.language && LANG_TO_DIALECTS[settings.language]
    ? LANG_TO_DIALECTS[settings.language]
    : '';

  chrome.runtime.sendMessage({ type: 'lookup', word, dialects }, (response) => {
    if (lookupId !== lookupSerial) return;
    if (chrome.runtime.lastError) { setLoading(false); return; }
    const results = response?.results ?? [];
    if (fetched.size >= MAX_CACHE) fetched.delete(fetched.keys().next().value);
    fetched.set(cacheKey, results);
    renderResults(prepareResults(results, word), settings);
    setLoading(false);
    if (kilangEnabled) doMoeKilangLookup(word, settings, lookupId);
    if (canUseAltSpelling(settings)) doAltLookup(word, settings);
  });
}

function normalizeTooltipNav(nav) {
  if (Array.isArray(nav?.history)) return { history: nav.history.slice(-8) };
  if (nav?.backWord) return { history: [nav.backWord] };
  return { history: [] };
}

function getCurrentDrillHistory() {
  return Array.isArray(currentTooltipNav?.history) ? currentTooltipNav.history : [];
}

function getNextDrillNav(fromWord = getHeaderWord()) {
  const cleanFrom = cleanWord(fromWord || '');
  const history = getCurrentDrillHistory();
  if (!cleanFrom) return { history };
  if (history.at(-1) === cleanFrom) return { history };
  return { history: [...history, cleanFrom].slice(-8) };
}

function drillLookup(rawWord) {
  const word = cleanWord(rawWord || '');
  if (!isDrillableWord(word) || word === cleanWord(getHeaderWord())) return;
  triggerLookup(
    word,
    currentTooltipRect,
    currentTooltipSettings,
    getNextDrillNav()
  );
}

async function triggerZhLookup(word, settings, lookupId) {
  setHeaderRoot('');
  setHeaderAudioUrl('');
  setLoading(true);

  const entries = canUseZhToAb(settings, word)
    ? await getZhLookupEntries(word, settings)
    : [];
  if (lookupId !== lookupSerial) return;

  renderZhResults(entries, settings);
  setLoading(false);
}

function doMoeKilangLookup(word, settings, lookupId) {
  const cacheKey = `moe:${word}`;
  if (moeFetched.has(cacheKey)) {
    renderMoeKilangSection(moeFetched.get(cacheKey), settings);
    return;
  }

  renderMoeKilangSection(null, settings);
  chrome.runtime.sendMessage({ type: 'moeInsights', word }, (response) => {
    if (lookupId !== lookupSerial) return;
    if (chrome.runtime.lastError) {
      renderMoeKilangSection({ rows: [] }, settings);
      return;
    }
    const insights = response?.insights ?? { rows: [] };
    if (moeFetched.size >= MAX_CACHE) moeFetched.delete(moeFetched.keys().next().value);
    moeFetched.set(cacheKey, insights);
    renderMoeKilangSection(insights, settings);
  });
}

async function triggerCandidateLookup(candidates, rect, settings) {
  const words = candidates
    .map(cleanWord)
    .filter(word => hasLookupLength(word) && word.length <= MAX_WORD_LEN);
  if (words.length === 0) return;
  if (!canUseZhToAb(settings, words[0])) return;

  const lookupId = ++lookupSerial;
  showTooltip(words[0], rect, settings);
  setLoading(true);

  const groups = [];

  await Promise.all(words.map(async word => {
    const entries = await getZhLookupEntries(word, settings);
    if (entries.length > 0) {
      groups.push({
        query: word,
        results: entries.slice(0, MAX_CJK_RESULTS_PER_GROUP),
      });
    }
  }));

  if (lookupId !== lookupSerial) return;
  groups.sort((a, b) => {
    if (b.query.length !== a.query.length) return b.query.length - a.query.length;
    return words.indexOf(a.query) - words.indexOf(b.query);
  });

  const topGroups = groups.slice(0, MAX_CJK_CANDIDATE_GROUPS);
  setHeaderWord(topGroups[0]?.query || words[0]);
  renderCandidateSections(topGroups, settings);
  setLoading(false);
}

function doAltLookup(word, settings) {
  if (!canUseAltSpelling(settings)) return;

  const alts = makeAltSpellings(word);
  if (alts.length === 0) return;
  const lookupId = lookupSerial;

  if (canUseDict(settings)) doDictAltLookup(alts, settings, lookupId);
  if (canUseMoeKilang(settings, word)) doMoeAltLookup(alts, settings, lookupId);
}

function doDictAltLookup(alts, settings, lookupId) {
  const dialects = settings.language && LANG_TO_DIALECTS[settings.language]
    ? LANG_TO_DIALECTS[settings.language] : '';

  const combined = [];
  let firstMatch = null;
  let pending = 0;

  function finish() {
    if (lookupId !== lookupSerial) return;
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
      if (lookupId !== lookupSerial) return;
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

function doMoeAltLookup(alts, settings, lookupId) {
  let pending = 0;
  let firstInsights = null;

  function finish() {
    if (lookupId !== lookupSerial) return;
    if (pending > 0) return;
    renderMoeAltSection(firstInsights || { rows: [] }, settings);
  }

  for (const alt of alts) {
    const cacheKey = `moe:${alt}`;
    if (moeFetched.has(cacheKey)) {
      const insights = moeFetched.get(cacheKey);
      if (!firstInsights && Array.isArray(insights?.rows) && insights.rows.length > 0) firstInsights = insights;
      continue;
    }

    pending++;
    chrome.runtime.sendMessage({ type: 'moeInsights', word: alt }, (response) => {
      if (lookupId !== lookupSerial) return;
      if (!chrome.runtime.lastError) {
        const insights = response?.insights ?? { query: alt, match: '', fallbackFrom: '', rows: [] };
        if (moeFetched.size >= MAX_CACHE) moeFetched.delete(moeFetched.keys().next().value);
        moeFetched.set(cacheKey, insights);
        if (!firstInsights && Array.isArray(insights?.rows) && insights.rows.length > 0) firstInsights = insights;
      }
      pending--;
      finish();
    });
  }

  if (pending > 0) renderMoeAltSection({ query: alts[0], rows: null }, settings);
  else finish();
}

function showTooltip(word, rect, settings, nav = null) {
  dismissTooltip();
  const tooltipNav = normalizeTooltipNav(nav);
  currentTooltipRect = rect;
  currentTooltipSettings = settings;
  currentTooltipNav = tooltipNav;
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
  const initialLeft = Math.max(8, rect.left + window.scrollX);

  tooltip.style.cssText = `position:absolute;top:${top}px;left:${initialLeft}px;z-index:2147483647`;

  const header = document.createElement('div');
  header.className = 'fdt-header';

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'fdt-back';
  backBtn.title = '返回';
  backBtn.setAttribute('aria-label', '返回');
  backBtn.textContent = '‹';
  backBtn.hidden = tooltipNav.history.length === 0;
  backBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const history = getCurrentDrillHistory();
    const backWord = history.at(-1);
    if (!backWord) return;
    triggerLookup(backWord, currentTooltipRect || rect, currentTooltipSettings || settings, {
      history: history.slice(0, -1),
    });
  });

  const wordSpan = document.createElement('span');
  wordSpan.className = 'fdt-word';
  wordSpan.textContent = word;

  const wordWrap = document.createElement('span');
  wordWrap.className = 'fdt-word-wrap';

  const audioBtn = createAudioButton('');
  audioBtn.hidden = true;
  audioBtn.disabled = true;

  const rootChip = document.createElement('button');
  rootChip.type = 'button';
  rootChip.className = 'fdt-root-chip';
  rootChip.title = '查詢詞根';
  rootChip.setAttribute('aria-label', '查詢詞根');
  rootChip.hidden = true;
  rootChip.disabled = true;
  rootChip.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const root = rootChip.dataset.root;
    if (!root || root === getHeaderWord()) return;
    triggerLookup(root, currentTooltipRect || rect, currentTooltipSettings || settings, getNextDrillNav());
  });
  const rootText = document.createElement('span');
  rootText.className = 'fdt-root-text';
  rootChip.append(createRootIcon(), rootText);

  const headerSaveBtn = createHeaderSaveButton();
  wordWrap.append(wordSpan, rootChip, audioBtn, headerSaveBtn);

  const labelSpan = document.createElement('span');
  labelSpan.className = 'fdt-label';
  labelSpan.textContent = settings.language || '所有族語';

  header.append(backBtn, wordWrap, labelSpan);

  const body = document.createElement('div');
  body.className = 'fdt-body fdt-loading';
  body.textContent = '查詢中…';

  tooltip.append(header, body);
  document.body.appendChild(tooltip);
  positionTooltipAndSavedButton(top, initialLeft);
}

function setLoading(on) {
  const body = tooltip?.querySelector('.fdt-body');
  if (!body) return;
  if (on) { body.classList.add('fdt-loading'); body.textContent = '查詢中…'; }
  else body.classList.remove('fdt-loading');
}

function clearMainResults() {
  const body = tooltip?.querySelector('.fdt-body');
  if (!body) return;
  body.classList.remove('fdt-loading');
  body.innerHTML = '';
  setHeaderAudioUrl('');
}

function clearEmptyMessage(body = tooltip?.querySelector('.fdt-body')) {
  body?.querySelector('.fdt-empty')?.remove();
}

function showNoResultsIfEmpty(body = tooltip?.querySelector('.fdt-body')) {
  if (!body) return;
  const hasContent = body.querySelector(
    '.fdt-result, .fdt-candidate-section, .fdt-moe-section, .fdt-alt-section'
  );
  if (hasContent || body.querySelector('.fdt-empty')) return;

  const empty = document.createElement('span');
  empty.className = 'fdt-empty';
  empty.textContent = '查無此詞';
  body.appendChild(empty);
}

function playAudio(url, btn) {
  if (!url) return;
  if (activeAudio) {
    activeAudio.pause();
    activeAudio = null;
  }

  const audio = new Audio(url);
  activeAudio = audio;
  btn.classList.add('playing');
  btn.classList.remove('error');

  const cleanup = () => {
    if (activeAudio === audio) activeAudio = null;
    btn.classList.remove('playing');
  };
  audio.addEventListener('ended', cleanup, { once: true });
  audio.addEventListener('error', () => {
    cleanup();
    btn.classList.add('error');
  }, { once: true });
  audio.play().catch(() => {
    cleanup();
    btn.classList.add('error');
  });
}

function createAudioButton(url) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fdt-audio';
  btn.title = '播放發音';
  btn.setAttribute('aria-label', '播放發音');
  btn.textContent = '▶';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    playAudio(url || btn.dataset.audioUrl, btn);
  });
  return btn;
}

function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    return Promise.resolve();
  } catch (err) {
    return Promise.reject(err);
  } finally {
    textarea.remove();
  }
}

function createCopyIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('fdt-copy-icon');

  const back = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  back.setAttribute('d', 'M5 5V3.5A1.5 1.5 0 0 1 6.5 2H12a1.5 1.5 0 0 1 1.5 1.5V9A1.5 1.5 0 0 1 12 10.5h-1.5');
  const front = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  front.setAttribute('x', '2.5');
  front.setAttribute('y', '5.5');
  front.setAttribute('width', '8');
  front.setAttribute('height', '8');
  front.setAttribute('rx', '1.5');

  svg.append(back, front);
  return svg;
}

function createCheckIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('fdt-copy-icon');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M3.5 8.2 6.6 11.3 12.8 4.7');
  svg.appendChild(path);
  return svg;
}

function setCopyButtonIcon(btn, copied) {
  btn.replaceChildren(copied ? createCheckIcon() : createCopyIcon());
}

function createBookmarkIcon(saved = false) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('fdt-save-icon');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M4.5 2.5h7v11L8 11.2l-3.5 2.3z');
  if (saved) path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

function createLibraryIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('fdt-save-icon');

  const left = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  left.setAttribute('d', 'M3 3.5h3.5A1.5 1.5 0 0 1 8 5v8a1.5 1.5 0 0 0-1.5-1.5H3z');
  const right = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  right.setAttribute('d', 'M13 3.5H9.5A1.5 1.5 0 0 0 8 5v8a1.5 1.5 0 0 1 1.5-1.5H13z');
  svg.append(left, right);
  return svg;
}

function getExampleCopyText(example) {
  return [example.ab, example.zh].filter(Boolean).join('\n');
}

function createCopyButton(example) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fdt-copy';
  btn.title = '複製例句';
  btn.setAttribute('aria-label', '複製例句');
  setCopyButtonIcon(btn, false);
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = getExampleCopyText(example);
    if (!text) return;
    copyTextToClipboard(text).then(() => {
      btn.classList.add('copied');
      setCopyButtonIcon(btn, true);
      clearTimeout(btn._copiedTimer);
      btn._copiedTimer = setTimeout(() => {
        btn.classList.remove('copied');
        setCopyButtonIcon(btn, false);
      }, 900);
    }).catch(() => {
      btn.classList.add('error');
      clearTimeout(btn._copiedTimer);
      btn._copiedTimer = setTimeout(() => {
        btn.classList.remove('error');
        setCopyButtonIcon(btn, false);
      }, 900);
    });
  });
  return btn;
}

function getPageSaveContext() {
  return {
    pageUrl: location.href,
    pageTitle: document.title,
  };
}

function getTooltipSaveContext() {
  return {
    language: currentTooltipSettings?.language || '',
    headword: getHeaderWord(),
    root: tooltip?.querySelector('.fdt-root-chip')?.dataset.root || '',
    ...getPageSaveContext(),
  };
}

function setSaveButtonState(btn, saved) {
  btn.classList.toggle('saved', saved);
  btn.title = saved ? '移除儲存' : '儲存';
  btn.setAttribute('aria-label', saved ? '移除儲存' : '儲存');
  btn.replaceChildren(createBookmarkIcon(saved));
}

function createSaveButton(getItem) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fdt-save';
  setSaveButtonState(btn, false);

  const readItem = () => fdtNormalizeSavedItem(getItem());
  try {
    const item = readItem();
    fdtFindSavedItemKey(item.key).then(saved => setSaveButtonState(btn, !!saved));
  } catch (err) {
    btn.disabled = true;
  }

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (btn.disabled) return;
    const item = readItem();
    fdtToggleSavedItem(item).then(result => {
      setSaveButtonState(btn, result.saved);
    }).catch(() => {
      btn.classList.add('error');
      clearTimeout(btn._errorTimer);
      btn._errorTimer = setTimeout(() => btn.classList.remove('error'), 900);
    });
  });
  return btn;
}

function createOpenSavedButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fdt-saved-open';
  btn.title = '開啟已儲存項目';
  btn.setAttribute('aria-label', '開啟已儲存項目');
  btn.appendChild(createLibraryIcon());
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fdtOpenSavedPage();
  });
  return btn;
}

function createHeaderSaveButton() {
  const btn = createSaveButton(() => tooltip?._headerSaveItem || buildSavedHeaderFallback());
  btn.classList.add('fdt-header-save');
  return btn;
}

function buildSavedHeaderFallback() {
  const headword = getHeaderWord();
  return {
    ...getTooltipSaveContext(),
    type: 'word',
    matchedWord: headword,
    ab: hasCjk(headword) ? '' : headword,
    zh: hasCjk(headword) ? headword : '',
  };
}

function setHeaderSaveItem(item) {
  const btn = tooltip?.querySelector('.fdt-header-save');
  if (!btn) return;
  tooltip._headerSaveItem = fdtNormalizeSavedItem(item);
  fdtFindSavedItemKey(tooltip._headerSaveItem.key).then(saved => {
    if (tooltip?.querySelector('.fdt-header-save') === btn) setSaveButtonState(btn, !!saved);
  });
}

function positionTooltipAndSavedButton(top, preferredLeft) {
  if (!tooltip) return;
  const margin = 8;
  const width = tooltip.offsetWidth || 304;
  const viewportRight = window.scrollX + window.innerWidth - margin;
  const left = Math.max(
    window.scrollX + margin,
    Math.min(preferredLeft, viewportRight - width)
  );
  tooltip.style.left = `${left}px`;
  showFloatingSavedButton(top, left, width);
}

function refreshTooltipLayout() {
  if (!tooltip) return;
  const top = Number.parseFloat(tooltip.style.top) || 0;
  const left = Number.parseFloat(tooltip.style.left) || 8;
  positionTooltipAndSavedButton(top, left);
}

function showFloatingSavedButton(top, left, tooltipWidth) {
  savedOpenButton?.remove();
  savedOpenButton = createOpenSavedButton();
  savedOpenButton.classList.add('fdt-saved-float');
  const gap = 6;
  const buttonWidth = 36;
  const viewportLeft = window.scrollX + 8;
  const viewportRight = window.scrollX + window.innerWidth - 8;
  const rightX = left + tooltipWidth + gap;
  const leftX = left - buttonWidth - gap;
  const x = rightX + buttonWidth <= viewportRight
    ? rightX
    : Math.max(viewportLeft, leftX);
  savedOpenButton.style.cssText = `position:absolute;top:${top}px;left:${x}px;z-index:2147483647`;
  const styles = getComputedStyle(tooltip);
  [
    '--fdt-surface',
    '--fdt-border',
    '--fdt-dim',
    '--fdt-accent',
    '--fdt-accent-soft',
    '--fdt-shadow',
  ].forEach(name => savedOpenButton.style.setProperty(name, styles.getPropertyValue(name)));
  document.body.appendChild(savedOpenButton);
}

function buildSavedExample(example) {
  return {
    ...getTooltipSaveContext(),
    type: 'example',
    ab: example.ab,
    zh: example.zh,
    sourceId: example.sourceId || '',
    sourceMeta: example.source || '',
    audioUrl: example.audioUrl || '',
  };
}

function uniqueSavedText(values) {
  const seen = new Set();
  return values.map(cleanDisplayText).filter(value => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildSavedHeadwordFromEntries(entries, options = {}) {
  const zhToAb = hasCjk(getHeaderWord());
  const first = entries[0] || {};
  const primaryValues = uniqueSavedText(entries.map(getPrimaryText));
  const ab = options.ab || (zhToAb ? primaryValues[0] : cleanDisplayText(first.ab || first.word_ab || getHeaderWord()));
  const zh = options.zh || (zhToAb
    ? uniqueSavedText(entries.map(entry => entry.secondaryText || entry.zh || entry.word_ch)).join('；')
    : primaryValues.join('；'));

  return {
    ...getTooltipSaveContext(),
    type: 'word',
    matchedWord: options.matchedWord || ab || getHeaderWord(),
    ab,
    zh,
    sourceId: options.sourceId || first.sourceId || 'EPARK',
    sourceMeta: options.sourceMeta || first.metaLabel || '',
    dialect: first.dialect_name || '',
    examples: entries.flatMap(getExampleRows).slice(0, MAX_EXPANDED_EXAMPLES),
    audioUrl: entries.map(getAudioUrl).find(Boolean) || '',
  };
}

function buildSavedMoeHeadword({ matchedWord, root, affixSummary, senses }) {
  return {
    ...getTooltipSaveContext(),
    type: 'word',
    matchedWord,
    ab: matchedWord,
    zh: uniqueSavedText(senses.map(sense => sense.definition)).join('；'),
    sourceId: 'KILANG',
    sourceMeta: uniqueSavedText(senses.map(sense => getMoeSourceMeta(sense.row))).join(' / '),
    root,
    affixes: affixSummary ? [affixSummary] : [],
    examples: senses.flatMap(sense => sense.examples).slice(0, MAX_EXPANDED_EXAMPLES),
    audioUrl: senses.map(sense => sense.audioUrl).find(Boolean) || '',
  };
}

function setHeaderAudioUrl(url) {
  const btn = tooltip?.querySelector('.fdt-header .fdt-audio');
  if (!btn) return;
  btn.dataset.audioUrl = url || '';
  btn.hidden = !url;
  btn.disabled = !url;
  btn.classList.remove('playing', 'error');
}

function cleanDisplayText(text) {
  return String(text || '')
    .replace(/`([^`~]+)~/g, '$1')
    .replace(/[`~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function appendDrillableText(parent, text) {
  const raw = String(text || '');
  if (!raw) return;

  const parts = raw.split(/([\p{L}\p{M}\d'^’ʼ:.-]+)/gu);
  parts.forEach(part => {
    if (!part) return;
    const word = cleanWord(part);
    if (!isDrillableWord(word)) {
      parent.appendChild(document.createTextNode(part));
      return;
    }

    const token = document.createElement('button');
    token.type = 'button';
    token.className = 'fdt-drill';
    token.textContent = part;
    token.title = '查詢此詞';
    token.setAttribute('aria-label', `查詢 ${word}`);
    token.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      drillLookup(word);
    });
    token.addEventListener('keydown', (e) => e.stopPropagation());
    parent.appendChild(token);
  });
}

function countCjk(text) {
  return [...String(text || '')].filter(ch => isCjk(ch)).length;
}

function isSentenceLikeExample(example) {
  const ab = example.ab || '';
  const zh = example.zh || '';
  const abTokens = ab.split(/\s+/).filter(Boolean).length;
  const zhChars = countCjk(zh);
  if (/[.!?。！？；;]/.test(`${ab}${zh}`)) return true;
  if (abTokens >= 3 && zhChars >= 4) return true;
  return zhChars >= 8;
}

function getExampleRows(entry) {
  if (!Array.isArray(entry?.examples)) return [];
  return entry.examples
    .map(ex => ({
      ab: cleanDisplayText(ex?.ab || ex?.word_ab || ex?.text || ''),
      zh: cleanDisplayText(ex?.zh || ex?.word_ch || ex?.translation || ''),
      source: cleanDisplayText(ex?.source || ex?.category || ''),
      sourceId: entry.sourceId || 'EPARK',
      audioUrl: getAudioUrl(ex),
    }))
    .filter(ex => (ex.ab || ex.zh) && isSentenceLikeExample(ex));
}

function closeExpandedResults(scope = tooltip) {
  scope?.querySelectorAll('.fdt-result.expanded').forEach(container => {
    container.classList.remove('expanded');
    container.querySelector('.fdt-row')?.setAttribute('aria-expanded', 'false');
    container.querySelector('.fdt-examples')?.remove();
  });
  scope?.querySelectorAll('.fdt-moe-item.expanded').forEach(item => {
    item.classList.remove('expanded');
    item.setAttribute('aria-expanded', 'false');
    item.querySelector('.fdt-examples')?.remove();
  });
  scope?.querySelectorAll('.fdt-moe-sense.expanded').forEach(item => {
    item.classList.remove('expanded');
    item.setAttribute('aria-expanded', 'false');
    item.querySelector('.fdt-examples')?.remove();
  });
}

function buildExamplesPanel(examples, limit = MAX_EXPANDED_EXAMPLES) {
  const panel = document.createElement('div');
  panel.className = 'fdt-examples';

  const visibleExamples = Number.isFinite(limit) ? examples.slice(0, limit) : examples;
  visibleExamples.forEach(example => {
    const item = document.createElement('div');
    item.className = 'fdt-example';

    if (example.audioUrl) item.appendChild(createAudioButton(example.audioUrl));

    const text = document.createElement('div');
    text.className = 'fdt-example-text';

    if (example.ab) {
      const ab = document.createElement('div');
      ab.className = 'fdt-example-ab';
      appendDrillableText(ab, example.ab);
      text.appendChild(ab);
    }

    if (example.zh) {
      const zh = document.createElement('div');
      zh.className = 'fdt-example-zh';
      zh.textContent = example.zh;
      text.appendChild(zh);
    }

    const actions = document.createElement('div');
    actions.className = 'fdt-example-actions';
    const controls = document.createElement('div');
    controls.className = 'fdt-example-controls';
    controls.appendChild(createSaveButton(() => buildSavedExample(example)));
    controls.appendChild(createCopyButton(example));
    actions.appendChild(controls);

    if (example.source) {
      const source = document.createElement('div');
      source.className = 'fdt-example-source';
      source.textContent = example.source;
      actions.appendChild(source);
    }

    item.appendChild(text);
    item.appendChild(actions);
    panel.appendChild(item);
  });

  return panel;
}

function toggleResultExamples(container, examples) {
  const row = container.querySelector('.fdt-row');
  const isExpanded = container.classList.contains('expanded');
  closeExpandedResults();
  if (isExpanded) return;

  container.classList.add('expanded');
  row?.setAttribute('aria-expanded', 'true');
  container.appendChild(buildExamplesPanel(examples));
}

function toggleMoeExamples(item, examples) {
  const isExpanded = item.classList.contains('expanded');
  closeExpandedResults();
  if (isExpanded) return;

  item.classList.add('expanded');
  item.setAttribute('aria-expanded', 'true');
  item.appendChild(buildExamplesPanel(examples));
}

function toggleMoeSenseExamples(item, examples) {
  const isExpanded = item.classList.contains('expanded');
  closeExpandedResults();

  item.classList.toggle('expanded', !isExpanded);
  item.setAttribute('aria-expanded', String(!isExpanded));
  item.querySelector('.fdt-examples')?.remove();
  item.appendChild(buildExamplesPanel(examples, isExpanded ? MAX_EXPANDED_EXAMPLES : Infinity));
}

function appendResultRow(parent, entry, settings, showRowAudio) {
  const container = document.createElement('div');
  container.className = 'fdt-result';

  const row = document.createElement('div');
  row.className = 'fdt-row';

  const examples = getExampleRows(entry);
  if (examples.length > 0) {
    row.classList.add('fdt-expandable');
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-expanded', 'false');
    row.title = '顯示例句';
    row.addEventListener('click', () => toggleResultExamples(container, examples));
    row.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      toggleResultExamples(container, examples);
    });
  }

  const textWrap = document.createElement('span');
  textWrap.className = 'fdt-result-text';
  if (entry.secondaryText) textWrap.classList.add('has-secondary');

  const audioUrl = getAudioUrl(entry);
  if (showRowAudio && audioUrl) textWrap.appendChild(createAudioButton(audioUrl));

  const zh = document.createElement('span');
  zh.className = 'fdt-zh';
  const primaryText = getPrimaryText(entry);
  if (entry.sourceId && !hasCjk(primaryText)) appendDrillableText(zh, primaryText);
  else zh.textContent = primaryText;
  textWrap.appendChild(zh);

  if (entry.secondaryText) {
    const secondary = document.createElement('span');
    secondary.className = 'fdt-result-secondary';
    secondary.textContent = entry.secondaryText;
    textWrap.appendChild(secondary);
  }
  row.appendChild(textWrap);

  if (entry.metaLabel || settings.showDialect) {
    const dl = document.createElement('span');
    dl.className = 'fdt-dialect';
    dl.textContent = entry.metaLabel || getDialectLabel(entry.dialect_name, settings);
    row.appendChild(dl);
  }

  container.appendChild(row);
  parent.appendChild(container);
}

function renderResults(results, settings) {
  const body = tooltip?.querySelector('.fdt-body');
  if (!body) return;
  body.classList.remove('fdt-loading');
  body.innerHTML = '';

  const seen = new Set();
  const deduped = results.filter(e => {
    const key = `${getPrimaryText(e)}:${getAudioUrl(e) || 'no-audio'}`;
    return seen.has(key) ? false : seen.add(key);
  });
  const top = deduped.slice(0, settings.maxResults);
  const zhToAb = hasCjk(getHeaderWord());
  setHeaderAudioUrl(zhToAb ? '' : (top.map(getAudioUrl).find(Boolean) || ''));
  if (top.length === 0) {
    showNoResultsIfEmpty(body);
    return;
  }

  setHeaderSaveItem(buildSavedHeadwordFromEntries(top));
  top.forEach(e => appendResultRow(body, e, settings, zhToAb));
  refreshTooltipLayout();
}

function renderZhResults(entries, settings) {
  const body = tooltip?.querySelector('.fdt-body');
  if (!body) return;
  body.classList.remove('fdt-loading');
  body.innerHTML = '';
  setHeaderAudioUrl('');

  const top = entries.slice(0, settings.maxResults);
  if (top.length === 0) {
    showNoResultsIfEmpty(body);
    return;
  }

  setHeaderSaveItem(buildSavedHeadwordFromEntries(top));
  top.forEach(entry => appendResultRow(body, entry, settings, true));
  refreshTooltipLayout();
}

function renderCandidateSections(groups, settings) {
  const body = tooltip?.querySelector('.fdt-body');
  if (!body) return;
  body.classList.remove('fdt-loading');
  body.innerHTML = '';
  setHeaderAudioUrl('');

  if (groups.length === 0) {
    showNoResultsIfEmpty(body);
    return;
  }

  if (groups[0]?.results?.length) {
    setHeaderSaveItem(buildSavedHeadwordFromEntries(groups[0].results, { matchedWord: groups[0].query }));
  }

  groups.forEach(group => {
    const section = document.createElement('div');
    section.className = 'fdt-candidate-section';

    const header = document.createElement('div');
    header.className = 'fdt-candidate-header';
    header.textContent = group.query;
    section.appendChild(header);

    group.results.forEach(entry => appendResultRow(section, entry, settings, true));
    body.appendChild(section);
  });
  refreshTooltipLayout();
}

function cleanMoeText(text) {
  return cleanDisplayText(text);
}

function cleanMoeDefinition(text) {
  return cleanMoeText(text).replace(/[。．.]+$/u, '').trim();
}

function getMoeMatchKey(word) {
  return cleanMoeText(word).toLowerCase();
}

function getMoeSourceLabel(code) {
  return ({
    s: 'S',
    p: 'P',
    m: 'M',
    a: 'A',
    'old-s': 'OLD',
  })[code] || 'SRC';
}

function insertMoeSection(body, section) {
  clearEmptyMessage(body);
  const altSection = body.querySelector('.fdt-alt-section');
  if (altSection) body.insertBefore(section, altSection);
  else body.appendChild(section);
}

function parseMoeExamples(json) {
  try {
    const parsed = JSON.parse(json || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getMoeExampleRows(row) {
  return parseMoeExamples(row.examples_json)
    .map(ex => ({
      ab: cleanMoeText(ex.ab),
      zh: cleanMoeText(ex.zh || ex.en),
      source: cleanMoeText(ex.source || ''),
      sourceId: 'KILANG',
      audioUrl: getAudioUrl(ex),
    }))
    .filter(ex => (ex.ab || ex.zh) && isSentenceLikeExample(ex));
}

function dedupeMoeExamples(examples) {
  const seen = new Set();
  return examples.filter(example => {
    const key = `${example.ab}\n${example.zh}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getMoeSourceRank(code) {
  return ({
    s: 0,
    m: 1,
    a: 2,
    'old-s': 3,
    p: 4,
  })[code] ?? 9;
}

function getMoeDisplayRows(rows) {
  const displayable = rows.filter(row => cleanMoeDefinition(row.definition) || getMoeExampleRows(row).length > 0);
  if (displayable.length === 0) return rows;

  const bestRank = Math.min(...displayable.map(row => getMoeSourceRank(row.dict_code)));
  return displayable.filter(row => getMoeSourceRank(row.dict_code) === bestRank);
}

function getMoeSenseKey(row) {
  const definition = cleanMoeDefinition(row.definition);
  return definition || cleanMoeText(row.word_ab) || String(row.id || '');
}

function getMoeSenseRows(rows) {
  const senses = [];
  const byKey = new Map();

  getMoeDisplayRows(rows).forEach(row => {
    const key = getMoeSenseKey(row);
    if (!key) return;

    let sense = byKey.get(key);
    if (!sense) {
      sense = {
        row,
        definition: cleanMoeDefinition(row.definition),
        audioUrl: getAudioUrl(row),
        examples: [],
      };
      byKey.set(key, sense);
      senses.push(sense);
    }
    if (!sense.audioUrl) sense.audioUrl = getAudioUrl(row);
    sense.examples = dedupeMoeExamples([...sense.examples, ...getMoeExampleRows(row)]);
  });

  return senses;
}

function getMoePrimaryRow(rows) {
  return getMoeSenseRows(rows)[0]?.row || rows[0];
}

function getMoeAffixes(word, stem) {
  const cleanWord = cleanMoeText(word).toLowerCase();
  const cleanStem = cleanMoeText(stem).toLowerCase();
  if (!cleanWord || !cleanStem || cleanWord === cleanStem) return [];

  const start = cleanWord.indexOf(cleanStem);
  if (start < 0) return [];

  const affixes = [];
  const prefix = cleanWord.slice(0, start);
  const suffix = cleanWord.slice(start + cleanStem.length);
  if (prefix) affixes.push({ type: 'prefix', label: `${prefix}-` });
  if (suffix) affixes.push({ type: 'suffix', label: `-${suffix}` });
  return affixes;
}

function formatMoeAffixSummary(affixes) {
  const prefix = affixes.find(affix => affix.type === 'prefix')?.label.replace(/-$/, '');
  const suffix = affixes.find(affix => affix.type === 'suffix')?.label.replace(/^-/, '');
  if (prefix && suffix) return `${prefix}-...-${suffix}`;
  if (prefix) return `${prefix}-`;
  if (suffix) return `-${suffix}`;
  return '';
}

function getMoeRecoveryAffixSummary(recovery) {
  const affixes = Array.isArray(recovery?.affixes) ? recovery.affixes : [];
  return affixes.map(cleanMoeText).filter(Boolean).join(' + ');
}

function getMoeRecoveryOperations(recovery) {
  return Array.isArray(recovery?.operations) ? recovery.operations : [];
}

function appendMoeDerivedHeader(section, context) {
  const header = document.createElement('div');
  header.className = 'fdt-derived-header';
  if (context.kind) header.classList.add(`fdt-relation-${context.kind}`);

  const base = document.createElement('span');
  base.className = 'fdt-derived-base';
  base.textContent = context.base;
  header.appendChild(base);

  if (context.affix) {
    const plus = document.createElement('span');
    plus.className = 'fdt-derived-plus';
    plus.textContent = '+';

    const affix = document.createElement('span');
    affix.className = 'fdt-derived-affix';
    affix.textContent = context.affix;

    header.append(plus, affix);
  }

  section.appendChild(header);
}

function removeDuplicateMoeAltSection(body, matchKey) {
  if (!matchKey) return;
  body.querySelectorAll('.fdt-moe-alt-section').forEach(section => {
    if (section.dataset.moeAltMatchKey === matchKey || section.dataset.moeAltQueryKey === matchKey) {
      section.remove();
    }
  });
}

function appendMoeRelationHeaders(section, details) {
  const {
    matchedWord,
    isSameHeadword,
    recoveryAffixSummary,
    inferredAffixSummary,
    affixStem,
    recoveryOperations,
  } = details;
  const hasAltRecovery = recoveryOperations.includes('alt');
  const hasGlottalRecovery = recoveryOperations.includes('glottal');

  if (!isSameHeadword) {
    appendMoeDerivedHeader(section, {
      base: matchedWord,
      affix: recoveryAffixSummary,
      kind: (hasAltRecovery && !hasGlottalRecovery && !recoveryAffixSummary) ? 'alt' : 'recovery',
    });
  }

  if (inferredAffixSummary) {
    appendMoeDerivedHeader(section, {
      base: cleanMoeText(affixStem) || matchedWord,
      affix: inferredAffixSummary,
      kind: 'derived',
    });
  }
}

function renderMoeSenseRows(section, rows) {
  const senses = getMoeSenseRows(rows);

  senses.forEach(sense => {
    const item = document.createElement('div');
    item.className = 'fdt-moe-sense';

    const examples = sense.examples;
    const hasOverflow = examples.length > MAX_EXPANDED_EXAMPLES;
    if (hasOverflow) {
      item.classList.add('fdt-expandable');
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-expanded', 'false');
      item.title = '顯示全部例句';
      item.addEventListener('click', () => toggleMoeSenseExamples(item, examples));
      item.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        toggleMoeSenseExamples(item, examples);
      });
    }

    const header = document.createElement('div');
    header.className = 'fdt-moe-sense-head';

    if (sense.audioUrl) header.appendChild(createAudioButton(sense.audioUrl));

    const def = document.createElement('div');
    def.className = 'fdt-moe-def';
    def.textContent = sense.definition || cleanMoeText(sense.row.word_ab);
    header.appendChild(def);

    const meta = document.createElement('span');
    meta.className = 'fdt-moe-meta';
    if (sense.row.tier) {
      const tier = document.createElement('span');
      tier.className = 'fdt-moe-source';
      tier.textContent = `T${sense.row.tier}`;
      meta.appendChild(tier);
    }
    const source = document.createElement('span');
    source.className = 'fdt-moe-source';
    source.textContent = getMoeSourceLabel(sense.row.dict_code);
    meta.appendChild(source);

    header.appendChild(meta);

    item.appendChild(header);

    if (examples.length > 0) {
      item.appendChild(buildExamplesPanel(examples, MAX_EXPANDED_EXAMPLES));
    }

    section.appendChild(item);
  });

  return senses;
}

function renderMoeKilangSection(insights, settings) {
  const body = tooltip?.querySelector('.fdt-body');
  if (!body) return;

  body.querySelector('.fdt-moe-section')?.remove();

  if (insights === null) {
    const loading = document.createElement('div');
    loading.className = 'fdt-moe-section fdt-moe-loading';
    const spinner = document.createElement('span');
    spinner.className = 'fdt-loading-icon';
    spinner.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = 'Searching Kilang...';
    loading.append(spinner, text);
    insertMoeSection(body, loading);
    return;
  }

  const rows = Array.isArray(insights?.rows) ? insights.rows : [];
  if (rows.length === 0) {
    setHeaderRoot('');
    body.dataset.moeMainMatchKey = '';
    showNoResultsIfEmpty(body);
    return;
  }

  const primary = getMoePrimaryRow(rows);
  const matchedWord = cleanMoeText(insights.match || primary.word_ab || getHeaderWord());
  const root = cleanMoeText(primary.ultimate_root || primary.stem || '');
  const parent = cleanMoeText(primary.parent_word || '');
  const stem = cleanMoeText(parent || primary.stem || root);
  const affixStem = stem || root;
  const affixes = getMoeAffixes(matchedWord, affixStem);
  const inferredAffixSummary = formatMoeAffixSummary(affixes);
  const recoveryAffixSummary = getMoeRecoveryAffixSummary(insights.recovery);
  const saveAffixSummary = recoveryAffixSummary || inferredAffixSummary;
  const recoveryOperations = getMoeRecoveryOperations(insights.recovery);
  const isSameHeadword = getMoeMatchKey(getHeaderWord()) === getMoeMatchKey(matchedWord);
  const isPureAltRecovery = recoveryOperations.includes('alt')
    && !recoveryOperations.includes('glottal')
    && !recoveryAffixSummary;
  const rootKey = getMoeMatchKey(root);
  const matchedKey = getMoeMatchKey(matchedWord);
  const headerKey = getMoeMatchKey(getHeaderWord());
  const rootAddsInfo = rootKey && rootKey !== matchedKey && rootKey !== headerKey;
  setHeaderRoot(root, { iconOnly: isPureAltRecovery && !rootAddsInfo });
  body.dataset.moeMainMatchKey = getMoeMatchKey(matchedWord);
  removeDuplicateMoeAltSection(body, body.dataset.moeMainMatchKey);

  const section = document.createElement('div');
  section.className = 'fdt-moe-section';

  appendMoeRelationHeaders(section, {
    matchedWord,
    isSameHeadword,
    recoveryAffixSummary,
    inferredAffixSummary,
    affixStem,
    recoveryOperations,
  });

  const senses = renderMoeSenseRows(section, rows);
  if (senses.length === 0) {
    showNoResultsIfEmpty(body);
    return;
  }

  setHeaderSaveItem(buildSavedMoeHeadword({
    matchedWord,
    root,
    affixSummary: saveAffixSummary,
    senses,
  }));

  insertMoeSection(body, section);
  refreshTooltipLayout();
}

function renderMoeAltSection(insights, settings) {
  const body = tooltip?.querySelector('.fdt-body');
  if (!body) return;

  body.querySelector('.fdt-moe-alt-section')?.remove();

  const queryKey = getMoeMatchKey(insights?.query || insights?.match || '');
  if (queryKey && body.dataset.moeMainMatchKey === queryKey) return;

  const section = document.createElement('div');
  section.className = 'fdt-alt-section fdt-moe-alt-section';
  section.dataset.moeAltQueryKey = queryKey;

  const altHeader = document.createElement('div');
  altHeader.className = 'fdt-alt-header';
  altHeader.textContent = cleanMoeText(insights?.query || insights?.match || '');
  section.appendChild(altHeader);

  if (!insights || insights.rows === null) {
    clearEmptyMessage(body);
    const loading = document.createElement('div');
    loading.className = 'fdt-moe-loading fdt-alt-loading';
    const spinner = document.createElement('span');
    spinner.className = 'fdt-loading-icon';
    spinner.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = 'Searching Kilang...';
    loading.append(spinner, text);
    section.appendChild(loading);
    body.appendChild(section);
    return;
  }

  const rows = Array.isArray(insights?.rows) ? insights.rows : [];
  if (rows.length === 0) {
    showNoResultsIfEmpty(body);
    return;
  }

  const primary = getMoePrimaryRow(rows);
  const matchedWord = cleanMoeText(insights.match || primary.word_ab || insights.query || '');
  const matchKey = getMoeMatchKey(matchedWord);
  if (matchKey && body.dataset.moeMainMatchKey === matchKey) {
    clearEmptyMessage(body);
    return;
  }
  section.dataset.moeAltMatchKey = matchKey;

  const root = cleanMoeText(primary.ultimate_root || primary.stem || '');
  const parent = cleanMoeText(primary.parent_word || '');
  const stem = cleanMoeText(parent || primary.stem || root);
  const affixStem = stem || root;
  const affixes = getMoeAffixes(matchedWord, affixStem);
  const inferredAffixSummary = formatMoeAffixSummary(affixes);
  const recoveryAffixSummary = getMoeRecoveryAffixSummary(insights.recovery);
  const saveAffixSummary = recoveryAffixSummary || inferredAffixSummary;
  const recoveryOperations = getMoeRecoveryOperations(insights.recovery);

  appendMoeRelationHeaders(section, {
    matchedWord,
    isSameHeadword: queryKey === matchKey,
    recoveryAffixSummary,
    inferredAffixSummary,
    affixStem,
    recoveryOperations,
  });

  const senses = renderMoeSenseRows(section, rows);
  if (senses.length === 0) {
    showNoResultsIfEmpty(body);
    return;
  }

  if (!body.querySelector(':scope > .fdt-result, :scope > .fdt-moe-section:not(.fdt-moe-alt-section)')) {
    setHeaderSaveItem(buildSavedMoeHeadword({
      matchedWord,
      root,
      affixSummary: saveAffixSummary,
      senses,
    }));
  }

  clearEmptyMessage(body);
  body.appendChild(section);
  refreshTooltipLayout();
}

function renderAltSection(altWord, results, settings) {
  const body = tooltip?.querySelector('.fdt-body');
  if (!body) return;

  body.querySelector('.fdt-dict-alt-section')?.remove();

  // Only render if loading or has results — empty results = hide section entirely
  if (results !== null && results.length === 0) {
    showNoResultsIfEmpty(body);
    return;
  }

  const section = document.createElement('div');
  section.className = 'fdt-alt-section fdt-dict-alt-section';

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
    const altTop = results.filter(e => {
      const key = `${getPrimaryText(e)}:${getAudioUrl(e) || 'no-audio'}`;
      return altSeen.has(key) ? false : altSeen.add(key);
    }).slice(0, settings.maxResults);
    if (!body.querySelector(':scope > .fdt-result, :scope > .fdt-moe-section')) {
      setHeaderSaveItem(buildSavedHeadwordFromEntries(altTop, { matchedWord: altWord }));
    }
    altTop.forEach(e => appendResultRow(section, e, settings, true));
  }

  clearEmptyMessage(body);
  body.appendChild(section);
  refreshTooltipLayout();
}

function dismissTooltip() {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio = null;
  }
  tooltip?.remove();
  savedOpenButton?.remove();
  savedOpenButton = null;
  tooltip = null;
  currentTooltipRect = null;
  currentTooltipSettings = null;
  currentTooltipNav = null;
}

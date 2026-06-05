const API_BASE = 'https://ycm-citadel.vercel.app/api/search';
const MOE_SHADOW_BASE = 'https://ycm-citadel.vercel.app/api/moe_shadow';
const ILRDF_MT_BASE = 'https://ai-labs.ilrdf.org.tw/kari-seejiq-tnpusu-ai-hmjil';
const ILRDF_TTS_BASE = 'https://ai-labs.ilrdf.org.tw/hnang-kari-ai-asi-sluhay';
const ILRDF_TIMEOUT = 20000;
const AMIS_MALAN_DIALECT = 'ami_Mala';
const AMIS_MALAN_SPEAKER = '阿美_馬蘭_女聲';
const MOE_COMMON_PREFIXES = ['sapi', 'paka', 'pina', 'maka', 'mala', 'mipa', 'misa', 'ma', 'mi', 'pa', 'pi', 'ka', 'sa', 'si', 'ni'];
const MOE_COMMON_SUFFIXES = ['ayay', 'anay', 'enay', 'ay', 'en', 'an', 'aw', 'to'];
const MOE_ALT_SWAPS = { u: 'o', o: 'u', l: 'r', r: 'l', f: 'v', v: 'f' };
const MAX_MOE_FALLBACK_CANDIDATES = 20;
const MAX_MOE_ALT_POSITIONS = 4;
const MAX_MOE_PREFIX_STRIPS = 2;
const MAX_MOE_SUFFIX_STRIPS = 1;
const MIN_MOE_RECOVERY_BASE_LEN = 4;
const MAX_TTS_CACHE = 200;
const ttsFetched = new Map();

async function updateIcon(enabled) {
  const size = 16;
  const bitmap = await createImageBitmap(
    await (await fetch(chrome.runtime.getURL('icons/icon16.png'))).blob()
  );
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, size, size);
  if (enabled) {
    // White outline for visibility against any icon background
    ctx.beginPath(); ctx.arc(13, 13, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    // Green dot
    ctx.beginPath(); ctx.arc(13, 13, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#34d399'; ctx.fill();
  }
  chrome.action.setIcon({ imageData: ctx.getImageData(0, 0, size, size) });
}

chrome.storage.sync.get({ enabled: true }, (s) => updateIcon(s.enabled));
chrome.storage.onChanged.addListener((changes) => {
  if ('enabled' in changes) updateIcon(changes.enabled.newValue);
});

async function fetchLookup(word, dialects) {
  const params = new URLSearchParams({ mode: 'DICT', q: word });
  if (dialects) params.set('dialects', dialects);
  const response = await fetch(`${API_BASE}?${params}`);
  if (!response.ok) throw new Error(`search failed: ${response.status}`);
  const data = await response.json();
  return data.results ?? [];
}

function uniqueWords(words) {
  const seen = new Set();
  return words.filter(word => {
    const key = word.toLowerCase();
    if (!word || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getMoeRecoveryLength(word) {
  return word.replace(/'/g, '').length;
}

function formatMoeAffixLabel(type, value) {
  if (type === 'prefix') return `${value}-`;
  if (type === 'suffix') return `-${value}`;
  return value;
}

function makeMoeAltSpellings(word) {
  const pos = [];
  for (let i = 0; i < word.length; i++) {
    if (word[i] in MOE_ALT_SWAPS) pos.push(i);
  }
  if (pos.length === 0) return [];

  const active = pos.slice(0, MAX_MOE_ALT_POSITIONS);
  const results = new Set();
  for (let mask = 1; mask < (1 << active.length); mask++) {
    const chars = word.split('');
    for (let b = 0; b < active.length; b++) {
      if (mask & (1 << b)) chars[active[b]] = MOE_ALT_SWAPS[word[active[b]]];
    }
    const alt = chars.join('');
    if (alt !== word) results.add(alt);
  }
  return [...results];
}

function makeMoeGlottalRepairs(word) {
  if (!word || word.includes("'")) return [];

  const repairs = [];
  if (/^[aeiou]/.test(word)) repairs.push(`'${word}`);
  if (/[aeiou]$/.test(word)) repairs.push(`${word}'`);

  for (const prefix of MOE_COMMON_PREFIXES) {
    if (!word.startsWith(prefix)) continue;
    const rest = word.slice(prefix.length);
    if (rest.length >= MIN_MOE_RECOVERY_BASE_LEN && /^[aeiou]/.test(rest)) {
      repairs.push(`${prefix}'${rest}`);
    }
  }

  return uniqueWords(repairs);
}

function makeMoeStrippedStates(word) {
  const initial = {
    word,
    prefixStrips: 0,
    suffixStrips: 0,
    affixes: [],
  };
  const queue = [initial];
  const states = [];
  const seen = new Set([`${word}:0:0`]);

  for (let index = 0; index < queue.length; index++) {
    const state = queue[index];
    if (state.prefixStrips < MAX_MOE_PREFIX_STRIPS) {
      for (const prefix of MOE_COMMON_PREFIXES) {
        if (!state.word.startsWith(prefix)) continue;
        const stripped = state.word.slice(prefix.length);
        if (getMoeRecoveryLength(stripped) < MIN_MOE_RECOVERY_BASE_LEN) continue;
        const next = {
          word: stripped,
          prefixStrips: state.prefixStrips + 1,
          suffixStrips: state.suffixStrips,
          affixes: [...state.affixes, formatMoeAffixLabel('prefix', prefix)],
        };
        const key = `${next.word}:${next.prefixStrips}:${next.suffixStrips}`;
        if (seen.has(key)) continue;
        seen.add(key);
        states.push(next);
        queue.push(next);
      }
    }

    if (state.suffixStrips < MAX_MOE_SUFFIX_STRIPS) {
      for (const suffix of MOE_COMMON_SUFFIXES) {
        if (!state.word.endsWith(suffix)) continue;
        const stripped = state.word.slice(0, -suffix.length);
        if (getMoeRecoveryLength(stripped) < MIN_MOE_RECOVERY_BASE_LEN) continue;
        const next = {
          word: stripped,
          prefixStrips: state.prefixStrips,
          suffixStrips: state.suffixStrips + 1,
          affixes: [...state.affixes, formatMoeAffixLabel('suffix', suffix)],
        };
        const key = `${next.word}:${next.prefixStrips}:${next.suffixStrips}`;
        if (seen.has(key)) continue;
        seen.add(key);
        states.push(next);
        queue.push(next);
      }
    }
  }

  return states;
}

function makeMoeFallbackCandidates(word) {
  const normalized = word.trim().toLowerCase();
  const candidates = [];
  const seen = new Set([normalized]);

  function add(wordValue, state, score, operations = []) {
    if (!wordValue || getMoeRecoveryLength(wordValue) < MIN_MOE_RECOVERY_BASE_LEN) return;
    const key = wordValue.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      word: wordValue,
      score,
      recovery: {
        affixes: state?.affixes ?? [],
        operations,
      },
    });
  }

  function addForms(state, baseScore) {
    add(state.word, state, baseScore);

    const alts = makeMoeAltSpellings(state.word);
    for (const alt of alts) add(alt, state, baseScore + 1, ['alt']);

    for (const repaired of makeMoeGlottalRepairs(state.word)) {
      add(repaired, state, baseScore + 2, ['glottal']);
    }

    for (const alt of alts) {
      for (const repaired of makeMoeGlottalRepairs(alt)) {
        add(repaired, state, baseScore + 3, ['alt', 'glottal']);
      }
    }
  }

  addForms({ word: normalized, affixes: [] }, 0);

  for (const state of makeMoeStrippedStates(normalized)) {
    const depth = state.prefixStrips + state.suffixStrips;
    addForms(state, 4 + ((depth - 1) * 4));
  }

  return candidates
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_MOE_FALLBACK_CANDIDATES);
}

async function fetchMoeRows(word, exact = true) {
  const params = new URLSearchParams({ keyword: word, exact: String(exact), mode: 'moe' });
  const response = await fetch(`${MOE_SHADOW_BASE}?${params}`);
  if (!response.ok) throw new Error(`moe lookup failed: ${response.status}`);
  const data = await response.json();
  return data.rows ?? [];
}

async function fetchMoeLineageRows(root) {
  const params = new URLSearchParams({ keyword: root, aggregate: 'true', mode: 'moe' });
  const response = await fetch(`${MOE_SHADOW_BASE}?${params}`);
  if (!response.ok) return [];

  const data = await response.json();
  return data.rows ?? [];
}

async function enrichMoeRows(rows, options = {}) {
  const maxRoots = options.maxRoots ?? 1;
  const roots = uniqueWords(
    rows.map(row => row.ultimate_root || row.stem).filter(Boolean)
  ).slice(0, maxRoots);
  if (roots.length === 0) return rows;

  const lineageRows = (await Promise.all(
    roots.map(root => fetchMoeLineageRows(root).catch(() => []))
  )).flat();
  if (lineageRows.length === 0) return rows;

  const lineageByWordAndSource = new Map(lineageRows.map(row => [
    `${String(row.word_ab || '').toLowerCase()}:${row.dict_code || ''}`,
    row,
  ]));
  const lineageByWord = new Map();
  lineageRows.forEach(row => {
    const word = String(row.word_ab || '').toLowerCase();
    if (word && !lineageByWord.has(word)) lineageByWord.set(word, row);
  });

  return rows.map(row => ({
    ...row,
    ...pickMoeLineageFields(
      lineageByWordAndSource.get(`${String(row.word_ab || '').toLowerCase()}:${row.dict_code || ''}`)
      || lineageByWord.get(String(row.word_ab || '').toLowerCase())
    ),
  }));
}

function pickMoeLineageFields(row) {
  if (!row) return {};
  return {
    parent_word: row.parent_word,
    ultimate_root: row.ultimate_root,
    tier: row.tier,
    sort_path: row.sort_path,
    sources: row.sources,
  };
}

async function fetchMoeInsights(word) {
  const exactRows = await enrichMoeRows(await fetchMoeRows(word));
  if (exactRows.length > 0) {
    return { query: word, match: word, fallbackFrom: '', rows: exactRows };
  }

  for (const candidate of makeMoeFallbackCandidates(word)) {
    const rows = await enrichMoeRows(await fetchMoeRows(candidate.word));
    if (rows.length > 0) {
      return { query: word, match: candidate.word, fallbackFrom: word, recovery: candidate.recovery, rows };
    }
  }

  return { query: word, match: '', fallbackFrom: '', rows: [] };
}

async function fetchMoeZhInsights(keyword) {
  const rows = await enrichMoeRows(await fetchMoeRows(keyword, false), { maxRoots: 8 });
  return { query: keyword, rows };
}

async function gradioCall(base, fn, data) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ILRDF_TIMEOUT);
  try {
    const submitRes = await fetch(`${base}/gradio_api/call/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
      signal: controller.signal,
    });
    if (!submitRes.ok) return null;
    const { event_id } = await submitRes.json();
    if (!event_id) return null;

    const streamRes = await fetch(`${base}/gradio_api/call/${fn}/${event_id}`, { signal: controller.signal });
    if (!streamRes.ok || !streamRes.body) return null;

    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const match = /event:\s*complete[\r\n]+data:\s*(\[[\s\S]+?\])\s*$/.exec(buf);
        if (match) return JSON.parse(match[1])[0];
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function getTtsCacheKey(speaker, text) {
  return `${speaker}\n${text}`;
}

async function getTtsAudioUrl(speaker, text) {
  const key = getTtsCacheKey(speaker, text);
  if (ttsFetched.has(key)) return await ttsFetched.get(key);

  const request = gradioCall(ILRDF_TTS_BASE, 'default_speaker_tts', [speaker, text])
    .then(result => {
      const url = result?.url ?? (typeof result === 'string' ? result : '');
      if (!url) {
        ttsFetched.delete(key);
        return '';
      }
      if (ttsFetched.size >= MAX_TTS_CACHE) ttsFetched.delete(ttsFetched.keys().next().value);
      ttsFetched.set(key, url);
      return url;
    })
    .catch(error => {
      ttsFetched.delete(key);
      throw error;
    });

  ttsFetched.set(key, request);
  return await request;
}

function notifyCompanionContextUpdated() {
  try {
    chrome.runtime.sendMessage({ type: 'companionContextUpdated' }, () => {
      void chrome.runtime.lastError;
    });
  } catch {}
}

async function ensureOffscreenAudioDocument() {
  if (!chrome.offscreen?.createDocument) {
    throw new Error('offscreenUnavailable');
  }

  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl],
    });
    if (contexts.length > 0) return;
  }

  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play generated TTS audio from extension UI.',
    });
  } catch (error) {
    if (!String(error?.message || '').includes('Only a single offscreen document')) throw error;
  }
}

async function playOffscreenAudio(url) {
  if (!url) return { ok: false, reason: 'missingUrl' };
  await ensureOffscreenAudioDocument();
  return await chrome.runtime.sendMessage({ type: 'offscreenPlayAudio', url });
}

async function playIlrdfTts(text, speaker = AMIS_MALAN_SPEAKER) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return { ok: false, reason: 'missingText' };
  const url = await getTtsAudioUrl(speaker, clean);
  if (!url) return { ok: false, reason: 'ttsUnavailable' };
  return await playOffscreenAudio(url);
}

async function translateIlrdfText(text, dialect = AMIS_MALAN_DIALECT) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return { ok: false, reason: 'missingText' };
  const result = await gradioCall(ILRDF_MT_BASE, 'translate', [clean, dialect, 'zho_Hant']);
  return typeof result === 'string'
    ? { ok: true, text: result }
    : { ok: false, reason: 'translateFailed' };
}

async function openCompanion(sender, context = null) {
  const contextWrite = context
    ? chrome.storage.session.set({ companionContext: context })
    : Promise.resolve();

  if (!chrome.sidePanel?.open) {
    return { ok: false, reason: 'sidePanelUnavailable' };
  }

  const windowId = sender?.tab?.windowId;
  if (typeof windowId === 'number') {
    await chrome.sidePanel.open({ windowId });
    await contextWrite;
    notifyCompanionContextUpdated();
    return { ok: true };
  }

  const window = await chrome.windows.getLastFocused();
  if (typeof window?.id !== 'number') {
    return { ok: false, reason: 'windowUnavailable' };
  }
  await chrome.sidePanel.open({ windowId: window.id });
  await contextWrite;
  notifyCompanionContextUpdated();
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'openSavedPage') {
    chrome.tabs.create({ url: msg.url || chrome.runtime.getURL('saved.html') });
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'openCompanion') {
    openCompanion(_sender)
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, reason: error?.message || 'openFailed' }));

    return true;
  }

  if (msg.type === 'companionContext') {
    openCompanion(_sender, msg.context)
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, reason: error?.message || 'openFailed' }));

    return true;
  }

  if (msg.type === 'playOffscreenAudio') {
    playOffscreenAudio(msg.url)
      .then(response => sendResponse(response || { ok: false }))
      .catch(error => sendResponse({ ok: false, reason: error?.message || 'playFailed' }));

    return true;
  }

  if (msg.type === 'playIlrdfTts') {
    playIlrdfTts(msg.text, msg.speaker)
      .then(response => sendResponse(response || { ok: false }))
      .catch(error => sendResponse({ ok: false, reason: error?.message || 'ttsFailed' }));

    return true;
  }

  if (msg.type === 'translateIlrdfText') {
    translateIlrdfText(msg.text, msg.dialect)
      .then(response => sendResponse(response || { ok: false }))
      .catch(error => sendResponse({ ok: false, reason: error?.message || 'translateFailed' }));

    return true;
  }

  if (msg.type === 'lookup') {
    fetchLookup(msg.word, msg.dialects)
      .then(results => sendResponse({ results }))
      .catch(() => sendResponse({ results: [] }));

    return true; // keep channel open for async sendResponse
  }

  if (msg.type === 'moeInsights') {
    fetchMoeInsights(msg.word)
      .then(insights => sendResponse({ insights }))
      .catch(() => sendResponse({ insights: null }));

    return true; // keep channel open for async sendResponse
  }

  if (msg.type === 'moeZhLookup') {
    fetchMoeZhInsights(msg.word)
      .then(insights => sendResponse({ insights }))
      .catch(() => sendResponse({ insights: { query: msg.word, rows: [] } }));

    return true; // keep channel open for async sendResponse
  }
});

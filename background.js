const API_BASE = 'https://ycm-citadel.vercel.app/api/search';
const MOE_SHADOW_BASE = 'https://ycm-citadel.vercel.app/api/moe_shadow';
const MOE_COMMON_PREFIXES = ['sapi', 'paka', 'pina', 'maka', 'mala', 'mipa', 'misa', 'ma', 'mi', 'pa', 'pi', 'ka', 'sa', 'si', 'ni'];
const MOE_COMMON_SUFFIXES = ['ayay', 'anay', 'enay', 'ay', 'en', 'an', 'aw', 'to'];

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

function makeMoeFallbackCandidates(word) {
  const normalized = word.trim().toLowerCase();
  const candidates = [];

  for (const prefix of MOE_COMMON_PREFIXES) {
    if (normalized.startsWith(prefix) && normalized.length > prefix.length + 1) {
      candidates.push(normalized.slice(prefix.length));
    }
  }

  for (const suffix of MOE_COMMON_SUFFIXES) {
    if (normalized.endsWith(suffix) && normalized.length > suffix.length + 1) {
      candidates.push(normalized.slice(0, -suffix.length));
    }
  }

  for (const prefix of MOE_COMMON_PREFIXES) {
    if (!normalized.startsWith(prefix)) continue;
    const withoutPrefix = normalized.slice(prefix.length);
    for (const suffix of MOE_COMMON_SUFFIXES) {
      if (withoutPrefix.endsWith(suffix) && withoutPrefix.length > suffix.length + 1) {
        candidates.push(withoutPrefix.slice(0, -suffix.length));
      }
    }
  }

  return uniqueWords(candidates).slice(0, 8);
}

async function fetchMoeRows(word) {
  const params = new URLSearchParams({ keyword: word, exact: 'true', mode: 'moe' });
  const response = await fetch(`${MOE_SHADOW_BASE}?${params}`);
  if (!response.ok) throw new Error(`moe lookup failed: ${response.status}`);
  const data = await response.json();
  return data.rows ?? [];
}

async function enrichMoeRows(rows) {
  const root = rows.map(row => row.ultimate_root || row.stem).find(Boolean);
  if (!root) return rows;

  const params = new URLSearchParams({ keyword: root, aggregate: 'true', mode: 'moe' });
  const response = await fetch(`${MOE_SHADOW_BASE}?${params}`);
  if (!response.ok) return rows;

  const data = await response.json();
  const lineageRows = data.rows ?? [];
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
    const rows = await enrichMoeRows(await fetchMoeRows(candidate));
    if (rows.length > 0) {
      return { query: word, match: candidate, fallbackFrom: word, rows };
    }
  }

  return { query: word, match: '', fallbackFrom: '', rows: [] };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
});

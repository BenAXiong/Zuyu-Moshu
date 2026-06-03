const FDT_SAVED_KEY = 'savedItemsV1';

function fdtNowIso() {
  return new Date().toISOString();
}

function fdtCleanSavedText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function fdtSavedId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `saved-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fdtSavedKey(item) {
  return [
    item.type,
    item.language,
    item.sourceId,
    item.headword,
    item.matchedWord,
    item.ab,
    item.zh,
    item.root,
  ].map(value => fdtCleanSavedText(value).toLowerCase()).join('|');
}

function fdtNormalizeSavedItem(item) {
  const now = fdtNowIso();
  const normalized = {
    id: item.id || fdtSavedId(),
    key: item.key || '',
    type: item.type || 'word',
    language: item.language || '',
    headword: fdtCleanSavedText(item.headword),
    matchedWord: fdtCleanSavedText(item.matchedWord),
    ab: fdtCleanSavedText(item.ab),
    zh: fdtCleanSavedText(item.zh),
    sourceId: fdtCleanSavedText(item.sourceId),
    sourceMeta: fdtCleanSavedText(item.sourceMeta),
    dialect: fdtCleanSavedText(item.dialect),
    root: fdtCleanSavedText(item.root),
    affixes: Array.isArray(item.affixes) ? item.affixes.map(fdtCleanSavedText).filter(Boolean) : [],
    examples: Array.isArray(item.examples) ? item.examples.map(example => ({
      ab: fdtCleanSavedText(example.ab),
      zh: fdtCleanSavedText(example.zh),
      source: fdtCleanSavedText(example.source),
      audioUrl: fdtCleanSavedText(example.audioUrl),
    })).filter(example => example.ab || example.zh) : [],
    audioUrl: fdtCleanSavedText(item.audioUrl),
    pageUrl: String(item.pageUrl || ''),
    pageTitle: fdtCleanSavedText(item.pageTitle),
    createdAt: item.createdAt || now,
    updatedAt: now,
  };
  normalized.key = fdtSavedKey(normalized);
  return normalized;
}

function fdtGetSavedItems() {
  return chrome.storage.local.get({ [FDT_SAVED_KEY]: [] })
    .then(result => Array.isArray(result[FDT_SAVED_KEY]) ? result[FDT_SAVED_KEY] : []);
}

function fdtSetSavedItems(items) {
  return chrome.storage.local.set({ [FDT_SAVED_KEY]: items });
}

async function fdtFindSavedItemKey(key) {
  const items = await fdtGetSavedItems();
  return items.find(item => item.key === key) || null;
}

async function fdtToggleSavedItem(item) {
  const normalized = fdtNormalizeSavedItem(item);
  const items = await fdtGetSavedItems();
  const index = items.findIndex(existing => existing.key === normalized.key);
  if (index >= 0) {
    const [removed] = items.splice(index, 1);
    await fdtSetSavedItems(items);
    return { saved: false, item: removed };
  }

  items.unshift(normalized);
  await fdtSetSavedItems(items);
  return { saved: true, item: normalized };
}

async function fdtRemoveSavedItem(id) {
  const items = await fdtGetSavedItems();
  const next = items.filter(item => item.id !== id);
  await fdtSetSavedItems(next);
  return next;
}

function fdtFormatSavedItem(item) {
  const lines = [];
  const title = item.ab || item.matchedWord || item.headword || item.zh;
  if (title) lines.push(title);
  if (item.zh && item.zh !== title) lines.push(item.zh);
  if (item.root) lines.push(`root: ${item.root}`);
  if (item.affixes?.length) lines.push(`affixes: ${item.affixes.join(' + ')}`);
  if (item.examples?.length) {
    item.examples.forEach(example => {
      if (example.ab) lines.push(example.ab);
      if (example.zh) lines.push(example.zh);
    });
  }
  const meta = [item.language, item.sourceId, item.sourceMeta || item.dialect].filter(Boolean).join(' / ');
  if (meta) lines.push(`[${meta}]`);
  return lines.join('\n');
}

function fdtOpenSavedPage() {
  const url = chrome.runtime.getURL('saved.html');
  if (chrome.tabs?.create) {
    chrome.tabs.create({ url });
    return;
  }
  chrome.runtime.sendMessage({ type: 'openSavedPage', url });
}

let savedItems = [];

const INDIHUNT_IMPORT_URL = 'https://indilog.vercel.app/import';
const INDIHUNT_MAX_ITEMS = 200;
const INDIHUNT_LANG_CODE = {
  Amis: 'ami',
  Atayal: 'tay',
  Paiwan: 'pwn',
  Bunun: 'bnn',
  Puyuma: 'pyu',
  Rukai: 'dru',
  Tsou: 'tsu',
  Saisiyat: 'xsy',
  Tao: 'tao',
  Thao: 'ssf',
  Kavalan: 'ckv',
  Truku: 'trv',
  Sakizaya: 'szy',
  Sediq: 'see',
  Kanakanavu: 'xnb',
  Saaroa: 'sxr',
};

const els = {};

document.addEventListener('DOMContentLoaded', () => {
  els.summary = document.getElementById('summary');
  els.search = document.getElementById('search');
  els.typeFilter = document.getElementById('typeFilter');
  els.languageFilter = document.getElementById('languageFilter');
  els.showSenseExamples = document.getElementById('showSenseExamples');
  els.list = document.getElementById('list');
  els.empty = document.getElementById('empty');
  els.copySelected = document.getElementById('copySelected');
  els.deleteSelected = document.getElementById('deleteSelected');
  els.exportIndiHunt = document.getElementById('exportIndiHunt');

  els.search.addEventListener('input', render);
  els.typeFilter.addEventListener('change', render);
  els.languageFilter.addEventListener('change', render);
  els.showSenseExamples.addEventListener('change', render);
  els.copySelected.addEventListener('click', () => copyItems(getSelectedItems(), els.copySelected));
  els.deleteSelected.addEventListener('click', deleteSelectedItems);
  els.exportIndiHunt.addEventListener('click', () => exportItemsToIndiHunt(getSelectedItems(), els.exportIndiHunt));

  loadItems();
});

async function loadItems() {
  savedItems = await fdtGetSavedItems();
  populateLanguageFilter();
  render();
}

function populateLanguageFilter() {
  const current = els.languageFilter.value;
  const languages = [...new Set(savedItems.map(item => item.language).filter(Boolean))].sort();
  els.languageFilter.replaceChildren(new Option('全部語言', ''));
  languages.forEach(language => els.languageFilter.appendChild(new Option(language, language)));
  els.languageFilter.value = languages.includes(current) ? current : '';
}

function itemSearchText(item) {
  return [
    item.type,
    item.language,
    item.headword,
    item.matchedWord,
    item.ab,
    item.zh,
    item.root,
    ...(item.affixes || []),
    ...(item.examples || []).flatMap(example => [example.ab, example.zh, example.source]),
  ].join(' ').toLowerCase();
}

function getFilteredItems() {
  const query = els.search.value.trim().toLowerCase();
  const type = els.typeFilter.value;
  const language = els.languageFilter.value;
  return savedItems.filter(item => {
    if (type && item.type !== type) return false;
    if (language && item.language !== language) return false;
    if (query && !itemSearchText(item).includes(query)) return false;
    return true;
  });
}

function getSelectedItems() {
  const ids = [...document.querySelectorAll('.item-check:checked')].map(input => input.value);
  return savedItems.filter(item => ids.includes(item.id));
}

function render() {
  const items = getFilteredItems();
  els.summary.textContent = `${savedItems.length} saved / ${items.length} shown`;
  els.empty.hidden = savedItems.length !== 0;
  els.list.replaceChildren();

  updateSelectedActionState();

  items.forEach(item => els.list.appendChild(renderItem(item)));
  updateSelectedActionState();
}

function renderItem(item) {
  const card = document.createElement('article');
  card.className = 'item';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'item-check';
  checkbox.value = item.id;
  checkbox.addEventListener('change', updateSelectedCopyState);

  const main = document.createElement('div');
  main.className = 'item-main';

  const title = document.createElement('div');
  title.className = 'item-title';
  const ab = document.createElement('div');
  ab.className = 'ab';
  ab.textContent = item.ab || item.matchedWord || item.headword || item.zh || '(empty)';
  title.appendChild(ab);
  main.appendChild(title);

  if (item.zh && item.zh !== ab.textContent) {
    const zh = document.createElement('div');
    zh.className = 'zh';
    zh.textContent = item.zh;
    main.appendChild(zh);
  }

  if (item.affixes?.length) {
    const affixes = document.createElement('div');
    affixes.className = 'affixes';
    affixes.textContent = item.affixes.join(' + ');
    main.appendChild(affixes);
  }

  const showExamples = item.type !== 'sense' || els.showSenseExamples.checked;
  if (showExamples && item.examples?.length) {
    const examples = document.createElement('div');
    examples.className = 'examples';
    item.examples.slice(0, 3).forEach(example => {
      const row = document.createElement('div');
      row.className = 'example';
      if (example.ab) {
        const exAb = document.createElement('div');
        exAb.className = 'example-ab';
        exAb.textContent = example.ab;
        row.appendChild(exAb);
      }
      if (example.zh) {
        const exZh = document.createElement('div');
        exZh.textContent = example.zh;
        row.appendChild(exZh);
      }
      examples.appendChild(row);
    });
    main.appendChild(examples);
  }

  const actions = document.createElement('div');
  actions.className = 'item-actions';
  const indivoreLogo = document.createElement('img');
  indivoreLogo.className = 'item-indihunt-logo';
  indivoreLogo.src = 'assets/indivore/icon128.png';
  indivoreLogo.alt = 'IndiHunt';
  indivoreLogo.width = 24;
  indivoreLogo.height = 24;
  actions.appendChild(indivoreLogo);

  const language = document.createElement('div');
  language.className = 'item-language';
  language.textContent = item.language || '';

  const root = document.createElement('div');
  root.className = 'item-root';
  root.textContent = item.root || '';

  card.append(checkbox, language, root, main, actions);
  return card;
}

function updateSelectedCopyState() {
  updateSelectedActionState();
}

function updateSelectedActionState() {
  const hasSelection = getSelectedItems().length > 0;
  els.copySelected.disabled = !hasSelection;
  els.deleteSelected.disabled = !hasSelection;
  els.exportIndiHunt.disabled = !hasSelection;
}

async function deleteSelectedItems() {
  const selectedIds = new Set(getSelectedItems().map(item => item.id));
  if (selectedIds.size === 0) return;
  savedItems = savedItems.filter(item => !selectedIds.has(item.id));
  await fdtSetSavedItems(savedItems);
  populateLanguageFilter();
  render();
}

function copyItems(items, btn) {
  if (!items.length) return;
  const text = items.map(fdtFormatSavedItem).join('\n\n---\n\n');
  navigator.clipboard.writeText(text).then(() => {
    if (!btn) return;
    const original = btn.textContent;
    btn.textContent = '已複製';
    setTimeout(() => { btn.textContent = original; }, 900);
  });
}

function exportItemsToIndiHunt(items, btn) {
  if (!items.length) return;
  const exportItems = items.flatMap(formatIndiHuntItems).slice(0, INDIHUNT_MAX_ITEMS);
  if (!exportItems.length) return;
  const payload = {
    version: 1,
    source: 'ycm-popupdict',
    exportedAt: new Date().toISOString(),
    items: exportItems,
  };
  openIndiHuntImport(payload);
  flashButtonLabel(btn, '已送出');
}

function formatIndiHuntItems(item) {
  const items = [];
  const main = formatIndiHuntMainItem(item);
  if (main) items.push(main);

  (item.examples || []).forEach(example => {
    const sentence = formatIndiHuntSentenceItem(example, item);
    if (sentence) items.push(sentence);
  });

  return items;
}

function formatIndiHuntMainItem(item) {
  const ab = cleanExportText(item.ab || item.matchedWord || item.headword);
  const language = getIndiHuntLanguageCode(item.language);
  if (!ab || !language) return null;

  return cleanIndiHuntItem({
    ab,
    zh: cleanExportText(item.zh),
    type: item.type === 'example' ? 'sentence' : 'word',
    language,
    dialect: cleanExportText(item.dialect),
    audio: cleanExportText(item.audioUrl),
    notes: formatIndiHuntNotes(item),
    tags: formatIndiHuntTags(item),
  });
}

function formatIndiHuntSentenceItem(example, parent) {
  const ab = cleanExportText(example.ab);
  const language = getIndiHuntLanguageCode(parent.language);
  if (!ab || !language) return null;

  return cleanIndiHuntItem({
    ab,
    zh: cleanExportText(example.zh),
    type: 'sentence',
    language,
    dialect: cleanExportText(parent.dialect),
    audio: cleanExportText(example.audioUrl || example.audio_url),
    notes: formatIndiHuntNotes(parent, example),
    tags: formatIndiHuntTags(parent),
  });
}

function cleanIndiHuntItem(item) {
  return Object.fromEntries(
    Object.entries(item).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== '';
    })
  );
}

function getIndiHuntLanguageCode(language) {
  return INDIHUNT_LANG_CODE[language] || '';
}

function formatIndiHuntNotes(item, example = null) {
  const notes = [];
  if (item.root) notes.push(`Root: ${item.root}`);
  if (item.affixes?.length) notes.push(`Affixes: ${item.affixes.join(' + ')}`);
  if (item.sourceMeta || item.dialect) notes.push(`Source: ${item.sourceMeta || item.dialect}`);
  if (example?.source) notes.push(`Example source: ${example.source}`);
  if (item.pageTitle) notes.push(`Page: ${item.pageTitle}`);
  if (item.pageUrl) notes.push(item.pageUrl);
  return notes.join(' · ');
}

function formatIndiHuntTags(item) {
  return [item.sourceId].map(cleanExportText).filter(Boolean);
}

function cleanExportText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function encodePayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function openIndiHuntImport(payload) {
  const b64 = encodePayload(payload);
  chrome.tabs.create({ url: `${INDIHUNT_IMPORT_URL}#v1:${b64}` });
}

function flashButtonLabel(btn, text) {
  if (!btn) return;
  const label = btn.querySelector('span') || btn;
  const original = label.textContent;
  label.textContent = text;
  setTimeout(() => { label.textContent = original; }, 900);
}

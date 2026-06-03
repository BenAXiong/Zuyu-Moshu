let savedItems = [];

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
  const payload = {
    source: 'ycm-popupdict',
    exportedAt: new Date().toISOString(),
    items: items.map(formatIndiHuntItem),
  };
  navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(() => {
    const label = btn.querySelector('span');
    if (!label) return;
    const original = label.textContent;
    label.textContent = '已複製';
    setTimeout(() => { label.textContent = original; }, 900);
  });
}

function formatIndiHuntItem(item) {
  return {
    type: item.type,
    language: item.language,
    headword: item.headword || item.matchedWord || item.ab || '',
    ab: item.ab || item.matchedWord || item.headword || '',
    zh: item.zh || '',
    root: item.root || '',
    affixes: item.affixes || [],
    examples: item.examples || [],
    sourceId: item.sourceId || '',
    sourceMeta: item.sourceMeta || item.dialect || '',
    pageUrl: item.pageUrl || '',
    pageTitle: item.pageTitle || '',
    createdAt: item.createdAt || '',
  };
}

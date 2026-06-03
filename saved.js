let savedItems = [];

const els = {};

document.addEventListener('DOMContentLoaded', () => {
  els.summary = document.getElementById('summary');
  els.search = document.getElementById('search');
  els.typeFilter = document.getElementById('typeFilter');
  els.sourceFilter = document.getElementById('sourceFilter');
  els.list = document.getElementById('list');
  els.empty = document.getElementById('empty');
  els.copySelected = document.getElementById('copySelected');
  els.copyFiltered = document.getElementById('copyFiltered');

  els.search.addEventListener('input', render);
  els.typeFilter.addEventListener('change', render);
  els.sourceFilter.addEventListener('change', render);
  els.copySelected.addEventListener('click', () => copyItems(getSelectedItems(), els.copySelected));
  els.copyFiltered.addEventListener('click', () => copyItems(getFilteredItems(), els.copyFiltered));

  loadItems();
});

async function loadItems() {
  savedItems = await fdtGetSavedItems();
  populateSourceFilter();
  render();
}

function populateSourceFilter() {
  const current = els.sourceFilter.value;
  const sources = [...new Set(savedItems.map(item => item.sourceId).filter(Boolean))].sort();
  els.sourceFilter.replaceChildren(new Option('全部來源', ''));
  sources.forEach(source => els.sourceFilter.appendChild(new Option(source, source)));
  els.sourceFilter.value = sources.includes(current) ? current : '';
}

function itemSearchText(item) {
  return [
    item.type,
    item.language,
    item.headword,
    item.matchedWord,
    item.ab,
    item.zh,
    item.sourceId,
    item.sourceMeta,
    item.dialect,
    item.root,
    ...(item.affixes || []),
    ...(item.examples || []).flatMap(example => [example.ab, example.zh, example.source]),
  ].join(' ').toLowerCase();
}

function getFilteredItems() {
  const query = els.search.value.trim().toLowerCase();
  const type = els.typeFilter.value;
  const source = els.sourceFilter.value;
  return savedItems.filter(item => {
    if (type && item.type !== type) return false;
    if (source && item.sourceId !== source) return false;
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

  els.copySelected.disabled = true;
  els.copyFiltered.disabled = items.length === 0;

  items.forEach(item => els.list.appendChild(renderItem(item)));
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

  const meta = document.createElement('div');
  meta.className = 'meta';
  [
    item.type,
    item.language,
    item.sourceId,
    item.sourceMeta || item.dialect,
    item.root ? `root ${item.root}` : '',
    item.affixes?.length ? item.affixes.join(' + ') : '',
  ].filter(Boolean).forEach(value => {
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = value;
    meta.appendChild(pill);
  });
  main.appendChild(meta);

  if (item.examples?.length) {
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
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = '複製';
  copy.addEventListener('click', () => copyItems([item], copy));
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'delete';
  del.textContent = '刪除';
  del.addEventListener('click', async () => {
    savedItems = await fdtRemoveSavedItem(item.id);
    populateSourceFilter();
    render();
  });
  actions.append(copy, del);

  card.append(checkbox, main, actions);
  return card;
}

function updateSelectedCopyState() {
  els.copySelected.disabled = getSelectedItems().length === 0;
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

const DOMAIN_ORDER = [
  'Boston Planning & Zoning',
  'Grid & Infrastructure',
  'Environmental Review',
  'Formal Participation',
  'Legal Challenges',
  'Negotiation',
  'Compliance & Complaints',
];

const ICONS = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11H3Z"/><path d="M3 8h18"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8Zm-9 10 9 4 9-4M3 18l9 4 9-4"/>',
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function icon(name) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.classList.add('ui-icon');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = ICONS[name];
  return node;
}

function button(className, text, action) {
  const node = element('button', className, text);
  node.type = 'button';
  if (action) node.addEventListener('click', action);
  return node;
}

function sourceText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalized(value) {
  return String(value ?? '').normalize('NFKD').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * An independent view of the workbook's annotated nodes.
 * Counts are source classifications, never weights or measures of public power.
 */
export function createInfluenceAnalysis(container, {
  onSelect = () => {},
  onOpenGraph = () => {},
  regionMap = new Map(),
  onFilterChange = () => {},
} = {}) {
  let data = null;
  let mechanism = '';
  let domain = '';
  let query = '';
  let selectedCode = '';
  let selectedSupplementary = false;
  const mechanismButtons = new Map();
  const domainButtons = new Map();
  const cardButtons = [];

  container.classList.add('influence-panel');
  container.setAttribute('aria-label', 'Public Influence Analysis');
  const page = element('div', 'influence-page');
  container.replaceChildren(page);

  const header = element('header', 'influence-intro');
  const introCopy = element('div', 'influence-intro-copy');
  introCopy.append(
    element('p', 'influence-kicker', 'Participation, Mapped'),
    element('h1', 'influence-title', 'Where Does The Public Have A Voice?'),
    element('p', 'influence-deck', 'Explore how people can take part, what their input may shape, and who makes the final decision.'),
  );
  const statistics = element('dl', 'influence-statistics');
  header.append(introCopy, statistics);
  page.append(header);

  const charts = element('div', 'influence-charts');
  const mechanismPanel = element('section', 'influence-chart influence-mechanism-chart');
  mechanismPanel.setAttribute('aria-labelledby', 'influence-mechanism-heading');
  const mechanismHeading = element('h2', '', 'Mechanisms Of Influence');
  mechanismHeading.id = 'influence-mechanism-heading';
  const mechanismHeader = element('div', 'influence-chart-heading');
  mechanismHeader.append(mechanismHeading, element('span', 'influence-unit', 'Annotated Nodes'));
  const mechanismDescription = element('p', 'influence-chart-description', 'Select a mechanism to explore its nodes.');
  const mechanismList = element('div', 'influence-mechanism-list');
  mechanismList.setAttribute('role', 'group');
  mechanismList.setAttribute('aria-label', 'Filter nodes by mechanism');
  const mechanismNote = element('div', 'influence-mechanism-note');
  mechanismNote.setAttribute('role', 'status');
  mechanismPanel.append(mechanismHeader, mechanismDescription, mechanismList, mechanismNote);

  const domainPanel = element('section', 'influence-chart influence-domain-chart');
  domainPanel.setAttribute('aria-labelledby', 'influence-domain-heading');
  const domainHeading = element('h2', '', 'Participation Contexts');
  domainHeading.id = 'influence-domain-heading';
  const domainHeader = element('div', 'influence-chart-heading');
  domainHeader.append(domainHeading, icon('layers'));
  const domainDescription = element('p', 'influence-chart-description', 'The workbook groups participation by context.');
  const domainList = element('div', 'influence-domain-list');
  domainList.setAttribute('role', 'group');
  domainList.setAttribute('aria-label', 'Filter nodes by participation context');
  domainPanel.append(domainHeader, domainDescription, domainList);
  charts.append(mechanismPanel, domainPanel);
  page.append(charts);

  const caveat = element('p', 'influence-count-note');
  page.append(caveat);

  const records = element('section', 'influence-records');
  records.setAttribute('aria-labelledby', 'influence-nodes-heading');
  const recordsHeading = element('div', 'influence-section-heading');
  const recordTitle = element('h2', '', 'Explore The Nodes');
  recordTitle.id = 'influence-nodes-heading';
  const resultsCount = element('span', 'influence-results-count');
  resultsCount.setAttribute('role', 'status');
  resultsCount.setAttribute('aria-live', 'polite');
  recordsHeading.append(recordTitle, resultsCount);

  const filters = element('div', 'influence-filters');
  const searchLabel = element('label', 'influence-search');
  const searchInput = element('input');
  searchInput.type = 'search';
  searchInput.id = 'influence-search-input';
  searchInput.placeholder = 'Find a node, action, or decision-maker…';
  searchInput.maxLength = 300;
  searchInput.autocomplete = 'off';
  searchLabel.append(icon('search'), element('span', 'sr-only', 'Search Public Influence nodes'), searchInput);
  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    renderResults();
  });
  searchInput.addEventListener('keydown', event => {
    if (event.key === 'Escape' && query) {
      event.stopPropagation();
      searchInput.value = '';
      query = '';
      renderResults();
    }
  });
  const mechanismSelect = element('select', 'influence-filter-select');
  mechanismSelect.setAttribute('aria-label', 'Filter by mechanism');
  mechanismSelect.addEventListener('change', () => {
    mechanism = mechanismSelect.value;
    renderResults();
  });
  const domainSelect = element('select', 'influence-filter-select');
  domainSelect.setAttribute('aria-label', 'Filter by participation context');
  domainSelect.addEventListener('change', () => {
    domain = domainSelect.value;
    renderResults();
  });
  filters.append(searchLabel, mechanismSelect, domainSelect);
  const filterSummary = element('div', 'influence-filter-summary');
  const activeFilters = element('span');
  const clearFilters = button('influence-clear-filters', 'Clear Filters', resetFilters);
  filterSummary.append(activeFilters, clearFilters);
  const list = element('ul', 'influence-node-list');
  const empty = element('div', 'influence-empty');
  empty.hidden = true;
  empty.append(
    icon('search'),
    element('h3', '', 'No Matching Nodes'),
    element('p', '', 'Try a different term or clear the filters to see all annotated nodes.'),
    button('influence-empty-reset', 'Show All Nodes', resetFilters),
  );
  records.append(recordsHeading, filters, filterSummary, list, empty);
  page.append(records);

  const supplementaryPanel = element('section', 'influence-supplementary');
  supplementaryPanel.setAttribute('aria-labelledby', 'influence-supplementary-heading');
  const supplementaryHeading = element('div', 'influence-section-heading');
  const supplementaryTitle = element('h2', '', 'Supplementary Mechanisms');
  supplementaryTitle.id = 'influence-supplementary-heading';
  supplementaryHeading.append(supplementaryTitle, element('span', 'influence-supplementary-badge', 'Separate From The 31'));
  const supplementaryDescription = element('p', 'influence-supplementary-description', 'Additional pathways identified in the workbook. These are kept separate from the annotated-node counts above.');
  const supplementaryList = element('ul', 'influence-supplementary-list');
  supplementaryPanel.append(supplementaryHeading, supplementaryDescription, supplementaryList);
  page.append(supplementaryPanel);

  function regionFor(record) {
    return regionMap.get(String(record.nodeId)) ?? '';
  }

  function addStatistic(value, label) {
    const item = element('div', 'influence-statistic');
    item.append(element('dt', '', label), element('dd', '', value));
    statistics.append(item);
  }

  function resetFilters() {
    mechanism = '';
    domain = '';
    query = '';
    searchInput.value = '';
    renderResults();
  }

  function choose(record, supplementary = false) {
    selectedCode = record.code;
    selectedSupplementary = supplementary;
    updateSelection();
    onSelect(record, { supplementary });
  }

  function updateSelection() {
    for (const entry of cardButtons) {
      const selected = entry.code === selectedCode && entry.supplementary === selectedSupplementary;
      entry.button.classList.toggle('is-selected', selected);
      entry.button.setAttribute('aria-pressed', String(selected));
    }
  }

  function createCard(record, supplementary = false) {
    const item = element('li', supplementary ? 'influence-supplementary-item' : 'influence-node-item');
    const card = button(supplementary ? 'influence-node-card influence-supplementary-card' : 'influence-node-card', null, () => choose(record, supplementary));
    card.dataset.code = record.code;
    const region = regionFor(record);
    if (region) card.dataset.section = region;
    card.setAttribute('aria-pressed', 'false');
    card.setAttribute('aria-label', `${record.code}: ${supplementary ? record.mechanism : record.title}. Open ${supplementary ? 'supplementary mechanism' : 'node'} details.`);
    const top = element('span', 'influence-card-top');
    const code = element('span', 'influence-node-code', record.code);
    const folder = element('span', 'influence-folder');
    folder.append(icon('folder'));
    top.append(folder, code, element('span', 'influence-node-domain', supplementary ? 'Supplementary' : record.domain), icon('arrow'));
    const title = element('strong', 'influence-card-title', supplementary ? record.mechanism : record.title);
    const action = element('span', 'influence-card-action', record.publicAction);
    const access = element('span', 'influence-card-access');
    access.append(element('span', 'influence-card-field-label', supplementary ? 'Eligibility' : 'Access'), document.createTextNode(sourceText(supplementary ? record.eligibility : record.participationAccess)));
    card.append(top, title, action, access);
    if (supplementary) card.append(element('span', 'influence-source-treatment', record.sourceTreatment.replace(/\bFrame\s*12\s+/gi, '')));
    item.append(card);
    cardButtons.push({ button: card, code: record.code, supplementary });
    return item;
  }

  function setOptions(select, firstLabel, values) {
    select.replaceChildren();
    const all = element('option', '', firstLabel);
    all.value = '';
    select.append(all);
    for (const value of values) {
      const option = element('option', '', value.label);
      option.value = value.value;
      select.append(option);
    }
  }

  function renderCharts() {
    mechanismButtons.clear();
    domainButtons.clear();
    mechanismList.replaceChildren();
    domainList.replaceChildren();
    const total = data.summary.annotatedNodeCount;
    for (const category of data.mechanisms) {
      const categoryButton = button('influence-mechanism', null, () => {
        mechanism = mechanism === category.id ? '' : category.id;
        renderResults();
      });
      categoryButton.dataset.mechanism = category.id;
      categoryButton.setAttribute('aria-pressed', 'false');
      categoryButton.setAttribute('aria-label', `${category.label}: ${category.count} of ${total} annotated nodes. Filter by this mechanism.`);
      const heading = element('span', 'influence-mechanism-label');
      heading.append(element('span', '', category.label), element('b', 'influence-mechanism-count', category.count));
      const track = element('span', 'influence-mechanism-track');
      track.setAttribute('aria-hidden', 'true');
      const fill = element('span', 'influence-mechanism-fill');
      fill.style.width = `${total ? category.count / total * 100 : 0}%`;
      track.append(fill);
      categoryButton.append(heading, track);
      mechanismButtons.set(category.id, categoryButton);
      mechanismList.append(categoryButton);
    }

    const domains = [...new Set(data.nodes.map(node => node.domain))].sort((a, b) => {
      const ai = DOMAIN_ORDER.indexOf(a);
      const bi = DOMAIN_ORDER.indexOf(b);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b);
    });
    for (const context of domains) {
      const matching = data.nodes.filter(node => node.domain === context);
      const domainButton = button('influence-domain', null, () => {
        domain = domain === context ? '' : context;
        renderResults();
      });
      domainButton.dataset.domain = context;
      domainButton.setAttribute('aria-pressed', 'false');
      domainButton.setAttribute('aria-label', `${context}: ${matching.length} annotated nodes. Filter by this context.`);
      const counts = new Map();
      for (const record of matching) {
        const region = regionFor(record);
        counts.set(region, (counts.get(region) ?? 0) + 1);
      }
      const domainMarker = element('span', 'influence-domain-marker');
      domainMarker.setAttribute('aria-hidden', 'true');
      for (const [region, count] of counts) {
        const segment = element('i');
        if (region) segment.dataset.section = region;
        segment.style.flexGrow = count;
        domainMarker.append(segment);
      }
      domainButton.append(domainMarker, element('span', 'influence-domain-name', context), element('b', 'influence-domain-count', matching.length));
      domainButtons.set(context, domainButton);
      domainList.append(domainButton);
    }
    setOptions(mechanismSelect, 'All Mechanisms', data.mechanisms.map(value => ({ value: value.id, label: value.label })));
    setOptions(domainSelect, 'All Contexts', domains.map(value => ({ value, label: value })));
  }

  function renderResults() {
    if (!data) return;
    const search = normalized(query);
    const terms = search.split(' ').filter(Boolean);
    const matching = data.nodes.filter(record => (!mechanism || record.mechanismId === mechanism)
      && (!domain || record.domain === domain)
      && terms.every(term => normalized([
        record.code, record.title, record.domain, record.publicAction, record.participationAccess,
        record.influenceTarget, record.convener, record.decisionAuthority, record.rightsLimitations,
        data.mechanisms.find(category => category.id === record.mechanismId)?.label,
      ].join(' ')).includes(term)));
    for (const [id, categoryButton] of mechanismButtons) categoryButton.setAttribute('aria-pressed', String(id === mechanism));
    for (const [context, domainButton] of domainButtons) domainButton.setAttribute('aria-pressed', String(context === domain));
    mechanismSelect.value = mechanism;
    domainSelect.value = domain;
    const currentMechanism = data.mechanisms.find(category => category.id === mechanism);
    mechanismNote.replaceChildren();
    mechanismNote.append(element('p', '', currentMechanism?.interpretation ?? 'These are ways to participate, with different access requirements and decision-making roles.'));
    if (mechanism === 'formal') {
      const tiers = element('details', 'influence-participation-tiers');
      tiers.append(element('summary', '', 'Three Distinct Participation Statuses'));
      const tierList = element('ul');
      for (const label of ['Public Comment', 'Limited Participation', 'Intervenor Status']) tierList.append(element('li', '', label));
      tiers.append(tierList, element('p', '', 'Public comment open; enhanced status requires application/admission'));
      const formalRecord = data.nodes.find(record => record.mechanismId === 'formal');
      if (formalRecord) tiers.append(button('influence-inline-button', `Read ${formalRecord.code} Access And Rights`, () => choose(formalRecord)));
      mechanismNote.append(tiers);
    }
    resultsCount.textContent = `${matching.length} Of ${data.summary.annotatedNodeCount} Nodes`;
    const summaryParts = [currentMechanism?.label, domain, query.trim() ? `“${query.trim()}”` : ''].filter(Boolean);
    activeFilters.textContent = summaryParts.length ? summaryParts.join(' · ') : 'All annotated nodes · Select a card to read the full details.';
    clearFilters.hidden = summaryParts.length === 0;
    // Keep the supplementary cards registered while replacing filtered main cards.
    for (let index = cardButtons.length - 1; index >= 0; index--) {
      if (!cardButtons[index].supplementary) cardButtons.splice(index, 1);
    }
    list.replaceChildren(...matching.map(record => createCard(record)));
    empty.hidden = matching.length !== 0;
    updateSelection();
    onFilterChange({ mechanism, domain, query, count: matching.length, total: data.summary.annotatedNodeCount });
  }

  return {
    load(nextData) {
      data = nextData;
      mechanism = '';
      domain = '';
      query = '';
      selectedCode = '';
      selectedSupplementary = false;
      searchInput.value = '';
      cardButtons.length = 0;
      statistics.replaceChildren();
      addStatistic(data.summary.annotatedNodeCount, 'Annotated Nodes');
      addStatistic(data.mechanisms.length, 'Mechanisms');
      addStatistic(data.summary.supplementaryMechanismCount, 'Supplementary');
      caveat.textContent = sourceText(data.summary.caveat) || sourceText(data.summary.interpretation);
      renderCharts();
      supplementaryList.replaceChildren(...data.supplementary.map(record => createCard(record, true)));
      renderResults();
      container.dataset.loaded = 'true';
    },
    focusSearch() {
      searchInput.focus();
      searchInput.select();
    },
    select(code, { supplementary } = {}) {
      selectedCode = String(code ?? '');
      selectedSupplementary = supplementary ?? (!data?.nodes.some(record => record.code === selectedCode)
        && Boolean(data?.supplementary.some(record => record.code === selectedCode)));
      updateSelection();
    },
    clearSelection() {
      selectedCode = '';
      selectedSupplementary = false;
      updateSelection();
    },
  };
}

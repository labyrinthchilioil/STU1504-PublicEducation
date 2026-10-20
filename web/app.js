import { createGraph, appendSafeHtml } from './graph.js';
import { createRegionMap } from './regions.js';
import { createLandscapeModel, THEMES, MODEL_RULES } from './landscape-model.js';
import { createLandscape } from './landscape.js';
import { createLandscapeTransition } from './landscape-transition.js';
import { createSpiderSearch } from './spider-search.js';
import { createSpiderCompanion } from './spider-companion.js';
import { clearSpiderHighlights, highlightSpiderText } from './spider-highlights.js';
import { formatNodeTitle } from './node-label.js';
import { withNodeCodes } from './node-codes.js';
import { INSPECTOR_SECTION_ORDER, cleanInspectorBlock, inspectorBlockSignature } from './inspector-content.js';

const $ = (id) => document.getElementById(id);
let data, graph, nodeMap, edgeMap, searchType = 'nodes', selectedNode = null, selectedConnection = null;
let lastTrigger = null, labelsVisible = true;
let currentRegion = 'all', layoutMode = false;
let currentView = 'diagram', landscape, landscapeModel, selectedTopics = [];
let publicInfluenceEnabled = false, publicInfluenceIds = [];
let overviewTransition = null;
let spiderSearch, spiderCompanion, spiderResult = null, spiderTimer, spiderReadyTimer;
let spiderComposing = false;
let spiderResultsOpen = false;
const activeGraph = () => currentView === 'landscape' ? landscape : graph;
let regionMap = new Map();
const regionForItem = item => regionMap.get(String(item.node_id || item.item_id));
const viewNames = { all:'Overview', land:'Land Use', grid:'Grid', environment:'Environment', operation:'Operation' };
const regions = {
  land: { x: 22, y: 1014, width: 4120, height: 6030 },
  grid: { x: 4360, y: 1020, width: 4120, height: 6030 },
  environment: { x: 8684, y: 1020, width: 6136, height: 6030 },
  operation: { x: 5200, y: 7050, width: 5500, height: 3000 },
};

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}
function announce(text) { $('live-status').textContent = text; }
function updatePublicInfluence() {
  graph?.setPublicInfluence(publicInfluenceEnabled && currentView === 'diagram' ? publicInfluenceIds : null);
  $('public-influence-tools').hidden = currentView !== 'diagram' || layoutMode;
  $('public-influence-toggle').setAttribute('aria-pressed', String(publicInfluenceEnabled));
  $('public-influence-count').textContent = publicInfluenceIds.length;
  $('public-influence-toggle').title = `${publicInfluenceEnabled ? 'Clear highlights for' : 'Highlight'} ${publicInfluenceIds.length} Public Influence nodes marked red in the database`;
  $('public-influence-toggle').setAttribute('aria-label', `Public Influence: ${publicInfluenceIds.length} nodes marked red in the database`);
}
function clearPublicInfluence() {
  if (!publicInfluenceEnabled) return;
  publicInfluenceEnabled = false;
  updatePublicInfluence();
  viewContext();
}
function togglePublicInfluence() {
  if (!graph || currentView !== 'diagram' || overviewTransition) return;
  if (!publicInfluenceEnabled) {
    if (layoutMode) setLayoutEditing(false);
    if (!$('index-panel').hidden) toggleIndex(false);
    clearSpiderQuery();
    closeInspector({ restoreFocus: false });
  }
  publicInfluenceEnabled = !publicInfluenceEnabled;
  updatePublicInfluence();
  viewContext();
  $('public-influence-toggle').focus({ preventScroll: true });
  announce(publicInfluenceEnabled
    ? `${publicInfluenceIds.length} Public Influence nodes highlighted. These nodes are marked red in the original database.`
    : 'Public Influence highlights cleared.');
}
function updateSpiderTether() {
  const anchor = currentView === 'landscape' && spiderResult?.total && !overviewTransition ? landscape?.getSpiderAnchor() : null;
  $('spider-tether').toggleAttribute('hidden', !anchor);
  if (!anchor) return;
  const main = $('main').getBoundingClientRect();
  const svg = $('landscape-diagram').getBoundingClientRect();
  const pet = $('spider-pet').getBoundingClientRect();
  const x = pet.left + pet.width / 2 - main.left;
  const y = pet.top + pet.height * .4 - main.top;
  const tx = svg.left + anchor.x - main.left, ty = svg.top + anchor.y - main.top;
  $('spider-tether').setAttribute('viewBox', `0 0 ${main.width} ${main.height}`);
  $('spider-tether').querySelector('path').setAttribute('d', `M${x},${y} C${x},${y - 70} ${tx - 45},${ty + 70} ${tx},${ty}`);
}
function highlightSpiderInspector() {
  const match = spiderResult?.matches.find(item => item.id === selectedNode);
  for (const block of $('inspector-content').querySelectorAll('h1,.source-block')) {
    highlightSpiderText(block, match?.terms);
  }
}
function renderSpiderResults() {
  const result = spiderResult;
  const box = $('spider-results');
  box.replaceChildren();
  box.hidden = !result?.total || !spiderResultsOpen;
  $('spider-results-toggle').hidden = !result?.total;
  $('spider-results-toggle').setAttribute('aria-expanded', String(!box.hidden));
  $('spider-results-toggle').textContent = box.hidden ? 'View notes' : 'Hide notes';
  for (const match of result?.matches.slice(0, 3) || []) {
    const button = element('button', 'spider-result');
    button.type = 'button';
    button.dataset.nodeId = match.id;
    button.title = match.reason;
    const title = element('span', 'spider-result-title', formatNodeTitle(match.node.node_text));
    const snippet = element('span', 'spider-result-snippet', match.snippet);
    button.append(title, snippet);
    highlightSpiderText(title, match.terms);
    highlightSpiderText(snippet, match.terms);
    button.addEventListener('click', () => {
      spiderResultsOpen = false;
      renderSpiderResults();
      openNode(match.node, { focus: true, keyboard: true });
    });
    box.append(button);
  }
  $('spider-clear').hidden = !$('spider-input').value;
  const status = $('spider-status');
  if (!result?.active) status.textContent = 'Try “hearing” or “water”.';
  else if (!result.total) status.textContent = 'No matches. Try another idea.';
  else status.textContent = currentView === 'landscape'
    ? `${result.total} nodes gathered`
    : `${result.total} nodes highlighted`;
  if (result?.total && result.matchedConceptCount < result.conceptCount) {
    status.textContent += ` · ${result.matchedConceptCount}/${result.conceptCount} ideas`;
  }
  status.title = status.textContent;
}
function applySpiderResult({ focus = false } = {}) {
  if (!graph || !spiderCompanion) return;
  clearTimeout(spiderReadyTimer);
  const ids = spiderResult?.active ? spiderResult.matches.map(match => match.id) : null;
  graph.setSpiderMatches(ids);
  clearSpiderHighlights($('diagram'));
  for (const match of spiderResult?.matches || []) {
    const text = $('diagram').querySelector(`.graph-node[data-id="${CSS.escape(match.id)}"] .graph-rich-text`);
    if (text) highlightSpiderText(text, match.terms);
  }
  highlightSpiderInspector();
  spiderCompanion.setMode(currentView);
  renderSpiderResults();
  if (currentView === 'landscape') {
    landscape.setSpiderQuery(ids, { label: spiderResult?.query || '' });
  } else {
    const hasMatches = Boolean(spiderResult?.total);
    spiderCompanion.setState(ids === null ? 'idle' : hasMatches ? 'highlighting' : 'empty');
    if (hasMatches) spiderReadyTimer = setTimeout(() => spiderCompanion.setState('ready'), 900);
    if (focus && hasMatches) requestAnimationFrame(() => {
      if (currentView === 'diagram' && spiderResult?.active) { graph.resize(); graph.focusNodes(ids); }
    });
  }
  updateSpiderTether();
}
function clearSpiderQuery({ focus = false } = {}) {
  clearTimeout(spiderTimer); clearTimeout(spiderReadyTimer);
  $('spider-input').value = '';
  spiderResult = null;
  spiderResultsOpen = false;
  graph?.setSpiderMatches(null);
  landscape?.setSpiderQuery(null);
  clearSpiderHighlights($('diagram'));
  clearSpiderHighlights($('inspector-content'));
  spiderCompanion?.setState('idle');
  renderSpiderResults();
  updateSpiderTether();
  if (focus) $('spider-input').focus({ preventScroll: true });
}
function submitSpiderQuery() {
  clearTimeout(spiderTimer);
  if (!spiderSearch || spiderComposing || overviewTransition) return;
  clearPublicInfluence();
  if (layoutMode) setLayoutEditing(false);
  if (!$('index-panel').hidden) toggleIndex(false);
  closeInspector({ restoreFocus: false });
  spiderResult = spiderSearch.search($('spider-input').value);
  spiderResultsOpen = false;
  applySpiderResult({ focus: true });
}
function setTheme(theme) {
  cancelOverviewTransition();
  const selected = theme === 'night' ? 'night' : 'paper';
  document.documentElement.dataset.theme = selected;
  for (const name of ['paper','night']) $('theme-'+name).setAttribute('aria-pressed',String(name === selected));
  document.querySelector('meta[name="theme-color"]').content = selected === 'night' ? '#1c1c1e' : '#f5f5f7';
  try { localStorage.setItem('frame12-theme',selected); } catch { /* Theme remains usable without storage. */ }
}
function viewContext(selection = null) {
  $('view-name').textContent = currentView === 'landscape' ? 'Network Lenses' : viewNames[currentRegion];
  const publicCount = publicInfluenceIds.filter(id => currentRegion === 'all' || regionMap.get(id) === currentRegion).length;
  const publicSummary = currentRegion === 'all' ? `${publicCount} Public Influence nodes` : `${publicCount} in this section · ${publicInfluenceIds.length} Public Influence nodes`;
  $('selection-summary').textContent = selection || (currentView === 'landscape' ? `${data?.nodes.length || 128} nodes · ${selectedTopics.length ? `${selectedTopics.length} active lenses` : 'Free network'}` : publicInfluenceEnabled ? publicSummary : 'All nodes');
}
function sourceLink(url, label = 'View original item in Miro ↗') {
  const a = element('a', 'source-item-link', label);
  if (/^https?:\/\//i.test(url || '')) a.href = url;
  a.target = '_blank'; a.rel = 'noopener noreferrer';
  return a;
}
function setHash(kind, id) {
  const params = new URLSearchParams();
  if (currentView === 'landscape') {
    params.set('view', 'landscape');
    if (selectedTopics.length) params.set('topics', selectedTopics.join(','));
  }
  if (id) params.set(kind, id);
  const value = params.size ? `#${params}` : location.pathname + location.search;
  history.replaceState(null, '', value);
}
function panelHeader(type, title, region) {
  const content = $('inspector-content'); content.replaceChildren();
  content.append(element('span', 'eyebrow', type), element('h1', '', title));
  $('inspector').hidden = false;
  if (region) $('inspector').dataset.section = region;
  else delete $('inspector').dataset.section;
  $('canvas-caption').hidden = true;
  $('inspector-content').scrollTop = 0;
  return content;
}
function section(title, blocks) {
  const section = element('section', 'detail-section');
  section.append(element('h2', '', title));
  let previousSignature = null;
  let count = 0;
  for (const block of blocks) {
    const content = element('div', 'source-block');
    content.dataset.blockId = block.block_id;
    appendSafeHtml(content, block.render_html || block.text || '');
    if (!cleanInspectorBlock(content, title)) continue;
    const signature = inspectorBlockSignature(content);
    if (signature === previousSignature) continue;
    previousSignature = signature;
    section.append(content);
    count++;
  }
  return count ? section : null;
}
function openNode(node, { focus = false, keyboard = false } = {}) {
  if (layoutMode) setLayoutEditing(false);
  lastTrigger = document.activeElement;
  selectedNode = node.node_id; selectedConnection = null;
  const content = panelHeader('Node', formatNodeTitle(node.node_text), regionForItem(node));
  let count = 0;
  for (const name of INSPECTOR_SECTION_ORDER) {
    const blocks = node.sections[name] || [];
    const detail = section(name, blocks);
    if (detail) { content.append(detail); count++; }
  }
  if (!count) content.append(element('p', 'no-note', 'No grouped note is present in the source.'));
  if (currentView === 'landscape') appendAffinities(content, node.node_id);
  const connections = data.connections.filter(c => c.start_node_id === node.node_id || c.end_node_id === node.node_id);
  viewContext(`${node.display_code || 'Selected node'} · ${connections.length} connection${connections.length === 1 ? '' : 's'}`);
  if (connections.length) {
    const related = element('details', 'connection-list');
    related.append(element('summary', '', `Connections (${connections.length})`));
    for (const edge of connections) {
      const outgoing = edge.start_node_id === node.node_id;
      const target = nodeMap.get(outgoing ? edge.end_node_id : edge.start_node_id);
      const button = element('button', 'related-link');
      button.append(element('span', '', outgoing ? 'OUTGOING →' : '← INCOMING'), document.createTextNode(formatNodeTitle(target.node_text)));
      if (edge.label_text) button.append(element('span', '', edge.label_text));
      button.addEventListener('click', () => openConnection(edge)); related.append(button);
    }
    content.append(related);
  }
  content.append(sourceLink(node.source_url));
  highlightSpiderInspector();
  activeGraph().setSelection(node.node_id, null); setHash('node', node.node_id);
  if (focus) requestAnimationFrame(() => { activeGraph().resize(); activeGraph().focusNode(node.node_id); });
  if (keyboard) $('close-inspector').focus({ preventScroll: true });
  announce(`Selected ${formatNodeTitle(node.node_text)}`);
}
function openConnection(edge, { focus = false, keyboard = false } = {}) {
  if (layoutMode) setLayoutEditing(false);
  lastTrigger = document.activeElement;
  selectedNode = null; selectedConnection = edge.connection_id;
  viewContext(`${edge.start_code || 'SOURCE'} → ${edge.end_code || 'DESTINATION'}`);
  const content = panelHeader('Connection', edge.label_text || 'Unlabeled connection');
  for (const [label, id] of [['From', edge.start_node_id], ['To', edge.end_node_id]]) {
    const node = nodeMap.get(id);
    content.append(element('div', 'endpoint-label', label));
    const button = element('button', 'endpoint-link', formatNodeTitle(node.node_text));
    if (regionForItem(node)) button.dataset.section = regionForItem(node);
    button.dataset.nodeId = id;
    button.addEventListener('click', () => openNode(node, { focus: true })); content.append(button);
  }
  content.append(sourceLink(edge.source_url));
  activeGraph().setSelection(null, edge.connection_id); setHash('connection', edge.connection_id);
  if (focus) {
    requestAnimationFrame(() => { activeGraph().resize(); activeGraph().focusConnection(edge.connection_id); });
  }
  if (keyboard) $('close-inspector').focus({ preventScroll: true });
  announce(`Selected connection from ${nodeMap.get(edge.start_node_id).display_code || 'source node'} to ${nodeMap.get(edge.end_node_id).display_code || 'destination node'}`);
}
function openNote(note) {
  if (layoutMode) setLayoutEditing(false);
  lastTrigger = document.activeElement; selectedNode = null; selectedConnection = null;
  viewContext('Source note');
  const content = panelHeader('Standalone source note', 'Canvas note', regionForItem(note));
  const prose = element('div', 'source-note-content'); appendSafeHtml(prose, note.source_html || note.text); content.append(prose, sourceLink(note.source_url));
  graph.setSelection(null, null); setHash('note', note.item_id);
}
function closeInspector({ restoreFocus = true } = {}) {
  $('inspector').hidden = true; $('canvas-caption').hidden = false;
  selectedNode = null; selectedConnection = null; activeGraph()?.setSelection(null,null); setHash('',null);
  viewContext();
  if (restoreFocus && lastTrigger?.isConnected && lastTrigger !== document.body && !lastTrigger.closest('[hidden]')) lastTrigger.focus({ preventScroll:true });
}
function toggleIndex(open = $('index-panel').hidden) {
  if (overviewTransition) cancelOverviewTransition();
  if (open) clearPublicInfluence();
  $('index-panel').hidden = !open; $('index-button').setAttribute('aria-expanded', String(open));
  if (open) { clearSpiderQuery(); renderSearch(); $('search-input').focus({preventScroll:true}); }
  else { activeGraph()?.setQuery(null); $('index-button').focus({preventScroll:true}); }
}
function renderSearch() {
  if (!data) return;
  const q = $('search-input').value.trim().toLocaleLowerCase();
  const rows = searchType === 'nodes' ? data.nodes : data.connections;
  const found = rows.filter(row => {
    if (!q) return true;
    const text = searchType === 'nodes' ? [row.node_id, row.display_code, row.node_text, row.Description, row.Evidence, row['Time Scope'], row['Public Influence']].join(' ') : [row.connection_id,row.label_text,row.start_node_id,row.end_node_id,nodeMap.get(row.start_node_id)?.node_text,nodeMap.get(row.end_node_id)?.node_text].join(' ');
    return text.toLocaleLowerCase().includes(q);
  });
  const box = $('search-results'); box.replaceChildren();
  $('result-count').textContent = `${found.length} ${searchType === 'nodes' ? 'nodes' : 'connections'}${q ? ' found' : ' in Frame 12'}`;
  if (!found.length) box.append(element('p', 'empty-results', 'No matching items. Try a node code, label or source ID.'));
  for (const row of found) {
    const button = element('button','result-button');
    const code = element('span','result-code');
    if (searchType === 'nodes') {
      if (regionForItem(row)) button.dataset.section = regionForItem(row);
      const chip = element('span','color-chip'); code.append(chip,document.createTextNode(row.display_code || 'NODE'));
      button.dataset.nodeId = row.node_id;
      button.append(code,element('span','result-title',formatNodeTitle(row.node_text)));
      button.addEventListener('click', () => { toggleIndex(false); openNode(row,{focus:true,keyboard:true}); });
    } else {
      const a = nodeMap.get(row.start_node_id), b = nodeMap.get(row.end_node_id);
      code.textContent = `${a.display_code || 'NODE'} → ${b.display_code || 'NODE'}`;
      button.dataset.connectionId = row.connection_id;
      button.append(code,element('span','result-title',row.label_text || `${formatNodeTitle(a.node_text)} → ${formatNodeTitle(b.node_text)}`));
      button.addEventListener('click', () => { toggleIndex(false); openConnection(row,{focus:true,keyboard:true}); });
    }
    box.append(button);
  }
  activeGraph()?.setQuery(q ? (searchType === 'nodes' ? found.map(n=>n.node_id) : [...new Set(found.flatMap(c=>[c.start_node_id,c.end_node_id]))]) : null);
}
function selectSearchTab(type) {
  searchType = type;
  for (const tab of ['nodes','connections']) $(tab+'-tab').setAttribute('aria-selected',String(type===tab));
  $('search-results').setAttribute('aria-labelledby',type+'-tab'); renderSearch();
}
function showSource() { cancelOverviewTransition(); $('source-dialog').showModal(); }
function closeSource() { $('source-dialog').close(); }
function focusRegion(key) {
  if (!graph) return;
  setView('diagram');
  currentRegion = key;
  closeInspector(); if (!$('index-panel').hidden) toggleIndex(false);
  graph.setActiveRegion(key);
  document.querySelectorAll('[data-region]').forEach(b=>{const active=b.dataset.region===key;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');});
  requestAnimationFrame(() => { graph.resize(); if (key==='all') graph.fit(); else graph.focusRegion(key,regions[key]); });
}
function setLayoutEditing(enabled) {
  if (currentView !== 'diagram' || !graph || $('diagram').getAttribute('aria-busy') === 'true') return;
  if (enabled) {
    clearPublicInfluence();
    clearSpiderQuery();
    closeInspector();
    if (!$('index-panel').hidden) toggleIndex(false);
  }
  graph.setEditing(enabled);
  $('diagram').focus({preventScroll:true});
}
function updateLayoutControls(state) {
  layoutMode = state.editing;
  $('public-influence-tools').hidden = currentView !== 'diagram' || state.editing;
  $('spider-dock').inert = state.editing;
  $('edit-layout').setAttribute('aria-pressed', String(state.editing));
  $('edit-layout').setAttribute('aria-label', state.editing ? 'Finish editing layout' : 'Edit diagram layout');
  $('edit-layout').title = state.editing ? 'Finish Editing Layout' : 'Edit Layout';
  $('edit-layout').querySelector('path').setAttribute('d', state.editing ? 'm5 12 4 4L19 6' : 'm15 5 4 4M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15Zm0 0 4-1');
  $('edit-layout').querySelector('.button-label').textContent = state.editing ? 'Done' : 'Edit Layout';
  $('edit-layout').disabled = state.busy;
  $('layout-tools').hidden = !state.editing;
  $('layout-undo').disabled = state.busy || !state.canUndo;
  $('layout-redo').disabled = state.busy || !state.canRedo;
  $('layout-reset').disabled = state.busy || !state.dirty;
  $('layout-status').textContent = state.message || (state.dirty ? (state.storageAvailable ? 'Saved on this device' : 'Changes kept for this session') : 'Drag nodes or lines · Snap to grid');
  $('canvas-caption').querySelector('p').textContent = state.editing ? 'Drag to arrange. Hold Space to pan. Undo with Ctrl / ⌘ Z.' : 'Select a node to read its original notes.';
  document.querySelector('.map-footer > span').textContent = state.dirty ? (state.storageAvailable ? 'Custom layout · Saved locally' : 'Custom layout · This session') : 'Original source layout';
}
function setView(view, { fromTransition = false } = {}) {
  if (!fromTransition) cancelOverviewTransition();
  if (!graph || view === currentView) return;
  if (layoutMode) setLayoutEditing(false);
  closeInspector();
  if (!$('index-panel').hidden) toggleIndex(false);
  graph.setSelection(null, null);
  currentView = view;
  spiderResultsOpen = false;
  const isLandscape = view === 'landscape';
  $('main').dataset.view = view;
  $('diagram-wrap').hidden = isLandscape;
  $('landscape-panel').hidden = !isLandscape;
  $('edit-layout').hidden = isLandscape;
  $('overview-discover').hidden = isLandscape;
  $('landscape-reset').hidden = !isLandscape;
  $('landscape-overview').hidden = !isLandscape;
  $('routing-note').hidden = isLandscape;
  $('labels-toggle').setAttribute('aria-label', isLandscape ? 'Show node labels' : 'Show connection labels');
  $('labels-toggle').title = isLandscape ? 'Node Labels' : 'Connection Labels';
  document.querySelector('.skip-link').href = isLandscape ? '#landscape-diagram' : '#diagram';
  if (isLandscape && !landscape) initializeLandscape();
  graph.setActive(!isLandscape);
  landscape?.setActive(isLandscape);
  activeGraph().setLabelsVisible(labelsVisible);
  document.querySelectorAll('[data-region]').forEach(button => {
    const active = !isLandscape && button.dataset.region === currentRegion;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
  });
  $('landscape-button').classList.toggle('active', isLandscape);
  if (isLandscape) $('landscape-button').setAttribute('aria-current', 'true');
  else $('landscape-button').removeAttribute('aria-current');
  updateViewFooter();
  viewContext();
  setHash('', null);
  applySpiderResult();
  updatePublicInfluence();
  requestAnimationFrame(() => { activeGraph().resize(); updateSpiderTether(); });
}
function initializeLandscape() {
  landscapeModel = createLandscapeModel(data, { regionMap });
  $('landscape-theme-method').textContent = `${MODEL_RULES.themeFormula}. ${MODEL_RULES.themeExplanation} Node names and titles are not scored.`;
  $('landscape-edge-method').textContent = `T is cosine similarity between the eight theme scores; N is the Jaccard overlap of original neighbors; S is 1 for the same known original area, otherwise 0. ${MODEL_RULES.inferenceSelection}`;
  $('landscape-cluster-method').textContent = MODEL_RULES.clusterExplanation;
  for (const theme of THEMES) {
    const count = landscapeModel.nodes.filter(n => n.themes[theme.id] >= MODEL_RULES.clusterThreshold).length;
    const button = element('button', 'landscape-topic');
    button.dataset.topic = theme.id;
    button.style.setProperty('--topic-color', theme.color);
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', `${theme.label}: ${count} matching nodes`);
    button.title = theme.description;
    button.append(document.createTextNode(theme.label), element('span', 'landscape-topic-count', count));
    button.addEventListener('click', () => {
      const topics = selectedTopics.includes(theme.id) ? selectedTopics.filter(id => id !== theme.id) : [...selectedTopics, theme.id];
      setTopics(topics);
    });
    $('landscape-topics').append(button);
  }
  landscape = createLandscape($('landscape-diagram'), landscapeModel, {
    onSelectNode: node => openNode(node),
    onSelectConnection: edge => openConnection(edge),
    onSelectInferred: openInferred,
    onViewChange: view => { if (currentView === 'landscape') $('zoom-level').value = `${Math.round(view.scale * 100)}%`; updateSpiderTether(); },
    onSpiderState: state => {
      if (currentView !== 'landscape') return;
      spiderCompanion?.setState(!spiderResult?.active ? 'idle' : !state.count ? 'empty' : state.phase);
      updateSpiderTether();
    },
  });
  new ResizeObserver(() => { if (currentView === 'landscape') landscape.resize(); }).observe($('landscape-stage'));
}
function updateViewFooter() {
  if (currentView === 'landscape') {
    const inferred = $('landscape-inferred').checked ? landscapeModel.inferredEdges.length : 0;
    document.querySelector('.map-footer > span').textContent = `${data.connections.length} source connections · ${inferred} related links · Drag to explore`;
  } else {
    document.querySelector('.map-footer > span').textContent = 'Source diagram · Local layout';
  }
}
function setTopics(topics, updateHash = true) {
  cancelOverviewTransition();
  clearSpiderQuery();
  selectedTopics = THEMES.filter(t => topics.includes(t.id)).map(t => t.id);
  landscape.setTopics(selectedTopics);
  document.querySelectorAll('[data-topic]').forEach(button => button.setAttribute('aria-pressed', String(selectedTopics.includes(button.dataset.topic))));
  const matched = landscapeModel.nodes.filter(node => selectedTopics.some(id => node.themes[id] >= MODEL_RULES.clusterThreshold)).length;
  $('landscape-status').textContent = selectedTopics.length
    ? `${selectedTopics.length} ${selectedTopics.length === 1 ? 'lens' : 'lenses'} · ${matched} matching nodes · ${data.nodes.length - matched} in context`
    : 'Free network · Select one or more lenses';
  viewContext();
  if (updateHash) setHash(selectedNode ? 'node' : selectedConnection?.startsWith('inferred:') ? 'related' : 'connection', selectedNode || selectedConnection);
}
function appendAffinities(content, nodeId) {
  const node = landscapeModel.nodeById.get(nodeId);
  const block = element('section', 'landscape-affinities');
  block.append(element('h2', '', 'Topic affinities'), element('p', '', 'Explore each score to see its source evidence. These scores describe relevance, not influence or certainty.'));
  for (const theme of [...THEMES].sort((a, b) => node.themes[b.id] - node.themes[a.id])) {
    const score = node.themes[theme.id];
    if (!score) continue;
    const row = element('details', 'affinity-row');
    row.style.setProperty('--topic-color', theme.color);
    const summary = element('summary');
    const track = element('span', 'affinity-track'), fill = element('span', 'affinity-fill');
    fill.style.width = `${score * 100}%`; track.append(fill);
    summary.append(element('span', 'affinity-label', theme.label), track, element('span', 'affinity-number', Math.round(score * 100) + '%'));
    const list = element('ul');
    for (const evidence of node.themeEvidence[theme.id] || []) {
      const text = evidence.kind === 'region'
        ? `Original display area: ${node.region}.`
        : `${evidence.section || 'Source note'}${evidence.matched ? ` · ${Array.isArray(evidence.matched) ? evidence.matched.join(', ') : evidence.matched}` : ''}${evidence.excerpt ? ` — ${evidence.excerpt}` : ''}`;
      list.append(element('li', '', text));
    }
    row.append(summary, list); block.append(row);
  }
  if (!THEMES.some(t => node.themes[t.id] > 0)) block.append(element('p', '', 'No theme evidence is available in this node’s source notes or original area. It stays in context.'));
  content.append(block);
}
function openInferred(edge) {
  lastTrigger = document.activeElement;
  selectedNode = null; selectedConnection = edge.id;
  const content = panelHeader('Related by model', 'A shared context');
  content.append(element('p', 'source-warning', 'This dashed link is calculated for exploration. It is not a recorded source connection.'));
  for (const id of [edge.source, edge.target]) {
    const node = nodeMap.get(id);
    const button = element('button', 'endpoint-link', formatNodeTitle(node.node_text));
    button.addEventListener('click', () => openNode(node, { focus: true }));
    content.append(button);
  }
  content.append(element('p', 'landscape-formula', `Relatedness ${Math.round(edge.weight * 100)}%`));
  const details = element('dl', 'connection-meta');
  const components = edge.components;
  for (const [label, value] of [['Theme similarity', components.cosine], ['Shared neighbors', components.jaccard], ['Same area', components.sameRegion]]) {
    details.append(element('dt', '', label), element('dd', '', `${Math.round(value * 100)}%`));
  }
  content.append(details, element('p', 'source-warning', 'R = 0.60 × theme similarity + 0.30 × shared neighbors + 0.10 × same original area.'));
  landscape.setSelection(null, edge.id);
  setHash('related', edge.id);
  viewContext('Suggested similarity');
  announce('Selected a model-derived related link.');
}
function beginOverviewTransition(targetView) {
  const state = { controller: new AbortController(), animation: null, revealed: false, targetView };
  overviewTransition = state;
  $('main').classList.add('is-untangling');
  $('main').setAttribute('aria-busy', 'true');
  for (const id of ['landscape-overview', 'overview-discover']) {
    $(id).disabled = true;
    $(id).setAttribute('aria-busy', 'true');
  }
  const destination = targetView === 'landscape' ? 'Discover' : 'Overview';
  $('overview-transition-message').textContent = `Preparing ${destination.toLowerCase()}…`;
  $('cancel-overview-transition').setAttribute('aria-label', `Cancel transition to ${destination}`);
  $('overview-transition-status').hidden = false;
  $('landscape-panel').inert = true;
  $('diagram-wrap').inert = true;
  document.querySelector('.toolbar-actions').inert = true;
  document.querySelector('.map-controls').inert = true;
  $('spider-dock').inert = true;
  $('public-influence-tools').inert = true;
  updateSpiderTether();
  return state;
}
function finishOverviewTransition(state) {
  if (overviewTransition !== state) return;
  overviewTransition = null;
  state.controller.abort();
  state.animation?.cancel();
  $('overview-transition-stage').hidden = true;
  $('overview-transition-status').hidden = true;
  $('main').classList.remove('is-untangling');
  $('main').removeAttribute('aria-busy');
  delete $('main').dataset.transition;
  $('landscape-diagram').style.visibility = '';
  $('landscape-diagram').style.opacity = '';
  $('diagram-wrap').style.visibility = '';
  $('diagram-wrap').style.opacity = '';
  $('diagram-wrap').hidden = currentView !== 'diagram';
  $('landscape-panel').hidden = currentView !== 'landscape';
  $('landscape-panel').inert = false;
  $('diagram-wrap').inert = false;
  document.querySelector('.toolbar-actions').inert = false;
  document.querySelector('.map-controls').inert = false;
  $('spider-dock').inert = false;
  $('public-influence-tools').inert = false;
  for (const id of ['landscape-overview', 'overview-discover']) {
    $(id).disabled = false;
    $(id).removeAttribute('aria-busy');
  }
  graph?.setActiveRegion(currentRegion);
  graph?.setActive(currentView === 'diagram');
  landscape?.setActive(currentView === 'landscape');
  updateSpiderTether();
  viewContext();
}
function cancelOverviewTransition() {
  const state = overviewTransition;
  if (!state) return;
  finishOverviewTransition(state);
  if (currentView === 'landscape') {
    $('landscape-overview').focus({ preventScroll: true });
    announce('Transition canceled. The landscape is ready to explore.');
  } else {
    $('overview-discover').focus({ preventScroll: true });
    announce('Transition canceled. Explore is ready.');
  }
}
async function untangleToOverview() {
  if (overviewTransition || currentView !== 'landscape' || !landscape) return;
  if ($('spider-input').value.trim() !== (spiderResult?.query || '')) submitSpiderQuery();
  clearTimeout(spiderTimer);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    focusRegion('all');
    document.querySelector('[data-region="all"]').focus({ preventScroll: true });
    announce('Overview ready.');
    return;
  }
  $('main').classList.add('is-untangling');
  closeInspector();
  if (!$('index-panel').hidden) toggleIndex(false);
  const state = beginOverviewTransition('diagram');
  landscape.setActive(false);
  try {
    // Finish any inspector resize before capturing the current network on screen.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (overviewTransition !== state) return;
    landscape.resize();
    $('overview-transition-stage').hidden = false;
    state.animation = createLandscapeTransition({
      container: $('overview-transition-stage'), landscapeSvg: $('landscape-diagram'),
    });
    $('landscape-diagram').style.visibility = 'hidden';
    // SVG descendants may explicitly set visibility=visible; opacity hides the whole subtree.
    $('landscape-diagram').style.opacity = '0';
    $('main').classList.add('is-untangling');
    $('overview-transition-status').hidden = false;
    // Measure the real Overview, including any saved local layout, behind the animation.
    $('diagram-wrap').style.visibility = 'hidden';
    $('diagram-wrap').style.opacity = '0';
    $('diagram-wrap').hidden = false;
    graph.setSelection(null, null);
    graph.setQuery(null);
    graph.setActiveRegion('all');
    graph.setPublicInfluence(publicInfluenceEnabled ? publicInfluenceIds : null);
    graph.resize();
    graph.fit();
    const completed = await state.animation.playTo($('diagram'), {
      signal: state.controller.signal,
      onPhase(phase) {
        if (overviewTransition !== state) return;
        $('main').dataset.transition = phase;
        const messages = { gather: 'Untangling connections…', untangle: 'Finding the structure…', reveal: 'Opening overview…' };
        $('overview-transition-message').textContent = messages[phase] || 'Opening overview…';
        $('selection-summary').textContent = messages[phase] || 'Opening overview…';
        if (phase === 'reveal') {
          state.revealed = true;
          currentRegion = 'all';
          $('diagram-wrap').style.visibility = '';
          $('diagram-wrap').style.opacity = '';
          setView('diagram', { fromTransition: true });
          graph.resize();
          graph.fit();
        }
      },
    });
    if (overviewTransition !== state) return;
    finishOverviewTransition(state);
    if (completed && state.revealed) {
      document.querySelector('[data-region="all"]').focus({ preventScroll: true });
      announce('Overview ready. The network is arranged in its source layout.');
    }
  } catch (error) {
    if (overviewTransition === state) {
      finishOverviewTransition(state);
      announce('The transition could not finish. You can still open Overview from Explore.');
      console.error(error);
    }
  }
}
async function untangleToDiscover() {
  if (overviewTransition || currentView !== 'diagram' || !graph) return;
  if ($('spider-input').value.trim() !== (spiderResult?.query || '')) submitSpiderQuery();
  clearTimeout(spiderTimer);
  if (layoutMode) setLayoutEditing(false);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    setView('landscape');
    landscape.settle();
    $('landscape-button').focus({ preventScroll: true });
    announce('Discover ready.');
    return;
  }
  closeInspector({ restoreFocus: false });
  if (!$('index-panel').hidden) toggleIndex(false);
  const state = beginOverviewTransition('landscape');
  graph.setActive(false);
  try {
    // Close panels and finish pending camera updates before recording Explore.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (overviewTransition !== state) return;
    graph.resize();
    $('overview-transition-stage').hidden = false;
    state.animation = createLandscapeTransition({
      container: $('overview-transition-stage'), diagramSvg: $('diagram'),
    });
    $('diagram-wrap').style.visibility = 'hidden';
    $('diagram-wrap').style.opacity = '0';
    // Lay out Discover behind the snapshot, preserving its lenses and query.
    $('landscape-diagram').style.visibility = 'hidden';
    $('landscape-diagram').style.opacity = '0';
    $('landscape-panel').hidden = false;
    if (!landscape) initializeLandscape();
    landscape.setActive(false);
    landscape.setSelection(null, null);
    landscape.setQuery(null);
    landscape.setLabelsVisible(labelsVisible);
    landscape.resize();
    landscape.setSpiderQuery(spiderResult?.active ? spiderResult.matches.map(match => match.id) : null, {
      label: spiderResult?.query || '', immediate: true,
    });
    landscape.settle();
    const completed = await state.animation.playTo($('landscape-diagram'), {
      signal: state.controller.signal,
      onPhase(phase) {
        if (overviewTransition !== state) return;
        $('main').dataset.transition = phase;
        const messages = { gather: 'Releasing the structure…', untangle: 'Tracing connections…', reveal: 'Opening Discover…' };
        $('overview-transition-message').textContent = messages[phase];
        $('selection-summary').textContent = messages[phase];
        if (phase === 'reveal') {
          state.revealed = true;
          $('landscape-diagram').style.visibility = '';
          $('landscape-diagram').style.opacity = '';
          setView('landscape', { fromTransition: true });
          landscape.resize();
        }
      },
    });
    if (overviewTransition !== state) return;
    finishOverviewTransition(state);
    if (completed && state.revealed) {
      $('landscape-button').focus({ preventScroll: true });
      announce('Discover ready. Explore the connections in the network.');
    }
  } catch (error) {
    if (overviewTransition === state) {
      finishOverviewTransition(state);
      announce('The transition could not finish. Open Landscape from Discover to continue.');
      console.error(error);
    }
  }
}
function navigateHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  cancelOverviewTransition();
  closeInspector();
  setView(params.get('view') === 'landscape' ? 'landscape' : 'diagram');
  if (currentView === 'landscape') setTopics((params.get('topics') || '').split(',').filter(Boolean));
  if (nodeMap.has(params.get('node'))) openNode(nodeMap.get(params.get('node')),{focus:true});
  else if (edgeMap.has(params.get('connection'))) openConnection(edgeMap.get(params.get('connection')),{focus:true});
  else if (currentView === 'landscape' && params.has('related')) {
    const edge = landscapeModel.inferredEdges.find(e => e.id === params.get('related'));
    if (edge) openInferred(edge);
  } else if (params.has('note')) { const note = data.canvasItems.find(n=>n.item_id===params.get('note')&&['standalone_note','standalone_label'].includes(n.role)); if(note) { setView('diagram'); openNote(note); } }
}

$('index-button').addEventListener('click',()=>toggleIndex()); $('close-index').addEventListener('click',()=>toggleIndex(false));
$('spider-form').addEventListener('submit', event => { event.preventDefault(); submitSpiderQuery(); });
$('spider-clear').addEventListener('click', () => clearSpiderQuery({ focus: true }));
$('spider-results-toggle').addEventListener('click', () => {
  spiderResultsOpen = !spiderResultsOpen;
  renderSpiderResults();
});
$('spider-dock').addEventListener('keydown', event => {
  if (event.key === 'Escape' && spiderResultsOpen && !event.isComposing) {
    event.preventDefault();
    spiderResultsOpen = false;
    renderSpiderResults();
    $('spider-input').focus({ preventScroll: true });
  }
});
$('spider-input').addEventListener('keydown', event => {
  if (event.key === 'Escape' && !event.isComposing && !spiderResultsOpen) { event.preventDefault(); clearSpiderQuery({ focus: true }); }
});
function queueSpiderQuery() {
  clearTimeout(spiderTimer);
  clearTimeout(spiderReadyTimer);
  $('spider-clear').hidden = !$('spider-input').value;
  if (spiderComposing) return;
  if (!$('spider-input').value.trim()) { clearSpiderQuery(); return; }
  spiderCompanion?.setState('thinking');
  spiderTimer = setTimeout(submitSpiderQuery, 420);
}
$('spider-input').addEventListener('input', queueSpiderQuery);
$('spider-input').addEventListener('compositionstart', () => { spiderComposing = true; clearTimeout(spiderTimer); });
$('spider-input').addEventListener('compositionend', () => { spiderComposing = false; queueSpiderQuery(); });
$('theme-paper').addEventListener('click',()=>setTheme('paper'));
$('theme-night').addEventListener('click',()=>setTheme('night'));
setTheme(document.documentElement.dataset.theme);
$('search-input').addEventListener('input',renderSearch);
$('nodes-tab').addEventListener('click',()=>selectSearchTab('nodes')); $('connections-tab').addEventListener('click',()=>selectSearchTab('connections'));
document.querySelector('.index-tabs').addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const type=event.key==='Home'?'nodes':event.key==='End'?'connections':searchType==='nodes'?'connections':'nodes';selectSearchTab(type);$(type+'-tab').focus();}});
$('close-inspector').addEventListener('click',closeInspector);
$('source-button').addEventListener('click',showSource); $('routing-note').addEventListener('click',showSource); $('close-source').addEventListener('click',closeSource);
$('source-dialog').addEventListener('click',event=>{if(event.target===$('source-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom) closeSource();}});
$('zoom-in').addEventListener('click',()=>activeGraph()?.zoomBy(1.4)); $('zoom-out').addEventListener('click',()=>activeGraph()?.zoomBy(1/1.4));
$('fit-button').addEventListener('click',()=>currentView === 'landscape' ? landscape.fit() : focusRegion('all'));
$('labels-toggle').addEventListener('click',()=>{labelsVisible=!labelsVisible;$('labels-toggle').setAttribute('aria-pressed',String(labelsVisible));activeGraph()?.setLabelsVisible(labelsVisible);});
$('landscape-button').addEventListener('click', () => setView('landscape'));
$('landscape-overview').addEventListener('click', untangleToOverview);
$('overview-discover').addEventListener('click', untangleToDiscover);
$('public-influence-toggle').addEventListener('click', togglePublicInfluence);
$('cancel-overview-transition').addEventListener('click', cancelOverviewTransition);
$('landscape-reset').addEventListener('click', () => { closeInspector(); setTopics([]); landscape.fit(); });
$('landscape-inferred').addEventListener('change', () => {
  landscape.setInferredVisible($('landscape-inferred').checked);
  if (selectedConnection && landscapeModel.inferredEdges.some(e => e.id === selectedConnection)) closeInspector();
  updateViewFooter();
});
$('landscape-method').addEventListener('click', () => $('landscape-method-dialog').showModal());
$('close-landscape-method').addEventListener('click', () => $('landscape-method-dialog').close());
$('edit-layout').addEventListener('click',()=>setLayoutEditing(!layoutMode));
$('layout-undo').addEventListener('click',()=>graph?.undo());
$('layout-redo').addEventListener('click',()=>graph?.redo());
$('layout-reset').addEventListener('click',()=>graph?.resetLayout());
document.querySelectorAll('[data-region]').forEach(button=>{
  if (regions[button.dataset.region]) button.dataset.section = button.dataset.region;
  button.addEventListener('click',()=>focusRegion(button.dataset.region));
});
document.addEventListener('keydown',event=>{
  if (event.defaultPrevented) return;
  if (overviewTransition) {
    if (event.key === 'Escape') { event.preventDefault(); cancelOverviewTransition(); }
    else if (['+', '=', '-', '0', '/'].includes(event.key)) event.preventDefault();
    return;
  }
  if ($('source-dialog').open || $('landscape-method-dialog').open) return;
  const typing = event.target instanceof Element && event.target.matches('input,textarea,[contenteditable=true]');
  if (layoutMode && !typing && (event.ctrlKey || event.metaKey) && ['z','y'].includes(event.key.toLowerCase())) {
    event.preventDefault(); if (event.key.toLowerCase()==='y' || event.shiftKey) graph.redo(); else graph.undo(); return;
  }
  if (event.key==='Escape') { if (!$('index-panel').hidden) toggleIndex(false); else if (layoutMode && !graph.isDragging()) setLayoutEditing(false); else if (!$('inspector').hidden) closeInspector(); return; }
  if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key==='/') { event.preventDefault(); toggleIndex(true); }
  if (event.key==='+'||event.key==='=') { event.preventDefault(); activeGraph()?.zoomBy(1.4); }
  if (event.key==='-') { event.preventDefault(); activeGraph()?.zoomBy(1/1.4); }
  if (event.key==='0') { event.preventDefault(); currentView === 'landscape' ? landscape.fit() : focusRegion('all'); }
});
window.addEventListener('hashchange',()=>data&&navigateHash());
window.addEventListener('resize', cancelOverviewTransition);
window.addEventListener('pagehide', cancelOverviewTransition);

try {
  const response = await fetch('data/frame12.json');
  if (!response.ok) throw new Error(`Data request returned ${response.status}`);
  data = withNodeCodes(await response.json());
  // Use original workbook markings, not the current palette or inferred themes.
  publicInfluenceIds = data.nodes.filter(node =>
    String(node.fill_color).toLowerCase() === '#ffc6c6'
    && String(node.border_color).toLowerCase() === '#ff6464'
    && String(node['Public Influence'] || '').trim()
  ).map(node => String(node.node_id));
  // Omit the two unconnected Grid descriptions from the displayed diagram.
  const removedGridNotes = new Set(['3458764686136016363', '3458764686136016376']);
  data.canvasItems = data.canvasItems.filter(item => !removedGridNotes.has(item.item_id));
  regionMap = createRegionMap(data);
  nodeMap = new Map(data.nodes.map(n=>[n.node_id,n])); edgeMap = new Map(data.connections.map(c=>[c.connection_id,c]));
  $('node-count').textContent=data.nodes.length; $('edge-count').textContent=data.connections.length;
  graph=createGraph($('diagram'),data,{
    regionForItem,
    onSelectNode:node=>openNode(node,{focus:true}), onSelectConnection:edge=>openConnection(edge,{focus:true}), onSelectNote:openNote,
    onViewChange:view=>{ if (currentView === 'diagram') $('zoom-level').value=`${Math.round(view.scale*100)}%`; },
    onLayoutChange:updateLayoutControls,
  });
  updatePublicInfluence();
  spiderSearch = createSpiderSearch(data);
  spiderCompanion = createSpiderCompanion({ root: $('spider-dock'), pet: $('spider-pet') });
  $('spider-dock').hidden = false;
  new ResizeObserver(updateSpiderTether).observe($('spider-dock'));
  new ResizeObserver(()=>{ if (currentView === 'diagram') graph.resize(); }).observe($('diagram-wrap'));
  $('loading-state').hidden=true; graph.fit(); navigateHash();
  announce(`Frame 12 loaded: ${data.nodes.length} nodes and ${data.connections.length} connections.`);
} catch (error) {
  $('loading-state').replaceChildren(element('p','','The diagram could not be loaded.'),element('p','','Run the local server and reload this page.'),element('p','',error.message));
  console.error(error);
}

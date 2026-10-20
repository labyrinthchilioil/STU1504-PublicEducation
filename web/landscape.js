import { assignThemeClusters } from './landscape-model.js';
import { createNodeAura } from './glow.js';
import { formatNodeTitle } from './node-label.js';
import { createNodeClickRipple } from './node-ripple.js';
import { folderPath, folderRayBoundary } from './folder-shape.js';

const NS = 'http://www.w3.org/2000/svg';
let nextLandscapeId = 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function svgElement(name, attrs = {}, text) {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}

function hash(text) {
  let result = 2166136261;
  for (const character of String(text)) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return (result >>> 0) / 4294967296;
}

function shortLabel(node) {
  const label = formatNodeTitle(node.label || node.source?.node_text || node.id).replace(/\s+/g, ' ').trim();
  const code = node.source?.display_code;
  if (code) return String(code);
  return label.length > 23 ? `${label.slice(0, 21).trim()}…` : label;
}

function folderBox(radius) {
  return { x: -radius * 1.3, y: -radius * .9, width: radius * 2.6, height: radius * 1.8 };
}

/** A self-contained SVG view. All source data and original diagram positions stay untouched. */
export function createLandscape(svg, model, callbacks = {}) {
  const uniqueId = `landscape-arrow-${++nextLandscapeId}`;
  const themeById = new Map(model.themes.map(theme => [theme.id, theme]));
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const nodes = model.nodes.map(node => ({
    ...node,
    x: Number.isFinite(node.initial?.x) ? node.initial.x * 560 : (hash(`${node.id}:x`) - .5) * 1000,
    y: Number.isFinite(node.initial?.y) ? node.initial.y * 420 : (hash(`${node.id}:y`) - .5) * 760,
    vx: 0, vy: 0, fx: null, fy: null,
    radius: (5.5 + Math.min(9.5, Math.sqrt(node.degree || 0) * 1.85)) * 1.4,
    targetX: 0, targetY: 0,
  }));
  const nodeById = new Map(nodes.map(node => [String(node.id), node]));
  const edges = model.edges
    .map(edge => ({ ...edge, from: nodeById.get(String(edge.source)), to: nodeById.get(String(edge.target)) }))
    .filter(edge => edge.from && edge.to);
  const adjacency = new Map(nodes.map(node => [String(node.id), new Set()]));
  for (const edge of edges.filter(edge => edge.kind === 'source')) {
    adjacency.get(String(edge.source)).add(String(edge.target));
    adjacency.get(String(edge.target)).add(String(edge.source));
  }

  let width = 1000, height = 750;
  let camera = { x: 500, y: 375, scale: 1 };
  let active = true, destroyed = false, inferredVisible = true, labelsVisible = true;
  let selectedNodeId = null, selectedEdgeId = null, queryIds = null;
  let topicIds = [], assignments = new Map(), anchors = [];
  let scatterPositions = null, restoringScatter = false;
  let spiderIds = null, spiderSnapshot = null, spiderMotion = null, spiderWeb = null;
  let spiderProgress = 1;
  let alpha = 1, frame = 0, frameCount = 0, settled = false;
  let suppressClickUntil = 0, hoveredNode = null, gesture = null;
  let hasExplicitCamera = false;
  const pointers = new Map();
  const listeners = [];
  const listen = (element, type, handler, options) => {
    element.addEventListener(type, handler, options);
    listeners.push(() => element.removeEventListener(type, handler, options));
  };
  const defs = svgElement('defs');
  const gridPattern = svgElement('pattern', {
    id: `${uniqueId}-grid`, patternUnits: 'userSpaceOnUse', width: 20, height: 20,
  });
  gridPattern.append(svgElement('circle', { cx: 10, cy: 10, r: .7, class: 'grid-dot' }));
  defs.append(gridPattern);
  const gridBackground = svgElement('rect', {
    class: 'landscape-grid', width: '100%', height: '100%',
    fill: `url(#${uniqueId}-grid)`, 'aria-hidden': 'true', 'pointer-events': 'none',
  });
  const nodeAura = createNodeAura(defs);
  const marker = svgElement('marker', {
    id: uniqueId, viewBox: '0 0 10 10', refX: 8.5, refY: 5,
    markerWidth: 4.5, markerHeight: 4.5, orient: 'auto', markerUnits: 'strokeWidth',
  });
  marker.append(svgElement('path', { d: 'M 0 1 L 9 5 L 0 9 Z', fill: 'context-stroke', stroke: 'none' }));
  defs.append(marker);
  const viewport = svgElement('g', { class: 'landscape-viewport' });
  const anchorLayer = svgElement('g', { class: 'landscape-anchors', 'aria-hidden': 'true' });
  const edgeLayer = svgElement('g', { class: 'landscape-links' });
  const silkLayer = svgElement('g', {
    class: 'landscape-silk', 'aria-hidden': 'true', 'pointer-events': 'none',
    fill: 'none', stroke: 'var(--spider-color, #ab65dc)', 'stroke-linecap': 'round',
  });
  const nodeLayer = svgElement('g', { class: 'landscape-nodes' });
  viewport.append(edgeLayer, anchorLayer, silkLayer, nodeLayer);
  const tooltip = svgElement('g', { class: 'landscape-tooltip', 'pointer-events': 'none', visibility: 'hidden', 'aria-hidden': 'true' });
  const tooltipBackground = svgElement('rect', { class: 'landscape-tooltip-bg', x: 0, y: 0, width: 250, height: 58, rx: 9, fill: 'var(--panel, #fff)', stroke: 'var(--border, #d7dee3)' });
  const tooltipTitle = svgElement('text', { class: 'landscape-tooltip-title', x: 12, y: 22, fill: 'var(--text, #24313a)', 'font-size': 12 });
  const tooltipMeta = svgElement('text', { class: 'landscape-tooltip-meta', x: 12, y: 42, fill: 'var(--muted, #677782)', 'font-size': 10 });
  tooltip.append(tooltipBackground, tooltipTitle, tooltipMeta);
  svg.replaceChildren(defs, gridBackground, viewport, tooltip);
  svg.style.touchAction = 'none';
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', 'Community landscape. Drag to pan, scroll to zoom, and select nodes or connections. Choose themes to organize the network.');
  const nodeRipple = createNodeClickRipple(svg);

  function activateNode(node) {
    if (!active || destroyed) return;
    callbacks.onSelectNode?.(node.source || node);
    nodeRipple.play({ parent: node.element, shape: node.circle, nodeId: node.id, section: node.region });
  }

  function activateEdge(edge) {
    if (performance.now() < suppressClickUntil) return;
    if (edge.kind === 'inferred') callbacks.onSelectInferred?.(model.edges.find(item => item.id === edge.id) || edge);
    else callbacks.onSelectConnection?.(edge.original || edge);
  }

  for (const edge of edges) {
    const sourceLabel = formatNodeTitle(edge.from.label);
    const targetLabel = formatNodeTitle(edge.to.label);
    const group = svgElement('g', {
      class: 'landscape-edge', 'data-id': edge.id, 'data-kind': edge.kind,
      tabindex: 0, role: 'button',
      'aria-label': `${edge.kind === 'inferred' ? 'Suggested thematic similarity' : 'Source connection'}: ${sourceLabel} ${edge.directed ? 'to' : 'and'} ${targetLabel}`,
    });
    const section = edge.from.region || edge.to.region;
    if (edge.kind === 'source' && section) group.setAttribute('data-section', section);
    const line = svgElement('path', {
      class: 'landscape-edge-line', fill: 'none',
      stroke: edge.kind === 'inferred' ? 'var(--muted)' : 'var(--section-color, var(--graph-edge-ink))',
      'stroke-width': edge.kind === 'inferred' ? .8 : 1.05,
      'stroke-opacity': edge.kind === 'inferred' ? .32 : .48,
      'vector-effect': 'non-scaling-stroke',
      ...(edge.kind === 'inferred' ? { 'stroke-dasharray': '3 5' } : {}),
      ...(edge.directed ? { 'marker-end': `url(#${uniqueId})` } : {}),
    });
    const hit = svgElement('path', {
      class: 'landscape-edge-hit', fill: 'none', stroke: 'transparent',
      'stroke-width': 11, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'stroke',
    });
    group.append(line, hit);
    edgeLayer.append(group);
    edge.element = group;
    edge.line = line;
    edge.hit = hit;
    edge.bend = (hash(`${edge.id}:curve`) - .5) * 40;
    listen(group, 'click', event => { event.stopPropagation(); activateEdge(edge); });
    listen(group, 'keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activateEdge(edge);
      }
    });
  }

  for (const node of nodes) {
    const group = svgElement('g', {
      class: 'landscape-node', 'data-id': node.id, tabindex: 0, role: 'button',
      'aria-label': `${formatNodeTitle(node.label)}. ${node.degree} source connections.`,
    });
    if (node.region) group.setAttribute('data-section', node.region);
    const circle = svgElement('path', {
      class: 'landscape-node-folder landscape-node-circle', d: folderPath(folderBox(node.radius)), fill: 'transparent',
      stroke: 'var(--section-color, var(--graph-node-border))', 'stroke-width': .6,
      'vector-effect': 'non-scaling-stroke',
    });
    const hit = svgElement('path', {
      class: 'landscape-node-hit', d: folderPath(folderBox(node.radius)), fill: 'transparent',
      'aria-hidden': 'true', 'pointer-events': 'all',
    });
    const label = svgElement('text', {
      class: 'landscape-node-label', x: 0, y: node.radius + 14,
      'text-anchor': 'middle', 'font-size': 10, fill: 'var(--text, #35434e)',
      'pointer-events': 'none', 'aria-hidden': 'true',
    }, shortLabel(node));
    const labelBackplate = svgElement('rect', {
      class: 'landscape-label-backplate', 'aria-hidden': 'true', 'pointer-events': 'none',
    });
    group.append(hit, circle, labelBackplate, label);
    nodeLayer.append(group);
    node.element = group;
    node.circle = circle;
    node.hit = hit;
    node.labelElement = label;
    node.labelBackplate = labelBackplate;
    node.labelY = node.radius + 14;
    node.labelFont = 10;
    listen(group, 'click', event => {
      event.stopPropagation();
      if (performance.now() >= suppressClickUntil) activateNode(node);
    });
    listen(group, 'keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activateNode(node);
      }
    });
    listen(group, 'pointerenter', () => { if (!gesture?.moved) showTooltip(node); });
    listen(group, 'pointerleave', hideTooltip);
    listen(group, 'focus', () => showTooltip(node));
    listen(group, 'blur', hideTooltip);
  }

  function updateNodeAuras() {
    nodeAura.update(nodes.map(node => {
      const radius = node.drawRadius || node.radius;
      return {
        id: node.id, shape: 'folder', source_shape: node.source?.shape, section: node.region,
        box: folderBox(radius),
        selected: node.element.classList.contains('is-selected'),
        queryMatched: Boolean(spiderIds?.has(String(node.id))),
      };
    }), camera.scale);
    // Keep the source renderer's aura inside each moving node. Physics updates
    // only the parent transform, rather than rebuilding the frosted decoration.
    for (const aura of [...nodeAura.layer.children]) {
      const node = nodeById.get(aura.dataset.auraId);
      aura.setAttribute('aria-hidden', 'true');
      aura.style.pointerEvents = 'none';
      node?.element.insertBefore(aura, node.circle);
    }
  }

  function updateCameraLabels() {
    for (const node of nodes) {
      const queried = Boolean(spiderIds?.has(String(node.id)));
      const selected = node.element.classList.contains('is-selected');
      const factor = queried ? (selected ? 1.32 : 1.26) : selected ? 1.20 : 1;
      node.drawRadius = Math.max(node.radius, 7.5 / camera.scale) * factor;
      node.element.dataset.emphasisScale = factor;
      const box = folderBox(node.drawRadius);
      node.circle.setAttribute('d', folderPath(box));
      // Keep the shorter folder silhouette easy to hit when zoomed out.
      node.hit.setAttribute('d', folderPath(folderBox(Math.max(node.drawRadius, 10 / camera.scale))));
      const code = node.source?.display_code;
      node.labelInside = Boolean(code && code.length <= 5 && box.width * camera.scale >= 24);
      node.labelFont = node.labelInside ? Math.min(10.5 * Math.min(factor, 1.16), (box.width * camera.scale - 5) / (code.length * .56)) : 10;
      node.labelY = node.labelInside ? box.height * .09 + node.labelFont * .34 / camera.scale
        : box.height / 2 + 12 / camera.scale;
      node.element.classList.toggle('has-inside-label', node.labelInside);
      node.labelElement.style.fontSize = `${node.labelFont / camera.scale}px`;
      node.labelElement.setAttribute('y', node.labelY);
      const labelWidth = shortLabel(node).length * node.labelFont * .55 + 8;
      node.labelBackplate.setAttribute('x', -labelWidth / camera.scale / 2);
      node.labelBackplate.setAttribute('y', node.labelY - 11 / camera.scale);
      node.labelBackplate.setAttribute('width', labelWidth / camera.scale);
      node.labelBackplate.setAttribute('height', 15 / camera.scale);
      node.labelBackplate.setAttribute('rx', 3 / camera.scale);
    }
    for (const anchor of anchors) {
      anchor.labelElement.style.fontSize = `${15 / camera.scale}px`;
      anchor.countElement.style.fontSize = `${10 / camera.scale}px`;
      anchor.countElement.setAttribute('y', 16 / camera.scale);
    }
    gridPattern.setAttribute('patternTransform', `translate(${camera.x % 20} ${camera.y % 20})`);
    updateNodeAuras();
  }

  function updateCamera() {
    viewport.setAttribute('transform', `translate(${camera.x} ${camera.y}) scale(${camera.scale})`);
    updateCameraLabels();
    render();
    callbacks.onViewChange?.({ scale: camera.scale });
    notifySpiderState();
    if (hoveredNode) positionTooltip(hoveredNode);
  }

  function positionTooltip(node) {
    const x = node.x * camera.scale + camera.x;
    const y = node.y * camera.scale + camera.y;
    const tooltipWidth = Math.min(330, Math.max(190, String(node.label).length * 6.2 + 24));
    tooltipBackground.setAttribute('width', tooltipWidth);
    tooltip.setAttribute('transform', `translate(${clamp(x + 18, 8, Math.max(8, width - tooltipWidth - 8))} ${clamp(y - 64, 8, Math.max(8, height - 66))})`);
  }

  function showTooltip(node) {
    hoveredNode = node;
    node.element.classList.add('is-hovered');
    const label = formatNodeTitle(node.label);
    tooltipTitle.textContent = label.length > 49 ? `${label.slice(0, 47)}…` : label;
    const theme = themeById.get(assignments.get(String(node.id))?.themeId);
    const section = { land: 'Land Use', grid: 'Grid', environment: 'Environment', operation: 'Operations' }[node.region];
    tooltipMeta.textContent = `${node.degree} source connection${node.degree === 1 ? '' : 's'}${theme || section ? ` · ${theme?.label || section}` : ''}`;
    tooltip.setAttribute('visibility', 'visible');
    layoutLabels();
    positionTooltip(node);
  }

  function hideTooltip() {
    hoveredNode?.element.classList.remove('is-hovered');
    hoveredNode = null;
    tooltip.setAttribute('visibility', 'hidden');
    layoutLabels();
  }

  function layoutLabels() {
    const occupied = [];
    const maxLabels = clamp(Math.round(36 * camera.scale), width < 600 ? 14 : 24, nodes.length);
    let visibleCount = 0;
    const ranked = [...nodes].sort((a, b) => {
      const priority = node => (String(node.id) === selectedNodeId ? 10000 : 0)
        + (node === hoveredNode ? 9000 : 0)
        + (queryIds?.has(String(node.id)) ? 300 : 0)
        + (spiderIds?.has(String(node.id)) ? 600 : 0)
        + (node.element.classList.contains('is-connected') ? 100 : 0)
        + (node.degree || 0);
      return priority(b) - priority(a) || String(a.id).localeCompare(String(b.id));
    });
    // Keep headings legible by reserving their screen-space rectangles.
    for (const anchor of spiderIds?.size ? [] : anchors) {
      const x = anchor.x * camera.scale + camera.x;
      const y = (anchor.y - anchor.radius - 24) * camera.scale + camera.y;
      const halfWidth = Math.max(40, anchor.theme.label.length * 4.5);
      occupied.push({ left: x - halfWidth, right: x + halfWidth, top: y - 18, bottom: y + 19 });
    }
    if (spiderWeb && spiderIds?.size) {
      const point = getSpiderAnchor();
      const halfWidth = width < 600 ? 14 : Math.max(54, spiderWeb.label.textContent.length * 3);
      const halfHeight = width < 600 ? 14 : 36;
      occupied.push({ left: point.x - halfWidth, right: point.x + halfWidth, top: point.y - halfHeight, bottom: point.y + halfHeight });
    }
    for (const node of ranked) {
      const forced = String(node.id) === selectedNodeId || node === hoveredNode;
      const x = node.x * camera.scale + camera.x;
      const y = node.y * camera.scale + camera.y + node.labelY * camera.scale;
      const halfWidth = node.labelElement.textContent.length * 2.8 + 3;
      const rect = { left: x - halfWidth, right: x + halfWidth, top: y - 10, bottom: y + 3 };
      const overlaps = occupied.some(other => rect.left < other.right && rect.right > other.left && rect.top < other.bottom && rect.bottom > other.top);
      const inView = rect.left >= 8 && rect.right <= width - 8 && rect.top > 0 && rect.bottom < height - (spiderIds?.size ? 116 : 48);
      const visible = labelsVisible && inView && (forced || ((node.labelInside || visibleCount < maxLabels && !overlaps) && !node.element.classList.contains('is-dimmed') && !node.element.classList.contains('is-spider-dimmed')));
      node.labelElement.setAttribute('visibility', visible ? 'visible' : 'hidden');
      node.labelBackplate.setAttribute('visibility', visible && !node.labelInside && node.element.classList.contains('is-spider-match') ? 'visible' : 'hidden');
      if (visible) { occupied.push(rect); visibleCount++; }
    }
  }

  function updateStates() {
    const selectedEdge = selectedEdgeId ? edges.find(edge => String(edge.id) === selectedEdgeId) : null;
    const related = new Set();
    if (selectedNodeId) {
      related.add(selectedNodeId);
      for (const id of adjacency.get(selectedNodeId) || []) related.add(id);
      if (inferredVisible) for (const edge of edges) {
        if (String(edge.source) === selectedNodeId) related.add(String(edge.target));
        if (String(edge.target) === selectedNodeId) related.add(String(edge.source));
      }
    } else if (selectedEdge) {
      related.add(String(selectedEdge.source));
      related.add(String(selectedEdge.target));
    }
    const hasSelection = Boolean(selectedNodeId || selectedEdge);
    svg.classList.toggle('has-selection', hasSelection);
    svg.classList.toggle('has-query', queryIds !== null);
    svg.classList.toggle('labels-hidden', !labelsVisible);
    svg.classList.toggle('is-clustered', topicIds.length > 0);
    svg.classList.toggle('has-spider-query', spiderIds !== null);
    svg.classList.toggle('has-spider-web', Boolean(spiderWeb));
    anchorLayer.style.opacity = spiderIds?.size ? '.15' : '';
    for (const node of nodes) {
      const id = String(node.id);
      const isRelated = related.has(id);
      const queryMatch = queryIds === null || queryIds.has(id);
      node.element.classList.toggle('is-selected', selectedNodeId === id);
      node.element.classList.toggle('is-connected', isRelated);
      node.element.classList.toggle('is-query-match', queryIds !== null && queryMatch);
      node.element.classList.toggle('is-spider-match', Boolean(spiderIds?.has(id)));
      node.element.classList.toggle('is-spider-dimmed', spiderIds !== null && !spiderIds.has(id) && !isRelated);
      node.element.classList.toggle('is-dimmed', (hasSelection && !isRelated) || !queryMatch);
      node.element.classList.toggle('is-unmatched', topicIds.length > 0 && !assignments.get(id)?.themeId);
      node.element.setAttribute('aria-pressed', String(selectedNodeId === id));
      const cluster = assignments.get(id);
      const color = themeById.get(cluster?.themeId)?.color;
      if (topicIds.length && color) node.element.style.setProperty('--land-topic-color', color);
      else node.element.style.removeProperty('--land-topic-color');
    }
    for (const edge of edges) {
      const from = String(edge.source), to = String(edge.target);
      const connected = selectedNodeId ? from === selectedNodeId || to === selectedNodeId : selectedEdgeId === String(edge.id);
      const queryMatch = queryIds === null || queryIds.has(from) || queryIds.has(to);
      edge.element.classList.toggle('is-selected', String(edge.id) === selectedEdgeId);
      edge.element.classList.toggle('is-connected', connected);
      edge.element.classList.toggle('is-query-match', queryIds !== null && queryMatch);
      edge.element.classList.toggle('is-spider-match', Boolean(spiderIds?.has(from) && spiderIds?.has(to)));
      edge.element.classList.toggle('is-spider-dimmed', spiderIds !== null && !(spiderIds.has(from) && spiderIds.has(to)) && !connected);
      edge.element.classList.toggle('is-dimmed', (hasSelection && !connected) || !queryMatch);
      edge.element.classList.toggle('is-cross-cluster', topicIds.length > 0 && assignments.get(from)?.themeId !== assignments.get(to)?.themeId);
      const visible = edge.kind !== 'inferred' || inferredVisible;
      edge.element.style.display = visible ? '' : 'none';
      edge.element.setAttribute('tabindex', visible ? '0' : '-1');
      edge.element.setAttribute('aria-hidden', String(!visible));
    }
    updateCameraLabels();
    render();
  }

  function render() {
    for (const node of nodes) node.element.setAttribute('transform', `translate(${node.x.toFixed(2)} ${node.y.toFixed(2)})`);
    for (const edge of edges) {
      const { from, to } = edge;
      const dx = to.x - from.x, dy = to.y - from.y;
      const distance = Math.hypot(dx, dy) || 1;
      const nx = dx / distance, ny = dy / distance;
      const fromRadius = from.drawRadius || from.radius, toRadius = to.drawRadius || to.radius;
      const start = folderRayBoundary(folderBox(fromRadius), dx, dy);
      const end = folderRayBoundary(folderBox(toRadius), -dx, -dy);
      const sx = from.x + start.x, sy = from.y + start.y;
      const tx = to.x + end.x, ty = to.y + end.y;
      let path;
      if (from === to) {
        const r = fromRadius + 18;
        const left = folderRayBoundary(folderBox(fromRadius), -.15, -1);
        const right = folderRayBoundary(folderBox(fromRadius), .15, -1);
        path = `M ${from.x + left.x} ${from.y + left.y} C ${from.x - r * 2} ${from.y - r * 3} ${from.x + r * 2} ${from.y - r * 3} ${from.x + right.x} ${from.y + right.y}`;
      } else {
        const bend = clamp(distance * .075, 5, 28) + edge.bend;
        const cx = (sx + tx) / 2 - ny * bend, cy = (sy + ty) / 2 + nx * bend;
        path = `M ${sx.toFixed(2)} ${sy.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${tx.toFixed(2)} ${ty.toFixed(2)}`;
      }
      edge.line.setAttribute('d', path);
      edge.hit.setAttribute('d', path);
    }
    renderSilk();
    layoutLabels();
    if (hoveredNode) positionTooltip(hoveredNode);
    if (spiderMotion) notifySpiderState();
  }

  function getSpiderAnchor() {
    if (!spiderWeb || !spiderIds?.size) return null;
    return { x: spiderWeb.x * camera.scale + camera.x, y: spiderWeb.y * camera.scale + camera.y };
  }

  function notifySpiderState() {
    callbacks.onSpiderState?.({
      active: spiderIds !== null,
      phase: spiderMotion?.kind === 'weave' ? 'weaving' : 'ready',
      anchor: getSpiderAnchor(),
      count: spiderIds?.size || 0,
    });
  }

  function renderSilk() {
    if (!spiderWeb) return;
    const web = spiderWeb;
    const casting = clamp(spiderProgress / .32, 0, 1);
    const point = (node, fraction = 1) => ({
      x: web.x + (node.x - web.x) * fraction,
      y: web.y + (node.y - web.y) * fraction,
    });
    for (const spoke of web.spokes) {
      const { node, path, index } = spoke;
      const dx = node.x - web.x, dy = node.y - web.y;
      const distance = Math.hypot(dx, dy) || 1;
      const slack = (1 - spiderProgress) * Math.min(95, distance * .28) + 6;
      const side = index % 2 ? -1 : 1;
      const cx = web.x + dx * .5 - dy / distance * slack * side;
      const cy = web.y + dy * .5 + dx / distance * slack * side;
      path.setAttribute('d', `M ${web.x} ${web.y} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${node.x.toFixed(2)} ${node.y.toFixed(2)}`);
      path.style.strokeDashoffset = String(1 - clamp((casting - index / Math.max(1, web.spokes.length) * .3) / .7, 0, 1));
    }
    for (const ring of web.rings) {
      const points = ring.nodes.map(node => point(node, ring.fraction));
      const first = points[0];
      let path = `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;
      for (let i = 1; i <= points.length; i++) {
        const from = points[(i - 1) % points.length], to = points[i % points.length];
        const mx = (from.x + to.x) * .5, my = (from.y + to.y) * .5;
        // Slightly slack cross threads give the web its scalloped structure.
        const cx = mx + (web.x - mx) * .13, cy = my + (web.y - my) * .13;
        path += ` Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${to.x.toFixed(2)} ${to.y.toFixed(2)}`;
      }
      ring.path.setAttribute('d', path);
      ring.path.style.opacity = String(clamp((spiderProgress - .22 - ring.index * .035) / .5, 0, 1) * .55);
    }
    web.hub.setAttribute('transform', `translate(${web.x} ${web.y})`);
    web.label.setAttribute('y', -22 / camera.scale);
    web.label.style.fontSize = `${11 / camera.scale}px`;
    web.count.setAttribute('y', 28 / camera.scale);
    web.count.style.fontSize = `${10 / camera.scale}px`;
    // The floating query already names the web on compact canvases.
    web.label.style.display = width < 600 ? 'none' : '';
    web.count.style.display = width < 600 ? 'none' : '';
    silkLayer.style.opacity = String(spiderMotion?.kind === 'restore' ? spiderProgress : 1);
  }

  function buildSpiderWeb(matches, label) {
    silkLayer.replaceChildren();
    silkLayer.style.opacity = '1';
    const web = { x: 0, y: 0, spokes: [], rings: [], targets: new Map(), radius: 74 };
    const centroid = matches.reduce((sum, node) => ({ x: sum.x + node.x / matches.length, y: sum.y + node.y / matches.length }), { x: 0, y: 0 });
    const ordered = [...matches].sort((a, b) =>
      Math.atan2(a.y - centroid.y, a.x - centroid.x) - Math.atan2(b.y - centroid.y, b.x - centroid.x));
    let offset = 0, tier = 0;
    while (offset < ordered.length) {
      const capacity = 10 + tier * 8;
      const members = ordered.slice(offset, offset + capacity);
      const radius = 74 + tier * 66;
      web.radius = radius;
      members.forEach((node, index) => {
        const angle = -Math.PI / 2 + index / members.length * Math.PI * 2 + (tier % 2 ? .14 : 0);
        web.targets.set(String(node.id), {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius * .78,
        });
        const path = svgElement('path', {
          class: 'silk-spoke', 'data-node-id': node.id,
          'stroke-width': 1.3, 'stroke-opacity': .7,
          'vector-effect': 'non-scaling-stroke', pathLength: 1,
        });
        path.style.strokeDasharray = '1';
        silkLayer.append(path);
        web.spokes.push({ node, path, index: web.spokes.length });
      });
      if (members.length > 2) {
        for (const fraction of tier === 0 ? [.38, .69, 1] : [1]) {
          const path = svgElement('path', {
            class: 'silk-ring', 'data-ring': web.rings.length,
            'stroke-width': .9, 'vector-effect': 'non-scaling-stroke',
          });
          silkLayer.append(path);
          web.rings.push({ nodes: members, fraction, path, index: web.rings.length });
        }
      }
      offset += members.length;
      tier++;
    }
    const hub = svgElement('g', { class: 'landscape-web-hub' });
    hub.append(
      svgElement('circle', { class: 'landscape-web-halo', r: 13, 'stroke-width': 1, 'stroke-opacity': .45, fill: 'var(--panel, #fff)', 'fill-opacity': .8, 'vector-effect': 'non-scaling-stroke' }),
      svgElement('circle', { class: 'landscape-web-core', r: 4, fill: 'var(--spider-color, #ab65dc)', stroke: 'none' }),
    );
    const title = String(label || 'Your web').trim();
    web.label = svgElement('text', {
      class: 'landscape-web-label', 'text-anchor': 'middle', fill: 'var(--spider-color, #ab65dc)',
      stroke: 'none', 'font-weight': 650,
    }, title.length > 30 ? `${title.slice(0, 28)}…` : title);
    web.count = svgElement('text', {
      class: 'landscape-web-count', 'text-anchor': 'middle', fill: 'var(--muted, #677782)', stroke: 'none',
    }, `${matches.length} connected ${matches.length === 1 ? 'idea' : 'ideas'}`);
    hub.append(web.label, web.count);
    silkLayer.append(hub);
    web.hub = hub;
    for (const node of nodes) {
      if (web.targets.has(String(node.id))) continue;
      const original = spiderSnapshot.positions.get(String(node.id));
      const angle = Math.atan2(original.y / .78, original.x);
      const radius = Math.max(Math.hypot(original.x, original.y / .78), web.radius + 105 + hash(`${node.id}:web-margin`) * 90);
      web.targets.set(String(node.id), { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * .78 });
    }
    return web;
  }

  function setSpiderQuery(ids, { label = '', immediate = false } = {}) {
    nodeRipple.cancel();
    const nextIds = ids == null ? null : new Set([...ids].map(String).filter(id => nodeById.has(id)));
    if (nextIds === null && spiderIds === null && !spiderSnapshot) return;
    if (nextIds?.size && spiderIds?.size === nextIds.size && [...nextIds].every(id => spiderIds.has(id))) {
      if (spiderWeb && label) spiderWeb.label.textContent = String(label).length > 30 ? `${String(label).slice(0, 28)}…` : String(label);
      notifySpiderState();
      return;
    }
    const currentPositions = () => new Map(nodes.map(node => [String(node.id), { x: node.x, y: node.y }]));
    spiderIds = nextIds;
    restoringScatter = false;
    hideTooltip();
    if (nextIds?.size) {
      if (!spiderSnapshot) spiderSnapshot = { positions: currentPositions(), camera: { ...camera }, explicitCamera: hasExplicitCamera };
      spiderWeb = buildSpiderWeb(nodes.filter(node => nextIds.has(String(node.id))), label);
      const fromCamera = { ...camera };
      spiderMotion = {
        kind: 'weave', tick: 0, duration: 170,
        from: currentPositions(), to: spiderWeb.targets, fromCamera, camera: spiderFitCamera(),
      };
      spiderProgress = 0;
      hasExplicitCamera = false;
    } else if (spiderSnapshot) {
      spiderMotion = {
        kind: 'restore', tick: 0, duration: 95,
        from: currentPositions(), to: spiderSnapshot.positions,
        fromCamera: { ...camera }, camera: { ...spiderSnapshot.camera },
        explicitCamera: spiderSnapshot.explicitCamera,
      };
      // A new empty query clears every thread immediately, even during a previous catch.
      spiderWeb = null;
      silkLayer.replaceChildren();
    } else {
      spiderMotion = null;
      spiderWeb = null;
      silkLayer.replaceChildren();
      settled = true;
    }
    updateStates();
    notifySpiderState();
    if (spiderMotion) restart(.7, immediate);
    else render();
  }

  function tick() {
    if (spiderMotion) {
      const motion = spiderMotion;
      motion.tick++;
      const progress = Math.min(1, motion.tick / motion.duration);
      const ease = value => value * value * (3 - 2 * value);
      spiderProgress = motion.kind === 'weave' ? progress : 1 - progress;
      for (const node of nodes) {
        const id = String(node.id), from = motion.from.get(id), to = motion.to.get(id);
        // Threads are cast first; their catches then travel towards the web in waves.
        const delay = motion.kind === 'weave' && spiderIds?.has(id) ? .12 + hash(`${id}:catch`) * .16 : 0;
        const t = ease(clamp((progress - delay) / (1 - delay), 0, 1));
        if (node.fx !== null) { node.x = node.fx; node.y = node.fy; }
        else { node.x = from.x + (to.x - from.x) * t; node.y = from.y + (to.y - from.y) * t; }
        node.vx = node.vy = 0;
      }
      if (motion.camera) {
        const t = ease(progress);
        for (const key of ['x', 'y', 'scale']) camera[key] = motion.fromCamera[key] + (motion.camera[key] - motion.fromCamera[key]) * t;
        viewport.setAttribute('transform', `translate(${camera.x} ${camera.y}) scale(${camera.scale})`);
        updateCameraLabels();
      }
      frameCount++;
      settled = progress === 1;
      if (settled) {
        spiderMotion = null;
        callbacks.onViewChange?.({ scale: camera.scale });
        if (motion.kind === 'restore') {
          hasExplicitCamera = motion.explicitCamera;
          spiderSnapshot = null;
          spiderWeb = null;
          silkLayer.replaceChildren();
          updateStates();
        }
        notifySpiderState();
      }
      return;
    }
    if (spiderIds !== null) { settled = true; return; }
    if (restoringScatter && scatterPositions) {
      let movement = 0;
      for (const node of nodes) {
        const position = scatterPositions.get(String(node.id));
        if (node.fx !== null) continue;
        const dx = position.x - node.x, dy = position.y - node.y;
        node.x += dx * .13; node.y += dy * .13;
        node.vx = node.vy = 0;
        movement += Math.abs(dx) + Math.abs(dy);
      }
      frameCount++;
      alpha *= .95;
      settled = movement < .015 || frameCount > 140;
      if (settled) {
        for (const node of nodes) {
          const position = scatterPositions.get(String(node.id));
          node.x = position.x; node.y = position.y;
        }
        restoringScatter = false;
      }
      return;
    }
    const clustered = topicIds.length > 0;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        if (Math.abs(dx) + Math.abs(dy) < .01) { dx = .2; dy = .1; }
        const distanceSquared = dx * dx + dy * dy;
        const distance = Math.sqrt(distanceSquared);
        const gap = (a.radius + b.radius) * 1.45 + (clustered ? 16 : 22);
        const repulsion = Math.min(5, 860 / (distanceSquared + 30)) * alpha;
        const collision = distance < gap ? (gap - distance) * .09 : 0;
        const force = (repulsion + collision) / distance;
        a.vx -= dx * force; a.vy -= dy * force;
        b.vx += dx * force; b.vy += dy * force;
      }
    }
    for (const edge of edges) {
      if (edge.kind === 'inferred' && !inferredVisible) continue;
      const { from, to } = edge;
      const dx = to.x - from.x, dy = to.y - from.y;
      const distance = Math.hypot(dx, dy) || 1;
      const sameCluster = assignments.get(String(from.id))?.themeId === assignments.get(String(to.id))?.themeId;
      const strength = clustered ? (sameCluster ? .014 : .0025) : .016;
      const desired = clustered ? 85 : 110 + Math.min(65, (from.degree + to.degree) * 2);
      const force = (distance - desired) / distance * strength * alpha * (edge.kind === 'inferred' ? .35 : 1);
      from.vx += dx * force; from.vy += dy * force;
      to.vx -= dx * force; to.vy -= dy * force;
    }
    let movement = 0;
    for (const node of nodes) {
      const attraction = clustered ? .043 : .0035;
      const tx = clustered ? node.targetX : node.initial?.x * 180 || 0;
      const ty = clustered ? node.targetY : node.initial?.y * 140 || 0;
      node.vx = (node.vx + (tx - node.x) * attraction * alpha) * .73;
      node.vy = (node.vy + (ty - node.y) * attraction * alpha) * .73;
      if (node.fx !== null) { node.x = node.fx; node.y = node.fy; node.vx = 0; node.vy = 0; }
      else {
        node.x += clamp(node.vx, -13, 13);
        node.y += clamp(node.vy, -13, 13);
      }
      movement += Math.abs(node.vx) + Math.abs(node.vy);
    }
    alpha *= .982;
    frameCount++;
    settled = alpha < .006 || (frameCount > 65 && movement < .16);
  }

  function animate() {
    frame = 0;
    if (!active || destroyed) return;
    const isSpiderAnimation = Boolean(spiderMotion) || spiderIds !== null;
    tick();
    if (!settled) tick();
    render();
    if (!settled) frame = requestAnimationFrame(animate);
    else if (!isSpiderAnimation && !hasExplicitCamera) fit();
  }

  function restart(energy = .85, immediate = false) {
    alpha = Math.max(alpha, energy);
    frameCount = 0;
    settled = false;
    if (!active && !immediate) return;
    if ((reducedMotion?.matches || immediate) && !gesture) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      for (let i = 0; i < 300 && !settled; i++) tick();
      render();
    } else if (!frame) frame = requestAnimationFrame(animate);
  }

  function bounds(includeTargets = false) {
    const xs = [], ys = [];
    for (const node of nodes) {
      if (spiderWeb && spiderIds?.size && !spiderIds.has(String(node.id))) continue;
      xs.push(node.x - node.radius * 1.3 - 30, node.x + node.radius * 1.3 + 30);
      ys.push(node.y - node.radius - 20, node.y + node.radius + 25);
      if (includeTargets) {
        xs.push(node.targetX - 50, node.targetX + 50);
        ys.push(node.targetY - 50, node.targetY + 50);
      }
    }
    for (const anchor of spiderIds?.size ? [] : anchors) {
      xs.push(anchor.x - 90, anchor.x + 90);
      ys.push(anchor.y - anchor.radius - 60, anchor.y + anchor.radius);
    }
    return xs.length ? { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) } : { left: -500, right: 500, top: -350, bottom: 350 };
  }

  function spiderFitCamera() {
    // Frame the gathered ideas; distant nonmatches remain in the scene as context.
    // Including their positions would shrink a small query to an unreadable speck.
    const availableHeight = Math.max(100, height - (width < 600 ? 145 : 120));
    const spanX = spiderWeb.radius * 2 + 84;
    const spanY = spiderWeb.radius * 1.56 + 54;
    const scale = clamp(Math.min((width - 50) / spanX, (availableHeight - 30) / spanY), .15, 2);
    return {
      x: width / 2 - spiderWeb.x * scale,
      y: availableHeight / 2 - spiderWeb.y * scale,
      scale,
    };
  }

  function fit(includeTargets = false) {
    if (spiderWeb && spiderIds?.size) {
      camera = spiderFitCamera();
      hasExplicitCamera = false;
      updateCamera();
      return;
    }
    const area = bounds(includeTargets);
    const availableHeight = Math.max(80, height - (spiderIds?.size ? (width < 600 ? 145 : 120) : 65));
    const padding = Math.min(50, Math.min(width, availableHeight) * .06);
    camera.scale = clamp(Math.min((width - padding * 2) / Math.max(1, area.right - area.left), (availableHeight - padding * 2) / Math.max(1, area.bottom - area.top)), .15, 2);
    camera.x = width / 2 - (area.left + area.right) / 2 * camera.scale;
    camera.y = availableHeight / 2 - (area.top + area.bottom) / 2 * camera.scale;
    hasExplicitCamera = false;
    updateCamera();
  }

  function setTopics(ids = []) {
    nodeRipple.cancel();
    const nextIds = [...new Set(ids)].filter(id => themeById.has(id));
    if (nextIds.join('|') === topicIds.join('|')) return;
    if (spiderIds !== null || spiderSnapshot) setSpiderQuery(null, { immediate: true });
    topicIds = nextIds;
    restoringScatter = topicIds.length === 0;
    assignments = assignThemeClusters(model, topicIds);
    const counts = new Map(topicIds.map(id => [id, 0]));
    for (const assignment of assignments.values()) if (assignment.themeId) counts.set(assignment.themeId, (counts.get(assignment.themeId) || 0) + 1);
    anchors = topicIds.map((id, index) => {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / topicIds.length;
      const radius = Math.min(175, 55 + Math.sqrt(counts.get(id) || 0) * 12);
      return {
        id, theme: themeById.get(id), count: counts.get(id) || 0, radius,
        x: topicIds.length === 1 ? 0 : topicIds.length === 2 ? (index === 0 ? -290 : 290) : Math.cos(angle) * (topicIds.length > 5 ? 440 : 370),
        y: topicIds.length < 3 ? 0 : Math.sin(angle) * (topicIds.length > 5 ? 285 : 230),
      };
    });
    const anchorById = new Map(anchors.map(anchor => [anchor.id, anchor]));
    for (const node of nodes) {
      const assignment = assignments.get(String(node.id));
      const anchor = anchorById.get(assignment?.themeId);
      const angle = hash(`${node.id}:orbit`) * Math.PI * 2;
      if (anchor) {
        const spread = Math.sqrt(hash(`${node.id}:spread`)) * anchor.radius;
        let secondaryX = 0, secondaryY = 0, total = 0;
        for (const other of anchors) {
          if (other.id === anchor.id) continue;
          const score = assignment.scores?.[other.id] || 0;
          secondaryX += other.x * score; secondaryY += other.y * score; total += score;
        }
        const bridge = total > 0 ? .13 : 0;
        node.targetX = anchor.x * (1 - bridge) + (total ? secondaryX / total * bridge : 0) + Math.cos(angle) * spread;
        node.targetY = anchor.y * (1 - bridge) + (total ? secondaryY / total * bridge : 0) + Math.sin(angle) * spread * .8;
      } else {
        const orbit = 545 + hash(`${node.id}:outer`) * 80;
        node.targetX = Math.cos(angle) * orbit;
        node.targetY = Math.sin(angle) * orbit * .48;
      }
      if (restoringScatter && scatterPositions) {
        const position = scatterPositions.get(String(node.id));
        node.targetX = position.x;
        node.targetY = position.y;
      }
    }
    anchorLayer.replaceChildren();
    for (const anchor of anchors) {
      const group = svgElement('g', {
        class: 'landscape-anchor', 'data-theme': anchor.id,
        transform: `translate(${anchor.x} ${anchor.y - anchor.radius - 24})`,
      });
      group.style.setProperty('--land-color', anchor.theme.color);
      anchor.labelElement = svgElement('text', { class: 'landscape-anchor-label', 'text-anchor': 'middle', fill: 'var(--land-color)', 'font-size': 14, 'font-weight': 650, y: 0 }, anchor.theme.label);
      anchor.countElement = svgElement('text', { class: 'landscape-anchor-count', 'text-anchor': 'middle', fill: 'var(--muted, #697a83)', 'font-size': 10, y: 16 }, `${anchor.count} node${anchor.count === 1 ? '' : 's'}`);
      group.append(anchor.labelElement, anchor.countElement);
      anchorLayer.append(group);
    }
    hideTooltip();
    updateStates();
    restart(1);
    fit(true);
    callbacks.onTopicsChange?.({ ids: [...topicIds], assignments, counts, unmatched: nodes.length - [...counts.values()].reduce((sum, count) => sum + count, 0) });
  }

  function resize() {
    if (destroyed) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const oldWidth = width, oldHeight = height;
    width = rect.width; height = rect.height;
    if (spiderSnapshot && (width !== oldWidth || height !== oldHeight)) {
      spiderSnapshot.camera.x += (width - oldWidth) / 2;
      spiderSnapshot.camera.y += (height - oldHeight) / 2;
      // Refit only after an actual size change; hiding/showing preserves the web camera.
      if (spiderMotion) spiderMotion.camera = null;
    }
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    if (hasExplicitCamera) {
      camera.x += (width - oldWidth) / 2;
      camera.y += (height - oldHeight) / 2;
      updateCamera();
    } else fit(topicIds.length > 0 && !settled);
  }

  function localPoint(event) {
    const rect = svg.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function zoomAt(factor, point = { x: width / 2, y: height / 2 }) {
    if (spiderMotion) spiderMotion.camera = null;
    const oldScale = camera.scale;
    camera.scale = clamp(camera.scale * factor, .15, 5);
    const ratio = camera.scale / oldScale;
    camera.x = point.x - (point.x - camera.x) * ratio;
    camera.y = point.y - (point.y - camera.y) * ratio;
    hasExplicitCamera = true;
    updateCamera();
  }

  listen(svg, 'wheel', event => {
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? height : 1);
    zoomAt(Math.exp(-clamp(delta, -250, 250) * .0018), localPoint(event));
  }, { passive: false });

  listen(svg, 'pointerdown', event => {
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    const point = localPoint(event);
    pointers.set(event.pointerId, point);
    const nodeElement = event.target.closest?.('.landscape-node');
    const node = nodeElement ? nodeById.get(nodeElement.dataset.id) : null;
    const edgeElement = event.target.closest?.('.landscape-edge');
    const edge = edgeElement ? edges.find(item => String(item.id) === edgeElement.dataset.id) : null;
    if (pointers.size === 1) gesture = { start: point, last: point, node, edge, moved: false, pointerId: event.pointerId };
    if (pointers.size > 1) {
      if (gesture?.node) { gesture.node.fx = null; gesture.node.fy = null; }
      gesture = { moved: true, pinch: true, node: null };
      hideTooltip();
    }
    try { svg.setPointerCapture(event.pointerId); } catch { /* Detached or synthetic pointers need no capture. */ }
  });

  listen(svg, 'pointermove', event => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    const next = localPoint(event);
    const previousPoints = [...pointers.values()];
    pointers.set(event.pointerId, next);
    if (pointers.size >= 2) {
      const newPoints = [...pointers.values()];
      const oldCenter = { x: (previousPoints[0].x + previousPoints[1].x) / 2, y: (previousPoints[0].y + previousPoints[1].y) / 2 };
      const center = { x: (newPoints[0].x + newPoints[1].x) / 2, y: (newPoints[0].y + newPoints[1].y) / 2 };
      const oldDistance = Math.hypot(previousPoints[1].x - previousPoints[0].x, previousPoints[1].y - previousPoints[0].y);
      const distance = Math.hypot(newPoints[1].x - newPoints[0].x, newPoints[1].y - newPoints[0].y);
      camera.x += center.x - oldCenter.x;
      camera.y += center.y - oldCenter.y;
      zoomAt(oldDistance > 1 ? distance / oldDistance : 1, center);
      return;
    }
    if (gesture.pinch) { gesture.start = next; gesture.last = next; gesture.pinch = false; }
    if (Math.hypot(next.x - gesture.start.x, next.y - gesture.start.y) > 4) gesture.moved = true;
    if (!gesture.moved) return;
    hideTooltip();
    svg.classList.add('is-dragging');
    if (gesture.node) {
      const node = gesture.node;
      node.fx = node.x = (next.x - camera.x) / camera.scale;
      node.fy = node.y = (next.y - camera.y) / camera.scale;
      node.vx = node.vy = 0;
      restart(.22);
      render();
    } else {
      if (spiderMotion) spiderMotion.camera = null;
      camera.x += next.x - gesture.last.x;
      camera.y += next.y - gesture.last.y;
      hasExplicitCamera = true;
      updateCamera();
    }
    gesture.last = next;
  });

  function endPointer(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (event.type === 'pointerup' && !gesture?.moved && pointers.size === 0) {
      if (gesture?.node) activateNode(gesture.node);
      else if (gesture?.edge) activateEdge(gesture.edge);
    }
    suppressClickUntil = performance.now() + 220;
    if (gesture?.node && gesture.moved) {
      gesture.node.fx = null;
      gesture.node.fy = null;
      restart(.28);
    }
    if (!pointers.size) {
      gesture = null;
      svg.classList.remove('is-dragging');
    } else {
      const last = [...pointers.values()][0];
      gesture = { start: last, last, moved: true, pinch: true, node: null };
    }
    try { svg.releasePointerCapture(event.pointerId); } catch { /* Capture can already have ended. */ }
  }
  listen(svg, 'pointerup', endPointer);
  listen(svg, 'pointercancel', endPointer);
  listen(svg, 'lostpointercapture', endPointer);
  listen(svg, 'keydown', event => {
    if (event.target !== svg) return;
    const delta = 50;
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomAt(1.2); }
    else if (event.key === '-') { event.preventDefault(); zoomAt(1 / 1.2); }
    else if (event.key === '0') { event.preventDefault(); fit(); }
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      if (spiderMotion) spiderMotion.camera = null;
      camera.x += event.key === 'ArrowLeft' ? delta : event.key === 'ArrowRight' ? -delta : 0;
      camera.y += event.key === 'ArrowUp' ? delta : event.key === 'ArrowDown' ? -delta : 0;
      hasExplicitCamera = true;
      updateCamera();
    }
  });

  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(svg);
  if (!resizeObserver) listen(window, 'resize', resize);
  // A deterministic warm-up gives the first frame a settled, connected scatter.
  for (let i = 0; i < 220; i++) tick();
  // The desktop canvas is wider than it is tall; open up the scatter horizontally.
  for (const node of nodes) { node.x *= 1.6; node.y *= .92; }
  scatterPositions = new Map(nodes.map(node => [String(node.id), { x: node.x, y: node.y }]));
  settled = true;
  alpha = 0;
  render();
  updateStates();
  resize();

  return {
    setTopics,
    setSpiderQuery,
    getSpiderAnchor,
    setSelection(nodeId, edgeId) {
      nodeRipple.cancel();
      selectedNodeId = nodeId == null ? null : String(nodeId);
      selectedEdgeId = edgeId == null ? null : String(edgeId);
      updateStates();
    },
    setQuery(ids) {
      queryIds = ids == null ? null : new Set([...ids].map(String));
      updateStates();
    },
    setLabelsVisible(visible) { labelsVisible = Boolean(visible); updateStates(); },
    setInferredVisible(visible) {
      inferredVisible = Boolean(visible);
      updateStates();
    },
    zoomBy: zoomAt,
    fit: () => fit(),
    resize,
    // Finish pending clustering/weaving while hidden so a view transition can
    // land on stable rendered geometry instead of chasing a moving target.
    settle() {
      if (!settled) restart(alpha, true);
      resize();
    },
    focusNode(id) {
      const node = nodeById.get(String(id));
      if (!node) return;
      camera.scale = Math.max(camera.scale, 1.15);
      camera.x = width / 2 - node.x * camera.scale;
      camera.y = height / 2 - node.y * camera.scale;
      hasExplicitCamera = true;
      updateCamera();
    },
    focusConnection(id) {
      const edge = edges.find(item => String(item.id) === String(id));
      if (!edge) return;
      const spanX = Math.abs(edge.from.x - edge.to.x) + 200;
      const spanY = Math.abs(edge.from.y - edge.to.y) + 180;
      camera.scale = clamp(Math.min(width * .72 / spanX, height * .72 / spanY), .3, 1.8);
      camera.x = width / 2 - (edge.from.x + edge.to.x) / 2 * camera.scale;
      camera.y = height / 2 - (edge.from.y + edge.to.y) / 2 * camera.scale;
      hasExplicitCamera = true;
      updateCamera();
    },
    setActive(value) {
      active = Boolean(value);
      nodeRipple.setActive(active);
      svg.classList.toggle('spider-paused', !active);
      if (!active) {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        hideTooltip();
      } else {
        resize();
        if (!settled) restart(alpha);
      }
    },
    destroy() {
      destroyed = true;
      nodeRipple.destroy();
      if (frame) cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      for (const remove of listeners) remove();
      pointers.clear();
      svg.replaceChildren();
    },
  };
}

import { routeConnections } from './routing.js';
import { enlargeNodeForDisplay, snap, gridStepForScale, editableSegments, moveRouteSegment, routeFromPoints, validateManualRoute } from './layout.js';
import { createNodeAura, createSelectionGlow } from './glow.js';
import { formatNodeTitle, formatNodeTitleContent } from './node-label.js';
import { createNodeClickRipple } from './node-ripple.js';
import { folderPath, folderLabelBox } from './folder-shape.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HTML_NS = 'http://www.w3.org/1999/xhtml';
const SAFE_TAGS = new Set(['p', 'strong', 'b', 'em', 'i', 'u', 'br', 'a', 'span', 'ul', 'ol', 'li']);
const DROP_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template']);

/** Rebuild markup from an allowlist, retaining safe links and source-color metadata. */
export function appendSafeHtml(container, html) {
  const parsed = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
  function append(source, target) {
    if (source.nodeType === Node.TEXT_NODE) {
      target.append(document.createTextNode(source.textContent));
      return;
    }
    if (source.nodeType !== Node.ELEMENT_NODE) return;
    const tag = source.localName.toLowerCase();
    if (DROP_TAGS.has(tag)) return;
    if (!SAFE_TAGS.has(tag)) {
      for (const child of source.childNodes) append(child, target);
      return;
    }
    const element = document.createElementNS(HTML_NS, tag);
    // Preserve approved source colors as metadata; the display palette controls text color.
    const color = source.style.color;
    const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(color);
    if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(color)
      || (rgb && rgb.slice(1).every(channel => Number(channel) <= 255))) element.setAttribute('data-source-color', color);
    if (tag === 'a') {
      try {
        const originalHref = source.getAttribute('href') ?? '';
        const url = new URL(originalHref);
        if (url.protocol === 'https:' || url.protocol === 'http:') {
          element.setAttribute('href', originalHref);
          element.setAttribute('target', '_blank');
          element.setAttribute('rel', 'noopener noreferrer');
        }
      } catch { /* A malformed or relative link stays readable as plain text. */ }
    }
    for (const child of source.childNodes) append(child, element);
    target.append(element);
  }
  for (const child of parsed.body.childNodes) append(child, container);
  return container;
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== null && value !== undefined) element.setAttribute(key, String(value));
  }
  return element;
}

function number(value, fallback = 0) {
  return value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function boxOf(item) {
  const layout = item.layout ?? item;
  return { x: number(layout.x), y: number(layout.y), width: number(layout.width), height: number(layout.height) };
}

function center(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function routeMidpoint(points) {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] ? remaining / lengths[i] : 0;
      return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
    }
    remaining -= lengths[i];
  }
  return points[0];
}

function renderShape(item, attributes = {}) {
  const box = boxOf(item);
  const common = { fill: item.fill_color || 'none', stroke: item.border_color || 'none',
    'stroke-width': number(item.layout?.border_width, 1), ...attributes };
  if (item.shape === 'folder') return svgElement('path', { d: folderPath(box, item.source_shape), ...common });
  if (item.shape === 'rhombus') {
    return svgElement('polygon', { points: `${box.x + box.width / 2},${box.y} ${box.x + box.width},${box.y + box.height / 2} ${box.x + box.width / 2},${box.y + box.height} ${box.x},${box.y + box.height / 2}`, ...common });
  }
  return svgElement('rect', { ...box, rx: item.shape === 'round_rectangle' ? Math.min(box.height / 4, 20) : 0, ...common });
}

function renderText(item, html, plainText, isNode = false) {
  const box = boxOf(item);
  const layout = item.layout ?? {};
  const diamond = item.shape === 'rhombus' || item.source_shape === 'rhombus';
  const folder = isNode && item.shape === 'folder';
  const insetX = isNode ? (diamond ? box.width * 0.14 : 10) : 0;
  const insetY = isNode ? (folder ? box.height * .18 + 5 : diamond ? box.height * 0.16 : 6) : 0;
  const textBox = folder ? folderLabelBox(box, item.source_shape) : {
    x: box.x + insetX, y: box.y + insetY,
    width: Math.max(1, box.width - insetX * 2), height: Math.max(1, box.height - insetY * 2),
  };
  const foreign = svgElement('foreignObject', { ...textBox, class: 'graph-label' });
  const wrapper = document.createElementNS(HTML_NS, 'div');
  wrapper.className = 'graph-rich-text';
  const sourceColor = layout.text_color || (isNode ? '#1a1a1a' : item.fill_color) || '#1a1a1a';
  wrapper.setAttribute('data-source-color', sourceColor);
  wrapper.setAttribute('data-source-font-family', layout.font_family || 'noto_sans');
  wrapper.setAttribute('data-source-font-size', String(number(layout.font_size, 22)));
  Object.assign(wrapper.style, {
    width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
    justifyContent: layout.vertical_align === 'bottom' ? 'flex-end' : (layout.vertical_align === 'middle' || isNode ? 'center' : 'flex-start'),
    color: isNode ? 'var(--graph-node-ink, #202124)' : 'var(--graph-note-ink, #202124)',
    fontFamily: isNode ? 'var(--node-font, "Noto Sans", sans-serif)' : 'var(--ui-font, "Helvetica Neue", Helvetica, Arial, sans-serif)',
    fontSize: isNode ? 'var(--node-font-size, 25px)' : `${number(layout.font_size, 22)}px`, fontWeight: isNode ? '850' : layout.font_weight || 'normal',
    fontStretch: isNode ? '75%' : 'normal', letterSpacing: isNode ? '-.025em' : 'normal',
    textAlign: layout.text_align || (isNode ? 'center' : 'left'), lineHeight: isNode ? '1.08' : '1.2',
    textWrap: isNode && diamond ? 'balance' : 'wrap',
    overflowWrap: 'break-word', boxSizing: 'border-box',
  });
  const content = document.createElementNS(HTML_NS, 'div');
  if (html) appendSafeHtml(content, html);
  else { content.textContent = plainText || ''; content.style.whiteSpace = 'pre-line'; }
  if (isNode) formatNodeTitleContent(content);
  wrapper.append(content);
  foreign.append(wrapper);
  return foreign;
}

function enableKeyboard(element, activate) {
  element.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('a')) return;
    event.preventDefault();
    activate();
  });
}

/** Source records stay immutable; local layout edits are a separate display layer. */
export function createGraph(svg, data, callbacks = {}) {
  const sourceNodes = data.nodes ?? [];
  const sourceNodeById = new Map(sourceNodes.map(node => [String(node.node_id), node]));
  const initialNodes = sourceNodes.map(enlargeNodeForDisplay);
  const initialNodeById = new Map(initialNodes.map(node => [String(node.node_id), node]));
  const nodes = initialNodes.map(node => ({ ...node, layout: { ...node.layout } }));
  const connections = data.connections ?? [];
  const connectionById = new Map(connections.map(edge => [String(edge.connection_id), edge]));
  const canvasItems = data.canvasItems ?? [];
  const nodeById = new Map(nodes.map(node => [String(node.node_id), node]));
  const nodeElements = new Map();
  const edgeElements = new Map();
  const emphasisScales = new Map();
  let displayRoutes = null;
  const noteElements = new Map();
  const frame = data.frame?.layout || data.frame || { x: 0, y: 0, width: 15200, height: 10200 };
  const frameBounds = { x: number(frame.x), y: number(frame.y), width: number(frame.width, 15200), height: number(frame.height, 10200) };
  let view = { ...frameBounds };
  let viewportWidth = 1;
  let viewportHeight = 1;
  let selectedNode = null;
  let selectedConnection = null;
  let queryIds = null;
  let spiderIds = null;
  let publicInfluenceIds = null;
  let drag = null;
  let labelsVisible = true;
  let focusMode = true;
  let activeRegion = null;
  let editing = false, busy = false, spaceHeld = false, gridStep = 20;
  let manualRoutes = new Map();
  const undoStack = [], redoStack = [];
  const storageKey = 'frame12-layout-v1';
  let storedLayout = null, storageAvailable = true;
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (stored?.version === 1 && stored.nodes && typeof stored.nodes === 'object') {
      storedLayout = stored;
      for (const node of nodes) {
        const position = stored.nodes[node.node_id];
        if (position && [position.x, position.y].every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e6)) {
          // Storage retains original-size top-left coordinates, preserving saved centers.
          const source = sourceNodeById.get(node.node_id).layout;
          const initial = initialNodeById.get(node.node_id).layout;
          node.layout.x = position.x + initial.x - source.x;
          node.layout.y = position.y + initial.y - source.y;
        }
      }
    }
  } catch { /* An unavailable or stale local layout must not block the diagram. */ }

  svg.replaceChildren();
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.style.touchAction = 'none';
  const definitions = svgElement('defs');
  const localStyle = svgElement('style');
  localStyle.textContent = `
    .graph-rich-text p { margin: 0; padding: 0; }
    .graph-rich-text a { color: inherit; text-decoration: underline; }
    .graph-rich-text ul,.graph-rich-text ol { margin: 0; padding-left: 1.3em; }
    .graph-node .graph-rich-text strong,.graph-node .graph-rich-text b { font-weight: 900; }
    .graph-node,.graph-note,.graph-edge { cursor: pointer; outline: none; }
    .graph-node,.graph-edge,.graph-note { transition: opacity 180ms ease; }
    .node-shape { fill: transparent; stroke: transparent; stroke-width: .55px; vector-effect: non-scaling-stroke; pointer-events: all; }
    .edge-line { stroke: var(--graph-edge-ink, #525252); stroke-width: max(var(--source-stroke-width, 2px), var(--graph-min-edge-stroke, 2px)); }
    .graph-edge.is-selected .edge-line { stroke: var(--graph-connection-focus, #096a83); stroke-width: max(var(--source-stroke-width, 2px), var(--graph-active-edge-stroke, 2px)); }
    .graph-edge.is-primary .edge-line { stroke-width: max(var(--source-stroke-width, 2px), var(--graph-primary-edge-stroke, 2px)); }
    .graph-arrow path { fill: var(--graph-edge-ink, #525252); }
    .graph-arrow-selected path { fill: var(--graph-connection-focus, #096a83); }
    .graph-node .node-outline { opacity: 0; pointer-events: none; stroke-width: .9px; }
    .graph-node:focus-visible .node-outline { opacity: .8; stroke-dasharray: 2 4; }
    .graph-node.is-dimmed,.graph-note.is-dimmed,.graph-edge.is-dimmed { opacity: var(--selection-muted-opacity, .34); }
    .graph-node.is-region-muted,.graph-note.is-region-muted,.graph-edge.is-region-muted { opacity: var(--region-muted-opacity, .14); }
    .node-outline { stroke: var(--graph-focus-color, #334ce6); }
    .graph-edge .edge-highlight { stroke: var(--graph-connection-focus, #096a83); opacity: 0; pointer-events: none; stroke-width: 2px; }
    .graph-edge:hover .edge-highlight,.graph-edge:focus-visible .edge-highlight { opacity: .16; }
    .graph-edge.is-selected .edge-highlight { opacity: .12; }
    .edge-label { font-family: var(--ui-font, "Helvetica Neue", Helvetica, Arial, sans-serif); font-size: var(--edge-font-size, 18px); fill: var(--graph-edge-ink, #525252); paint-order: stroke fill; stroke: var(--graph-label-halo, #fff); stroke-width: 7px; stroke-linejoin: round; }
    .graph-edge.is-selected .edge-label { fill: var(--graph-connection-focus, #096a83); }
    .edge-night-contrast { display: none; pointer-events: none; }
    .graph-note:focus-visible { outline: 1px solid var(--graph-focus-color, #234fd1); outline-offset: 4px; }
    @media (prefers-reduced-motion: reduce) { .graph-node,.graph-edge,.graph-note { transition: none; } }
  `;
  definitions.append(localStyle);
  const gridPattern = svgElement('pattern', { id: 'frame12-dot-grid', patternUnits: 'userSpaceOnUse', width: 20, height: 20 });
  const gridDot = svgElement('circle', { cx: 0, cy: 0, r: 1, class: 'grid-dot' });
  gridPattern.append(gridDot);
  definitions.append(gridPattern);
  svg.append(definitions);
  const gridBackground = svgElement('rect', { class: 'graph-grid', fill: 'url(#frame12-dot-grid)', 'aria-hidden': 'true', 'pointer-events': 'none' });
  const backgroundLayer = svgElement('g', { class: 'graph-backgrounds', 'aria-hidden': 'true' });
  const edgeLayer = svgElement('g', { class: 'graph-connections' });
  const nodeLayer = svgElement('g', { class: 'graph-nodes' });
  const noteLayer = svgElement('g', { class: 'graph-notes' });
  const editLayer = svgElement('g', { class: 'graph-edit-controls', 'aria-label': 'Connection adjustment handles' });
  const snapIndicator = svgElement('circle', { class: 'snap-indicator', r: 4, 'aria-hidden': 'true', 'pointer-events': 'none', visibility: 'hidden' });
  const nodeAura = createNodeAura(definitions);
  const selectionGlow = createSelectionGlow(definitions);
  const nodeRipple = createNodeClickRipple(svg);
  svg.append(gridBackground, backgroundLayer, selectionGlow.layer, nodeAura.layer, edgeLayer, nodeLayer, noteLayer, editLayer, snapIndicator);
  const frameFill = data.frame?.fill_color || '#ffffff';
  const frameShape = svgElement('rect', { ...frameBounds, class: 'graph-frame',
    fill: frameFill, stroke: data.frame?.border_color || 'none' });
  frameShape.style.fill = 'var(--graph-frame-fill, #fff)';
  if (data.frame?.border_color && data.frame.border_color !== 'none') frameShape.style.stroke = 'var(--graph-node-border, #525252)';
  backgroundLayer.append(frameShape);

  for (const item of canvasItems) {
    if (item.display_location !== 'canvas' || item.role === 'frame') continue;
    const box = boxOf(item);
    const group = svgElement('g', { 'data-id': item.item_id, class: item.role === 'background' ? 'graph-background' : 'graph-note',
      'data-section': callbacks.regionForItem?.(item),
      transform: item.layout?.rotation_degrees ? `rotate(${item.layout.rotation_degrees} ${box.x + box.width / 2} ${box.y + box.height / 2})` : null });
    if (item.role === 'background') {
      const neutral = String(item.fill_color).toLowerCase() === '#f7f7f7';
      const shape = renderShape(item, { class: neutral ? 'graph-panel graph-panel-neutral' : 'graph-panel graph-panel-stage' });
      shape.style.fill = neutral ? 'var(--graph-panel-fill, #f4f4f4)' : 'var(--graph-stage-fill, #e8e8e8)';
      if (item.border_color && item.border_color !== 'none') shape.style.stroke = 'var(--graph-node-border, #525252)';
      group.append(shape);
      backgroundLayer.append(group);
    } else {
      group.setAttribute('tabindex', '0');
      group.setAttribute('role', 'button');
      group.setAttribute('aria-label', item.text || 'Source note');
      group.append(renderText(item, item.source_html, item.text));
      noteElements.set(String(item.item_id), { element: group, item });
      enableKeyboard(group, () => { if (!editing) callbacks.onSelectNote?.(item); });
      noteLayer.append(group);
    }
  }

  let routes;
  try {
    if (nodes.some(node => nodeOverlaps(node))) throw new Error('Stored nodes overlap');
    routes = routeConnections(nodes, connections);
  } catch {
    for (const node of nodes) Object.assign(node.layout, initialNodeById.get(node.node_id).layout);
    storedLayout = null;
    routes = routeConnections(nodes, connections);
  }
  if (storedLayout?.edges && typeof storedLayout.edges === 'object') {
    for (const edge of connections) {
      const points = storedLayout.edges[edge.connection_id];
      if (Array.isArray(points) && points.length >= 2 && points.length <= 100 && points.every(point => point && [point.x, point.y].every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e6))
        && sameEndpoints(points, routes.get(edge.connection_id).points)
        && validateManualRoute(points, edge, nodes, routes).valid) {
        manualRoutes.set(edge.connection_id, structuredClone(points));
        routes.set(edge.connection_id, routeFromPoints(points, edge, nodes, labelRoutes()));
      }
    }
  }
  const markers = new Map();
  const selectedMarkers = new Map();
  function markerFor(color, width, section) {
    const key = `${color}:${width}:${section || ''}`;
    if (markers.has(key)) return markers.get(key);
    const id = `frame12-arrow-${markers.size}`;
    // Keep source-sized arrows when minimum screen-space strokes improve an overview.
    const marker = svgElement('marker', { id, class: 'graph-arrow', 'data-section': section, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: width * 7, markerHeight: width * 7, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' });
    marker.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 Z', fill: color }));
    definitions.append(marker);
    markers.set(key, id);
    return id;
  }

  function selectedMarkerFor(width, section) {
    const key = `${width}:${section || ''}`;
    if (selectedMarkers.has(key)) return selectedMarkers.get(key);
    const id = `frame12-arrow-selected-${selectedMarkers.size}`;
    const marker = svgElement('marker', { id, class: 'graph-arrow-selected', 'data-section': section, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: width * 7, markerHeight: width * 7, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' });
    marker.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 Z', fill: '#234fd1' }));
    definitions.append(marker);
    selectedMarkers.set(key, id);
    return id;
  }

  for (const edge of connections) {
    const start = nodeById.get(String(edge.start_node_id));
    const end = nodeById.get(String(edge.end_node_id));
    if (!start || !end) continue;
    const route = routes.get(String(edge.connection_id));
    const color = edge.line_color || '#313131';
    const width = number(edge.line_width, 2);
    const section = callbacks.regionForItem?.(start) || callbacks.regionForItem?.(end);
    const markerId = markerFor(color, width, section);
    const selectedMarkerId = selectedMarkerFor(width, section);
    const group = svgElement('g', { class: 'graph-edge', 'data-id': edge.connection_id, 'data-route-status': manualRoutes.has(edge.connection_id) ? 'user-adjusted' : 'staggered-provisional',
      'data-source-line-type': edge.line_type, 'data-display-line-type': route.kind, 'data-section': section, tabindex: '0', role: 'button',
      'aria-label': `${edge.start_code || start.node_text} to ${edge.end_code || end.node_text}${edge.label_text ? `: ${edge.label_text}` : ''}` });
    const title = svgElement('title');
    title.textContent = `${edge.connection_id}${edge.label_text ? ` — ${edge.label_text}` : ''}`;
    group.append(title);
    group.style.setProperty('--source-stroke-width', `${width}px`);
    const contrast = svgElement('path', { class: 'edge-night-contrast', d: edge.path_data || route.d, fill: 'none',
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      'stroke-dasharray': edge.dash_array || (edge.line_style === 'dashed' ? '5,5' : null) });
    const highlight = svgElement('path', { class: 'edge-highlight', d: edge.path_data || route.d, fill: 'none', stroke: '#234fd1', 'stroke-width': width + 12, 'vector-effect': 'non-scaling-stroke' });
    const path = svgElement('path', { class: 'edge-line', d: edge.path_data || route.d, fill: 'none', stroke: color, 'stroke-width': width,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': edge.dash_array || (edge.line_style === 'dashed' ? '5,5' : null),
      'marker-end': edge.direction === 'end_to_start' || edge.direction === 'none' ? null : `url(#${markerId})`,
      'marker-start': edge.direction === 'end_to_start' || edge.direction === 'bidirectional' ? `url(#${markerId})` : null });
    const hit = svgElement('path', { class: 'edge-hit', d: edge.path_data || route.d, fill: 'none', stroke: 'transparent', 'stroke-width': '15', 'vector-effect': 'non-scaling-stroke' });
    group.append(highlight, contrast, path, hit);
    if (edge.label_text) {
      const midpoint = routeMidpoint(route.points);
      const point = route.label || { x: midpoint.x, y: midpoint.y - 12 };
      const label = svgElement('text', { class: 'edge-label', x: edge.label_x ?? point.x, y: edge.label_y ?? point.y,
        fill: color, 'font-family': 'Helvetica Neue, Helvetica, Arial, sans-serif', 'font-size': 18, 'text-anchor': 'middle' });
      const lines = String(edge.label_text).split('\n');
      lines.forEach((line, index) => {
        if (index) label.append(document.createTextNode('\n'));
        const span = svgElement('tspan', { x: edge.label_x ?? point.x, dy: index ? '1.2em' : 0 });
        span.textContent = line;
        label.append(span);
      });
      group.append(label);
    }
    edgeLayer.append(group);
    edgeElements.set(String(edge.connection_id), { element: group, edge, path, selectedMarkerId });
    enableKeyboard(group, () => activateItem('edge', edge.connection_id));
  }

  for (const node of nodes) {
    const group = svgElement('g', { class: 'graph-node', 'data-id': node.node_id, tabindex: '0', role: 'button', 'aria-label': formatNodeTitle(node.node_text),
      'data-section': callbacks.regionForItem?.(node), 'data-folder-variant': node.source_shape,
      'aria-pressed': 'false' });
    const title = svgElement('title');
    title.textContent = formatNodeTitle(node.node_text);
    const initialNode = initialNodeById.get(node.node_id);
    const shape = renderShape(initialNode, { class: 'node-shape' });
    shape.style.setProperty('--source-stroke-width', `${number(node.layout?.border_width, 1)}px`);
    const outline = renderShape(initialNode, { class: 'node-outline', fill: 'none', stroke: '#234fd1', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' });
    group.append(title, shape, outline, renderText(initialNode, node.label_html, node.node_text, true));
    nodeLayer.append(group);
    nodeElements.set(String(node.node_id), { element: group, node });
    positionNode(node);
    enableKeyboard(group, () => activateItem('node', node.node_id));
  }

  function sameEndpoints(a, b) {
    return Math.hypot(a[0].x - b[0].x, a[0].y - b[0].y) < .01
      && Math.hypot(a.at(-1).x - b.at(-1).x, a.at(-1).y - b.at(-1).y) < .01;
  }

  function nodeOverlaps(node) {
    const a = boxOf(node);
    return nodes.some(other => {
      if (other.node_id === node.node_id) return false;
      const b = boxOf(other);
      return a.x < b.x + b.width + 12 && a.x + a.width + 12 > b.x
        && a.y < b.y + b.height + 12 && a.y + a.height + 12 > b.y;
    });
  }

  function positionNode(node) {
    const element = nodeElements.get(node.node_id)?.element;
    if (!element) return;
    const initial = initialNodeById.get(node.node_id).layout;
    const dx = node.layout.x - initial.x, dy = node.layout.y - initial.y;
    const factor = emphasisScales.get(String(node.node_id)) || 1;
    const cx = initial.x + initial.width / 2, cy = initial.y + initial.height / 2;
    if (factor !== 1) element.setAttribute('transform', `translate(${dx} ${dy}) translate(${cx} ${cy}) scale(${factor}) translate(${-cx} ${-cy})`);
    else if (dx || dy) element.setAttribute('transform', `translate(${dx} ${dy})`);
    else element.removeAttribute('transform');
    element.dataset.emphasisScale = factor;
    element.dataset.layoutX = node.layout.x;
    element.dataset.layoutY = node.layout.y;
  }

  function paintRoute(id, route, displayOnly = false) {
    if (!displayOnly) routes.set(id, route);
    const entry = edgeElements.get(id);
    if (!entry) return;
    for (const path of entry.element.querySelectorAll('path')) path.setAttribute('d', route.d);
    entry.element.dataset.displayLineType = route.kind;
    entry.element.dataset.routeStatus = manualRoutes.has(id) ? 'user-adjusted' : 'staggered-provisional';
    const label = entry.element.querySelector('.edge-label');
    if (label) {
      const middle = routeMidpoint(route.points), point = route.label || { x: middle.x, y: middle.y - 14 };
      label.setAttribute('x', point.x); label.setAttribute('y', point.y);
      for (const span of label.querySelectorAll('tspan')) span.setAttribute('x', point.x);
    }
  }

  function displayNode(node, factor = emphasisScales.get(String(node.node_id)) || 1) {
    const box = boxOf(node);
    return { ...node, layout: { ...node.layout,
      x: box.x - box.width * (factor - 1) / 2, y: box.y - box.height * (factor - 1) / 2,
      width: box.width * factor, height: box.height * factor,
    } };
  }

  function updateDisplayGeometry() {
    let changed = false;
    for (const [id, { element }] of nodeElements) {
      const emphasized = element.classList.contains('is-spider-match')
        || element.classList.contains('is-public-influence-match');
      const selected = element.classList.contains('is-selected');
      const factor = editing ? 1 : emphasized ? (selected ? 1.20 : 1.16) : selected ? 1.12 : 1;
      if ((emphasisScales.get(id) || 1) !== factor) changed = true;
      emphasisScales.set(id, factor);
    }
    if (!changed) return;
    for (const node of nodes) positionNode(node);
    if ([...emphasisScales.values()].some(factor => factor > 1)) {
      const displayed = nodes.map(node => displayNode(node));
      displayRoutes = routeConnections(displayed, connections);
      // A valid local adjustment survives emphasis; temporary reroutes are never saved.
      for (const [id, points] of manualRoutes) {
        if (sameEndpoints(points, displayRoutes.get(id).points)
          && validateManualRoute(points, connectionById.get(id), displayed, displayRoutes).valid) {
          displayRoutes.set(id, routeFromPoints(points, connectionById.get(id), displayed, labelRoutes(displayRoutes)));
        }
      }
    } else displayRoutes = null;
    for (const [id, route] of displayRoutes || routes) paintRoute(id, route, true);
  }

  function fitNodeLabels() {
    for (const { element } of nodeElements.values()) {
      const wrapper = element.querySelector('.graph-rich-text');
      if (!wrapper?.clientWidth || !wrapper.clientHeight) continue;
      const content = wrapper.firstElementChild;
      let size = 25;
      wrapper.style.fontSize = `${size}px`;
      while (size > 18 && (content.scrollHeight > wrapper.clientHeight + 1 || content.scrollWidth > wrapper.clientWidth + 1)) {
        size -= .5;
        wrapper.style.fontSize = `${size}px`;
      }
    }
  }

  function layoutData() {
    const positions = {};
    for (const node of nodes) {
      const source = sourceNodeById.get(node.node_id).layout;
      const initial = initialNodeById.get(node.node_id).layout;
      if (Math.abs(node.layout.x - initial.x) > .001 || Math.abs(node.layout.y - initial.y) > .001) {
        positions[node.node_id] = {
          x: node.layout.x + source.x - initial.x,
          y: node.layout.y + source.y - initial.y,
        };
      }
    }
    return { version: 1, nodes: positions, edges: Object.fromEntries(manualRoutes) };
  }

  function notifyLayout(message) {
    const layout = layoutData();
    callbacks.onLayoutChange?.({ editing, busy, dirty: Object.keys(layout.nodes).length > 0 || manualRoutes.size > 0,
      canUndo: undoStack.length > 0, canRedo: redoStack.length > 0, storageAvailable, message });
  }

  function saveLayout(message) {
    const layout = layoutData();
    try {
      if (Object.keys(layout.nodes).length || Object.keys(layout.edges).length) localStorage.setItem(storageKey, JSON.stringify(layout));
      else localStorage.removeItem(storageKey);
      storageAvailable = true;
    } catch { storageAvailable = false; }
    notifyLayout(storageAvailable ? (message || 'Saved on this device')
      : `${message ? message.replace(' · Saved on this device', '') + '. ' : ''}Changes kept for this session`);
  }

  function captureLayout() {
    return { nodes: nodes.map(node => ({ id: node.node_id, x: node.layout.x, y: node.layout.y })),
      manual: structuredClone([...manualRoutes]), routes: new Map(routes) };
  }

  function restoreLayout(state) {
    for (const position of state.nodes) {
      const node = nodeById.get(position.id);
      Object.assign(node.layout, { x: position.x, y: position.y }); positionNode(node);
    }
    manualRoutes = new Map(structuredClone(state.manual));
    routes = new Map(state.routes);
    for (const [id, route] of routes) paintRoute(id, route);
    updateEmphasis(); drawHandles();
  }

  function remember(state) {
    undoStack.push(state);
    if (undoStack.length > 40) undoStack.shift();
    redoStack.length = 0;
  }

  function activateItem(kind, id) {
    if (busy) return;
    if (editing) {
      selectedNode = kind === 'node' ? id : null;
      selectedConnection = kind === 'edge' ? id : null;
      updateEmphasis(); drawHandles();
      notifyLayout(kind === 'edge' ? 'Drag a line or its handles to adjust the route' : 'Drag the node · Arrow keys move one grid step');
    } else if (kind === 'node') {
      const entry = nodeElements.get(String(id));
      callbacks.onSelectNode?.(nodeById.get(id));
      if (entry) nodeRipple.play({
        parent: entry.element, shape: entry.element.querySelector('.node-shape'),
        nodeId: id, section: entry.element.dataset.section,
      });
    } else callbacks.onSelectConnection?.(edgeElements.get(id)?.edge);
  }

  function drawHandles() {
    editLayer.replaceChildren();
    if (!editing || !selectedConnection) return;
    const route = routes.get(selectedConnection);
    if (!route) return;
    const scale = Math.max(.001, viewportWidth / view.width);
    const section = edgeElements.get(selectedConnection).element.dataset.section;
    if (section) editLayer.dataset.section = section; else delete editLayer.dataset.section;
    for (const handle of editableSegments(route.points)) {
      const attributes = { cx: handle.x, cy: handle.y, 'data-edge-id': selectedConnection,
        'data-segment-index': handle.index, 'data-axis': handle.axis };
      const hit = svgElement('circle', { ...attributes, r: 13 / scale, class: 'edge-handle-hit', fill: 'transparent' });
      const dot = svgElement('circle', { ...attributes, r: 4 / scale, class: 'edge-handle', tabindex: '0', role: 'slider',
        'aria-label': `Move ${handle.axis === 'x' ? 'vertical' : 'horizontal'} line segment`,
        'aria-orientation': handle.axis === 'x' ? 'horizontal' : 'vertical',
        'aria-valuenow': Math.round(handle.axis === 'x' ? handle.x : handle.y), 'vector-effect': 'non-scaling-stroke' });
      editLayer.append(hit, dot);
    }
  }

  function showSnap(point) {
    snapIndicator.setAttribute('cx', point.x); snapIndicator.setAttribute('cy', point.y);
    snapIndicator.setAttribute('r', 4 / Math.max(.001, viewportWidth / view.width));
    snapIndicator.setAttribute('visibility', 'visible');
  }

  function undo() {
    if (busy || drag || !undoStack.length) return;
    redoStack.push(captureLayout()); restoreLayout(undoStack.pop()); saveLayout('Undone · Saved on this device');
  }

  function redo() {
    if (busy || drag || !redoStack.length) return;
    undoStack.push(captureLayout()); restoreLayout(redoStack.pop()); saveLayout('Redone · Saved on this device');
  }

  function updateEmphasis() {
    const selectedIds = new Set(selectedNode === null ? [] : [selectedNode]);
    const neighborIds = new Set();
    const activeEdges = new Set();
    if (selectedConnection) {
      const edge = edgeElements.get(String(selectedConnection))?.edge;
      if (edge) { selectedIds.add(String(edge.start_node_id)); selectedIds.add(String(edge.end_node_id)); }
    }
    for (const [id, { edge }] of edgeElements) {
      const startId = String(edge.start_node_id);
      const endId = String(edge.end_node_id);
      if (id === selectedConnection || (selectedNode && (startId === selectedNode || endId === selectedNode))) {
        activeEdges.add(id);
        neighborIds.add(startId);
        neighborIds.add(endId);
      }
    }
    const hasSelection = focusMode && selectedIds.size > 0;
    const hasQuery = queryIds !== null || spiderIds !== null || publicInfluenceIds !== null;
    const isMatch = id => queryIds?.has(id) || spiderIds?.has(id) || publicInfluenceIds?.has(id);
    svg.classList.toggle('has-selection', hasSelection);
    svg.classList.toggle('has-spider-query', spiderIds !== null);
    svg.classList.toggle('has-public-influence', publicInfluenceIds !== null);
    for (const [id, { element }] of nodeElements) {
      const selected = selectedIds.has(id);
      const related = selected || neighborIds.has(id);
      const matched = isMatch(id);
      element.classList.toggle('is-spider-match', Boolean(spiderIds?.has(id)));
      element.classList.toggle('is-public-influence-match', Boolean(publicInfluenceIds?.has(id)));
      element.classList.toggle('is-selected', selected);
      element.classList.toggle('is-primary', id === selectedNode);
      element.classList.toggle('is-neighbor', !selected && neighborIds.has(id));
      element.classList.toggle('is-dimmed', !related && (hasQuery ? !matched : hasSelection));
      element.classList.toggle('is-region-muted', Boolean(activeRegion && element.dataset.section !== activeRegion && !selected && !matched));
      element.setAttribute('aria-pressed', String(selected));
    }
    for (const [id, { element, edge, path, selectedMarkerId }] of edgeElements) {
      const active = activeEdges.has(id);
      element.classList.toggle('is-selected', active);
      element.classList.toggle('is-primary', id === selectedConnection);
      // Keep source arrow attributes intact; only active edges use the focus marker.
      for (const endpoint of ['marker-start', 'marker-end']) {
        if (active && path.hasAttribute(endpoint)) path.style.setProperty(endpoint, `url(#${selectedMarkerId})`);
        else path.style.removeProperty(endpoint);
      }
      const matched = isMatch(String(edge.start_node_id)) || isMatch(String(edge.end_node_id));
      element.classList.toggle('is-dimmed', !active && (hasQuery ? !matched : hasSelection));
      element.classList.toggle('is-spider-match', Boolean(spiderIds?.has(String(edge.start_node_id)) && spiderIds?.has(String(edge.end_node_id))));
      element.classList.toggle('is-public-influence-link', Boolean(publicInfluenceIds?.has(String(edge.start_node_id)) || publicInfluenceIds?.has(String(edge.end_node_id))));
      element.classList.toggle('is-region-muted', Boolean(activeRegion && element.dataset.section !== activeRegion && id !== selectedConnection && !matched));
      const label = element.querySelector('.edge-label');
      if (label) label.style.display = labelsVisible ? '' : 'none';
    }
    for (const { element } of noteElements.values()) {
      element.classList.toggle('is-region-muted', Boolean(activeRegion && element.dataset.section !== activeRegion));
    }
    updateDisplayGeometry();
    updateGlow();
  }

  function updateGlow() {
    const auraNodes = [];
    for (const [id, { element, node }] of nodeElements) {
      auraNodes.push({ id, box: boxOf(displayNode(node)), shape: node.shape, source_shape: node.source_shape, folder_variant: node.source_shape, section: element.dataset.section,
        muted: element.classList.contains('is-region-muted'), dimmed: element.classList.contains('is-dimmed'),
        selected: element.classList.contains('is-selected'), neighbor: element.classList.contains('is-neighbor'),
        queryMatched: Boolean(spiderIds?.has(id) || publicInfluenceIds?.has(id)) });
    }
    const scale = Math.max(.001, viewportWidth / view.width);
    nodeAura.update(auraNodes, scale);
    const glowNodes = [], glowEdges = [];
    if (focusMode) {
      for (const [id, { element, node }] of nodeElements) {
        if (!element.classList.contains('is-selected') || element.classList.contains('is-region-muted')) continue;
        glowNodes.push({ id, box: boxOf(displayNode(node)), shape: node.shape, source_shape: node.source_shape, folder_variant: node.source_shape, section: element.dataset.section, primary: id === selectedNode });
      }
      for (const [id, { element }] of edgeElements) {
        if (!element.classList.contains('is-selected') || element.classList.contains('is-region-muted')) continue;
        glowEdges.push({ id, d: (displayRoutes || routes).get(id).d, section: element.dataset.section, primary: id === selectedConnection });
      }
    }
    selectionGlow.update({ nodes: glowNodes, edges: glowEdges }, scale);
  }

  function getView() {
    return { ...view, scale: viewportWidth / view.width, zoom: frameBounds.width / view.width };
  }

  function applyView() {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`);
    const scale = Math.max(0.001, Math.min(viewportWidth / view.width, viewportHeight / view.height));
    // Connection weights stay legible while the node auras follow their source geometry.
    svg.style.setProperty('--graph-min-edge-stroke', `${0.6 / scale}px`);
    svg.style.setProperty('--graph-active-edge-stroke', `${1.1 / scale}px`);
    svg.style.setProperty('--graph-primary-edge-stroke', `${1.5 / scale}px`);
    nodeAura.resize(scale);
    selectionGlow.resize(scale);
    gridStep = gridStepForScale(scale);
    svg.dataset.gridStep = gridStep;
    gridPattern.setAttribute('width', gridStep); gridPattern.setAttribute('height', gridStep);
    gridPattern.setAttribute('x', -gridStep / 2); gridPattern.setAttribute('y', -gridStep / 2);
    gridDot.setAttribute('cx', gridStep / 2); gridDot.setAttribute('cy', gridStep / 2);
    gridDot.setAttribute('r', .7 / scale);
    for (const name of ['x', 'y', 'width', 'height']) gridBackground.setAttribute(name, view[name]);
    drawHandles();
    callbacks.onViewChange?.(getView());
  }

  function readSize() {
    const rect = svg.getBoundingClientRect();
    viewportWidth = Math.max(1, rect.width);
    viewportHeight = Math.max(1, rect.height);
  }

  function focusBounds(bounds) {
    readSize();
    const padding = 1.12;
    const width = Math.max(150, number(bounds.width, frameBounds.width)) * padding;
    const height = Math.max(100, number(bounds.height, frameBounds.height)) * padding;
    const aspect = viewportWidth / viewportHeight;
    const fittedWidth = Math.max(width, height * aspect);
    const fittedHeight = fittedWidth / aspect;
    view = { x: number(bounds.x) + number(bounds.width) / 2 - fittedWidth / 2,
      y: number(bounds.y) + number(bounds.height) / 2 - fittedHeight / 2, width: fittedWidth, height: fittedHeight };
    applyView();
  }

  function zoomBy(factor, anchor) {
    const old = { ...view };
    const minimum = 500;
    const maximum = Math.max(frameBounds.width * 4, frameBounds.height * 4 * viewportWidth / viewportHeight);
    const newWidth = Math.min(maximum, Math.max(minimum, old.width / factor));
    const ratio = newWidth / old.width;
    const point = anchor || { x: old.x + old.width / 2, y: old.y + old.height / 2 };
    view = { x: point.x - (point.x - old.x) * ratio, y: point.y - (point.y - old.y) * ratio,
      width: newWidth, height: old.height * ratio };
    applyView();
  }

  function pointAtClient(clientX, clientY) {
    const point = new DOMPoint(clientX, clientY).matrixTransform(svg.getScreenCTM().inverse());
    return { x: point.x, y: point.y };
  }

  svg.addEventListener('wheel', event => {
    event.preventDefault();
    if (drag || busy) return;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewportHeight : 1);
    zoomBy(Math.exp(-Math.max(-300, Math.min(300, delta)) * 0.0018), pointAtClient(event.clientX, event.clientY));
  }, { passive: false });

  function labelRoutes(routeMap = routes) {
    return new Map([...routeMap].map(([id, route]) => [id, { ...route, label_text: connectionById.get(id)?.label_text }]));
  }

  function commitNodeMove(before, node) {
    if (nodeOverlaps(node)) {
      restoreLayout(before); notifyLayout('Not moved: leave space between nodes'); return;
    }
    busy = true; svg.setAttribute('aria-busy', 'true'); notifyLayout('Updating connections…');
    // Preview is immediate; the full obstacle-aware routing runs once on release.
    setTimeout(() => {
      let message;
      try {
        const nextRoutes = routeConnections(nodes, connections), kept = new Map();
        for (const [id, points] of manualRoutes) {
          const edge = edgeElements.get(id).edge;
          if (sameEndpoints(points, nextRoutes.get(id).points) && validateManualRoute(points, edge, nodes, nextRoutes).valid) {
            kept.set(id, points); nextRoutes.set(id, routeFromPoints(points, edge, nodes, labelRoutes(nextRoutes)));
          }
        }
        remember(before); manualRoutes = kept; routes = nextRoutes;
        for (const [id, route] of routes) paintRoute(id, route);
        drawHandles(); updateGlow();
      } catch {
        restoreLayout(before); message = 'Not moved: this position blocks a connection. Try a nearby grid point.';
      } finally {
        busy = false; svg.removeAttribute('aria-busy'); saveLayout(message);
      }
    }, 24);
  }

  function commitLineMove(before, id, points) {
    const edge = edgeElements.get(id).edge;
    const check = validateManualRoute(points, edge, nodes, routes);
    if (!sameEndpoints(points, before.routes.get(id).points) || !check.valid) {
      restoreLayout(before); notifyLayout('Not moved: keep the line clear of nodes and other lines'); return;
    }
    if (JSON.stringify(points) === JSON.stringify(before.routes.get(id).points)) { restoreLayout(before); return; }
    remember(before); manualRoutes.set(id, structuredClone(points));
    paintRoute(id, routeFromPoints(points, edge, nodes, labelRoutes()));
    drawHandles(); updateGlow(); saveLayout();
  }

  function previewNode(node, before) {
    positionNode(node);
    const old = before.nodes.find(position => position.id === node.node_id);
    const dx = node.layout.x - old.x, dy = node.layout.y - old.y;
    for (const [id, entry] of edgeElements) {
      const isStart = entry.edge.start_node_id === node.node_id, isEnd = entry.edge.end_node_id === node.node_id;
      if (!isStart && !isEnd) continue;
      const original = before.routes.get(id).points, points = structuredClone(original);
      for (const [moving, index, neighbor] of [[isStart, 0, 1], [isEnd, points.length - 1, points.length - 2]]) {
        if (!moving) continue;
        points[index].x += dx; points[index].y += dy;
        if (points.length > 2) {
          if (Math.abs(original[index].x - original[neighbor].x) < .01) points[neighbor].x += dx;
          else points[neighbor].y += dy;
        }
      }
      paintRoute(id, routeFromPoints(points, entry.edge));
    }
    updateGlow();
    nodeElements.get(node.node_id).element.classList.toggle('is-invalid', nodeOverlaps(node));
  }

  svg.addEventListener('pointerdown', event => {
    if (busy || drag || ![0, 1].includes(event.button) || event.target.closest('a')) return;
    const handle = event.target.closest('.edge-handle,.edge-handle-hit');
    const target = event.target.closest('.graph-node,.graph-edge,.graph-note');
    const point = pointAtClient(event.clientX, event.clientY);
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, point, view: { ...view }, moved: false,
      target, mode: 'pan', step: gridStep };
    if (editing && event.button === 0 && !spaceHeld) {
      if (target?.classList.contains('graph-node')) {
        drag.mode = 'node'; drag.id = target.dataset.id; drag.before = captureLayout();
        drag.center = center(boxOf(nodeById.get(drag.id)));
      } else if (handle || target?.classList.contains('graph-edge')) {
        drag.id = handle?.dataset.edgeId || target.dataset.id;
        const route = routes.get(drag.id), handles = editableSegments(route.points);
        const closest = handle ? handles.find(h => h.index === Number(handle.dataset.segmentIndex))
          : handles.reduce((best, h) => {
            const a = route.points[h.index], b = route.points[h.index + 1];
            const length = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
            const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / length)) : 0;
            const distance = Math.hypot(point.x - a.x - t * (b.x - a.x), point.y - a.y - t * (b.y - a.y));
            return !best || distance < best.distance ? { ...h, distance } : best;
          }, null);
        if (closest) { drag.mode = 'edge'; drag.handle = closest; drag.before = captureLayout(); }
      }
    }
    event.preventDefault(); svg.focus({ preventScroll: true }); svg.setPointerCapture(event.pointerId);
  });

  svg.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) <= 4) return;
    if (!drag.moved && drag.mode !== 'pan') activateItem(drag.mode, drag.id);
    drag.moved = true;
    if (drag.mode === 'pan') {
      svg.classList.add('is-panning');
      view = { ...drag.view, x: drag.view.x - dx / viewportWidth * drag.view.width,
        y: drag.view.y - dy / viewportHeight * drag.view.height }; applyView(); return;
    }
    svg.classList.add('is-edit-dragging');
    const delta = { x: dx / viewportWidth * drag.view.width, y: dy / viewportHeight * drag.view.height };
    if (drag.mode === 'node') {
      const node = nodeById.get(drag.id);
      const point = { x: snap(drag.center.x + delta.x, drag.step), y: snap(drag.center.y + delta.y, drag.step) };
      node.layout.x = point.x - node.layout.width / 2; node.layout.y = point.y - node.layout.height / 2;
      previewNode(node, drag.before); showSnap(point);
    } else {
      const { handle } = drag, edge = edgeElements.get(drag.id).edge;
      const coordinate = (handle.axis === 'x' ? handle.x + delta.x : handle.y + delta.y);
      const points = moveRouteSegment(drag.before.routes.get(drag.id).points, handle.index, coordinate, drag.step, edge);
      paintRoute(drag.id, routeFromPoints(points, edge)); drawHandles(); updateGlow();
      edgeElements.get(drag.id).element.classList.toggle('is-invalid', !validateManualRoute(points, edge, nodes, routes).valid);
      showSnap({ x: handle.axis === 'x' ? snap(coordinate, drag.step) : snap(handle.x, drag.step),
        y: handle.axis === 'y' ? snap(coordinate, drag.step) : snap(handle.y, drag.step) });
    }
  });

  function releasePointer(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const state = drag; drag = null;
    svg.classList.remove('is-panning', 'is-edit-dragging');
    for (const element of svg.querySelectorAll('.is-invalid')) element.classList.remove('is-invalid');
    snapIndicator.setAttribute('visibility', 'hidden');
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    if (event.type !== 'pointerup') {
      if (state.before && state.moved) restoreLayout(state.before);
      if (state.mode === 'pan') { view = state.view; applyView(); }
      notifyLayout('Move cancelled'); return;
    }
    if (state.moved && state.mode === 'node') commitNodeMove(state.before, nodeById.get(state.id));
    else if (state.moved && state.mode === 'edge') commitLineMove(state.before, state.id, routes.get(state.id).points);
    else if (!state.moved) {
      if (state.mode === 'edge' && !state.target) activateItem('edge', state.id);
      else if (state.target) {
        state.target.focus({ preventScroll: true });
        if (state.target.classList.contains('graph-node')) activateItem('node', state.target.dataset.id);
        else if (state.target.classList.contains('graph-edge')) activateItem('edge', state.target.dataset.id);
        else if (!editing) callbacks.onSelectNote?.(noteElements.get(state.target.dataset.id)?.item);
      }
    }
  }
  svg.addEventListener('pointerup', releasePointer);
  svg.addEventListener('pointercancel', releasePointer);
  svg.addEventListener('lostpointercapture', event => { if (drag) releasePointer({ type: 'pointercancel', pointerId: event.pointerId }); });

  svg.addEventListener('keydown', event => {
    if (!editing || busy || event.target.closest('a')) return;
    if (event.key === 'Escape' && drag) {
      event.preventDefault(); event.stopPropagation(); releasePointer({ type: 'pointercancel', pointerId: drag.pointerId }); return;
    }
    if (event.key === ' ') { event.preventDefault(); event.stopPropagation(); spaceHeld = true; svg.classList.add('space-pan'); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target.closest('.graph-node'), handle = event.target.closest('.edge-handle');
    if (!target && !handle) return;
    event.preventDefault(); event.stopPropagation();
    const before = captureLayout(), amount = gridStep * (event.shiftKey ? 5 : 1);
    const dx = event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0;
    const dy = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0;
    if (target) {
      const node = nodeById.get(target.dataset.id), c = center(boxOf(node));
      node.layout.x = snap(c.x + dx, gridStep) - node.layout.width / 2;
      node.layout.y = snap(c.y + dy, gridStep) - node.layout.height / 2;
      previewNode(node, before); target.classList.remove('is-invalid'); commitNodeMove(before, node);
    } else {
      const id = handle.dataset.edgeId, index = Number(handle.dataset.segmentIndex), axis = handle.dataset.axis;
      if (axis === 'x' && !dx || axis === 'y' && !dy) return;
      const coordinate = Number(handle.getAttribute(axis === 'x' ? 'cx' : 'cy')) + (axis === 'x' ? dx : dy);
      const points = moveRouteSegment(routes.get(id).points, index, coordinate, gridStep, edgeElements.get(id).edge);
      commitLineMove(before, id, points);
      editLayer.querySelector(`[data-segment-index="${index}"].edge-handle`)?.focus({ preventScroll: true });
    }
  }, true);
  window.addEventListener('keyup', event => { if (event.key === ' ') { spaceHeld = false; svg.classList.remove('space-pan'); } });
  window.addEventListener('blur', () => { spaceHeld = false; svg.classList.remove('space-pan'); if (drag) releasePointer({ type: 'pointercancel', pointerId: drag.pointerId }); });

  function resize() {
    const point = center(view);
    readSize();
    fitNodeLabels();
    view.height = view.width * viewportHeight / viewportWidth;
    view.y = point.y - view.height / 2;
    applyView();
  }

  function layoutBounds(items = nodes, includeFrame = true) {
    const boxes = items.map(boxOf);
    if (includeFrame) {
      boxes.push(frameBounds);
      for (const route of routes.values()) for (const point of route.points) boxes.push({ x: point.x, y: point.y, width: 0, height: 0 });
    }
    const left = Math.min(...boxes.map(box => box.x)), top = Math.min(...boxes.map(box => box.y));
    return { x: left, y: top, width: Math.max(...boxes.map(box => box.x + box.width)) - left,
      height: Math.max(...boxes.map(box => box.y + box.height)) - top };
  }
  function fit() { focusBounds(layoutBounds()); }
  function setEditing(enabled) {
    if (busy) return;
    nodeRipple.cancel();
    if (drag) releasePointer({ type: 'pointercancel', pointerId: drag.pointerId });
    editing = Boolean(enabled); svg.dataset.editing = String(editing);
    selectedNode = null; selectedConnection = null; spaceHeld = false;
    svg.classList.remove('space-pan'); updateEmphasis(); drawHandles();
    notifyLayout(editing ? 'Drag nodes or lines · Snap to grid' : undefined);
  }
  function resetLayout() {
    if (busy || drag) return;
    const before = captureLayout();
    const layout = layoutData();
    if (!Object.keys(layout.nodes).length && !manualRoutes.size) return;
    for (const node of nodes) { Object.assign(node.layout, initialNodeById.get(node.node_id).layout); positionNode(node); }
    routes = routeConnections(nodes, connections); manualRoutes.clear();
    for (const [id, route] of routes) paintRoute(id, route);
    remember(before); drawHandles(); updateGlow(); saveLayout('Original layout restored · You can undo this');
  }
  svg.dataset.editing = 'false';
  svg.dataset.activeRegion = 'all';
  fit();
  updateEmphasis();
  document.fonts?.ready.then(fitNodeLabels);
  notifyLayout();
  return {
    fit, focusBounds, zoomBy, getView, resize, setEditing, undo, redo, resetLayout,
    isEditing: () => editing,
    isDragging: () => Boolean(drag),
    focusConnection(id) {
      const edge = edgeElements.get(String(id))?.edge;
      if (!edge) return;
      const bounds = layoutBounds([nodeById.get(edge.start_node_id), nodeById.get(edge.end_node_id)], false);
      focusBounds({ x: bounds.x - 150, y: bounds.y - 150, width: bounds.width + 300, height: bounds.height + 300 });
    },
    focusRegion(region, fallback) {
      const changed = layoutData();
      const items = nodes.filter(node => callbacks.regionForItem?.(node) === region);
      if (!Object.keys(changed.nodes).length || !items.length) { focusBounds(fallback); return; }
      const bounds = layoutBounds(items, false);
      focusBounds({ x: bounds.x - 250, y: bounds.y - 250, width: bounds.width + 500, height: bounds.height + 500 });
    },
    focusNode(id) {
      const node = nodeById.get(String(id));
      if (!node) return;
      const box = boxOf(node);
      focusBounds({ x: box.x - 300, y: box.y - 300, width: box.width + 600, height: box.height + 600 });
    },
    focusNodes(ids) {
      const items = Array.from(ids, id => nodeById.get(String(id))).filter(Boolean);
      if (!items.length) return;
      const bounds = layoutBounds(items, false);
      focusBounds({ x: bounds.x - 300, y: bounds.y - 300, width: bounds.width + 600, height: bounds.height + 600 });
    },
    setSelection(nodeId, connectionId) {
      nodeRipple.cancel();
      selectedNode = nodeId == null ? null : String(nodeId);
      selectedConnection = connectionId == null ? null : String(connectionId);
      updateEmphasis();
      drawHandles();
    },
    setActiveRegion(region) {
      nodeRipple.cancel();
      activeRegion = ['land', 'grid', 'environment', 'operation'].includes(region) ? region : null;
      svg.dataset.activeRegion = activeRegion || 'all';
      updateEmphasis();
    },
    setQuery(ids) {
      queryIds = ids === null || ids === undefined ? null : new Set(Array.from(ids, String));
      updateEmphasis();
    },
    setSpiderMatches(ids) {
      nodeRipple.cancel();
      spiderIds = ids == null ? null : new Set(Array.from(ids, String));
      updateEmphasis();
    },
    setPublicInfluence(ids) {
      nodeRipple.cancel();
      publicInfluenceIds = ids == null ? null : new Set(Array.from(ids, String));
      updateEmphasis();
    },
    setLabelsVisible(visible) { labelsVisible = Boolean(visible); updateEmphasis(); },
    setFocusMode(enabled) { focusMode = Boolean(enabled); if (!focusMode) nodeRipple.cancel(); updateEmphasis(); },
    setActive(value) { nodeRipple.setActive(value); svg.classList.toggle('spider-paused', !value); },
    destroy() { nodeRipple.destroy(); },
  };
}

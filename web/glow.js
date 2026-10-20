import { folderPath } from './folder-shape.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
let nextInstance = 0;

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== null && value !== undefined) element.setAttribute(key, String(value));
  }
  return element;
}

function scaleValue(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 1;
}

function isCircle(node) {
  return node.shape === 'circle' || node.shape === 'ellipse';
}

/** Frost follows the displayed node geometry; text and hit targets stay separate. */
function shapeForNode(node, box = node.box) {
  const { x, y, width, height } = box;
  if (node.shape === 'folder') return svgElement('path', { d: folderPath(box, node.folder_variant) });
  if (node.shape === 'rhombus') {
    return svgElement('polygon', {
      points: `${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}`,
    });
  }
  if (isCircle(node)) {
    return svgElement('ellipse', { cx: x + width / 2, cy: y + height / 2, rx: width / 2, ry: height / 2 });
  }
  return svgElement('rect', {
    x, y, width, height,
    rx: node.shape === 'round_rectangle' ? Math.min(height / 4, 20) : 0,
  });
}

function setGeometry(element, node, box = node.box) {
  const shape = shapeForNode(node, box);
  for (const attribute of shape.attributes) element.setAttribute(attribute.name, attribute.value);
}

function blurFilter(definitions, id, deviation) {
  const filter = svgElement('filter', {
    id, x: '-80%', y: '-180%', width: '260%', height: '460%', 'color-interpolation-filters': 'sRGB',
  });
  const gaussian = svgElement('feGaussianBlur', { stdDeviation: deviation });
  filter.append(gaussian);
  definitions.append(filter);
  return gaussian;
}

function pathBounds(path, d) {
  try {
    const box = path.getBBox();
    if (box.width || box.height) return box;
  } catch { /* Detached SVGs may not yet expose measurable geometry. */ }
  const values = String(d).match(/-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)?.map(Number) || [];
  const xs = values.filter((_, index) => index % 2 === 0), ys = values.filter((_, index) => index % 2 === 1);
  if (!xs.length || !ys.length) return { x: 0, y: 0, width: 1, height: 1 };
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** One deterministic tile per renderer: no per-node noise filters or animation. */
function createGrain(definitions, id) {
  const pattern = svgElement('pattern', { id, patternUnits: 'userSpaceOnUse', width: 64, height: 64 });
  let seed = 948731;
  const random = () => {
    seed = Math.imul(seed ^ seed >>> 15, 1 | seed);
    seed ^= seed + Math.imul(seed ^ seed >>> 7, 61 | seed);
    return ((seed ^ seed >>> 14) >>> 0) / 4294967296;
  };
  const paths = ['', ''];
  for (let index = 0; index < 520; index++) {
    const x = (random() * 64).toFixed(2), y = (random() * 64).toFixed(2);
    const size = (.35 + random() * .5).toFixed(2);
    paths[index % 2] += `M${x},${y}h${size}v${size}h-${size}Z`;
  }
  const dark = svgElement('path', { d: paths[0], opacity: .18 });
  dark.style.fill = 'var(--frost-grain-ink, #25468b)';
  pattern.append(dark, svgElement('path', { d: paths[1], fill: '#ffffff', opacity: .32 }));
  definitions.append(pattern);
  return pattern;
}

/** Inactive folders diffuse inward; active folders become solid elevated cards. */
export function createNodeAura(defs) {
  const prefix = `node-frost-${++nextInstance}`;
  const definitions = svgElement('g', { 'data-aura-definitions': prefix });
  defs.append(definitions);
  const layer = svgElement('g', {
    class: 'graph-node-auras', 'aria-hidden': 'true', 'pointer-events': 'none',
  });
  layer.style.pointerEvents = 'none';
  const grain = createGrain(definitions, `${prefix}-grain`);
  const edgeBlur = blurFilter(definitions, `${prefix}-edge`, 1.8);
  const focusBlur = blurFilter(definitions, `${prefix}-focus`, 5);
  const records = new Map(), paints = new Map();
  let currentScale = 1;

  function paintFor(section) {
    const key = ['land', 'grid', 'environment', 'operation'].includes(section) ? section : 'neutral';
    if (paints.has(key)) return paints.get(key);
    const id = `${prefix}-${key}-face`;
    const gradient = svgElement('linearGradient', {
      id, 'data-section': key === 'neutral' ? undefined : key,
      x1: '0%', y1: '0%', x2: '90%', y2: '100%', 'color-interpolation': 'sRGB',
    });
    for (const [offset, opacity] of [['0%', .10], ['40%', .20], ['100%', .34]]) {
      const stop = svgElement('stop', { offset, 'stop-opacity': opacity });
      stop.style.stopColor = 'var(--section-color, var(--graph-node-border, #7483b8))';
      gradient.append(stop);
    }
    definitions.append(gradient);
    paints.set(key, id);
    return id;
  }

  function applyScale() {
    edgeBlur.setAttribute('stdDeviation', Math.min(24, 1.8 / currentScale));
    focusBlur.setAttribute('stdDeviation', Math.min(90, 5 / currentScale));
    grain.setAttribute('patternTransform', `scale(${1 / currentScale})`);
  }

  function ensureQueryGlow(record) {
    if (record.query) return;
    const queryDefinitions = svgElement('g', { 'data-query-definitions': record.id });
    const group = svgElement('g', {
      class: 'node-query-glow', 'data-query-id': record.id, 'aria-hidden': 'true', 'pointer-events': 'none',
    });
    const parts = [
      { name: 'bloom', width: 14, blur: 5.8, opacity: .68, color: 'var(--spider-query-glow, #40bff7)' },
      { name: 'core', width: 4, blur: 1.8, opacity: .5, color: 'var(--spider-query-color, #297bbd)' },
    ].map(treatment => {
      const id = `${prefix}-query-${record.id}-${treatment.name}`;
      const filter = svgElement('filter', {
        id, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse',
        'color-interpolation-filters': 'sRGB',
      });
      const gaussian = svgElement('feGaussianBlur');
      filter.append(gaussian);
      queryDefinitions.append(filter);
      const shape = shapeForNode(record);
      shape.setAttribute('class', `node-query-${treatment.name}`);
      shape.setAttribute('fill', 'none');
      shape.setAttribute('opacity', treatment.opacity);
      shape.setAttribute('filter', `url(#${id})`);
      shape.style.stroke = treatment.color;
      group.append(shape);
      return { ...treatment, shape, filter, gaussian };
    });
    definitions.append(queryDefinitions);
    record.group.insertBefore(group, record.halo);
    record.query = { group, definitions: queryDefinitions, parts };
  }

  function createFolderTreatment(record) {
    const folderDefinitions = svgElement('g', { 'data-folder-definitions': record.id });
    const clip = svgElement('clipPath', {
      id: `${prefix}-folder-${record.id}-clip`, clipPathUnits: 'userSpaceOnUse',
    });
    const clipShape = shapeForNode(record);
    clip.append(clipShape);
    const filter = svgElement('filter', {
      id: `${prefix}-folder-${record.id}-inward`,
      filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse',
      'color-interpolation-filters': 'sRGB',
    });
    const gaussian = svgElement('feGaussianBlur');
    filter.append(gaussian);
    folderDefinitions.append(clip, filter);
    definitions.append(folderDefinitions);

    record.halo.setAttribute('class', 'node-aura-halo node-folder-diffusion');
    record.halo.setAttribute('filter', `url(#${filter.id})`);
    record.halo.setAttribute('clip-path', `url(#${clip.id})`);
    record.halo.setAttribute('stroke-linejoin', 'round');
    record.face.classList.add('node-folder-face');
    record.grain.style.opacity = 'var(--folder-grain-opacity, .2)';
    const outline = shapeForNode(record);
    outline.setAttribute('class', 'node-folder-outline');
    outline.setAttribute('fill', 'none');
    outline.setAttribute('stroke-linejoin', 'round');
    record.group.replaceChildren(record.face, record.halo, record.grain, outline);
    record.folder = { definitions: folderDefinitions, clipShape, filter, gaussian, outline };
  }

  function ensureFolderElevation(record) {
    if (record.folder.elevation) return;
    const group = svgElement('g', {
      class: 'node-folder-elevation', 'aria-hidden': 'true', 'pointer-events': 'none',
    });
    group.style.opacity = '1';
    const parts = ['cast', 'contact'].map(name => {
      const filter = svgElement('filter', {
        id: `${prefix}-folder-${record.id}-shadow-${name}`,
        filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse',
        'color-interpolation-filters': 'sRGB',
      });
      const gaussian = svgElement('feGaussianBlur');
      const offset = svgElement('feOffset');
      filter.append(gaussian, offset);
      record.folder.definitions.append(filter);
      const shape = shapeForNode(record);
      shape.setAttribute('class', `node-folder-shadow-${name}`);
      shape.style.fill = 'var(--folder-shadow-color, #142233)';
      shape.setAttribute('stroke', 'none');
      shape.setAttribute('filter', `url(#${filter.id})`);
      group.append(shape);
      return { name, shape, filter, gaussian, offset };
    });
    record.group.insertBefore(group, record.face);
    record.folder.elevation = { group, parts };
  }

  function placeFolder(record, geometryChanged) {
    const active = record.queryMatched || record.selected;
    if (active) ensureFolderElevation(record);
    if (geometryChanged) {
      for (const part of [record.halo, record.face, record.grain, record.folder.clipShape, record.folder.outline]) {
        setGeometry(part, record);
      }
      for (const part of record.folder.elevation?.parts || []) setGeometry(part.shape, record);
    }
    const edge = 'var(--folder-edge, var(--section-color, #3b70ff))';
    record.face.style.fill = active ? edge : 'var(--folder-face, #fffefa)';
    record.halo.style.stroke = edge;
    record.folder.outline.style.stroke = edge;
    for (const part of [record.halo, record.grain, record.folder.outline]) {
      part.setAttribute('display', active ? 'none' : 'inline');
    }
    record.halo.setAttribute('opacity', .94);
    record.folder.outline.setAttribute('opacity', .28);
    record.folder.outline.setAttribute('stroke-width', .45 / currentScale);
    // One soft edge, clipped after filtering, leaves the outer canvas clear.
    // Small folders keep a pale center; close-ups cap the colored depth at18px.
    const depth = Math.min(record.box.height * .28,
      Math.min(18, Math.max(2.2, record.box.height * currentScale * .20)) / currentScale);
    const deviation = depth * .48;
    const padding = depth + deviation * 4 + 1 / currentScale;
    record.halo.setAttribute('stroke-width', depth * 2);
    record.folder.gaussian.setAttribute('stdDeviation', deviation);
    record.folder.filter.setAttribute('x', record.box.x - padding);
    record.folder.filter.setAttribute('y', record.box.y - padding);
    record.folder.filter.setAttribute('width', Math.max(1 / currentScale, record.box.width) + padding * 2);
    record.folder.filter.setAttribute('height', Math.max(1 / currentScale, record.box.height) + padding * 2);
    record.group.classList.toggle('is-elevated', active);
    record.group.classList.remove('has-query-glow');
    if (record.folder.elevation) {
      const { group, parts } = record.folder.elevation;
      group.setAttribute('display', active ? 'inline' : 'none');
      group.setAttribute('data-elevation-state', record.queryMatched ? 'query' : record.selected ? 'selection' : 'idle');
      if (active) {
        const height = record.box.height * currentScale;
        const lift = record.queryMatched ? 1 : .82;
        for (const part of parts) {
          const contact = part.name === 'contact';
          const blur = (contact
            ? Math.min(1.2, Math.max(.55, height * .025))
            : Math.min(5.5, Math.max(1.3, height * .095))) * lift / currentScale;
          const dy = (contact
            ? Math.min(1.6, Math.max(.65, height * .035))
            : Math.min(6.5, Math.max(1.6, height * .13))) * lift / currentScale;
          const dx = contact ? 0 : Math.min(.75, height * .01) * lift / currentScale;
          const partPadding = blur * 4 + 1 / currentScale;
          const opacity = record.queryMatched ? (contact ? .22 : .17) : (contact ? .18 : .13);
          part.shape.setAttribute('opacity', opacity);
          part.shape.style.opacity = `calc(var(--folder-shadow-opacity, 1) * ${opacity})`;
          part.gaussian.setAttribute('stdDeviation', blur);
          part.offset.setAttribute('dx', dx);
          part.offset.setAttribute('dy', dy);
          part.filter.setAttribute('x', record.box.x - partPadding);
          part.filter.setAttribute('y', record.box.y - partPadding);
          part.filter.setAttribute('width', Math.max(1 / currentScale, record.box.width) + partPadding * 2 + dx);
          part.filter.setAttribute('height', Math.max(1 / currentScale, record.box.height) + partPadding * 2 + dy);
        }
      }
    }
  }

  function place(record, geometryChanged = false) {
    if (record.folder) {
      placeFolder(record, geometryChanged);
      return;
    }
    const queryVisible = record.queryMatched && !record.selected;
    if (queryVisible) ensureQueryGlow(record);
    if (geometryChanged) {
      for (const part of [record.halo, record.face, record.grain]) setGeometry(part, record);
      for (const part of record.query?.parts || []) setGeometry(part.shape, record);
    }
    record.group.classList.toggle('has-query-glow', queryVisible);
    if (record.query) {
      record.query.group.setAttribute('display', queryVisible ? 'inline' : 'none');
      if (queryVisible) {
        for (const part of record.query.parts) {
          const deviation = part.blur / currentScale, width = part.width / currentScale;
          // User-space bounds give tiny circles and thin overview rectangles
          // enough room for the complete bleeding edge without clipping.
          const padding = deviation * 4 + width / 2 + 2 / currentScale;
          part.shape.setAttribute('stroke-width', width);
          part.gaussian.setAttribute('stdDeviation', deviation);
          part.filter.setAttribute('x', record.box.x - padding);
          part.filter.setAttribute('y', record.box.y - padding);
          part.filter.setAttribute('width', Math.max(1 / currentScale, record.box.width) + padding * 2);
          part.filter.setAttribute('height', Math.max(1 / currentScale, record.box.height) + padding * 2);
        }
      }
    }
    const selectedCircle = record.circle && record.selected;
    record.halo.setAttribute('stroke-width', (selectedCircle ? 10 : 1.3) / currentScale);
    record.halo.setAttribute('opacity', selectedCircle ? .42 : queryVisible ? 0 : .14);
    record.halo.setAttribute('filter', `url(#${prefix}-${selectedCircle ? 'focus' : 'edge'})`);
  }

  function resize(scale = currentScale) {
    const nextScale = scaleValue(scale);
    if (Math.abs(nextScale - currentScale) < .00001) return;
    currentScale = nextScale;
    applyScale();
    for (const record of records.values()) place(record);
  }

  function update(nodes = [], scale = currentScale) {
    const nextScale = scaleValue(scale);
    const resized = Math.abs(nextScale - currentScale) >= .00001;
    currentScale = nextScale;
    if (resized) applyScale();
    const wanted = new Set();
    for (const node of nodes) {
      const id = String(node.id);
      wanted.add(id);
      let record = records.get(id);
      if (!record || record.shape !== node.shape) {
        record?.query?.definitions.remove();
        record?.folder?.definitions.remove();
        const group = record?.group || svgElement('g', {
          class: 'node-aura', 'data-aura-id': id, 'aria-hidden': 'true', 'pointer-events': 'none',
        });
        group.setAttribute('data-display-shape', node.shape || 'rectangle');
        group.setAttribute('data-source-shape', node.source_shape || node.shape || 'rectangle');
        const halo = shapeForNode(node);
        halo.setAttribute('class', 'node-aura-halo');
        halo.setAttribute('fill', 'none');
        halo.style.stroke = 'var(--section-color, var(--graph-node-border, #7483b8))';
        const face = shapeForNode(node);
        face.setAttribute('class', 'node-aura-face node-aura-lens');
        face.setAttribute('stroke', 'none');
        const texture = shapeForNode(node);
        texture.setAttribute('class', 'node-aura-grain');
        texture.setAttribute('fill', `url(#${grain.id})`);
        texture.setAttribute('stroke', 'none');
        texture.style.opacity = 'var(--frost-grain-opacity, .5)';
        group.replaceChildren(halo, face, texture);
        if (!record) layer.append(group);
        record = { id, group, halo, face, grain: texture, circle: isCircle(node), shape: node.shape,
          folder_variant: node.folder_variant, box: node.box, signature: '' };
        if (node.shape === 'folder') createFolderTreatment(record);
        records.set(id, record);
      }
      if (node.section) record.group.setAttribute('data-section', node.section);
      else record.group.removeAttribute('data-section');
      record.section = node.section;
      if (!record.folder) record.face.setAttribute('fill', `url(#${paintFor(node.section)})`);
      record.group.classList.toggle('is-region-muted', Boolean(node.muted));
      record.group.classList.toggle('is-dimmed', Boolean(node.dimmed));
      record.group.classList.toggle('is-selected', Boolean(node.selected));
      record.group.classList.toggle('is-neighbor', Boolean(node.neighbor));
      record.group.classList.toggle('is-query-match', Boolean(node.queryMatched));
      record.group.classList.remove('is-inverted');
      const selected = Boolean(node.selected);
      const selectedChanged = selected !== record.selected;
      record.selected = selected;
      const queryMatched = Boolean(node.queryMatched);
      const queryChanged = queryMatched !== record.queryMatched;
      record.queryMatched = queryMatched;
      const signature = `${node.folder_variant || ''},${node.box.x},${node.box.y},${node.box.width},${node.box.height}`;
      const geometryChanged = signature !== record.signature;
      record.folder_variant = node.folder_variant;
      record.box = node.box;
      if (geometryChanged || resized || selectedChanged || queryChanged) place(record, geometryChanged);
      record.signature = signature;
    }
    for (const [id, record] of records) {
      if (wanted.has(id)) continue;
      record.query?.definitions.remove();
      record.folder?.definitions.remove();
      record.group.remove();
      records.delete(id);
    }
  }
  return { layer, update, resize };
}

/** A selected item is lit only in its original region color. */
export function createSelectionGlow(defs) {
  const prefix = `selection-frost-${++nextInstance}`;
  const definitions = svgElement('g', { 'data-glow-definitions': prefix });
  defs.append(definitions);
  const nodeBlur = blurFilter(definitions, `${prefix}-node`, 7);
  const edgeDefinitions = svgElement('g');
  definitions.append(edgeDefinitions);
  const layer = svgElement('g', {
    class: 'graph-selection-glow', 'aria-hidden': 'true', 'pointer-events': 'none',
  });
  layer.style.pointerEvents = 'none';
  let records = [], currentScale = 1, lastSignature = null;

  function addNode(item) {
    const primary = item.primary !== false;
    const group = svgElement('g', {
      class: `glow-node ${primary ? 'is-primary' : 'is-secondary'}`,
      'data-glow-id': item.id, 'data-section': item.section,
      'data-display-shape': item.shape || 'rectangle',
      'data-source-shape': item.source_shape || item.shape || 'rectangle',
    });
    if (item.shape === 'folder') group.setAttribute('display', 'none');
    const bloom = shapeForNode(item);
    bloom.setAttribute('class', 'glow-bloom');
    bloom.setAttribute('fill', 'none');
    if (item.shape !== 'folder') bloom.setAttribute('filter', `url(#${prefix}-node)`);
    bloom.setAttribute('opacity', item.shape === 'folder' ? 0 : (primary ? .45 : .1));
    bloom.style.stroke = item.shape === 'folder' ? 'none' : 'var(--section-color, var(--graph-node-border, #7483b8))';
    group.append(bloom);
    layer.append(group);
    records.push({ type: 'node', item, bloom, primary });
  }

  function addEdge(item, index) {
    const primary = item.primary !== false;
    const group = svgElement('g', {
      class: `glow-edge ${primary ? 'is-primary' : 'is-secondary'}`,
      'data-glow-id': item.id, 'data-section': item.section, fill: 'none',
    });
    const filter = svgElement('filter', {
      id: `${prefix}-edge-${index}`, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse',
      'color-interpolation-filters': 'sRGB',
    });
    const gaussian = svgElement('feGaussianBlur');
    filter.append(gaussian);
    edgeDefinitions.append(filter);
    const bloom = svgElement('path', {
      d: item.d, class: 'glow-bloom', filter: `url(#${filter.id})`, opacity: primary ? .2 : .07,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    });
    const core = svgElement('path', {
      d: item.d, class: 'glow-core', opacity: primary ? .64 : .18,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    });
    for (const part of [bloom, core]) part.style.stroke = 'var(--section-color, var(--graph-node-border, #7483b8))';
    group.append(bloom, core);
    layer.append(group);
    records.push({ type: 'edge', bloom, core, primary, filter, gaussian, box: pathBounds(bloom, item.d) });
  }

  function resize(scale = currentScale) {
    currentScale = scaleValue(scale);
    nodeBlur.setAttribute('stdDeviation', Math.min(100, 7 / currentScale));
    for (const record of records) {
      if (record.type === 'node') {
        const width = record.item.shape === 'folder' ? 0 : (record.primary ? 14 : 5);
        record.bloom.setAttribute('stroke-width', width / currentScale);
      } else {
        const width = (record.primary ? 5 : 2.5) / currentScale;
        const deviation = Math.min(32, 2 / currentScale);
        const padding = deviation * 4 + width;
        record.bloom.setAttribute('stroke-width', width);
        record.core.setAttribute('stroke-width', (record.primary ? 1.4 : .7) / currentScale);
        // User-space bounds stay nonzero for perfectly horizontal or vertical
        // routes, where an objectBoundingBox filter would disappear.
        record.gaussian.setAttribute('stdDeviation', deviation);
        record.filter.setAttribute('x', record.box.x - padding);
        record.filter.setAttribute('y', record.box.y - padding);
        record.filter.setAttribute('width', Math.max(1 / currentScale, record.box.width) + padding * 2);
        record.filter.setAttribute('height', Math.max(1 / currentScale, record.box.height) + padding * 2);
      }
    }
  }

  function update({ nodes = [], edges = [] } = {}, scale = currentScale) {
    const signature = JSON.stringify([nodes.map(item => [item.id, item.shape, item.folder_variant, item.source_shape, item.box, item.section, item.primary]),
      edges.map(item => [item.id, item.d, item.section, item.primary])]);
    if (signature === lastSignature) {
      resize(scale);
      return;
    }
    lastSignature = signature;
    layer.replaceChildren();
    edgeDefinitions.replaceChildren();
    records = [];
    edges.forEach(addEdge);
    nodes.forEach(addNode);
    resize(scale);
  }
  return { layer, update, resize };
}

import { folderPath, folderPolygon } from './folder-shape.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DURATION = 2400;
const SAMPLE_COUNT = 65;
let transitionCount = 0;

const clamp = value => Math.max(0, Math.min(1, value));
const mix = (from, to, progress) => from + (to - from) * progress;
const smoothstep = value => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) element.setAttribute(name, String(value));
  }
  return element;
}

function screenMatrix(element, origin) {
  const matrix = element.getScreenCTM();
  if (!matrix) return null;
  return {
    a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d,
    e: matrix.e - origin.left, f: matrix.f - origin.top,
  };
}

function matrixAttribute(matrix) {
  return `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`;
}

function screenPoint(point, matrix) {
  return {
    x: point.x * matrix.a + point.y * matrix.c + matrix.e,
    y: point.x * matrix.b + point.y * matrix.d + matrix.f,
  };
}

function samplePath(path, origin) {
  const matrix = screenMatrix(path, origin);
  if (!matrix) return null;
  try {
    const length = path.getTotalLength();
    const points = Array.from({ length: SAMPLE_COUNT }, (_, index) =>
      screenPoint(path.getPointAtLength(length * index / (SAMPLE_COUNT - 1)), matrix));
    return { points, matrix, d: path.getAttribute('d') };
  } catch {
    // An empty route is harmless; the real diagram still supplies its final state.
    return null;
  }
}

function pathAttribute(points) {
  return points.map((point, index) =>
    `${index ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
}

function sampledFolder(variant) {
  const points = folderPolygon({ x: 0, y: 0, width: 1, height: 1 }, variant);
  const lengths = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return Math.hypot(next.x - point.x, next.y - point.y);
  });
  const total = lengths.reduce((sum, length) => sum + length, 0);
  return Array.from({ length: 64 }, (_, index) => {
    let along = total * index / 64, segment = 0;
    while (segment < lengths.length - 1 && along > lengths[segment]) along -= lengths[segment++];
    const a = points[segment], b = points[(segment + 1) % points.length];
    const t = lengths[segment] ? along / lengths[segment] : 0;
    return { x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) };
  });
}

function morphFolder(node, box, progress) {
  if (node.sourceVariant === node.targetVariant || progress === 0) return folderPath(box, node.sourceVariant);
  if (progress === 1) return folderPath(box, node.targetVariant);
  return pathAttribute(node.contours[0].map((point, index) => ({
    x: box.x + mix(point.x, node.contours[1][index].x, progress) * box.width,
    y: box.y + mix(point.y, node.contours[1][index].y, progress) * box.height,
  }))) + ' Z';
}

function screenBox(element, origin) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left - origin.left, y: rect.top - origin.top,
    width: rect.width, height: rect.height,
    cx: rect.left + rect.width / 2 - origin.left,
    cy: rect.top + rect.height / 2 - origin.top,
  };
}

function visible(element) {
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
}

function computedOpacity(element) {
  return Number(getComputedStyle(element).opacity) || 0;
}

function copyText(element, origin) {
  const matrix = screenMatrix(element, origin);
  if (!matrix || !visible(element)) return null;
  const copy = element.cloneNode(true);
  copy.removeAttribute('id');
  copy.removeAttribute('class');
  copy.removeAttribute('style');
  copy.setAttribute('transform', matrixAttribute(matrix));
  const style = getComputedStyle(element);
  for (const property of [
    'font-family', 'font-size', 'font-weight', 'font-stretch', 'letter-spacing', 'fill', 'stroke',
    'stroke-width', 'stroke-linejoin', 'paint-order', 'text-anchor', 'opacity',
  ]) copy.style.setProperty(property, style.getPropertyValue(property));
  return copy;
}

function copyRichText(element, origin) {
  const matrix = screenMatrix(element, origin);
  if (!matrix || !visible(element)) return null;
  const copy = element.cloneNode(true);
  const originals = [element, ...element.querySelectorAll('*')];
  const copies = [copy, ...copy.querySelectorAll('*')];
  // A graph label is a foreignObject with HTML. Freeze the computed typography
  // and query marks because its graph-node ancestor will not exist in the overlay.
  const properties = [
    'display', 'visibility', 'opacity', 'width', 'height', 'box-sizing',
    'flex-direction', 'justify-content', 'align-items', 'gap',
    'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch',
    'line-height', 'letter-spacing', 'text-align', 'text-transform', 'text-wrap',
    'white-space', 'overflow-wrap', 'word-break', 'color', 'background-color',
    'text-decoration-line', 'text-decoration-color', 'text-decoration-thickness',
    'text-underline-offset', 'margin', 'padding', 'border-radius', 'overflow',
  ];
  originals.forEach((original, index) => {
    const style = getComputedStyle(original);
    const clone = copies[index];
    clone.removeAttribute('id');
    clone.removeAttribute('class');
    clone.removeAttribute('style');
    clone.removeAttribute('tabindex');
    for (const property of properties) clone.style.setProperty(property, style.getPropertyValue(property));
  });
  copy.setAttribute('transform', matrixAttribute(matrix));
  return copy;
}

function strokeWidth(style, matrix, fallback) {
  const scale = Math.hypot(matrix.a, matrix.b);
  return Math.max(.35, (parseFloat(style.strokeWidth) || fallback) *
    (style.vectorEffect === 'non-scaling-stroke' ? 1 : scale));
}

/**
 * Snapshot either view without mutating its nodes, routes, or camera.
 *
 * Pass landscapeSvg for Discover -> Explore, or diagramSvg for Explore ->
 * Discover. The caller then hides the source and lays out the destination
 * invisibly before playTo(destinationSvg). Both snapshots use rendered screen
 * coordinates, respecting zoom, query emphasis, and locally edited routes.
 * onPhase('reveal') hands off to the destination beneath the fading overlay.
 */
export function createLandscapeTransition({ container, landscapeSvg, diagramSvg }) {
  const reverse = Boolean(diagramSvg);
  const sourceSvg = reverse ? diagramSvg : landscapeSvg;
  if (!container || !sourceSvg || (landscapeSvg && diagramSvg)) {
    throw new TypeError('Network transition requires a container and exactly one source SVG.');
  }

  const origin = container.getBoundingClientRect();
  const overlay = svgElement('svg', {
    class: 'landscape-transition',
    viewBox: `0 0 ${Math.max(1, origin.width)} ${Math.max(1, origin.height)}`,
    preserveAspectRatio: 'none',
    'aria-hidden': 'true',
    focusable: 'false',
    'data-phase': 'gather',
    'data-progress': 0,
    'data-direction': reverse ? 'to-discover' : 'to-overview',
  });
  Object.assign(overlay.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    overflow: 'hidden', pointerEvents: 'none', zIndex: '5',
  });

  const arrowId = `discover-transition-arrow-${++transitionCount}`;
  const definitions = svgElement('defs');
  const marker = svgElement('marker', {
    id: arrowId, viewBox: '0 0 10 10', refX: 8.5, refY: 5,
    markerWidth: 4, markerHeight: 4,
    orient: 'auto-start-reverse', markerUnits: 'strokeWidth',
  });
  marker.append(svgElement('path', { d: 'M 0 1 L 9 5 L 0 9 Z', fill: 'context-stroke' }));
  definitions.append(marker);
  const edgeLayer = svgElement('g', { class: 'transition-edges' });
  const nodeLayer = svgElement('g', { class: 'transition-nodes' });
  const labelLayer = svgElement('g', { class: 'transition-labels' });
  overlay.append(definitions, edgeLayer, nodeLayer, labelLayer);

  const nodes = [];
  const sourceAuras = new Map(Array.from(
    sourceSvg.querySelectorAll('.node-aura[data-aura-id]'),
    aura => [aura.dataset.auraId, aura],
  ));
  for (const group of sourceSvg.querySelectorAll(reverse ? '.graph-node[data-id]' : '.landscape-node[data-id]')) {
    const source = group.querySelector(reverse ? '.node-shape' : '.landscape-node-circle');
    if (!source || !visible(group)) continue;
    const box = screenBox(source, origin);
    const style = getComputedStyle(source);
    const aura = sourceAuras.get(group.dataset.id);
    const face = aura?.querySelector('.node-folder-face');
    const diffusion = aura?.querySelector('.node-folder-diffusion');
    const elevated = group.classList.contains('is-spider-match')
      || group.classList.contains('is-public-influence-match') || group.classList.contains('is-selected');
    const opacity = computedOpacity(group) * computedOpacity(source);
    const sourceVariant = reverse && group.dataset.folderVariant === 'rhombus' ? 'rhombus' : 'rectangle';
    const shape = svgElement('path', {
      class: 'transition-node', 'data-id': group.dataset.id,
      'data-source-variant': sourceVariant,
      d: folderPath(box, sourceVariant),
      // Carry the same solid active surface into either view without a new border.
      fill: face ? getComputedStyle(face).fill : '#fffefa',
      stroke: elevated ? 'none' : diffusion ? getComputedStyle(diffusion).stroke : style.stroke,
      'stroke-opacity': .94, 'stroke-width': 1.8, 'stroke-linejoin': 'round',
      opacity,
    });
    if (elevated) shape.style.filter = 'drop-shadow(0 2px 1.5px color-mix(in srgb,var(--folder-shadow-color) 18%,transparent)) drop-shadow(1px 7px 7px color-mix(in srgb,var(--folder-shadow-color) 20%,transparent))';
    nodeLayer.append(shape);
    nodes.push({ id: group.dataset.id, box, shape, opacity, sourceVariant });
    const label = group.querySelector(reverse ? '.graph-label' : '.landscape-node-label');
    const labelCopy = label && (reverse ? copyRichText(label, origin) : copyText(label, origin));
    if (labelCopy) {
      const backplate = group.querySelector('.landscape-label-backplate');
      const backplateCopy = backplate && copyText(backplate, origin);
      if (backplateCopy) {
        backplateCopy.style.opacity = String(computedOpacity(group) * computedOpacity(backplate));
        labelLayer.append(backplateCopy);
      }
      labelCopy.style.opacity = String(computedOpacity(group) * computedOpacity(label));
      labelLayer.append(labelCopy);
    }
  }

  // Preserve the selected-theme headings during the first instant of the handoff.
  for (const text of sourceSvg.querySelectorAll(reverse ? '.edge-label' : '.landscape-anchors text')) {
    const copy = copyText(text, origin);
    if (copy) labelLayer.append(copy);
  }

  const edges = [];
  for (const group of sourceSvg.querySelectorAll(reverse ? '.graph-edge[data-id]' : '.landscape-edge[data-id]')) {
    const source = group.querySelector(reverse ? '.edge-line' : '.landscape-edge-line');
    if (!source || !visible(group) || !visible(source)) continue;
    const sampled = samplePath(source, origin);
    if (!sampled) continue;
    const style = getComputedStyle(source);
    const opacity = computedOpacity(group) * computedOpacity(source) * Number(style.strokeOpacity);
    const width = strokeWidth(style, sampled.matrix, .85);
    const kind = reverse ? 'source' : group.dataset.kind;
    const path = svgElement('path', {
      class: 'transition-edge', 'data-id': group.dataset.id, 'data-kind': kind,
      d: pathAttribute(sampled.points), fill: 'none', stroke: style.stroke,
      'stroke-width': width, opacity, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      'stroke-dasharray': style.strokeDasharray === 'none' ? null : style.strokeDasharray,
      'marker-end': source.hasAttribute('marker-end') ? `url(#${arrowId})` : null,
      'marker-start': source.hasAttribute('marker-start') ? `url(#${arrowId})` : null,
      'vector-effect': 'non-scaling-stroke',
    });
    edgeLayer.append(path);
    edges.push({
      id: group.dataset.id, kind,
      path, points: sampled.points, opacity, width,
    });
  }

  overlay.dataset.nodeCount = String(nodes.length);
  overlay.dataset.edgeCount = String(edges.length);
  container.append(overlay);

  let frame = 0;
  let started = false;
  let closed = false;
  let resolvePlayback;
  let rejectPlayback;
  const cleanupListeners = [];

  function finish(completed) {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(frame);
    for (const removeListener of cleanupListeners) removeListener();
    overlay.remove();
    resolvePlayback?.(completed);
  }

  function cancel() {
    finish(false);
  }

  function playTo(destinationSvg, { signal, onPhase } = {}) {
    if (closed || started || signal?.aborted) {
      cancel();
      return Promise.resolve(false);
    }
    started = true;

    return new Promise((resolve, reject) => {
      resolvePlayback = resolve;
      rejectPlayback = reject;
      let phase = '';
      const emitPhase = nextPhase => {
        if (phase === nextPhase || closed) return;
        phase = nextPhase;
        overlay.dataset.phase = nextPhase;
        onPhase?.(nextPhase);
      };
      const fail = error => {
        // Reject before cleanup so errors remain observable to the caller.
        rejectPlayback(error);
        finish(false);
      };

      try {
        if (!destinationSvg) throw new TypeError('Network transition requires a destination SVG.');
        const targetNodes = new Map(Array.from(
          destinationSvg.querySelectorAll(reverse ? '.landscape-node[data-id]' : '.graph-node[data-id]'),
          group => [group.dataset.id, group.querySelector(reverse ? '.landscape-node-circle' : '.node-shape')],
        ));
        const targetEdges = new Map(Array.from(
          destinationSvg.querySelectorAll(reverse ? '.landscape-edge[data-id]' : '.graph-edge[data-id]'),
          group => [group.dataset.id, group.querySelector(reverse ? '.landscape-edge-line' : '.edge-line')],
        ));

        for (const node of nodes) {
          const target = targetNodes.get(node.id);
          if (target) {
            node.target = screenBox(target, origin);
            node.targetVariant = !reverse && target.closest('.graph-node')?.dataset.folderVariant === 'rhombus' ? 'rhombus' : 'rectangle';
            node.shape.dataset.targetVariant = node.targetVariant;
            node.contours = [sampledFolder(node.sourceVariant), sampledFolder(node.targetVariant)];
          }
        }
        for (const edge of edges) {
          if (edge.kind !== 'source') continue;
          const target = targetEdges.get(edge.id);
          if (!target) continue;
          const sampled = samplePath(target, origin);
          if (!sampled) continue;
          const style = getComputedStyle(target);
          const targetGroup = target.closest(reverse ? '.landscape-edge' : '.graph-edge');
          // Explore uses scaled strokes, while Discover and this overlay use pixels.
          edge.target = {
            ...sampled, color: style.stroke,
            width: strokeWidth(style, sampled.matrix, 2),
            opacity: computedOpacity(targetGroup) * computedOpacity(target) * Number(style.strokeOpacity),
            dash: style.strokeDasharray,
            startArrow: target.hasAttribute('marker-start'),
            endArrow: target.hasAttribute('marker-end'),
          };
        }
        overlay.dataset.targetNodeCount = String(nodes.filter(node => node.target).length);
        overlay.dataset.targetEdgeCount = String(edges.filter(edge => edge.target).length);

        if (signal) {
          signal.addEventListener('abort', cancel, { once: true });
          cleanupListeners.push(() => signal.removeEventListener('abort', cancel));
        }

        const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        const completeImmediately = () => {
          if (closed) return;
          overlay.dataset.progress = '1';
          emitPhase('reveal');
          finish(true);
        };
        if (media?.matches || !nodes.some(node => node.target)) {
          completeImmediately();
          return;
        }
        const motionPreferenceChanged = event => {
          if (event.matches) {
            try { completeImmediately(); } catch (error) { fail(error); }
          }
        };
        media?.addEventListener('change', motionPreferenceChanged);
        cleanupListeners.push(() => media?.removeEventListener('change', motionPreferenceChanged));

        emitPhase('gather');
        const start = performance.now();
        function draw(now) {
          if (closed) return;
          try {
            const progress = clamp((now - start) / DURATION);
            const move = smoothstep((progress - .07) / .70);
            const reshape = smoothstep((progress - .48) / .30);
            const reveal = smoothstep((progress - .82) / .18);
            overlay.dataset.progress = progress.toFixed(4);
            labelLayer.setAttribute('opacity', 1 - smoothstep(progress / .20));
            overlay.style.opacity = String(1 - reveal);

            for (const edge of edges) {
              if (edge.kind === 'inferred' || !edge.target) {
                edge.path.setAttribute('opacity', edge.opacity * (1 - smoothstep(progress / .27)));
                continue;
              }
              if (move < 1) {
                edge.path.setAttribute('d', pathAttribute(edge.points.map((point, index) => ({
                  x: mix(point.x, edge.target.points[index].x, move),
                  y: mix(point.y, edge.target.points[index].y, move),
                }))));
              } else if (!edge.settled) {
                // Restore exact paths, including every corner, before revealing
                // the destination. Sampling is used only for the moving intermediate.
                edge.path.setAttribute('d', edge.target.d);
                edge.path.setAttribute('transform', matrixAttribute(edge.target.matrix));
                edge.path.setAttribute('stroke', edge.target.color);
                edge.path.setAttribute('stroke-dasharray', edge.target.dash);
                for (const [endpoint, enabled] of [
                  ['start', edge.target.startArrow], ['end', edge.target.endArrow],
                ]) {
                  if (enabled) edge.path.setAttribute(`marker-${endpoint}`, `url(#${arrowId})`);
                  else edge.path.removeAttribute(`marker-${endpoint}`);
                }
                edge.settled = true;
              }
              edge.path.setAttribute('stroke-width', mix(edge.width, edge.target.width, move));
              edge.path.setAttribute('opacity', mix(edge.opacity, edge.target.opacity * .80, move));
            }

            for (const node of nodes) {
              if (!node.target) {
                node.shape.setAttribute('opacity', node.opacity * (1 - move));
                continue;
              }
              const width = mix(node.box.width, node.target.width, reshape);
              const height = mix(node.box.height, node.target.height, reshape);
              node.shape.setAttribute('d', morphFolder(node, {
                x: mix(node.box.cx, node.target.cx, move) - width / 2,
                y: mix(node.box.cy, node.target.cy, move) - height / 2, width, height,
              }, reshape));
              node.shape.setAttribute('opacity', node.opacity * mix(1, .18, reshape));
            }

            if (progress >= .82) emitPhase('reveal');
            else if (progress >= .10) emitPhase('untangle');
            if (progress >= 1) finish(true);
            else if (!closed) frame = requestAnimationFrame(draw);
          } catch (error) {
            fail(error);
          }
        }
        frame = requestAnimationFrame(draw);
      } catch (error) {
        fail(error);
      }
    });
  }

  return { playTo, cancel };
}

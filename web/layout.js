// Display-only layout editing. These helpers never change workbook records.
import { pointOnFolderBoundary, segmentHitsFolder } from './folder-shape.js';

const EPSILON = 0.001;
const VECTORS = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
const copy = point => ({ x: Number(point.x), y: Number(point.y) });
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const segments = points => points.slice(1).map((b, index) => ({ a: points[index], b, index }));

/** Enlarge displayed cards around their existing centers without changing source records. */
export function enlargeNodeForDisplay(node) {
  const box = node.layout;
  const width = box.width * 1.25, height = box.height * 1.25;
  return {
    ...node,
    shape: 'folder',
    source_shape: node.shape,
    layout: {
      ...box, width, height,
      x: box.x + (box.width - width) / 2,
      y: box.y + (box.height - height) / 2,
    },
  };
}

export function snap(value, step, origin = 0) {
  if (![value, step, origin].every(Number.isFinite) || step <= 0) throw new RangeError('A positive grid step and finite coordinates are required.');
  return Number((origin + Math.round((value - origin) / step) * step).toPrecision(14));
}

/** Keep visible grid spacing roughly 8–16 screen pixels as the map zooms. */
export function gridStepForScale(scale) {
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('A positive map scale is required.');
  return Math.max(5, 20 * 2 ** Math.floor(Math.log2(16 / (20 * scale))));
}

function simplify(points) {
  const result = [];
  for (const original of points) {
    const point = copy(original), previous = result.at(-1);
    if (previous && distance(previous, point) < EPSILON) continue;
    // Only merge forward runs: a doubled-back path must remain visible to validation.
    while (result.length > 1) {
      const before = result.at(-2), last = result.at(-1);
      const straight = Math.abs(cross(before, last, point)) < EPSILON;
      const forward = (last.x - before.x) * (point.x - last.x) + (last.y - before.y) * (point.y - last.y) >= 0;
      if (straight && forward) result.pop(); else break;
    }
    result.push(point);
  }
  return result;
}

/** Indices refer to the supplied points, including diagonal or endpoint segments. */
export function editableSegments(points) {
  return segments(points).filter(({ a, b }) => distance(a, b) > EPSILON).map(({ a, b, index }) => ({
    index, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
    axis: Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'y' : 'x',
  }));
}

function lead(point, toward, side, step) {
  const dx = toward.x - point.x, dy = toward.y - point.y;
  const vector = VECTORS[side] ?? (Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1]);
  const length = Math.max(1, Math.min(step * 2, distance(point, toward) / 3));
  return { x: point.x + vector[0] * length, y: point.y + vector[1] * length };
}

/**
 * Move a segment perpendicular to its direction, snapping its lane to the grid.
 * Endpoint moves add short doglegs; original start/end coordinates stay exact.
 * Supplying edge preserves recorded attachment sides when converting a diagonal.
 */
export function moveRouteSegment(points, index, coordinate, step, edge = {}) {
  if (!Array.isArray(points) || index < 0 || index >= points.length - 1 || !Number.isInteger(index)) throw new RangeError('Choose an existing connector segment.');
  const handle = editableSegments(points).find(segment => segment.index === index);
  if (!handle) return points.map(copy);
  const lane = snap(coordinate, step), a = copy(points[index]), b = copy(points[index + 1]);
  const first = index === 0, last = index === points.length - 2;
  const diagonal = Math.abs(a.x - b.x) > EPSILON && Math.abs(a.y - b.y) > EPSILON;
  const axis = handle.axis;
  if (diagonal || first && last) {
    const p = lead(a, b, first ? edge.start_side : null, step);
    const q = lead(b, a, last ? edge.end_side : null, step);
    const bent = axis === 'x'
      ? [a, p, { x: lane, y: p.y }, { x: lane, y: q.y }, q, b]
      : [a, p, { x: p.x, y: lane }, { x: q.x, y: lane }, q, b];
    return simplify([...points.slice(0, index), ...bent, ...points.slice(index + 2)]);
  }
  const movedA = { ...a, [axis]: lane }, movedB = { ...b, [axis]: lane };
  const middle = [movedA, movedB];
  if (first) {
    const p = lead(a, b, null, step);
    middle.splice(0, 1, a, p, { ...p, [axis]: lane });
  }
  if (last) {
    const q = lead(b, a, null, step);
    middle.splice(middle.length - 1, 1, { ...q, [axis]: lane }, q, b);
  }
  return simplify([...points.slice(0, index), ...middle, ...points.slice(index + 2)]);
}

function boxOf(node) {
  const box = node.layout ?? node;
  return { x: Number(box.x), y: Number(box.y), width: Number(box.width), height: Number(box.height) };
}

function polygon(node, inset = 0) {
  const { x, y, width, height } = boxOf(node);
  if (node.shape === 'rhombus') return [[x + width / 2, y + inset], [x + width - inset, y + height / 2],
    [x + width / 2, y + height - inset], [x + inset, y + height / 2]];
  return [[x + inset, y + inset], [x + width - inset, y + inset],
    [x + width - inset, y + height - inset], [x + inset, y + height - inset]];
}

// Clip against the interior of a convex polygon, allowing exact boundary contact.
function hitsNode(a, b, node) {
  if (node.shape === 'folder') return segmentHitsFolder(a, b, boxOf(node), EPSILON * 4, node.source_shape);
  const vertices = polygon(node, EPSILON * 4);
  let low = 0, high = 1;
  for (let i = 0; i < vertices.length; i++) {
    const p = vertices[i], q = vertices[(i + 1) % vertices.length];
    const ex = q[0] - p[0], ey = q[1] - p[1];
    const constant = ex * (a.y - p[1]) - ey * (a.x - p[0]);
    const slope = ex * (b.y - a.y) - ey * (b.x - a.x);
    if (Math.abs(slope) < 1e-9) { if (constant < 0) return false; }
    else if (slope > 0) low = Math.max(low, -constant / slope);
    else high = Math.min(high, -constant / slope);
    if (high <= low + 1e-9) return false;
  }
  return high > low + 1e-9;
}

function onBoundary(point, node) {
  const box = boxOf(node), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  if (node.shape === 'folder') return pointOnFolderBoundary(point, box, EPSILON * 4, node.source_shape);
  if (node.shape === 'rhombus') {
    const normalized = Math.abs(point.x - cx) / (box.width / 2) + Math.abs(point.y - cy) / (box.height / 2);
    return Math.abs(normalized - 1) * Math.min(box.width, box.height) / 2 < EPSILON * 4;
  }
  return (Math.abs(point.x - box.x) < EPSILON * 4 || Math.abs(point.x - box.x - box.width) < EPSILON * 4)
    && point.y >= box.y - EPSILON && point.y <= box.y + box.height + EPSILON
    || (Math.abs(point.y - box.y) < EPSILON * 4 || Math.abs(point.y - box.y - box.height) < EPSILON * 4)
    && point.x >= box.x - EPSILON && point.x <= box.x + box.width + EPSILON;
}

function overlaps(a, b, c, d) {
  const length = distance(a, b);
  if (length < EPSILON || distance(c, d) < EPSILON) return false;
  if (Math.abs(cross(a, b, c)) / length > EPSILON || Math.abs(cross(a, b, d)) / length > EPSILON) return false;
  const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
  const tc = (c.x - a.x) * ux + (c.y - a.y) * uy, td = (d.x - a.x) * ux + (d.y - a.y) * uy;
  return Math.min(length, Math.max(tc, td)) - Math.max(0, Math.min(tc, td)) > EPSILON;
}

function touches(a, b, c, d) {
  const ab = distance(a, b), cd = distance(c, d);
  if (ab < EPSILON || cd < EPSILON) return false;
  const p = cross(a, b, c) / ab, q = cross(a, b, d) / ab;
  const r = cross(c, d, a) / cd, s = cross(c, d, b) / cd;
  if ((p > EPSILON && q > EPSILON) || (p < -EPSILON && q < -EPSILON)
    || (r > EPSILON && s > EPSILON) || (r < -EPSILON && s < -EPSILON)) return false;
  return Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) + EPSILON
    && Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) + EPSILON;
}

/** Keep topology intact while permitting ordinary crossings between connectors. */
export function validateManualRoute(points, edge, nodes = [], otherRoutes = new Map()) {
  if (!Array.isArray(points) || points.length < 2 || !points.every(point => Number.isFinite(point?.x) && Number.isFinite(point?.y))) {
    return { valid: false, reason: 'The connector needs a finite start and end point.' };
  }
  const nodeList = nodes instanceof Map ? [...nodes.values()] : nodes;
  const nodeMap = new Map(nodeList.map(node => [String(node.node_id), node]));
  const start = nodeMap.get(String(edge.start_node_id)), end = nodeMap.get(String(edge.end_node_id));
  if (start && !onBoundary(points[0], start) || end && !onBoundary(points.at(-1), end)) {
    return { valid: false, reason: 'Keep the connector attached to its original nodes.' };
  }
  const own = segments(points).filter(({ a, b }) => distance(a, b) > EPSILON);
  for (let i = 0; i < own.length; i++) {
    const { a, b } = own[i];
    for (const node of nodeList) if (hitsNode(a, b, node)) return { valid: false, reason: 'Move the line into a clear lane outside the nodes.' };
    for (let j = i + 1; j < own.length; j++) {
      const { a: c, b: d } = own[j];
      if (overlaps(a, b, c, d) || j > i + 1 && touches(a, b, c, d)) {
        return { valid: false, reason: 'Keep the connector from doubling back or crossing itself.' };
      }
    }
  }
  const entries = otherRoutes instanceof Map ? [...otherRoutes] : Array.from(otherRoutes, route => [route.connection_id ?? route.id, route]);
  for (const [id, route] of entries) {
    if (String(id) === String(edge.connection_id)) continue;
    for (const { a, b } of own) for (const { a: c, b: d } of segments(route.points ?? route)) {
      if (overlaps(a, b, c, d)) return { valid: false, reason: 'Move the line to a free grid lane; another connector occupies this one.' };
    }
  }
  return { valid: true, reason: '' };
}

/** Build a path and reposition its existing label; no new content is introduced. */
export function routeFromPoints(points, edge = {}, nodes = [], otherRoutes = new Map()) {
  const clean = simplify(points);
  let label = null;
  if (edge.label_text) {
    const lines = String(edge.label_text).split('\n');
    const width = Math.max(...lines.map(line => line.length)) * 9.6 + 18, height = lines.length * 21.6 + 10;
    const nodeList = nodes instanceof Map ? [...nodes.values()] : nodes;
    const labelBoxes = [];
    const entries = otherRoutes instanceof Map ? [...otherRoutes] : Array.from(otherRoutes, route => [route.connection_id ?? route.id, route]);
    for (const [id, route] of entries) {
      if (String(id) === String(edge.connection_id) || !route.label) continue;
      if (route.labelBounds) { labelBoxes.push(route.labelBounds); continue; }
      const otherLines = route.label_text ? String(route.label_text).split('\n') : null;
      const otherWidth = otherLines ? Math.max(...otherLines.map(line => line.length)) * 9.6 + 18 : 160;
      const otherHeight = otherLines ? otherLines.length * 21.6 + 10 : 32;
      labelBoxes.push({ x: route.label.x - otherWidth / 2, y: route.label.y - 22, width: otherWidth, height: otherHeight });
    }
    const obstacles = [...nodeList.map(boxOf), ...labelBoxes];
    let best = Infinity;
    for (const { a, b } of segments(clean)) for (const ratio of [0.5, 0.3, 0.7]) for (const offset of [-14, 22, -38, 46]) {
      const point = { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio + offset };
      const candidate = { x: point.x - width / 2, y: point.y - 22, width, height };
      let score = -distance(a, b) + Math.abs(ratio - 0.5) * 40 + Math.abs(offset + 14) + (offset > 0 ? 8 : 0)
        + (Math.abs(b.y - a.y) > Math.abs(b.x - a.x) ? 15 : 0);
      for (const box of obstacles) {
        if (candidate.x < box.x + box.width && candidate.x + width > box.x && candidate.y < box.y + box.height && candidate.y + height > box.y) score += 100000;
      }
      if (score < best) { best = score; label = point; }
    }
  }
  return { points: clean, d: clean.map((point, i) => `${i ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '), kind: clean.length > 2 ? 'elbowed' : 'straight', label };
}

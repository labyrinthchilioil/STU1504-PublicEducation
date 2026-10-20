// Display-only connector routing. The workbook has no saved connector paths.
// Node positions, connector IDs, endpoints, directions and source styles stay intact.
import { folderBoundary } from './folder-shape.js';

const VECTORS = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
const GAP = 24;
const CLEARANCE = 12;
const EPSILON = 0.001;

const boxOf = item => {
  const box = item.layout ?? item;
  return { x: Number(box.x), y: Number(box.y), width: Number(box.width), height: Number(box.height) };
};
const center = box => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const compareIds = (a, b) => String(a).localeCompare(String(b), 'en');
const round = value => Math.round(value * 1000) / 1000;

function inferredSide(box, other) {
  const a = center(box), b = center(other);
  const dx = (b.x - a.x) / box.width, dy = (b.y - a.y) / box.height;
  return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'top' : 'bottom');
}

function boundaryPoint(node, side, offset) {
  if (node.shape === 'folder') {
    const point = folderBoundary(boxOf(node), side, offset, node.source_shape);
    return { x: round(point.x), y: round(point.y) };
  }
  const box = boxOf(node), point = center(box), [dx, dy] = VECTORS[side];
  if (dx) {
    point.y += offset;
    point.x += dx * box.width / 2 * (node.shape === 'rhombus' ? 1 - Math.abs(offset) / (box.height / 2) : 1);
  } else {
    point.x += offset;
    point.y += dy * box.height / 2 * (node.shape === 'rhombus' ? 1 - Math.abs(offset) / (box.width / 2) : 1);
  }
  return { x: round(point.x), y: round(point.y) };
}

function simplify(points) {
  const result = [];
  for (const original of points) {
    const point = { x: round(original.x), y: round(original.y) };
    const previous = result.at(-1);
    if (previous && distance(previous, point) < EPSILON) continue;
    // A dogleg candidate can double back over a port stub. Collapse those runs
    // too, rather than drawing a connector on top of itself.
    while (result.length > 1) {
      const last = result.at(-1), before = result.at(-2);
      if (before.x === last.x && last.x === point.x || before.y === last.y && last.y === point.y) result.pop();
      else break;
    }
    if (result.length && distance(result.at(-1), point) < EPSILON) continue;
    result.push(point);
  }
  return result;
}

function segments(points) {
  return points.slice(1).map((b, index) => ({ a: points[index], b }));
}

// Liang–Barsky clipping handles diagonal straight connectors as well as elbows.
function intersectsBox(a, b, box, padding = CLEARANCE) {
  const left = box.x - padding + EPSILON, right = box.x + box.width + padding - EPSILON;
  const top = box.y - padding + EPSILON, bottom = box.y + box.height + padding - EPSILON;
  const dx = b.x - a.x, dy = b.y - a.y;
  let low = 0, high = 1;
  for (const [p, q] of [[-dx, a.x - left], [dx, right - a.x], [-dy, a.y - top], [dy, bottom - a.y]]) {
    if (Math.abs(p) < EPSILON) { if (q < 0) return false; }
    else {
      const value = q / p;
      if (p < 0) low = Math.max(low, value); else high = Math.min(high, value);
      if (low > high) return false;
    }
  }
  return high > low + EPSILON;
}

// Separate parallel runs by a visible lane; perpendicular crossings remain valid.
function parallelConflict(a, b, c, d, clearance = GAP - EPSILON) {
  const ax = b.x - a.x, ay = b.y - a.y, bx = d.x - c.x, by = d.y - c.y;
  const length = Math.hypot(ax, ay), otherLength = Math.hypot(bx, by);
  if (length < EPSILON || otherLength < EPSILON) return false;
  if (Math.abs(ax * by - ay * bx) / (length * otherLength) > 0.00001) return false;
  const ux = ax / length, uy = ay / length;
  const gap = Math.abs((c.x - a.x) * uy - (c.y - a.y) * ux);
  if (gap >= clearance) return false;
  const cAlong = (c.x - a.x) * ux + (c.y - a.y) * uy;
  const dAlong = (d.x - a.x) * ux + (d.y - a.y) * uy;
  return Math.min(length, Math.max(cAlong, dAlong)) - Math.max(0, Math.min(cAlong, dAlong)) > EPSILON;
}

function crosses(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return cross(a, b, c) * cross(a, b, d) < -EPSILON && cross(c, d, a) * cross(c, d, b) < -EPSILON;
}

function createPorts(nodes, connections) {
  const byId = new Map(nodes.map(node => [String(node.node_id), node]));
  const groups = new Map(), entries = new Map();
  for (const edge of connections) {
    const start = byId.get(String(edge.start_node_id)), end = byId.get(String(edge.end_node_id));
    if (!start || !end) continue;
    const entry = { edge, start, end };
    entries.set(String(edge.connection_id), entry);
    for (const [role, node, other] of [['a', start, end], ['b', end, start]]) {
      const requested = role === 'a' ? edge.start_side : edge.end_side;
      const side = VECTORS[requested] ? requested : inferredSide(boxOf(node), boxOf(other));
      const key = `${node.node_id}:${side}`;
      const request = { entry, role, node, other, side };
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(request);
    }
  }
  for (const requests of groups.values()) {
    const side = requests[0].side, horizontal = side === 'top' || side === 'bottom';
    requests.sort((a, b) => {
      const ac = center(boxOf(a.other)), bc = center(boxOf(b.other));
      return (horizontal ? ac.x - bc.x : ac.y - bc.y)
        || compareIds(a.entry.edge.connection_id, b.entry.edge.connection_id) || a.role.localeCompare(b.role);
    });
    const box = boxOf(requests[0].node);
    const spacing = Math.min(28, (horizontal ? box.width : box.height) * 0.9 / Math.max(1, requests.length - 1));
    requests.forEach((request, index) => {
      const offset = (index - (requests.length - 1) / 2) * spacing;
      const point = boundaryPoint(request.node, side, offset);
      const [dx, dy] = VECTORS[side];
      let depth = 36 + index * GAP;
      // Keep port stubs inside even the narrowest source gap between two nodes.
      for (const other of nodes) {
        if (other.node_id === request.node.node_id) continue;
        const obstacle = boxOf(other);
        let free = Infinity;
        if (dx && point.y > obstacle.y - CLEARANCE && point.y < obstacle.y + obstacle.height + CLEARANCE) {
          if (dx > 0 && obstacle.x >= box.x + box.width) free = obstacle.x - box.x - box.width;
          if (dx < 0 && obstacle.x + obstacle.width <= box.x) free = box.x - obstacle.x - obstacle.width;
        }
        if (dy && point.x > obstacle.x - CLEARANCE && point.x < obstacle.x + obstacle.width + CLEARANCE) {
          if (dy > 0 && obstacle.y >= box.y + box.height) free = obstacle.y - box.y - box.height;
          if (dy < 0 && obstacle.y + obstacle.height <= box.y) free = box.y - obstacle.y - obstacle.height;
        }
        depth = Math.min(depth, free * 0.38);
      }
      const lead = { x: dx ? (dx < 0 ? box.x - depth : box.x + box.width + depth) : point.x,
        y: dy ? (dy < 0 ? box.y - depth : box.y + box.height + depth) : point.y };
      request.entry[request.role] = point;
      request.entry[`${request.role}Lead`] = { x: round(lead.x), y: round(lead.y) };
      request.entry[`${request.role}Side`] = side;
    });
  }
  return entries;
}

function pathString(points) {
  return points.map((point, index) => `${index ? 'L' : 'M'} ${round(point.x)} ${round(point.y)}`).join(' ');
}

function pathLength(points) {
  return points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0);
}

function obstacleCheck(entry, obstacles, a, b, first, last) {
  for (const obstacle of obstacles) {
    if (first && obstacle.id === String(entry.start.node_id)) continue;
    if (last && obstacle.id === String(entry.end.node_id)) continue;
    if (intersectsBox(a, b, obstacle.box)) return false;
  }
  return true;
}

function routeScore(points, entry, obstacles, occupied, clearance = GAP - EPSILON) {
  const first = points[0], next = points[1], last = points.at(-1), previous = points.at(-2);
  const av = VECTORS[entry.aSide], bv = VECTORS[entry.bSide];
  if ((next.x - first.x) * av[0] + (next.y - first.y) * av[1] <= 0
    || (previous.x - last.x) * bv[0] + (previous.y - last.y) * bv[1] <= 0) return Infinity;
  let score = pathLength(points) + Math.max(0, points.length - 2) * 36;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (!obstacleCheck(entry, obstacles, a, b, i === 1, i === points.length - 1)) return Infinity;
    for (const segment of occupied) {
      if (segment.id === String(entry.edge.connection_id)) continue;
      if (parallelConflict(a, b, segment.a, segment.b, clearance)) return Infinity;
      if (crosses(a, b, segment.a, segment.b)) score += 45;
    }
  }
  return score;
}

function candidateChannels(entry, obstacles, occupied, margin = 360) {
  const { aLead: a, bLead: b } = entry;
  const bounds = { left: Math.min(a.x, b.x) - margin, right: Math.max(a.x, b.x) + margin,
    top: Math.min(a.y, b.y) - margin, bottom: Math.max(a.y, b.y) + margin };
  const xs = new Set([a.x, b.x, (a.x + b.x) / 2, bounds.left, bounds.right]);
  const ys = new Set([a.y, b.y, (a.y + b.y) / 2, bounds.top, bounds.bottom]);
  for (const { box } of obstacles) {
    if (box.x > bounds.right || box.x + box.width < bounds.left || box.y > bounds.bottom || box.y + box.height < bounds.top) continue;
    for (const x of [box.x - 36, box.x + box.width + 36]) xs.add(x);
    for (const y of [box.y - 36, box.y + box.height + 36]) ys.add(y);
  }
  for (const { a: p, b: q } of occupied) {
    if (Math.min(p.x, q.x) > bounds.right || Math.max(p.x, q.x) < bounds.left || Math.min(p.y, q.y) > bounds.bottom || Math.max(p.y, q.y) < bounds.top) continue;
    if (p.x === q.x) for (const offset of [-GAP, GAP]) xs.add(p.x + offset);
    if (p.y === q.y) for (const offset of [-GAP, GAP]) ys.add(p.y + offset);
  }
  return { xs: [...xs].map(round).sort((x, y) => x - y), ys: [...ys].map(round).sort((x, y) => x - y) };
}

class MinHeap {
  values = [];
  push(item) {
    const values = this.values;
    let index = values.length;
    values.push(item);
    while (index) {
      const parent = (index - 1) >> 1;
      if (values[parent].priority <= item.priority) break;
      values[index] = values[parent]; index = parent;
    }
    values[index] = item;
  }
  pop() {
    const values = this.values, result = values[0], last = values.pop();
    if (values.length) {
      let index = 0;
      while (index * 2 + 1 < values.length) {
        let child = index * 2 + 1;
        if (child + 1 < values.length && values[child + 1].priority < values[child].priority) child++;
        if (values[child].priority >= last.priority) break;
        values[index] = values[child]; index = child;
      }
      values[index] = last;
    }
    return result;
  }
}

// A sparse coordinate grid supplies a deterministic fallback for multi-bend routes.
function gridRoute(entry, obstacles, occupied, channels) {
  const { xs, ys } = channels, width = xs.length, count = width * ys.length;
  const start = ys.indexOf(entry.aLead.y) * width + xs.indexOf(entry.aLead.x);
  const end = ys.indexOf(entry.bLead.y) * width + xs.indexOf(entry.bLead.x);
  const point = index => ({ x: xs[index % width], y: ys[Math.floor(index / width)] });
  const scores = new Float64Array(count * 3).fill(Infinity);
  const previous = new Int32Array(count * 3).fill(-1), checked = new Map();
  const heap = new MinHeap(), endPoint = point(end);
  const heuristic = p => Math.abs(p.x - endPoint.x) + Math.abs(p.y - endPoint.y);
  scores[start * 3] = 0;
  heap.push({ state: start * 3, score: 0, priority: heuristic(point(start)) });
  let goal = -1;
  while (heap.values.length) {
    const current = heap.pop();
    if (current.score !== scores[current.state]) continue;
    const index = Math.floor(current.state / 3), direction = current.state % 3;
    if (index === end) { goal = current.state; break; }
    const x = index % width, y = Math.floor(index / width), a = point(index);
    for (const [next, axis] of [[x ? index - 1 : -1, 1], [x + 1 < width ? index + 1 : -1, 1],
      [y ? index - width : -1, 2], [y + 1 < ys.length ? index + width : -1, 2]]) {
      if (next < 0) continue;
      const key = Math.min(index, next) * count + Math.max(index, next);
      let cost = checked.get(key);
      const b = point(next);
      if (cost === undefined) {
        cost = obstacleCheck(entry, obstacles, a, b, false, false) ? distance(a, b) : Infinity;
        if (Number.isFinite(cost)) for (const segment of occupied) {
          if (segment.id === String(entry.edge.connection_id)) continue;
          if (parallelConflict(a, b, segment.a, segment.b)) { cost = Infinity; break; }
          if (crosses(a, b, segment.a, segment.b)) cost += 45;
        }
        checked.set(key, cost);
      }
      if (!Number.isFinite(cost)) continue;
      const nextState = next * 3 + axis, score = current.score + cost + (direction && direction !== axis ? 36 : 0);
      if (score >= scores[nextState]) continue;
      scores[nextState] = score; previous[nextState] = current.state;
      heap.push({ state: nextState, score, priority: score + heuristic(b) });
    }
  }
  if (goal < 0) return null;
  const points = [];
  for (let state = goal; state >= 0; state = previous[state]) points.push(point(Math.floor(state / 3)));
  return simplify([entry.a, ...points.reverse(), entry.b]);
}

function orthogonalRoute(entry, obstacles, occupied) {
  const { a, b, aLead: p, bLead: q } = entry;
  const channels = candidateChannels(entry, obstacles, occupied);
  const candidates = [[a, p, { x: p.x, y: q.y }, q, b], [a, p, { x: q.x, y: p.y }, q, b]];
  for (const x of channels.xs) candidates.push([a, p, { x, y: p.y }, { x, y: q.y }, q, b]);
  for (const y of channels.ys) candidates.push([a, p, { x: p.x, y }, { x: q.x, y }, q, b]);
  let best = null, bestScore = Infinity;
  for (const candidate of candidates) {
    const points = simplify(candidate), score = routeScore(points, entry, obstacles, occupied);
    if (score < bestScore) { best = points; bestScore = score; }
  }
  if (!best) best = gridRoute(entry, obstacles, occupied, channels);
  if (!best) best = gridRoute(entry, obstacles, occupied, candidateChannels(entry, obstacles, occupied, 900));
  if (!best) throw new Error(`No clear display route for connector ${entry.edge.connection_id}`);
  return { points: best, d: pathString(best), kind: 'elbowed' };
}

function chooseLabel(route, edge, obstacles, labels) {
  if (!edge.label_text) return null;
  const lines = String(edge.label_text).split('\n');
  // Include the 18px Helvetica text's 1.2em baseline spacing and its outline
  // halo, so labels remain clear even when the glyphs themselves just fit.
  const width = Math.max(...lines.map(line => line.length)) * 9.6 + 18;
  const height = lines.length * 21.6 + 10;
  let best = null, bestCost = Infinity;
  const total = pathLength(route.points);
  let traveled = 0;
  for (const { a, b } of segments(route.points)) {
    const length = distance(a, b);
    if (length < 35) { traveled += length; continue; }
    for (const ratio of [0.5, 0.3, 0.7]) for (const offset of [-14, 22]) {
      const point = { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio + offset };
      const box = { x: point.x - width / 2, y: point.y - 22, width, height };
      let cost = Math.abs(traveled + length * ratio - total / 2) * 0.05 + (offset > 0 ? 8 : 0);
      if (Math.abs(b.y - a.y) > Math.abs(b.x - a.x)) cost += 15;
      for (const obstacle of [...obstacles.map(item => item.box), ...labels]) {
        if (box.x < obstacle.x + obstacle.width && box.x + box.width > obstacle.x && box.y < obstacle.y + obstacle.height && box.y + box.height > obstacle.y) cost += 100000;
      }
      if (cost < bestCost) { best = { point, box }; bestCost = cost; }
    }
    traveled += length;
  }
  if (!best) return null;
  labels.push(best.box);
  return { x: round(best.point.x), y: round(best.point.y) };
}

/** Return display paths without mutating any workbook record. */
export function routeConnections(nodes, connections) {
  const entries = createPorts(nodes, connections);
  const obstacles = nodes.map(node => ({ id: String(node.node_id), box: boxOf(node) }));
  const reserved = [...entries.values()].flatMap(entry => [
    { id: String(entry.edge.connection_id), a: entry.a, b: entry.aLead },
    { id: String(entry.edge.connection_id), a: entry.bLead, b: entry.b },
  ]);
  const occupied = [...reserved], routes = new Map(), labels = [];
  // Reserve short direct links before routing longer branches around them.
  const ordered = [...entries.values()].sort((a, b) => distance(a.a, a.b) - distance(b.a, b.b)
    || compareIds(a.edge.connection_id, b.edge.connection_id));
  for (const entry of ordered) {
    let route = null;
    const av = VECTORS[entry.aSide], bv = VECTORS[entry.bSide];
    const outward = (entry.b.x - entry.a.x) * av[0] + (entry.b.y - entry.a.y) * av[1] >= 0
      && (entry.a.x - entry.b.x) * bv[0] + (entry.a.y - entry.b.y) * bv[1] >= 0;
    if (entry.edge.line_type === 'straight' && outward
      && Number.isFinite(routeScore([entry.a, entry.b], entry, obstacles, occupied))) {
      route = { points: [entry.a, entry.b], d: pathString([entry.a, entry.b]), kind: 'straight' };
    }
    // Curved source connectors use the same elbowed display routing. The
    // recorded line_type remains untouched for source inspection.
    if (!route) route = orthogonalRoute(entry, obstacles, occupied);
    route.label = chooseLabel(route, entry.edge, obstacles, labels);
    routes.set(String(entry.edge.connection_id), route);
    for (const segment of segments(route.points)) occupied.push({ ...segment, id: String(entry.edge.connection_id) });
  }
  return routes;
}

import fs from 'node:fs';
import assert from 'node:assert/strict';
import { routeConnections } from '../web/routing.js';
import { enlargeNodeForDisplay, validateManualRoute } from '../web/layout.js';
import { folderPolygon, folderPath, folderLabelBox, folderBoundary, folderRayBoundary, pointOnFolderBoundary, segmentHitsFolder } from '../web/folder-shape.js';

// Pin down the nonconvex tab independently of production hit testing.
const FOLDER_CONTOUR = [[.03, 0], [.32, 0], [.44, .18], [.97, .18], [1, .24],
  [1, .94], [.97, 1], [.03, 1], [0, .94], [0, .06]];
const fixtureBox = { x: 0, y: 0, width: 100, height: 100 };
assert.deepEqual(folderPolygon(fixtureBox), FOLDER_CONTOUR.map(([x, y]) => ({ x: x * 100, y: y * 100 })));
assert.equal(folderPath(fixtureBox), folderPolygon(fixtureBox).map(({ x, y }, i) => `${i ? 'L' : 'M'} ${x} ${y}`).join(' ') + ' Z');
assert.deepEqual(folderBoundary(fixtureBox, 'top'), { x: 50, y: 18 }, 'Top-center port meets the body, not the empty tab area');
assert.deepEqual(folderBoundary(fixtureBox, 'top', -30), { x: 20, y: 0 }, 'Top-left port meets the raised tab');
assert(!segmentHitsFolder({ x: 35, y: 1 }, { x: 90, y: 17 }, fixtureBox), 'The concave tab void is not filled by convex clipping');
assert(segmentHitsFolder({ x: -10, y: 8 }, { x: 110, y: 8 }, fixtureBox), 'A line through the raised tab hits the folder');
assert(segmentHitsFolder({ x: 45, y: 17 }, { x: 45, y: 19 }, fixtureBox), 'A short crossing of the body lip is detected');
assert(segmentHitsFolder({ x: 10, y: 18 }, { x: 40, y: 18 }, fixtureBox), 'The internal tab/body seam remains solid');
assert(!segmentHitsFolder({ x: 44, y: 18 }, { x: 97, y: 18 }, fixtureBox), 'Following the actual lip is boundary contact');
assert(!segmentHitsFolder({ x: -10, y: -10 }, { x: 3, y: 0 }, fixtureBox), 'A tangent at a corner is not an interior collision');
assert(segmentHitsFolder({ x: 50, y: 50 }, { x: 50, y: 50 }, fixtureBox), 'A point strictly inside remains an interior hit');
const variants = ['rectangle', 'round_rectangle', 'rhombus'];
assert.equal(new Set(variants.map(variant => folderPath(fixtureBox, variant))).size, 2, 'The display has squared folders and rounded diamonds');
assert.equal(folderPath(fixtureBox, 'round_rectangle'), folderPath(fixtureBox, 'rectangle'), 'Both rectangular source types use the same unchanged squared folder');
assert.deepEqual(folderBoundary(fixtureBox, 'top', 0, 'rhombus'), { x: 50, y: 0 }, 'Diamond top remains centered at the original box extent');
assert.deepEqual(folderBoundary(fixtureBox, 'bottom', 0, 'rhombus'), { x: 50, y: 100 }, 'Diamond bottom retains the original box extent');
assert.deepEqual(folderBoundary(fixtureBox, 'left', 0, 'rhombus'), { y: 50, x: 0 }, 'Diamond left remains centered at the original box extent');
assert(folderBoundary(fixtureBox, 'top', -30, 'rhombus').y > 20, 'The diamond has no raised upper-left folder tab');
assert(!segmentHitsFolder({ x: 0, y: 10 }, { x: 15, y: 10 }, fixtureBox, .001, 'rhombus'), 'The rounded diamond leaves bounding-box corners empty');
const diamond = folderPolygon(fixtureBox, 'rhombus');
assert(diamond.length > 40, 'Rounded diamond corners have smooth sampled contours');
for (const point of diamond) {
  assert(diamond.some(other => Math.abs(other.x + point.x - 100) < 1e-8 && Math.abs(other.y - point.y) < 1e-8), 'Diamond is horizontally symmetric without a tab');
  assert(diamond.some(other => Math.abs(other.y + point.y - 100) < 1e-8 && Math.abs(other.x - point.x) < 1e-8), 'Diamond is vertically symmetric about its center');
}
for (const variant of variants) for (const box of [fixtureBox, { x: -319, y: 724, width: 450, height: 53 }, { x: 213, y: -112, width: 37, height: 260 }]) {
  const vertices = folderPolygon(box, variant);
  assert.equal(Math.min(...vertices.map(point => point.x)), box.x, 'Variant preserves left box extent');
  assert.equal(Math.max(...vertices.map(point => point.x)), box.x + box.width, 'Variant preserves right box extent');
  assert.equal(Math.min(...vertices.map(point => point.y)), box.y, 'Variant preserves top box extent');
  assert.equal(Math.max(...vertices.map(point => point.y)), box.y + box.height, 'Variant preserves bottom box extent');
  const label = folderLabelBox(box, variant);
  if (variant === 'rhombus') {
    assert(Math.abs(label.x + label.width / 2 - box.x - box.width / 2) < 1e-8, 'Diamond label is centered horizontally');
    assert(Math.abs(label.y + label.height / 2 - box.y - box.height / 2) < 1e-8, 'Diamond label is centered vertically');
  }
  for (const x of [label.x, label.x + label.width]) for (const y of [label.y, label.y + label.height]) {
    assert(segmentHitsFolder({ x, y }, { x, y }, box, .001, variant), `Every ${variant} label-box corner lies strictly inside its body`);
  }
  for (const side of ['left', 'right', 'top', 'bottom']) {
    const extent = side === 'left' || side === 'right' ? box.height : box.width;
    for (const offset of [-.5, -.45, -.4, -.2, 0, .25, .45, .5]) {
      assert(pointOnFolderBoundary(folderBoundary(box, side, offset * extent, variant), box, 1e-7, variant), `Cardinal ${side} port lies on the actual ${variant} folder`);
    }
  }
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 36) {
    const dx = Math.cos(angle), dy = Math.sin(angle), point = folderRayBoundary(box, dx, dy, variant);
    assert(pointOnFolderBoundary(point, box, 1e-7, variant), 'Every ray ends on its exact variant silhouette');
    assert((point.x - box.x - box.width / 2) * dx + (point.y - box.y - box.height / 2) * dy > 0, 'Ray endpoint is forward of the center');
  }
}

const sourceData = JSON.parse(fs.readFileSync(new URL('../web/data/frame12.json', import.meta.url), 'utf8'));
const sourceSnapshot = JSON.stringify(sourceData);
const displayNodes = sourceData.nodes.map(enlargeNodeForDisplay);
const grownNodes = displayNodes.map(node => {
  const box = node.layout, width = box.width * 1.2, height = box.height * 1.2;
  return { ...node, layout: { ...box, width, height,
    x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2 } };
});
for (const [index, display] of displayNodes.entries()) {
  const source = sourceData.nodes[index];
  assert.notEqual(display, source, 'Display nodes are independent records');
  assert.notEqual(display.layout, source.layout, 'Display layout is independent of source geometry');
  assert.equal(display.shape, 'folder', 'Display records retain the shared shape API while source_shape selects their silhouette');
  assert.equal(display.source_shape, source.shape, 'The original shape remains available without mutating source');
  assert.equal(display.layout.width, source.layout.width * 1.25, 'Display width is enlarged by 25%');
  assert.equal(display.layout.height, source.layout.height * 1.25, 'Display height is enlarged by 25%');
  assert(Math.abs(display.layout.x + display.layout.width / 2 - source.layout.x - source.layout.width / 2) < .000001, 'Display center x is preserved');
  assert(Math.abs(display.layout.y + display.layout.height / 2 - source.layout.y - source.layout.height / 2) < .000001, 'Display center y is preserved');
}
assert.equal(JSON.stringify(sourceData), sourceSnapshot, 'Enlarging display cards does not mutate source data');

// Audit original shapes and the enlarged, nonconvex folder display independently.
for (const [scenario, nodeRecords] of [['source', sourceData.nodes], ['folder-display', displayNodes], ['folder-grown-1.2', grownNodes]]) {
  const data = { ...sourceData, nodes: nodeRecords };
  const original = JSON.stringify(data);
  const started = performance.now();
  const routes = routeConnections(data.nodes, data.connections);
  const duration = performance.now() - started;
  assert.equal(routes.size, data.connections.length, 'Every connector has a route');
  assert.equal(JSON.stringify(data), original, 'Routing does not mutate source data');
  assert.deepEqual([...routeConnections(data.nodes, data.connections)], [...routes], 'Routing is deterministic');
  assert.deepEqual([...routeConnections([...data.nodes].reverse(), [...data.connections].reverse())], [...routes], 'Routing is independent of source record order');

  const EPS = 0.01;
  const nodes = new Map(data.nodes.map(node => [String(node.node_id), node]));
  const segments = [];
  const collisions = [];
  const overlaps = [];
  const ownNodeCollisions = [];
  const closeParallelRuns = [];
  const selfOverlaps = [];
  const VECTORS = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };

  // Independent convex-polygon clipping, including the actual diamond boundary.
  function polygon(node, shrink = 0) {
    const { x, y, width, height } = node.layout;
    if (node.shape === 'folder') return folderPolygon(node.layout, node.source_shape).map(point => [point.x, point.y]);
    if (node.shape === 'rhombus') return [[x + width / 2, y + shrink], [x + width - shrink, y + height / 2],
      [x + width / 2, y + height - shrink], [x + shrink, y + height / 2]];
    return [[x + shrink, y + shrink], [x + width - shrink, y + shrink],
      [x + width - shrink, y + height - shrink], [x + shrink, y + height - shrink]];
  }
  function clippedInterval(a, b, vertices) {
    let low = 0, high = 1;
    for (let i = 0; i < vertices.length; i++) {
      const p = vertices[i], q = vertices[(i + 1) % vertices.length];
      const ex = q[0] - p[0], ey = q[1] - p[1];
      const constant = ex * (a.y - p[1]) - ey * (a.x - p[0]);
      const slope = ex * (b.y - a.y) - ey * (b.x - a.x);
      if (Math.abs(slope) < 1e-8) { if (constant < 0) return null; }
      else if (slope > 0) low = Math.max(low, -constant / slope);
      else high = Math.min(high, -constant / slope);
      if (high <= low + 1e-8) return null;
    }
    return high > low + 1e-8 ? [low, high] : null;
  }
  function hitsPolygon(a, b, vertices) {
    return Boolean(clippedInterval(a, b, vertices));
  }
  function distanceToBoundary(point, vertices) {
    return Math.min(...vertices.map((a, index) => {
      const b = vertices[(index + 1) % vertices.length], dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((point.x - a[0]) * dx + (point.y - a[1]) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(point.x - a[0] - dx * t, point.y - a[1] - dy * t);
    }));
  }
  function hitsFolder(a, b, node) {
    // Independent audit: triangulate each variant, then clip against the union.
    // Production instead splits an even-odd polygon at segment crossings.
    const parts = folderParts.get(node);
    const outer = polygon(node);
    return parts.some(part => {
      const interval = clippedInterval(a, b, part);
      if (!interval) return false;
      const t = (interval[0] + interval[1]) / 2;
      return distanceToBoundary({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, outer) > EPS;
    });
  }
  function triangulate(vertices) {
    const remaining = vertices.slice(), triangles = [];
    const turn = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    while (remaining.length > 3) {
      let found = false;
      for (let index = 0; index < remaining.length; index++) {
        const a = remaining[(index + remaining.length - 1) % remaining.length];
        const b = remaining[index], c = remaining[(index + 1) % remaining.length];
        if (turn(a, b, c) <= 1e-8) continue;
        if (remaining.some(p => p !== a && p !== b && p !== c
          && turn(a, b, p) >= -1e-8 && turn(b, c, p) >= -1e-8 && turn(c, a, p) >= -1e-8)) continue;
        triangles.push([a, b, c]);
        remaining.splice(index, 1);
        found = true;
        break;
      }
      assert(found, 'Every folder variant is a simple polygon that can be triangulated');
    }
    triangles.push(remaining);
    return triangles;
  }
  const folderParts = new Map(data.nodes.filter(node => node.shape === 'folder')
    .map(node => [node, triangulate(polygon(node))]));
  function onBoundary(point, node) {
    const box = node.layout, cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    if (node.shape === 'folder') return distanceToBoundary(point, polygon(node)) < EPS;
    if (node.shape === 'rhombus') return Math.abs(Math.abs(point.x - cx) / (box.width / 2) + Math.abs(point.y - cy) / (box.height / 2) - 1) < 0.0001;
    return (Math.abs(point.x - box.x) < EPS || Math.abs(point.x - box.x - box.width) < EPS)
      && point.y >= box.y - EPS && point.y <= box.y + box.height + EPS
      || (Math.abs(point.y - box.y) < EPS || Math.abs(point.y - box.y - box.height) < EPS)
      && point.x >= box.x - EPS && point.x <= box.x + box.width + EPS;
  }
  for (const edge of data.connections) {
    const route = routes.get(String(edge.connection_id));
    assert.notEqual(route.kind, 'curved', `No curved display route: ${edge.connection_id}`);
    assert(!/[CcSsQqTtAa]/.test(route.d), `Display paths use only straight segments: ${edge.connection_id}`);
    if (edge.line_type === 'curved') assert.equal(route.kind, 'elbowed', `Curved source connector renders as elbows: ${edge.connection_id}`);
    assert(route.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)), 'Finite route coordinates');
    assert(onBoundary(route.points[0], nodes.get(String(edge.start_node_id))), `Start boundary ${edge.connection_id}`);
    assert(onBoundary(route.points.at(-1), nodes.get(String(edge.end_node_id))), `End boundary ${edge.connection_id}`);
    if (scenario !== 'source') {
      const validation = validateManualRoute(route.points, edge, data.nodes, routes);
      assert(validation.valid, `Folder route remains valid for editing ${edge.connection_id}: ${validation.reason}`);
    }
    for (const [side, endpoint, adjacent] of [[edge.start_side, route.points[0], route.points[1]],
      [edge.end_side, route.points.at(-1), route.points.at(-2)]]) {
      const vector = VECTORS[side];
      if (vector) assert((adjacent.x - endpoint.x) * vector[0] + (adjacent.y - endpoint.y) * vector[1] > 0,
        `Connector respects the source attachment side: ${edge.connection_id}`);
    }
    for (let index = 1; index < route.points.length; index++) {
      const a = route.points[index - 1], b = route.points[index];
      if (route.kind === 'elbowed') assert(Math.abs(a.x - b.x) < EPS || Math.abs(a.y - b.y) < EPS,
        `Elbowed segments remain horizontal or vertical: ${edge.connection_id}`);
      segments.push({ a, b, edge });
      for (const node of data.nodes) {
        if (!(node.shape === 'folder' ? hitsFolder(a, b, node) : hitsPolygon(a, b, polygon(node, EPS)))) continue;
        const collision = { connection: edge.connection_id, node: node.display_code || node.node_id };
        if (String(node.node_id) === String(edge.start_node_id) || String(node.node_id) === String(edge.end_node_id)) ownNodeCollisions.push(collision);
        else collisions.push(collision);
      }
    }
  }
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const one = segments[i], two = segments[j];
    const dx = one.b.x - one.a.x, dy = one.b.y - one.a.y;
    const length = Math.hypot(dx, dy), ox = two.b.x - two.a.x, oy = two.b.y - two.a.y;
    if (!length || Math.abs(dx * oy - dy * ox) > 0.0001 * length) continue;
    const separation = Math.abs(dx * (two.a.y - one.a.y) - dy * (two.a.x - one.a.x)) / length;
    const project = point => ((point.x - one.a.x) * dx + (point.y - one.a.y) * dy) / length;
    const start = project(two.a), end = project(two.b);
    const overlap = Math.min(length, Math.max(start, end)) - Math.max(0, Math.min(start, end));
    if (overlap <= EPS) continue;
    const result = { first: one.edge.connection_id, second: two.edge.connection_id, length: overlap, separation };
    if (one.edge.connection_id === two.edge.connection_id) {
      if (separation < EPS) selfOverlaps.push(result);
    } else {
      if (separation < EPS) overlaps.push(result);
      if (separation < 24 - EPS) closeParallelRuns.push(result);
    }
  }
  const report = { scenario, routes: routes.size, durationMs: Math.round(duration),
    kinds: Object.fromEntries(['straight', 'elbowed', 'curved'].map(kind => [kind, [...routes.values()].filter(route => route.kind === kind).length])),
    unrelatedNodeIntersections: collisions.length, collinearOverlaps: overlaps.length,
    ownNodeIntersections: ownNodeCollisions.length, selfOverlaps: selfOverlaps.length,
    parallelRunsUnder24Units: closeParallelRuns.length,
    examples: { collisions: collisions.slice(0, 10), overlaps: overlaps.slice(0, 10),
      ownNodes: ownNodeCollisions.slice(0, 10), closeParallelRuns: closeParallelRuns.slice(0, 10), selfOverlaps: selfOverlaps.slice(0, 10) } };
  console.log(JSON.stringify(report, null, 2));
  assert.equal(collisions.length, 0, 'Connectors stay clear of unrelated nodes');
  assert.equal(overlaps.length, 0, 'Connectors never share a positive-length line segment');
  assert.equal(ownNodeCollisions.length, 0, 'Connectors never turn through their own endpoint shapes');
  assert.equal(selfOverlaps.length, 0, 'A connector never doubles back on itself');
  assert.equal(closeParallelRuns.length, 0, 'Parallel connector runs keep at least 24 source units of separation');
}
assert.equal(JSON.stringify(sourceData), sourceSnapshot, 'All routing audits preserve the original source records');

import fs from 'node:fs';
import assert from 'node:assert/strict';
import { routeConnections } from '../web/routing.js';
import { snap, gridStepForScale, editableSegments, moveRouteSegment, routeFromPoints, validateManualRoute } from '../web/layout.js';

assert.equal(snap(17, 10), 20);
assert.equal(snap(-17, 10), -20);
assert.equal(snap(19, 10, 2), 22);
assert.equal(snap(0.29, 0.1), 0.3);
for (const scale of [0.025, 0.07, 0.13, 0.4, 0.8, 1, 1.5, 2, 3]) {
  const screenSpacing = gridStepForScale(scale) * scale;
  assert(screenSpacing >= 8 - 1e-8 && screenSpacing <= 16 + 1e-8, `Adaptive grid spacing at ${scale}`);
}
assert.equal(gridStepForScale(10), 5, 'Grid has a useful minimum source-space step');
assert.throws(() => snap(0, 0), RangeError);
assert.throws(() => gridStepForScale(0), RangeError);

const examples = [
  { name: 'single horizontal', points: [{ x: 3, y: 7 }, { x: 303, y: 7 }], index: 0, coordinate: 48 },
  { name: 'single vertical', points: [{ x: 3, y: 7 }, { x: 3, y: 307 }], index: 0, coordinate: 58 },
  { name: 'diagonal', points: [{ x: 3, y: 7 }, { x: 303, y: 207 }], index: 0, coordinate: 103 },
  { name: 'first vertical', points: [{ x: 3, y: 7 }, { x: 3, y: 107 }, { x: 203, y: 107 }], index: 0, coordinate: 48 },
  { name: 'last horizontal', points: [{ x: 3, y: 7 }, { x: 3, y: 107 }, { x: 203, y: 107 }], index: 1, coordinate: 148 },
  { name: 'interior horizontal', points: [{ x: 3, y: 7 }, { x: 3, y: 107 }, { x: 203, y: 107 }, { x: 203, y: 307 }], index: 1, coordinate: 148 },
];
for (const example of examples) {
  const original = structuredClone(example.points);
  const handle = editableSegments(example.points).find(handle => handle.index === example.index);
  const moved = moveRouteSegment(example.points, example.index, example.coordinate, 10);
  assert.deepEqual(moved[0], example.points[0], `${example.name}: start stays attached`);
  assert.deepEqual(moved.at(-1), example.points.at(-1), `${example.name}: end stays attached`);
  assert.deepEqual(example.points, original, `${example.name}: source points are immutable`);
  assert(moved.slice(1).every((point, i) => point.x === moved[i].x || point.y === moved[i].y), `${example.name}: only orthogonal segments`);
  const lane = snap(example.coordinate, 10);
  assert(moved.slice(1).some((point, i) => point[handle.axis] === lane && moved[i][handle.axis] === lane), `${example.name}: moved lane snaps to grid`);
  assert(validateManualRoute(moved, {}, []).valid, `${example.name}: no self overlap`);
  const route = routeFromPoints(moved, { label_text: 'Existing connector label' });
  assert(!/[CQSTA]/i.test(route.d));
  assert(route.label && Number.isFinite(route.label.x) && Number.isFinite(route.label.y));
}

const rect = { node_id: 'a', shape: 'rectangle', layout: { x: 0, y: 0, width: 100, height: 100 } };
const target = { node_id: 'b', shape: 'rectangle', layout: { x: 300, y: 0, width: 100, height: 100 } };
const edge = { connection_id: 'edge', start_node_id: 'a', end_node_id: 'b' };
const free = [{ x: 100, y: 50 }, { x: 300, y: 50 }];
assert(validateManualRoute(free, edge, [rect, target]).valid);
assert(!validateManualRoute([{ x: 90, y: 50 }, { x: 300, y: 50 }], edge, [rect, target]).valid, 'Detached endpoint rejected');
assert(!validateManualRoute([{ x: 100, y: 50 }, { x: 90, y: 50 }, { x: 90, y: -50 }, { x: 300, y: -50 }, { x: 300, y: 50 }], edge, [rect, target]).valid, 'Owner-node traversal rejected');
assert(!validateManualRoute(free, edge, [rect, target, { node_id: 'c', layout: { x: 170, y: 30, width: 50, height: 40 } }]).valid, 'Unrelated node interior rejected');
assert(validateManualRoute(free, edge, [rect, target], new Map([['cross', { points: [{ x: 200, y: 0 }, { x: 200, y: 100 }] }]])).valid, 'Perpendicular crossings remain valid');
assert(!validateManualRoute(free, edge, [rect, target], new Map([['overlap', { points: [{ x: 150, y: 50 }, { x: 250, y: 50 }] }]])).valid, 'Positive collinear overlap rejected');
assert(validateManualRoute(free, edge, [rect, target], new Map([['touch', { points: [{ x: 400, y: 50 }, { x: 300, y: 50 }] }]])).valid, 'Endpoint contact remains valid');
assert(validateManualRoute(free, edge, [rect, target], new Map([['edge', { points: free }]])).valid, 'Own previous route is ignored');
assert(!validateManualRoute([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 40, y: 0 }], {}, []).valid, 'Self overlap rejected');
assert(!validateManualRoute([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 50, y: 100 }, { x: 50, y: -20 }], {}, []).valid, 'Self crossing rejected');
const diamond = { node_id: 'd', shape: 'rhombus', layout: { x: 0, y: 0, width: 100, height: 100 } };
assert(validateManualRoute([{ x: 0, y: 10 }, { x: 20, y: 10 }], {}, [diamond]).valid, 'Empty diamond bounding-box corner stays usable');
assert(!validateManualRoute([{ x: 0, y: 50 }, { x: 100, y: 50 }], {}, [diamond]).valid, 'Actual diamond interior rejected');
const labelRoute = routeFromPoints([{ x: 0, y: 0 }, { x: 500, y: 0 }], { connection_id: 'label', label_text: 'Label' });
const avoidedLabel = routeFromPoints([{ x: 0, y: 0 }, { x: 500, y: 0 }], { connection_id: 'label', label_text: 'Label' }, [],
  new Map([['other', { label: labelRoute.label, label_text: 'Another label' }]]));
assert.notDeepEqual(avoidedLabel.label, labelRoute.label, 'Moved label avoids an existing label at its preferred position');

const data = JSON.parse(fs.readFileSync(new URL('../web/data/frame12.json', import.meta.url), 'utf8'));
const original = JSON.stringify(data);
const routes = routeConnections(data.nodes, data.connections);
let handles = 0, movedSegments = 0, movableConnectors = 0;
const invalidOriginals = [];
for (const edge of data.connections) {
  const route = routes.get(String(edge.connection_id)), controls = editableSegments(route.points);
  assert(controls.length, `${edge.connection_id}: every connector is editable`);
  handles += controls.length;
  const valid = validateManualRoute(route.points, edge, data.nodes, routes);
  if (!valid.valid) invalidOriginals.push({ id: edge.connection_id, reason: valid.reason });
  let hasClearMove = false;
  for (const handle of controls) {
    const moved = moveRouteSegment(route.points, handle.index, handle[handle.axis] + 40, 20, edge);
    assert.deepEqual(moved[0], route.points[0], 'Actual connector start is preserved');
    assert.deepEqual(moved.at(-1), route.points.at(-1), 'Actual connector end is preserved');
    assert(moved.slice(1).every((point, i) => point.x === moved[i].x || point.y === moved[i].y), 'All edited actual routes contain only orthogonal segments');
    if (validateManualRoute(moved, edge, data.nodes, routes).valid) { movedSegments++; hasClearMove = true; }
  }
  if (!hasClearMove) hasClearMove = controls.some(handle => [-200, -100, -60, -40, -20, 20, 60, 100, 200].some(offset =>
    validateManualRoute(moveRouteSegment(route.points, handle.index, handle[handle.axis] + offset, 20, edge), edge, data.nodes, routes).valid));
  assert(hasClearMove, `${edge.connection_id}: at least one clear snapped manual move is possible`);
  movableConnectors++;
}
assert.deepEqual(invalidOriginals, [], 'All original display routes validate');
assert.equal(JSON.stringify(data), original, 'Editing never mutates source records');
assert(movedSegments > 100, 'Actual clear-lane segment moves are accepted');
console.log(JSON.stringify({ connectors: routes.size, editableSegments: handles, validSampleMoves: movedSegments, movableConnectors, checks: 'passed' }, null, 2));

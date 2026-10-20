import assert from 'node:assert/strict';
import fs from 'node:fs';
import { THEMES, MODEL_RULES, createLandscapeModel, assignThemeClusters, cosineSimilarity, similarityComponents } from '../web/landscape-model.js';

const data = JSON.parse(fs.readFileSync(new URL('../web/data/frame12.json', import.meta.url), 'utf8'));
const before = JSON.stringify(data);
const model = createLandscapeModel(data);
assert.equal(model.nodes.length, 128, 'Keep every source node');
assert.equal(model.sourceEdges.length, 181, 'Keep every source connector');
assert.deepEqual(model.sourceEdges.map(edge => edge.original), data.connections);
assert.deepEqual(model.sourceEdges.map(edge => [edge.source, edge.target]), data.connections.map(edge => [edge.start_node_id, edge.end_node_id]));
assert(model.sourceEdges.every(edge => edge.directed && edge.kind === 'source'));
assert.equal(JSON.stringify(data), before, 'Model creation never changes the source');
assert.deepEqual(createLandscapeModel(data), model, 'Repeated creation is deterministic');
assert.deepEqual(createLandscapeModel({ nodes: [], connections: [] }).stats, {
  nodeCount: 0, sourceEdgeCount: 0, inferredEdgeCount: 0, themeCounts: Object.fromEntries(THEMES.map(theme => [theme.id, 0])),
});

const pair = (a, b) => JSON.stringify([a, b].sort());
const sourcePairs = new Set(model.sourceEdges.map(edge => pair(edge.source, edge.target)));
const inferredPairs = new Set(), inferredDegrees = new Map(model.nodes.map(node => [node.id, 0]));
assert(model.inferredEdges.length > 0, 'The supplied data has some useful inferred connections');
for (const edge of model.inferredEdges) {
  assert.equal(edge.directed, false);
  assert.equal(edge.kind, 'inferred');
  assert.notEqual(edge.source, edge.target);
  assert(!sourcePairs.has(pair(edge.source, edge.target)), 'No inferred duplicate of an existing source pair');
  assert(!inferredPairs.has(pair(edge.source, edge.target)), 'No repeated inferred pair');
  inferredPairs.add(pair(edge.source, edge.target));
  inferredDegrees.set(edge.source, inferredDegrees.get(edge.source) + 1);
  inferredDegrees.set(edge.target, inferredDegrees.get(edge.target) + 1);
  assert(edge.weight >= MODEL_RULES.inferenceThreshold && edge.weight <= 1);
  assert.equal(edge.weight, 0.6 * edge.components.cosine + 0.3 * edge.components.jaccard + 0.1 * edge.components.sameRegion);
}
assert([...inferredDegrees.values()].every(degree => degree <= MODEL_RULES.maxInferredDegree), 'Reciprocal top-k caps inferred degree');
assert.equal(createLandscapeModel(data, { maxInferredDegree: 0 }).inferredEdges.length, 0);
assert.throws(() => createLandscapeModel(data, { maxInferredDegree: -1 }), RangeError);
assert.throws(() => createLandscapeModel(data, { inferredThreshold: NaN }), RangeError);

for (const node of model.nodes) {
  assert(Math.hypot(node.initial.x, node.initial.y) <= 1);
  for (const theme of THEMES) {
    const score = node.themes[theme.id];
    assert(Number.isFinite(score) && score >= 0 && score <= 1, 'All scores are finite and normalized');
    const evidence = node.themeEvidence[theme.id];
    assert(Math.abs(score - (1 - Math.exp(-evidence.reduce((sum, item) => sum + item.weight, 0)))) < 1e-12, 'Every score has inspectable evidence');
  }
}

assert.equal(cosineSimilarity({}, {}), 0);
assert.equal(cosineSimilarity({ grid: 1 }, {}), 0);
assert.equal(cosineSimilarity({ grid: 1 }, { grid: 1 }), 1);
assert.equal(cosineSimilarity({ grid: 1 }, { environment: 1 }), 0);
assert.deepEqual(similarityComponents({ id: 'a', themes: {}, region: null }, { id: 'b', themes: {}, region: null }), { cosine: 0, jaccard: 0, sameRegion: 0, score: 0 });
assert.equal(similarityComponents({ id: 'a', themes: {} }, { id: 'b', themes: {} },
  new Map([['a', new Set(['c', 'd'])], ['b', new Set(['c', 'e'])]])).jaccard, 1 / 3);

// Renaming a node, changing its display code and changing URLs cannot alter tags.
const renamed = structuredClone(data);
for (const node of renamed.nodes) {
  node.node_text = 'Government grid hearing community public influence environment';
  node.display_code = 'ZONING';
  node.source_url = 'https://example.test/grid';
}
assert.deepEqual(createLandscapeModel(renamed).nodes.map(node => node.themes), model.nodes.map(node => node.themes));

// Labels alone cannot give an otherwise undocumented node a theme.
const bare = createLandscapeModel({ nodes: [{ node_id: 'bare', node_text: 'Electric grid, public hearing, environment' }], connections: [] });
assert(Object.values(bare.nodes[0].themes).every(score => score === 0));
assert.equal(assignThemeClusters(bare, ['grid']).get('bare').themeId, null);
const negative = createLandscapeModel({
  nodes: [
    { node_id: 'none', 'Public Influence': 'None' },
    { node_id: 'no', Description: 'No public hearings or public comments are available.', 'Public Influence': 'Public Influence:\nNo public involvement.' },
    { node_id: 'after', 'Public Influence': 'Public Influence:\nPublic participation is not available.' },
    { node_id: 'affirmative', 'Public Influence': 'Public Influence:\nResidents may submit comments. No direct approval or veto authority.' },
  ], connections: [],
});
for (const id of ['none', 'no', 'after']) {
  assert.equal(negative.nodeById.get(id).themes['public-influence'], 0, 'Negative public notes never imply participation');
  assert.equal(negative.nodeById.get(id).themes.hearing, 0, 'Negative hearing text never implies a hearing');
}
assert(negative.nodeById.get('affirmative').themes['public-influence'] >= MODEL_RULES.clusterThreshold, 'A limited participation route remains thematically relevant');
const noThemes = assignThemeClusters(model, []);
assert.equal(noThemes.size, data.nodes.length);
assert([...noThemes.values()].every(assignment => assignment.themeId === null));
assert.deepEqual(assignThemeClusters(model, ['grid', 'hearing']), assignThemeClusters(model, ['hearing', 'grid']), 'Selection order does not alter clustering');
const selected = assignThemeClusters(model, ['grid', 'hearing']);
assert.equal(selected.size, 128, 'Unmatched nodes stay in the model');
assert([...selected.values()].every(assignment => assignment.themeId === null || ['grid', 'hearing'].includes(assignment.themeId)));

// Source ordering cannot affect position, inferred edges, or thematic relevance.
const reordered = createLandscapeModel({ ...data, nodes: [...data.nodes].reverse(), connections: [...data.connections].reverse() });
assert.deepEqual(reordered.inferredEdges, model.inferredEdges);
for (const node of reordered.nodes) {
  assert.deepEqual(node.initial, model.nodeById.get(node.id).initial);
  assert.deepEqual(node.themes, model.nodeById.get(node.id).themes);
}
console.log(`Landscape checks passed: ${model.nodes.length} nodes, ${model.sourceEdges.length} original links, ${model.inferredEdges.length} inferred links; max inferred degree ${Math.max(...inferredDegrees.values())}.`);

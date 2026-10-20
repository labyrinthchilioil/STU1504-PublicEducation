// Verify the analysis against source graph records and independently reviewed workbook membership.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { withNodeCodes, SUPPLEMENTAL_NODE_CODES } from '../web/node-codes.js';

const graphBytes = await readFile(new URL('../web/data/frame12.json', import.meta.url));
const graph = JSON.parse(graphBytes);
const analysis = JSON.parse(await readFile(new URL('../web/data/public-influence.json', import.meta.url), 'utf8'));
const workbookBytes = await readFile(new URL('../database/Frame12_Public_Influence_Visualization_Database.xlsx', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sorted = values => [...values].sort();
const graphById = new Map(graph.nodes.map(node => [node.node_id, node]));

assert.equal(analysis.schemaVersion, 1);
assert.equal(analysis.source.sha256, sha256(workbookBytes), 'Analysis provenance matches the current workbook');
assert.equal(analysis.source.graphSha256, sha256(graphBytes.toString('utf8').replace(/\r\n?/g, '\n')),
  'Analysis provenance matches the current graph independently of checkout line endings');
assert.equal(analysis.source.workbook, 'database/Frame12_Public_Influence_Visualization_Database.xlsx');
assert.equal(analysis.nodes.length, 31);
assert.equal(analysis.summary.annotatedNodeCount, 31);
assert.equal(new Set(analysis.nodes.map(node => node.nodeId)).size, 31, 'No duplicated or rounded Miro IDs');

// This membership was reviewed directly against Node_Influence and Mechanism_Summary.
const expectedMechanisms = {
  comment: 'B02 B03 L06 L10 L14 L17 G10 G11 G15 G20 G23 EM02 EM04 EM07 EM08 EA04 EW03 EH03 EC03 EA08'.split(' '),
  formal: ['G17'],
  challenge: ['L22', 'EW05', 'EC05'],
  negotiation: ['X02'],
  compliance: ['G26', 'EN02', 'BUILD', 'CONTROL', 'VERIFY', 'OPERATE'],
};
assert.deepEqual(analysis.mechanisms.map(mechanism => mechanism.count), [20, 1, 3, 1, 6]);
assert.deepEqual(analysis.mechanisms.map(mechanism => mechanism.id), Object.keys(expectedMechanisms));
for (const mechanism of analysis.mechanisms) {
  const actualCodes = analysis.nodes.filter(node => node.mechanismId === mechanism.id).map(node => node.code);
  assert.deepEqual(sorted(actualCodes), sorted(expectedMechanisms[mechanism.id]), `${mechanism.id}: exact source membership`);
  assert.deepEqual(sorted(mechanism.nodeCodes), sorted(actualCodes), `${mechanism.id}: chart and records agree`);
  assert.equal(mechanism.count, actualCodes.length);
}

const originalRedIds = graph.nodes.filter(node =>
  String(node.fill_color).toLowerCase() === '#ffc6c6'
  && String(node.border_color).toLowerCase() === '#ff6464'
  && String(node['Public Influence'] || '').trim()
).map(node => node.node_id);
assert.deepEqual(sorted(analysis.nodes.map(node => node.nodeId)), sorted(originalRedIds),
  'Analysis covers exactly the 31 original red annotated nodes');

const sourceFields = {
  code: 'Frame12 Node Code',
  title: 'Frame12 Node Title',
  domain: 'Domain',
  publicAction: 'Public Action',
  participationAccess: 'Participation Access',
  influenceTarget: 'Potential Influence Target',
  convener: 'Process Initiation / Convener',
  decisionAuthority: 'Decision Authority',
  rightsLimitations: 'Rights / Limitations',
};
for (const record of analysis.nodes) {
  assert.equal(typeof record.nodeId, 'string', `${record.code}: Miro IDs must not become numbers`);
  assert.match(record.nodeId, /^\d{19}$/);
  const source = graphById.get(record.nodeId);
  assert.ok(source, `${record.code}: resolves to an existing graph node`);
  assert.equal(record.code, source.display_code);
  assert.equal(record.sourceUrl, source.source_url);
  assert.equal(record.originalPublicInfluence, source['Public Influence']);
  assert.deepEqual(record.evidenceLinks, source.evidence_links, `${record.code}: all evidence and ownership preserved`);
  const sourceRow = analysis.sourceTables.Node_Influence[record.sourceRow - 2];
  assert.ok(sourceRow, `${record.code}: worksheet row provenance`);
  for (const [field, heading] of Object.entries(sourceFields)) {
    assert.equal(record[field], sourceRow[heading], `${record.code}: source ${heading}`);
  }
}
assert.equal(analysis.nodes.reduce((count, node) => count + node.evidenceLinks.length, 0), 43,
  'All 43 evidence links associated with annotated nodes remain available');

assert.equal(analysis.supplementary.length, 3);
assert.equal(analysis.summary.supplementaryMechanismCount, 3);
assert.deepEqual(analysis.supplementary.map(record => record.code), ['L16', 'EW02', 'EA08']);
for (const record of analysis.supplementary) {
  const source = graphById.get(record.nodeId);
  assert.ok(source, `${record.code}: supplementary mechanism uses an original graph node`);
  assert.equal(record.code, source.display_code);
  assert.equal(record.sourceUrl, source.source_url);
  assert.deepEqual(record.evidenceLinks, source.evidence_links);
  const alreadyAnnotated = analysis.nodes.some(node => node.nodeId === record.nodeId);
  assert.equal(alreadyAnnotated, record.code === 'EA08', `${record.code}: not added to the 31-node total`);
  if (record.code !== 'EA08') assert.ok(!source['Public Influence'], `${record.code}: remains explicitly supplementary`);
}
assert.equal(new Set([...analysis.nodes, ...analysis.supplementary].map(record => record.nodeId)).size, 33,
  'Three supplementary mechanisms reference only two additional graph nodes');

// Presentation-only codes must still exist when navigating back to the graph.
const codedGraph = withNodeCodes(graph);
assert.equal(codedGraph.nodes.length, 128);
assert.equal(new Set(codedGraph.nodes.map(node => node.display_code)).size, 128);
assert.deepEqual(codedGraph.nodes.map(node => node.node_id), graph.nodes.map(node => node.node_id));
for (const [id, code] of Object.entries(SUPPLEMENTAL_NODE_CODES)) {
  assert.equal(codedGraph.nodes.find(node => node.node_id === id)?.display_code, code);
}
assert.equal(codedGraph.connections.length, 181);
for (const connection of codedGraph.connections) {
  assert.ok(graphById.has(connection.start_node_id) && graphById.has(connection.end_node_id));
}

console.log('Public Influence checks passed: 31 exact annotated nodes, counts 20/1/3/1/6, 43 original evidence links, 3 separate supplementary mechanisms, and all 128 graph IDs/codes preserved.');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSpiderSearch, getHighlightRanges } from '../web/spider-search.js';

const data = JSON.parse(fs.readFileSync(new URL('../web/data/frame12.json', import.meta.url), 'utf8'));
const before = JSON.stringify(data);
const search = createSpiderSearch(data).search;
const ids = result => result.matches.map(match => match.id);
const code = result => result.matches.map(match => match.node.display_code);
const stableResult = result => ({ ...result, query: '' });

for (const [english, chinese] of [
  ['grid', '电网'],
  ['environment', '环境'],
  ['government', '政府'],
  ['public influence', '公众参与'],
  ['hearing', '听证'],
  ['land use', '土地'],
  ['construction', '施工'],
  ['operations', '运营'],
  ['Show me public hearings about water', '帮我找出关于水的听证会'],
  ['Show me noise complaints', '查看噪音投诉'],
]) {
  const result = search(english);
  assert(result.total > 0, `${english} finds actual dataset nodes`);
  assert.deepEqual(stableResult(search(chinese)), stableResult(result), `${chinese} finds and ranks the same source evidence`);
}

const hearings = search('Show me public hearings about water');
assert.equal(hearings.matches[0].node.display_code, 'EW03', 'Water-hearing sentence ranks the conservation commission public hearing first');
assert.equal(search('Show me noise complaints').matches[0].node.display_code, 'EN02', 'Noise complaint sentence ranks the noise complaints node first');
assert(search('air permits').matches.slice(0, 4).every(match => match.node.display_code?.startsWith('EA')), 'Two-concept sentence ranks relevant air permit nodes above other permits');
assert(search('air permits').matches.every(match => match.matchedConceptCount === 2), 'Air permit search excludes nodes matching only the generic permit concept');
assert(search('air permits').total < 25, 'The web stays focused on the combined request');
assert.deepEqual(code(search('L10')), ['L10'], 'Exact codes find the intended node');
assert(code(search('water')).includes('EH01'), 'Water query finds the water source decision');
assert(code(search('air')).includes('EA01'), 'Air query finds the emissions decision');
assert(!code(search('water')).includes('G01'), 'A narrow query is not expanded to unrelated thematic nodes');
assert(search('environment').total > search('water').total, 'A general topic covers more than a specific concept');
assert.deepEqual(stableResult(search('🌱 water')), stableResult(search('water')), 'Emoji do not corrupt token offsets');
assert.deepEqual(search('grid'), search('grid'), 'Search ordering is deterministic');

for (const query of ['', '  ', null, undefined, '。!? + ** [ ]', 'show me the nodes']) {
  const result = search(query);
  assert.equal(result.active, false, 'Empty/filler queries do not activate a network');
  assert.equal(result.total, 0);
  assert.deepEqual(result.terms, []);
}
for (const query of ['zorbflax', '量子企鹅', '<script>alert("zorbflax")</script>']) {
  const result = search(query);
  assert.equal(result.active, true);
  assert.equal(result.total, 0, 'Unknown words cannot invent a relationship');
}
const long = search('water '.repeat(10000));
assert(long.query.length <= 300, 'Query processing is bounded');
assert.deepEqual(ids(long), ids(search('water')), 'Repeating the same concept never increases its vote count');
for (const result of [search('grid'), search('water hearing'), search('公众参与'), long]) {
  assert.equal(result.total, result.matches.length);
  for (const match of result.matches) {
    assert(Number.isFinite(match.score) && match.score > 0 && match.score <= 1);
    assert.strictEqual(match.node, data.nodes.find(node => node.node_id === match.id), 'Result references the actual source node');
    assert(match.reason && match.section && match.snippet, 'Every match explains its source');
    assert(match.terms.every(term => typeof term === 'string' && term.length > 0));
  }
}
assert.equal(JSON.stringify(data), before, 'Indexing and querying never mutate the source');
const reversed = createSpiderSearch({ ...data, nodes: [...data.nodes].reverse() });
assert.deepEqual(ids(reversed.search('grid')), ids(search('grid')), 'Input order cannot change rankings');

const fixture = createSpiderSearch({
  nodes: [
    { node_id: 'both', node_text: 'Shared review', Description: 'The power connection and water supply are reviewed together.' },
    { node_id: 'one', node_text: 'One review', Description: 'Power power power grid electric electricity.' },
    { node_id: 'heading', node_text: 'Blank note', 'Public Influence': 'Public Influence:\n' },
    { node_id: 'bare-grid', node_text: 'An unannotated item', layout: { x: 20, y: 20, width: 10, height: 10 } },
  ],
  connections: [],
  canvasItems: [{ item_id: '3458764686135623210', role: 'background', layout: { x: 0, y: 0, width: 100, height: 100 } }],
});
const combined = fixture.search('grid water');
assert.equal(combined.matches[0].id, 'both', 'Coverage of two logical concepts beats synonym repetition of only one');
assert.deepEqual(ids(combined), ['both'], 'Full coverage excludes nodes matching only one requested concept');
assert.equal(combined.conceptCount, 2);
assert.equal(combined.matchedConceptCount, 2);
const partial = fixture.search('grid noise');
assert.deepEqual(ids(partial), ['both', 'one', 'bare-grid'], 'When no node covers all concepts, keep the best available coverage');
assert(partial.matches.every(match => match.reason.includes('1/2 query concepts')), 'Partial coverage is explicit, including region-only evidence');
assert.equal(partial.matchedConceptCount, 1);
assert(!fixture.search('public influence').matches.some(match => match.id === 'heading'), 'A repeated section heading is not topic evidence');
const regionOnly = fixture.search('grid').matches.find(match => match.id === 'bare-grid');
assert(regionOnly);
assert.equal(regionOnly.section, 'Original visual region');
assert.match(regionOnly.reason, /original diagram/);
assert.deepEqual(regionOnly.terms, [], 'Region-only evidence does not pretend a word is in the notes');
assert(!fixture.search('water').matches.some(match => match.id === 'bare-grid'));

const text = 'Air in a chair; air quality, AIRBORNE; water wastewater.';
const ranges = getHighlightRanges(text, ['air', 'air quality', 'water']);
assert.deepEqual(ranges.map(range => text.slice(range.start, range.end)), ['Air', 'air quality', 'water'], 'Whole-word literal matching and longer phrase ranges avoid false highlights');
assert.deepEqual(getHighlightRanges('public hearing', ['public', 'hearing', 'public hearing']), [{ start: 0, end: 14 }]);
assert.deepEqual(getHighlightRanges('a.b aXb', ['a.b']), [{ start: 0, end: 3 }], 'Regular-expression syntax stays literal');
assert.deepEqual(getHighlightRanges('noise <img src=x onerror=alert(1)>', ['<img src=x onerror=alert(1)>']), [{ start: 6, end: 34 }], 'Markup-like terms only produce plain-text offsets');
assert.deepEqual(getHighlightRanges('政府和环境', ['政府', '环境']), [{ start: 0, end: 2 }, { start: 3, end: 5 }]);
assert.deepEqual(getHighlightRanges(null, ['air']), []);
assert.deepEqual(getHighlightRanges('air', []), []);

console.log(`Spider search checks passed: ${data.nodes.length} source nodes; bilingual phrase matching, source evidence, ranking, boundaries and input safety.`);

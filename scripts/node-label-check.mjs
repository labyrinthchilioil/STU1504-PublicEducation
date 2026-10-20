import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formatNodeTitle } from '../web/node-label.js';

const examples = [
  ['PROPOSED BOSTON DATA CENTER', 'Proposed Boston Data Center'],
  ['L01 | Locate the BOSTON parcel', 'L01 | Locate The Boston Parcel'],
  ['L03-S | All applicable Boston zoning routes', 'L03-S | All Applicable Boston Zoning Routes'],
  ['BUILD | construct the approved data center', 'BUILD | Construct The Approved Data Center'],
  ['E-HOLD | Resolve missing or denied environmental requirements', 'E-HOLD | Resolve Missing Or Denied Environmental Requirements'],
  ['I-R | Are all required preconstruction authorizations secured?', 'I-R | Are All Required Preconstruction Authorizations Secured?'],
  ['G01 | Identify Boston\'s electric distribution utility - NSTAR Electric Company (Eversource)',
    'G01 | Identify Boston\'s Electric Distribution Utility - NSTAR Electric Company (Eversource)'],
  ['B04 | Article 80 review outcomes or confirmed non-applicability (enter L20)',
    'B04 | Article 80 Review Outcomes Or Confirmed Non-Applicability (Enter L20)'],
  ['EA02 | Which MassDEP air permit requirements route?', 'EA02 | Which MassDEP Air Permit Requirements Route?'],
  ['ES02 | Prepare EPA SWPPP / NOI & BWSC site plan package', 'ES02 | Prepare EPA SWPPP / NOI & BWSC Site Plan Package'],
  ['EW06 | Are separate Section 401 or USACE Permits required?', 'EW06 | Are Separate Section 401 Or USACE Permits Required?'],
  ['EB01 | Check Boston Article 37 & BERDO requirements', 'EB01 | Check Boston Article 37 & BERDO Requirements'],
  ['LAWFUL BOSTON DATA-CENTER OPERATION', 'Lawful Boston Data-Center Operation'],
  ['SHARED INPUTS:\nBoston parcel, lawful use,\ncooling / discharge', 'Shared Inputs:\nBoston Parcel, Lawful Use,\nCooling / Discharge'],
  ['MEPA review completed or confirmed N/A', 'MEPA Review Completed Or Confirmed N/A'],
  ['115kV grid with kWh metering', '115kV Grid With kWh Metering'],
  ['title V: EPA’s permit; Boston’s review', 'Title V: EPA’s Permit; Boston’s Review'],
  ['  BUILD  ', '  BUILD  '],
  [null, ''],
];
for (const [source, expected] of examples) assert.equal(formatNodeTitle(source), expected, String(source));

const data = JSON.parse(await readFile(new URL('../web/data/frame12.json', import.meta.url), 'utf8'));
let changed = 0;
for (const node of data.nodes) {
  const title = formatNodeTitle(node.node_text);
  assert.equal(title.length, node.node_text.length, `${node.node_id}: offsets stay stable for rich text and query marks`);
  assert.equal(title.replace(/[\p{L}\p{N}]/gu, ''), node.node_text.replace(/[\p{L}\p{N}]/gu, ''), `${node.node_id}: punctuation and spacing`);
  assert.equal(formatNodeTitle(title), title, `${node.node_id}: formatting is idempotent`);
  if (node.display_code) assert.equal(title.split('|')[0].trim(), node.display_code, `${node.node_id}: source code`);
  if (title !== node.node_text) changed++;
}
assert.ok(changed > 100, 'The full source corpus receives the requested title casing');
console.log(`Node labels: ${examples.length} cases and ${data.nodes.length} source titles passed; ${changed} titles normalized.`);

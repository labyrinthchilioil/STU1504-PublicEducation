import { createRegionMap } from './regions.js';

/**
 * An inspectable thematic model, not an embedding model or a factual classifier.
 * Node labels, display codes, URL strings and connection labels are never scored.
 * Only the four source-note sections and the existing visual regions are used.
 */
export const THEMES = Object.freeze([
  { id: 'grid', label: 'Grid', color: '#5c9ee8', description: 'Electric service, capacity and power infrastructure.' },
  { id: 'environment', label: 'Environment', color: '#66b99a', description: 'Air, water, climate and environmental impacts.' },
  { id: 'government', label: 'Government', color: '#aa93d8', description: 'Public authorities, regulation and formal approvals.' },
  { id: 'public-influence', label: 'Public Influence', color: '#e7ae60', description: 'Community participation, comments and complaints.' },
  { id: 'hearing', label: 'Hearing', color: '#d887a6', description: 'Hearings, testimony, public meetings and appeals.' },
  { id: 'land-use', label: 'Land Use', color: '#c6a17b', description: 'Parcels, zoning, siting and development review.' },
  { id: 'construction', label: 'Construction', color: '#e18a70', description: 'Building work, installation and construction permits.' },
  { id: 'operations', label: 'Operations', color: '#70b5bd', description: 'Ongoing operation, monitoring and compliance.' },
].map(theme => Object.freeze(theme)));

export const MODEL_RULES = Object.freeze({
  version: 1,
  themeFormula: 'q = 1 - exp(-(0.55D + 0.25S + 0.65R + 0.65P))',
  themeExplanation: 'D is the number of distinct concept groups in Description (capped at 3). S is the number in Evidence, Time Scope and Public Influence combined (capped at 3). R is 1 for the matching original visual region, otherwise 0. P is 1 only for Public Influence when its source section contains an affirmative participation concept. Simple negated clauses do not count toward Public Influence or Hearing.',
  relationshipFormula: 'R(a,b) = 0.60 cosine(q_a,q_b) + 0.30 Jaccard(N_a,N_b) + 0.10 sameRegion(a,b)',
  relationshipExplanation: 'N is the set of neighbors in the original source graph, ignoring direction only for this comparison. Empty vectors and empty neighbor unions score 0. Missing regions do not count as a match. Inferred links describe thematic similarity, not an official connection or decision.',
  inferenceThreshold: 0.62,
  maxInferredDegree: 3,
  clusterThreshold: 0.25,
  inferenceSelection: 'Exclude self-links and pairs already connected in the source. Keep only pairs scoring at least 0.62 that are in each other’s top 3. Resolve equal scores by node ID.',
  clusterExplanation: 'Each node goes to its highest-scoring selected theme when its score is at least 0.25; ties use the fixed theme order. When other selected themes have positive scores, its layout target blends 87% of its primary theme position with 13% of the score-weighted positions of those secondary themes, plus deterministic spread. Link forces gently adjust positions. Unmatched nodes remain in the periphery. Scores measure thematic relevance, not probability or legal applicability.',
  sourceFields: Object.freeze(['Description', 'Evidence', 'Time Scope', 'Public Influence', 'original visual region']),
});

// Each line is one concept group. Repetition within a group never adds weight.
// Groups intentionally describe broad topics, not the source node names.
const CONCEPTS = {
  grid: [
    ['power supply', /\b(electric(?:al|ity)?|power|energy|utility|utilities|eversource)\b/i],
    ['grid infrastructure', /\b(grid|substations?|transmission|distribution|feeders?|transformers?)\b/i],
    ['capacity and connection', /\b(load|capacity|interconnections?|energiz(?:e|ation)|service connections?)\b/i],
    ['grid planning', /\b(iso[\s-]?ne|system impacts?|reliability|demand|network upgrades?)\b/i],
  ],
  environment: [
    ['air and emissions', /\b(emissions?|air quality|pollution|pollutants?|exhaust|carbon|greenhouse|climate|net[\s-]zero)\b/i],
    ['water and discharge', /\b(water|wastewater|stormwater|sewer|discharge|withdrawal|wetlands?|cooling)\b/i],
    ['environmental review', /\b(environment(?:al)?|mepa|nepa|massdep|epa|conservation|ecolog(?:y|ical))\b/i],
    ['local impacts', /\b(noise|vibration|habitat|flood(?:ing)?|contaminat(?:ion|ed)|waste|hazardous|resilience)\b/i],
  ],
  government: [
    ['public authorities', /\b(government|agenc(?:y|ies)|authorit(?:y|ies)|department|commission|council|municipal|state|federal)\b/i],
    ['formal permissions', /\b(permits?|permitting|approvals?|licen[cs](?:e|es|ing)|certificates?|authorization)\b/i],
    ['rules and enforcement', /\b(regulat(?:ion|ions|ory)|statut(?:e|es|ory)|ordinances?|codes?|enforcement|jurisdiction|legal)\b/i],
    ['named public bodies', /\b(isd|btda|bpda|bcdc|bwsc|zba|dpu|efsb|massdep|mepa|epa|berdo|article\s+\d+)\b/i],
  ],
  'public-influence': [
    ['community participation', /\b(public participation|participat(?:e|ion)|community|communities|residents?|neighbou?r(?:hood)?s?|stakeholders?)\b/i],
    ['public input', /\b(comments?|feedback|input|consultation|outreach|engagement|testimony|public meetings?|public hearings?)\b/i],
    ['challenges and complaints', /\b(complaints?|appeals?|petition(?:s|ers)?|interven(?:e|tion|ors?)|objections?|challenges?)\b/i],
    ['public access', /\b(public notice|public records?|transparency|disclos(?:e|ure)|notification|notice periods?)\b/i],
  ],
  hearing: [
    ['hearing process', /\b(hearings?|adjudicat(?:ion|ory))\b/i],
    ['public meetings', /\b(public meetings?|community meetings?|board meetings?|open meetings?|public sessions?)\b/i],
    ['formal testimony', /\b(testimony|testify|witness(?:es)?|cross[\s-]examin(?:e|ation)|evidentiary)\b/i],
    ['appeal process', /\b(appeals?|interven(?:e|tion|ors?)|petition(?:s|ers)?|dockets?)\b/i],
  ],
  'land-use': [
    ['land and parcels', /\b(land|parcels?|propert(?:y|ies)|real estate|easements?|land rights?)\b/i],
    ['zoning and siting', /\b(zoning|siting|setbacks?|variances?|conditional use|lawful use|land[\s-]use)\b/i],
    ['development planning', /\b(planning|development review|article\s+80|master plan|site[\s-]plans?|urban design)\b/i],
    ['public ways', /\b(public ways?|right[s]?[\s-]of[\s-]way|streets?|sidewalks?|curb|access routes?)\b/i],
  ],
  construction: [
    ['construction work', /\b(construction|construct|building work|demolition|excavat(?:ion|e)|trench(?:ing)?|work phase)\b/i],
    ['installation', /\b(install(?:ation|ing)?|equipment|mechanical|electrical work|building systems?|contractors?)\b/i],
    ['construction oversight', /\b(building permits?|electrical permits?|inspections?|inspectors?|fire safety|building codes?)\b/i],
    ['work impacts', /\b(work zones?|construction noise|truck(?:s|ing)?|work hours?|traffic|site preparation)\b/i],
  ],
  operations: [
    ['operation and service', /\b(operat(?:e|es|ing|ion|ions|ional)|occupancy|commissioning|ongoing|in[\s-]service)\b/i],
    ['monitoring and reporting', /\b(monitor(?:ing)?|reporting|annual|verification|audits?|records?|recordkeeping)\b/i],
    ['continuing compliance', /\b(compliance|renew(?:al|als)?|operating limits?|performance|maintenance|maintain)\b/i],
    ['operating resources', /\b(fuel|generators?|backup|emergency|refrigerants?|consumption)\b/i],
  ],
};

const SECTION_NAMES = ['Description', 'Evidence', 'Time Scope', 'Public Influence'];
const REGION_THEME = { land: 'land-use', grid: 'grid', environment: 'environment', operation: 'operations' };
const compareIds = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const pairKey = (a, b) => JSON.stringify(compareIds(a, b) < 0 ? [a, b] : [b, a]);

function sectionText(node, section) {
  const blocks = node.sections?.[section];
  // Sections and flattened fields carry the same source text. Never count both.
  return Array.isArray(blocks) && blocks.length
    ? blocks.map(block => block.text ?? '').join('\n')
    : String(node[section] ?? '');
}

function excerpt(text, index) {
  const start = Math.max(0, index - 45);
  const end = Math.min(text.length, index + 130);
  return `${start ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

function findConcept(text, pattern, skipNegated) {
  if (!skipNegated) return pattern.exec(text);
  // This is deliberately a small textual rule, not a legal/natural-language
  // inference. Clause boundaries preserve affirmative text after a disclaimer.
  const occurrences = new RegExp(pattern.source, `${pattern.flags}g`);
  for (const match of text.matchAll(occurrences)) {
    const prefix = text.slice(0, match.index).split(/[.!?;,\n:]/).at(-1);
    const suffix = text.slice(match.index + match[0].length).split(/[.!?;,\n:]/)[0];
    const negativePrefix = /\b(no|not|never|without|none|cannot|can't|doesn't|isn't|aren't|won't)\b/i.test(prefix);
    const negativeSuffix = /^\s+(?:(?:is|are|was|were)\s+)?(?:not|unavailable|absent|excluded)\b/i.test(suffix);
    if (!negativePrefix && !negativeSuffix) return match;
  }
  return null;
}

function scoreThemes(node, region) {
  const notes = Object.fromEntries(SECTION_NAMES.map(section => [section, sectionText(node, section)]));
  const publicBody = notes['Public Influence'].replace(/^\s*publice? influence\s*:?\s*/i, '');
  const hasPublicSection = CONCEPTS['public-influence'].some(([, pattern]) => findConcept(publicBody, pattern, true));
  const themes = {}, themeEvidence = {};
  for (const theme of THEMES) {
    const evidence = [];
    let descriptionCount = 0, supplementaryCount = 0;
    for (const [concept, pattern] of CONCEPTS[theme.id]) {
      const skipNegated = ['public-influence', 'hearing'].includes(theme.id);
      const description = findConcept(notes.Description, pattern, skipNegated);
      if (description && descriptionCount < 3) {
        descriptionCount++;
        evidence.push({ kind: 'description', section: 'Description', concept, matched: description[0], excerpt: excerpt(notes.Description, description.index), weight: 0.55 });
      }
      // A concept repeated in several supplementary sections counts only once.
      for (const section of SECTION_NAMES.slice(1)) {
        const match = findConcept(notes[section], pattern, skipNegated);
        if (match && supplementaryCount < 3) {
          supplementaryCount++;
          evidence.push({ kind: 'source-note', section, concept, matched: match[0], excerpt: excerpt(notes[section], match.index), weight: 0.25 });
          break;
        }
      }
    }
    if (REGION_THEME[region] === theme.id) {
      evidence.push({ kind: 'region', section: 'Original visual region', concept: 'source layout', matched: region, excerpt: `Inside the original ${region} region. This is a weak thematic prior, not an authority classification.`, weight: 0.65 });
    }
    if (theme.id === 'public-influence' && hasPublicSection) {
      evidence.push({ kind: 'section', section: 'Public Influence', concept: 'dedicated source section', matched: 'Public Influence', excerpt: 'The source Public Influence section includes an affirmative participation concept.', weight: 0.65 });
    }
    const total = evidence.reduce((sum, reason) => sum + reason.weight, 0);
    themes[theme.id] = 1 - Math.exp(-total);
    themeEvidence[theme.id] = evidence;
  }
  return { themes, themeEvidence };
}

/** Zero vectors have zero similarity, including when both vectors are empty. */
export function cosineSimilarity(a, b) {
  let dot = 0, aSquared = 0, bSquared = 0;
  for (const theme of THEMES) {
    const av = a?.[theme.id] ?? 0, bv = b?.[theme.id] ?? 0;
    dot += av * bv; aSquared += av * av; bSquared += bv * bv;
  }
  return aSquared && bSquared ? Math.min(1, Math.max(0, dot / Math.sqrt(aSquared * bSquared))) : 0;
}

/** Source neighbors are undirected only for computing similarity, not display. */
export function similarityComponents(a, b, neighborMap = new Map()) {
  const an = neighborMap.get(a.id) ?? new Set(), bn = neighborMap.get(b.id) ?? new Set();
  let intersection = 0;
  for (const id of an) if (bn.has(id)) intersection++;
  const union = an.size + bn.size - intersection;
  const cosine = cosineSimilarity(a.themes, b.themes);
  const jaccard = union ? intersection / union : 0;
  const sameRegion = a.region && b.region && a.region === b.region ? 1 : 0;
  return { cosine, jaccard, sameRegion, score: 0.60 * cosine + 0.30 * jaccard + 0.10 * sameRegion };
}

function randomFor(id) {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return () => {
    hash += 0x6D2B79F5;
    let value = Math.imul(hash ^ hash >>> 15, 1 | hash);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function initialPosition(id) {
  const random = randomFor(id);
  const angle = random() * Math.PI * 2, radius = Math.sqrt(random()) * 0.92;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

function strongestTheme(scores, selectedIds = THEMES.map(theme => theme.id)) {
  let themeId = null, score = 0;
  // Use fixed theme order so clicking the same themes in another order is stable.
  for (const theme of THEMES) {
    if (selectedIds.includes(theme.id) && scores[theme.id] > score) {
      themeId = theme.id; score = scores[theme.id];
    }
  }
  return { themeId: score >= MODEL_RULES.clusterThreshold ? themeId : null, score };
}

/**
 * Preserve every source node and every directed source edge. Inferred edges are
 * separate, undirected, and reciprocal top-k, so inferred degree is bounded by k.
 * Input data is never mutated. Initial positions are a centered [-1, 1] scatter.
 */
export function createLandscapeModel(data, options = {}) {
  const regionMap = options.regionMap ?? createRegionMap(data);
  const threshold = options.inferredThreshold ?? MODEL_RULES.inferenceThreshold;
  const degreeCap = options.maxInferredDegree ?? MODEL_RULES.maxInferredDegree;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new RangeError('inferredThreshold must be in [0, 1].');
  if (!Number.isInteger(degreeCap) || degreeCap < 0) throw new RangeError('maxInferredDegree must be a nonnegative integer.');
  const nodes = (data.nodes ?? []).map(source => {
    const id = String(source.node_id), region = regionMap.get(id) ?? null;
    const scored = scoreThemes(source, region);
    return { id, label: source.node_text ?? '', source, region, degree: 0, ...scored, dominantTheme: strongestTheme(scored.themes).themeId, initial: initialPosition(id) };
  });
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  if (nodeById.size !== nodes.length) throw new Error('Landscape source nodes must have unique IDs.');
  const neighborMap = new Map(nodes.map(node => [node.id, new Set()]));
  const connectedPairs = new Set();
  const sourceEdges = (data.connections ?? []).map(original => {
    const source = String(original.start_node_id), target = String(original.end_node_id);
    if (!nodeById.has(source) || !nodeById.has(target)) throw new Error(`Connection ${original.connection_id} has an unknown endpoint.`);
    connectedPairs.add(pairKey(source, target));
    nodeById.get(source).degree++; nodeById.get(target).degree++;
    if (source !== target) { neighborMap.get(source).add(target); neighborMap.get(target).add(source); }
    return { id: String(original.connection_id), source, target, kind: 'source', directed: true, weight: 1, original };
  });

  const orderedNodes = [...nodes].sort((a, b) => compareIds(a.id, b.id));
  const candidates = [];
  const ranked = new Map(nodes.map(node => [node.id, []]));
  if (degreeCap) {
    for (let i = 0; i < orderedNodes.length; i++) {
      for (let j = i + 1; j < orderedNodes.length; j++) {
        const a = orderedNodes[i], b = orderedNodes[j];
        if (connectedPairs.has(pairKey(a.id, b.id))) continue;
        const components = similarityComponents(a, b, neighborMap);
        if (components.score < threshold) continue;
        const edge = {
          id: `inferred:${a.id}:${b.id}`, source: a.id, target: b.id,
          kind: 'inferred', directed: false, weight: components.score, components,
          commonThemes: THEMES.filter(theme => Math.min(a.themes[theme.id], b.themes[theme.id]) >= MODEL_RULES.clusterThreshold)
            .map(theme => ({ id: theme.id, score: Math.min(a.themes[theme.id], b.themes[theme.id]) }))
            .sort((x, y) => y.score - x.score || compareIds(x.id, y.id)),
        };
        candidates.push(edge);
        ranked.get(a.id).push({ edge, other: b.id });
        ranked.get(b.id).push({ edge, other: a.id });
      }
    }
  }
  const topCandidates = new Map([...ranked].map(([id, list]) => [
    id, new Set(list.sort((a, b) => b.edge.weight - a.edge.weight || compareIds(a.other, b.other)).slice(0, degreeCap).map(({ edge }) => edge.id)),
  ]));
  const inferredEdges = candidates.filter(edge => topCandidates.get(edge.source).has(edge.id) && topCandidates.get(edge.target).has(edge.id));
  const themeCounts = Object.fromEntries(THEMES.map(theme => [theme.id, nodes.filter(node => node.themes[theme.id] >= MODEL_RULES.clusterThreshold).length]));
  return {
    nodes, nodeById, edges: [...sourceEdges, ...inferredEdges], sourceEdges, inferredEdges,
    themes: THEMES, source: data.source ?? null,
    rules: { ...MODEL_RULES, inferenceThreshold: threshold, maxInferredDegree: degreeCap,
      inferenceSelection: `Exclude self-links and existing source pairs. Keep scores ≥ ${threshold} only when both endpoints rank each other in their top ${degreeCap}; ties use node ID.` },
    stats: { nodeCount: nodes.length, sourceEdgeCount: sourceEdges.length, inferredEdgeCount: inferredEdges.length, themeCounts },
  };
}

/** Selecting themes reassigns positions; it never deletes a source node or edge. */
export function assignThemeClusters(model, selectedThemeIds = []) {
  const selected = THEMES.map(theme => theme.id).filter(id => selectedThemeIds.includes(id));
  return new Map(model.nodes.map(node => {
    const scores = Object.fromEntries(selected.map(id => [id, node.themes[id]]));
    return [node.id, { ...strongestTheme(node.themes, selected), scores }];
  }));
}

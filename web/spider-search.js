import { createLandscapeModel, THEMES } from './landscape-model.js';

// This is a local, inspectable vocabulary search. It does not send a query to an
// AI service, infer new facts, or change the source graph or its theme scores.
const MAX_QUERY_LENGTH = 300;
const SECTION_NAMES = ['Description', 'Evidence', 'Time Scope', 'Public Influence'];
const STOPWORDS = new Set(('a an and are as at be been being but by can could did do does for from had has have how i if in into is it its me my of on or our please related relevant show that the their them there these they this those through to us was we were what when where which who why will with would you your find nodes node about regarding tell want need all any some something things anything helps help looking look explain get give involving concerning affect affects affecting impact impacts decision decisions 以及 关于 有关 相关 所有 找出 找到 帮我 请问 请 如何 哪些 什么 怎么 可以 是否 这个 我想 想要 查看 显示 寻找 搜索 节点 一个 一些 告诉 了解 的 和 与 对 了 吗 呢').split(/\s+/));

// A unit is a concept, not one vote per synonym. Long phrases are recognized
// first, so "public hearing" is a single Hearing request, not a request for every
// node containing the generic word "public".
const CONCEPTS = [
  { id: 'grid', theme: 'grid', broad: true,
    aliases: ['grid', 'power', 'electricity', 'electrical', 'electric', '电网', '电力', '供电', '电能'],
    terms: ['grid', 'power', 'electricity', 'electrical', 'electric', 'energy', 'utility', 'utilities', 'Eversource', 'NSTAR', 'transmission', 'distribution', 'feeder', 'feeders', 'substation', 'substations', 'interconnection', 'capacity'] },
  { id: 'environment', theme: 'environment', broad: true,
    aliases: ['environment', 'environmental', 'ecology', 'ecological', '环境', '环保', '生态'],
    terms: ['environment', 'environmental', 'emissions', 'air quality', 'pollution', 'water', 'wastewater', 'stormwater', 'wetlands', 'climate', 'noise', 'conservation', 'MassDEP', 'MEPA', 'NEPA', 'EPA', 'carbon', 'discharge'] },
  { id: 'government', theme: 'government', broad: true,
    aliases: ['government', 'governmental', 'public authorities', 'public authority', '政府', '政府部门', '监管机构', '公共机构'],
    terms: ['government', 'agency', 'agencies', 'authority', 'authorities', 'department', 'commission', 'council', 'municipal', 'state', 'federal', 'regulation', 'regulations', 'regulatory', 'ordinance', 'ordinances', 'permit', 'permits', 'approval', 'approvals', 'ISD', 'DPU', 'ZBA', 'BWSC', 'MassDEP', 'EPA'] },
  { id: 'public-influence', theme: 'public-influence', broad: true,
    aliases: ['public influence', 'public participation', 'public involvement', 'community participation', 'community', 'communities', 'residents', 'resident', 'citizens', 'citizen', 'neighborhood', 'neighbourhood', 'influence', 'participation', 'participate', '公众参与', '公众影响', '公共影响', '公众意见', '居民', '社区', '民众', '市民', '公众', '参与'],
    terms: ['public participation', 'public involvement', 'community', 'communities', 'resident', 'residents', 'neighborhood', 'neighbourhood', 'stakeholders', 'public comments', 'public comment', 'comments', 'feedback', 'consultation', 'outreach', 'engagement', 'testimony', 'complaints', 'appeals', 'petition', 'intervention', 'public notice'] },
  { id: 'hearing', theme: 'hearing', broad: true,
    aliases: ['public hearing', 'public hearings', 'hearing', 'hearings', 'testimony', 'testify', 'public meeting', 'public meetings', '听证会', '听证', '公众会议', '公开会议', '证词'],
    terms: ['hearing', 'hearings', 'public meeting', 'public meetings', 'community meeting', 'community meetings', 'board meeting', 'testimony', 'testify', 'adjudicatory', 'evidentiary', 'witness', 'appeal', 'appeals', 'intervention', 'intervenor', 'petition', 'docket'] },
  { id: 'land-use', theme: 'land-use', broad: true,
    aliases: ['land use', 'land-use', 'land', 'zoning', 'siting', '土地使用', '土地利用', '土地', '用地', '分区', '选址'],
    terms: ['land', 'parcel', 'parcels', 'property', 'properties', 'zoning', 'siting', 'setback', 'setbacks', 'variance', 'variances', 'conditional use', 'lawful use', 'development review', 'Article 80', 'site plan', 'site plans', 'public way', 'public-way', 'right-of-way', 'easement', 'easements'] },
  { id: 'construction', theme: 'construction', broad: true,
    aliases: ['construction', 'construct', 'building work', 'building construction', '建设', '建造', '施工', '建筑施工'],
    terms: ['construction', 'construct', 'building work', 'demolition', 'excavation', 'trenching', 'work phase', 'installation', 'install', 'installing', 'contractor', 'contractors', 'building permit', 'electrical permit', 'inspections', 'fire safety', 'work zone', 'work hours'] },
  { id: 'operations', theme: 'operations', broad: true,
    aliases: ['operations', 'operation', 'operating', 'operate', '运营', '运行', '运维'],
    terms: ['operation', 'operations', 'operating', 'operate', 'operational', 'occupancy', 'commissioning', 'ongoing', 'in-service', 'monitoring', 'reporting', 'annual', 'verification', 'compliance', 'maintenance', 'renewal', 'operating limits'] },
  { id: 'water', theme: 'environment',
    aliases: ['water', 'water supply', '供水', '水资源', '水务', '用水', '水'],
    terms: ['water', 'water supply', 'withdrawal', 'BWSC', 'WMA', 'cooling', 'wastewater', 'stormwater', 'wetlands', 'drainage', 'sewer', 'discharge'] },
  { id: 'wastewater', theme: 'environment',
    aliases: ['wastewater', 'sewer', 'sewage', 'discharge', '污水', '废水', '排污', '排水'],
    terms: ['wastewater', 'sewer', 'sewage', 'discharge', 'discharges', 'MWRA', 'NPDES'] },
  { id: 'stormwater', theme: 'environment',
    aliases: ['stormwater', 'storm water', 'runoff', '雨水', '径流'],
    terms: ['stormwater', 'runoff', 'drainage', 'SWPPP', 'CGP', 'erosion', 'sediment'] },
  { id: 'wetlands', theme: 'environment',
    aliases: ['wetland', 'wetlands', '湿地'],
    terms: ['wetland', 'wetlands', 'WPA', 'conservation commission', 'RDA', 'NOI'] },
  { id: 'air', theme: 'environment',
    aliases: ['air quality', 'air', 'emission', 'emissions', '空气质量', '空气', '大气', '排放', '废气'],
    terms: ['air', 'emission', 'emissions', 'exhaust', 'pollutant', 'pollutants', 'Title V', 'air quality', 'generator', 'generators'] },
  { id: 'noise', theme: 'environment',
    aliases: ['noise', 'noisy', 'sound', 'vibration', '噪声', '噪音', '振动'],
    terms: ['noise', 'sound', 'vibration', 'acoustic', 'acoustical'] },
  { id: 'climate', theme: 'environment',
    aliases: ['climate', 'carbon', 'greenhouse', 'net zero', 'net-zero', '气候', '碳排放', '碳', '温室气体', '减碳'],
    terms: ['climate', 'carbon', 'greenhouse', 'net-zero', 'net zero', 'BERDO', 'Article 37', 'decarbonization', 'emissions'] },
  { id: 'capacity', theme: 'grid',
    aliases: ['grid capacity', 'power capacity', 'capacity', 'load', '电力容量', '容量', '负荷', '负载'],
    terms: ['capacity', 'load', 'demand', 'feasibility', 'reliability'] },
  { id: 'upgrades', theme: 'grid',
    aliases: ['grid upgrades', 'grid upgrade', 'upgrades', 'upgrade', '电网升级', '电网改造', '升级', '改造'],
    terms: ['upgrade', 'upgrades', 'feeder', 'feeders', 'substation', 'substations', 'transmission', 'network'] },
  { id: 'approval', theme: 'government',
    aliases: ['approval', 'approvals', 'permit', 'permits', 'permitting', 'authorization', 'authorizations', '许可', '审批', '批准', '许可证'],
    terms: ['approval', 'approvals', 'permit', 'permits', 'permitting', 'authorization', 'authorizations', 'license', 'licence', 'certification'] },
  { id: 'comments', theme: 'public-influence',
    aliases: ['public comments', 'public comment', 'comments', 'comment', 'feedback', '公众评论', '公众反馈', '评论', '意见', '反馈'],
    terms: ['comment', 'comments', 'feedback', 'testimony', 'public input', 'consultation', 'engagement', 'outreach'] },
  { id: 'complaints', theme: 'public-influence',
    aliases: ['complaint', 'complaints', 'complain', '投诉', '举报'],
    terms: ['complaint', 'complaints', 'complain', 'enforcement', 'report violations'] },
  { id: 'appeals', theme: 'hearing',
    aliases: ['appeal', 'appeals', 'challenge', 'challenges', '上诉', '申诉', '异议'],
    terms: ['appeal', 'appeals', 'challenge', 'challenges', 'intervention', 'petition', 'court'] },
  { id: 'notice', theme: 'public-influence',
    aliases: ['public notice', 'notification', 'notice', '公示', '公告', '公众通知'],
    terms: ['public notice', 'notification', 'notice', 'notices', 'notice period'] },
  { id: 'compliance', theme: 'operations',
    aliases: ['compliance', 'monitoring', 'inspection', 'inspections', 'maintenance', '合规', '监测', '检查', '维护'],
    terms: ['compliance', 'monitoring', 'inspection', 'inspections', 'maintenance', 'verification', 'reporting', 'records', 'recordkeeping'] },
];
const THEME_LABELS = new Map(THEMES.map(theme => [theme.id, theme.label]));
const compareIds = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const latinWord = character => Boolean(character && /[a-z0-9_]/i.test(character));

export const SPIDER_SEARCH_RULES = Object.freeze({
  version: 1,
  maxQueryLength: MAX_QUERY_LENGTH,
  scoreFormula: 'score = 0.78 * sum(best evidence weight per matched concept) / query concept count + 0.22 * matched concept count / query concept count',
  fieldWeights: Object.freeze({ 'Node code': 1, 'Node title': 0.96, Description: 0.86, Evidence: 0.70, 'Time Scope': 0.70, 'Public Influence': 0.70 }),
  themeFallback: 'Only explicit broad-theme queries can use the existing theme affinity. When no literal vocabulary term matches, affinity >= 0.25 contributes 0.55 * affinity; a region-only match is labeled as original diagram grouping.',
  selection: 'Keep nodes with the highest available number of matched query concepts. If any node covers every concept, only full-coverage nodes remain. Otherwise the reason reports the partial coverage. Sort by score, then node ID.',
});

/**
 * Literal matches only: terms are never interpreted as HTML or regular
 * expressions. Ranges refer to the supplied plain text and do not overlap.
 * Latin word boundaries prevent, for example, "air" from matching "chair".
 * Render callers should wrap text nodes, rather than replacing innerHTML.
 */
export function getHighlightRanges(text, terms = []) {
  const value = String(text ?? '');
  const lower = value.toLowerCase();
  const found = [];
  for (const raw of new Set(terms.map(term => String(term ?? '').trim()).filter(Boolean))) {
    const term = raw.toLowerCase();
    let offset = 0;
    while (offset < lower.length) {
      const start = lower.indexOf(term, offset);
      if (start < 0) break;
      const end = start + term.length;
      const leftOK = !latinWord(term[0]) || !latinWord(lower[start - 1]);
      const rightOK = !latinWord(term.at(-1)) || !latinWord(lower[end]);
      if (leftOK && rightOK) found.push({ start, end });
      offset = Math.max(end, start + 1);
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const ranges = [];
  for (const range of found) {
    const previous = ranges.at(-1);
    if (!previous || range.start >= previous.end) ranges.push(range);
    else if (range.end > previous.end) previous.end = range.end;
  }
  return ranges;
}

const ALIASES = CONCEPTS.flatMap(concept => concept.aliases.map(alias => ({ alias, concept })))
  .sort((a, b) => b.alias.length - a.alias.length || compareIds(a.alias, b.alias));

function queryUnits(query) {
  const consumed = new Set(), units = new Map();
  for (const { alias, concept } of ALIASES) {
    for (const range of getHighlightRanges(query, [alias])) {
      if (Array.from({ length: range.end - range.start }, (_, index) => range.start + index).some(index => consumed.has(index))) continue;
      for (let index = range.start; index < range.end; index++) consumed.add(index);
      units.set(concept.id, concept);
    }
  }
  // Match offsets use UTF-16 positions, including when an emoji precedes a word.
  const remainder = query.split('').map((character, index) => consumed.has(index) ? ' ' : character).join('');
  for (const match of remainder.matchAll(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu)) {
    let word = match[0].toLowerCase();
    // Chinese sentences do not have word separators. Remove only known request
    // fillers; unknown Chinese remains a literal unit and cannot invent a hit.
    if (/[\u3400-\u9fff]/.test(word)) {
      for (const filler of [...STOPWORDS].filter(item => /[\u3400-\u9fff]/.test(item)).sort((a, b) => b.length - a.length)) word = word.split(filler).join(' ');
    }
    for (const token of word.split(/\s+/).filter(Boolean)) {
      if (STOPWORDS.has(token)) continue;
      units.set(`literal:${token}`, { id: `literal:${token}`, terms: [token] });
    }
  }
  return [...units.values()].sort((a, b) => compareIds(a.id, b.id));
}

function sectionText(node, section) {
  const blocks = node.sections?.[section];
  const text = Array.isArray(blocks) && blocks.length
    ? blocks.map(block => String(block.text ?? '')).join('\n')
    : String(node[section] ?? '');
  // A section heading appears on almost every source note. Treating the
  // "Public Influence" heading as evidence would make this query match all nodes.
  return text.replace(/^\s*(?:description|evidence|time scope|publice? influence)\s*:\s*/gim, '')
    .replace(/^\s*(?:description|evidence|time scope|publice? influence)\s*$/gim, '');
}

function excerpt(text, terms) {
  const range = getHighlightRanges(text, terms)[0];
  const index = range?.start ?? 0;
  const start = Math.max(0, index - 45);
  const end = Math.min(text.length, Math.max(start + 180, range?.end ?? 0));
  return `${start ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

/** Index once, then reuse search(query). The source data is never mutated. */
export function createSpiderSearch(data) {
  const model = createLandscapeModel(data, { maxInferredDegree: 0 });
  const records = model.nodes.map(modelNode => ({
    modelNode,
    node: modelNode.source,
    fields: [
      { section: 'Node code', text: String(modelNode.source.display_code ?? ''), weight: 1 },
      { section: 'Node title', text: String(modelNode.source.node_text ?? ''), weight: 0.96 },
      ...SECTION_NAMES.map(section => ({ section, text: sectionText(modelNode.source, section), weight: section === 'Description' ? 0.86 : 0.70 })),
    ],
  }));

  function search(input) {
    const query = String(input ?? '').normalize('NFKC').trim().slice(0, MAX_QUERY_LENGTH);
    const units = queryUnits(query);
    const themes = THEMES.map(theme => theme.id).filter(id => units.some(unit => unit.theme === id));
    const base = { query, active: units.length > 0, terms: [], themes, matches: [], total: 0, conceptCount: units.length, matchedConceptCount: 0 };
    if (!units.length) return base;
    const matches = [];
    for (const record of records) {
      let strength = 0, covered = 0;
      const terms = new Set(), evidence = [];
      const matchedLabels = new Set();
      for (const unit of units) {
        let unitStrength = 0;
        for (const field of record.fields) {
          const ranges = getHighlightRanges(field.text, unit.terms);
          if (!ranges.length) continue;
          const matchedTerms = ranges.map(range => field.text.slice(range.start, range.end));
          matchedTerms.forEach(term => terms.add(term));
          unitStrength = Math.max(unitStrength, field.weight);
          evidence.push({ ...field, terms: matchedTerms });
        }
        // Only an explicit broad-theme query may use a theme prior. "Water",
        // for example, must never return every node in the Environment region.
        if (unit.broad && !unitStrength) {
          const affinity = record.modelNode.themes[unit.theme] ?? 0;
          if (affinity >= 0.25) {
            const reasons = record.modelNode.themeEvidence[unit.theme] ?? [];
            const textual = reasons.find(reason => ['description', 'source-note'].includes(reason.kind));
            unitStrength = 0.55 * affinity;
            if (textual) {
              terms.add(textual.matched);
              evidence.push({ section: textual.section, text: textual.excerpt, terms: [textual.matched], weight: unitStrength });
            } else {
              evidence.push({ section: 'Original visual region', text: `Grouped with ${THEME_LABELS.get(unit.theme)} in the original diagram.`, terms: [], weight: unitStrength });
            }
          }
        }
        if (unitStrength) {
          covered++;
          strength += unitStrength;
          if (unit.theme) matchedLabels.add(THEME_LABELS.get(unit.theme));
        }
      }
      if (!covered) continue;
      const actualTerms = [...terms].sort((a, b) => b.length - a.length || compareIds(a.toLowerCase(), b.toLowerCase()));
      // Prefer an actual source note over a short title for the result preview.
      const best = [...evidence].sort((a, b) => {
        const aNote = SECTION_NAMES.includes(a.section), bNote = SECTION_NAMES.includes(b.section);
        return Number(bNote) - Number(aNote) || b.weight - a.weight;
      })[0];
      const score = Math.min(1, 0.78 * strength / units.length + 0.22 * covered / units.length);
      const labels = THEMES.map(theme => theme.label).filter(label => matchedLabels.has(label)).join(' + ');
      const sourceReason = best.section === 'Original visual region'
        ? best.text
        : `${labels ? `${labels} · ` : ''}Matches ${best.section.toLowerCase()}`;
      const reason = `${sourceReason}${covered < units.length ? ` · ${covered}/${units.length} query concepts` : ''}`;
      matches.push({
        id: record.modelNode.id,
        node: record.node,
        score,
        matchedConceptCount: covered,
        terms: actualTerms,
        reason,
        snippet: excerpt(best.text, best.terms),
        section: best.section,
      });
    }
    // A sentence such as "air permits" should collect the relevant air permits,
    // not every water or construction permit that covers only half the request.
    // If no node covers all requested concepts, retain the best available
    // coverage and make that partial match explicit in its existing reason.
    const matchedConceptCount = Math.max(0, ...matches.map(match => match.matchedConceptCount));
    const selected = matches.filter(match => match.matchedConceptCount === matchedConceptCount);
    selected.sort((a, b) => b.score - a.score || compareIds(a.id, b.id));
    return {
      ...base,
      terms: [...new Set(selected.flatMap(match => match.terms))].sort((a, b) => b.length - a.length || compareIds(a.toLowerCase(), b.toLowerCase())),
      matches: selected,
      total: selected.length,
      matchedConceptCount,
    };
  }
  return { search };
}

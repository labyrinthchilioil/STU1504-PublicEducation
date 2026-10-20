const ACRONYMS = new Map([
  'BERDO', 'BOS', 'BWSC', 'BZC', 'CGP', 'DPU', 'EEA', 'EIR', 'ENF', 'EO', 'EPA',
  'FERC', 'ISD', 'ISO', 'ISO-NE', 'MEPA', 'MWRA', 'NOI', 'NSTAR', 'PIC', 'RDA',
  'SWPPP', 'USACE', 'WMA', 'WPA', 'ZBA',
].map(word => [word.toLowerCase(), word]));
const SPECIAL_NAMES = new Map([
  'MassDEP', 'kV', 'kW', 'kWh', 'kVA', 'MW', 'MWh', 'MVA', 'Hz', 'MHz', 'GHz',
].map(word => [word.toLowerCase(), word]));
const DISPLAY_CODES = new Set(['HOLD', 'BUILD', 'INSPECT', 'OCCUPANCY', 'CONTROL', 'VERIFY', 'OPERATE', 'I-R', 'E-HOLD']);
const WORDS = /[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*(?:['’][\p{L}]+)?/gu;

function formatWord(word) {
  const normalized = word.toLowerCase();
  const special = ACRONYMS.get(normalized) || SPECIAL_NAMES.get(normalized);
  if (special) return special;
  if (/^(?:[a-z]{1,4}\d+[a-z]?)(?:-[a-z0-9]+)*$/i.test(word) || /^(?:I-R|E-HOLD)$/i.test(word)) {
    return word.toUpperCase();
  }
  if (/^\d/.test(word)) {
    const unit = /^(\d+)([a-z]+)$/i.exec(word);
    if (unit && SPECIAL_NAMES.has(unit[2].toLowerCase())) return `${unit[1]}${SPECIAL_NAMES.get(unit[2].toLowerCase())}`;
    return /^\d+[a-z]$/i.test(word) ? word.toUpperCase() : word;
  }
  if (/[-_]/.test(word)) return word.split(/([-_])/).map(part => /^[-_]$/.test(part) ? part : formatWord(part)).join('');
  const apostrophe = /^(.*?)((?:['’])[\p{L}]+)$/u.exec(word);
  if (apostrophe) {
    const suffix = apostrophe[2].slice(1);
    const ending = /^(?:s|t|re|ve|ll|d|m)$/i.test(suffix) ? suffix.toLowerCase() : formatWord(suffix);
    return `${formatWord(apostrophe[1])}${apostrophe[2][0]}${ending}`;
  }
  const formatted = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  // Avoid expanding a character into multiple code units in rich-text labels.
  return formatted.length === word.length ? formatted : word;
}

/**
 * Presentation-only title casing. Leading source codes, acronyms and units keep
 * their established spelling; punctuation, whitespace and text length stay put.
 */
export function formatNodeTitle(text) {
  const source = String(text ?? '');
  if (DISPLAY_CODES.has(source.trim().toUpperCase())) {
    return source.replace(source.trim(), source.trim().toUpperCase());
  }
  const prefix = /^\s*[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*\s*\|/u.exec(source)?.[0] || '';
  return prefix + source.slice(prefix.length).replace(WORDS, formatWord);
}

/**
 * Format words across inline elements without rebuilding markup or touching
 * links/styles. Block boundaries supply separators absent from textContent.
 */
export function formatNodeTitleContent(element) {
  let text = '';
  const parts = [];
  const blocks = new Set(['p', 'div', 'li', 'ul', 'ol']);
  const separator = () => { if (text && !text.endsWith('\n')) text += '\n'; };
  function visit(node) {
    if (node.nodeType === 3) {
      const start = text.length;
      text += node.data;
      parts.push({ node, start, end: text.length });
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.localName === 'br') { separator(); return; }
    const block = blocks.has(node.localName);
    if (block) separator();
    for (const child of node.childNodes) visit(child);
    if (block) separator();
  }
  visit(element);
  const formatted = formatNodeTitle(text);
  for (const { node, start, end } of parts) node.data = formatted.slice(start, end);
  return element;
}

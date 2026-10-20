export const INSPECTOR_SECTION_ORDER = ['Description', 'Public Influence', 'Evidence', 'Time Scope'];

const SECTION_HEADINGS = {
  Description: ['Description'],
  'Public Influence': ['Public Influence', 'Publice Influence'],
  'Time Scope': ['Time Scope'],
  Evidence: ['Evidence'],
};

/** Only strip a repeated section label, never an ordinary sentence about it. */
export function sectionHeadingPrefixLength(text, section) {
  const labels = SECTION_HEADINGS[section];
  if (!labels) return 0;
  const alternatives = labels.map(label => label.split(' ').join('\\s+')).join('|');
  const match = new RegExp(`^\\s*(?:${alternatives})\\s*(?::|：|$)\\s*`, 'i').exec(String(text ?? ''));
  return match?.[0].length || 0;
}

function textNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  return nodes;
}

function removeEmptyMarkup(root) {
  for (const child of [...root.children]) {
    removeEmptyMarkup(child);
    if (child.localName !== 'br' && !child.textContent.trim() && !child.querySelector('a[href]')) child.remove();
  }
  for (const edge of ['firstChild', 'lastChild']) {
    while (root[edge] && (root[edge].nodeType === Node.TEXT_NODE
      ? !root[edge].textContent.trim() : root[edge].localName === 'br')) root[edge].remove();
  }
}

/** Clean the display copy after appendSafeHtml; original source records stay intact. */
export function cleanInspectorBlock(root, section) {
  let length = sectionHeadingPrefixLength(root.textContent, section);
  while (length) {
    const nodes = textNodes(root);
    let remaining = length;
    const removedLengths = new Map();
    const headingLinks = new Set();
    for (const node of nodes) {
      if (remaining <= 0) break;
      const removed = Math.min(remaining, node.textContent.length);
      removedLengths.set(node, removed);
      remaining -= removed;
      const link = node.parentElement.closest('a[href]');
      if (link && node.textContent.slice(0, removed).trim()) headingLinks.add(link);
    }
    const survivingLinkText = link => textNodes(link)
      .map(node => node.textContent.slice(removedLengths.get(node) || 0)).join('').trim();
    const hasDescriptiveText = link => {
      const text = survivingLinkText(link);
      return text.length > 0 && sectionHeadingPrefixLength(text, section) !== text.length;
    };
    const links = [...root.querySelectorAll('a[href]')];
    // A lone citation named "Evidence" stays accessible. A linked heading can
    // disappear only when the same destination still has a descriptive label.
    const losesCitation = [...headingLinks].some(link => !hasDescriptiveText(link)
      && !links.some(other => other !== link
        && other.getAttribute('href') === link.getAttribute('href') && hasDescriptiveText(other)));
    if (losesCitation) break;
    remaining = length;
    for (const node of nodes) {
      if (remaining <= 0) break;
      const removed = Math.min(remaining, node.textContent.length);
      node.textContent = node.textContent.slice(removed);
      remaining -= removed;
    }
    removeEmptyMarkup(root);
    length = sectionHeadingPrefixLength(root.textContent, section);
  }
  removeEmptyMarkup(root);
  if (section === 'Public Influence') {
    root.classList.add('public-influence-copy');
    // Some source paragraphs contain an answer followed by the next question.
    // Give each authored question its own visual block, keeping its markup.
    for (const question of root.querySelectorAll('strong, b')) {
      if (!/^\s*\d+\.\s+[^?]+\?\s*$/.test(question.textContent)) continue;
      question.classList.add('public-influence-question');
      if (root.textContent.trim() === question.textContent.trim()) {
        root.classList.add('public-influence-question-only');
      }
    }
  }
  return Boolean(root.textContent.trim() || root.querySelector('a[href]'));
}

/** Include link destinations so equally named citations are never merged. */
export function inspectorBlockSignature(root) {
  return JSON.stringify([
    root.textContent.replace(/\s+/g, ' ').trim(),
    [...root.querySelectorAll('a[href]')].map(link => [link.getAttribute('href'), link.textContent]),
  ]);
}

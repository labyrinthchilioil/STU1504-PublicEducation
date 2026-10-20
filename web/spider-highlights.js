import { getHighlightRanges } from './spider-search.js';

/** Wrap original text without interpreting the query as markup or replacing links. */
export function clearSpiderHighlights(root) {
  for (const mark of root.querySelectorAll('mark.spider-mark')) {
    const parent = mark.parentNode;
    mark.replaceWith(document.createTextNode(mark.textContent));
    parent.normalize();
  }
}

export function highlightSpiderText(root, terms) {
  clearSpiderHighlights(root);
  if (!terms?.length) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement.closest('script,style,input,.spider-mark')
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  const ranges = getHighlightRanges(nodes.map(item => item.textContent).join(''), terms);
  let offset = 0;
  for (const textNode of nodes) {
    const text = textNode.textContent;
    const localRanges = ranges.filter(range => range.start < offset + text.length && range.end > offset)
      .map(range => ({ start: Math.max(0, range.start - offset), end: Math.min(text.length, range.end - offset) }));
    offset += text.length;
    if (!localRanges.length) continue;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const { start, end } of localRanges) {
      fragment.append(document.createTextNode(text.slice(cursor, start)));
      const mark = document.createElement('mark');
      mark.className = 'spider-mark';
      mark.textContent = text.slice(start, end);
      fragment.append(mark);
      cursor = end;
    }
    fragment.append(document.createTextNode(text.slice(cursor)));
    textNode.replaceWith(fragment);
  }
}

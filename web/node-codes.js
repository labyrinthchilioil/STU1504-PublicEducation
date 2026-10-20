/** Stable site identifiers for source nodes that do not already have a code.
 * R denotes the resolved outcome of the corresponding Grid decision branch.
 */
export const SUPPLEMENTAL_NODE_CODES = Object.freeze({
  '3458764686135623218': 'P01',
  '3458764686135623219': 'P02',
  '3458764686135681516': 'G14-R',
  '3458764686135681517': 'G16-R',
  '3458764686135681518': 'G18-R',
  '3458764686135681519': 'G22-R',
  '3458764686135816325': 'EM10',
  '3458764686135816326': 'EA09',
  '3458764686135816327': 'EW07',
  '3458764686135816328': 'ES05',
  '3458764686135816329': 'EH08',
  '3458764686135816330': 'EC06',
  '3458764686136016438': 'O01',
});

function prefixHtml(html, code) {
  const source = String(html || '');
  const firstBlock = /^\s*<(?:p|div)(?:\s[^<>]*)?>/i.exec(source);
  const offset = firstBlock?.[0].length || 0;
  return `${source.slice(0, offset)}${code} | ${source.slice(offset)}`;
}

/** Add presentation codes without editing the workbook or exported source data. */
export function withNodeCodes(data) {
  const occupied = new Set(data.nodes.filter(node => node.display_code).map(node => node.display_code.toUpperCase()));
  const nodes = data.nodes.map(node => {
    const code = SUPPLEMENTAL_NODE_CODES[String(node.node_id)];
    if (node.display_code || !code) return node;
    if (occupied.has(code)) throw new Error(`Duplicate display code: ${code}`);
    occupied.add(code);
    return {
      ...node,
      source_display_code: node.display_code,
      source_node_text: node.node_text,
      source_label_html: node.label_html,
      code_origin: 'site',
      display_code: code,
      node_text: `${code} | ${node.node_text}`,
      label_html: node.label_html ? prefixHtml(node.label_html, code) : null,
    };
  });
  const nodeById = new Map(nodes.map(node => [String(node.node_id), node]));
  const connections = data.connections.map(edge => ({
    ...edge,
    start_code: edge.start_code || nodeById.get(String(edge.start_node_id))?.display_code || null,
    end_code: edge.end_code || nodeById.get(String(edge.end_node_id))?.display_code || null,
  }));
  return { ...data, nodes, connections };
}

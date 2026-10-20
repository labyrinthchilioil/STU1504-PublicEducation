// Display regions follow the original background panels and their existing labels.
// They are visual groupings, not new authority classifications or source metadata.
const BACKGROUND_REGIONS = new Map([
  ['3458764686135623209', 'land'],
  ['3458764686135623210', 'grid'],
  ['3458764686135623211', 'environment'],
  ['3458764687774469720', 'operation'],
  ['3458764687776526587', 'operation'],
  ['3458764687777226549', 'operation'],
]);

const LABEL_REGIONS = new Map([
  ['3458764686135623212', 'land'],
  ['3458764686135623213', 'grid'],
  ['3458764686135623214', 'environment'],
  ['3458764687776526893', 'operation'],
  ['3458764687776559229', 'operation'],
  ['3458764687777226550', 'operation'],
]);

/** @returns {Map<string, 'land'|'grid'|'environment'|'operation'>} */
export function createRegionMap(data) {
  const regionMap = new Map();
  const panels = [];

  for (const item of data.canvasItems ?? []) {
    const id = String(item.item_id);
    const backgroundRegion = BACKGROUND_REGIONS.get(id);
    if (backgroundRegion && item.role === 'background') {
      regionMap.set(id, backgroundRegion);
      panels.push({ region: backgroundRegion, box: item.layout ?? item });
    }
    const labelRegion = LABEL_REGIONS.get(id);
    if (labelRegion) regionMap.set(id, labelRegion);
  }

  for (const node of data.nodes ?? []) {
    const box = node.layout ?? node;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const matches = panels.filter(({ box: panel }) => centerX >= panel.x
      && centerX <= panel.x + panel.width && centerY >= panel.y
      && centerY <= panel.y + panel.height);
    // An uncontained or ambiguous node stays neutral, as do standalone notes.
    if (matches.length === 1) regionMap.set(String(node.node_id), matches[0].region);
  }

  return regionMap;
}

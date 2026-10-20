const SVG_NS = 'http://www.w3.org/2000/svg';
const STATES = new Set(['idle', 'thinking', 'highlighting', 'weaving', 'ready', 'empty']);

function element(name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

/**
 * A monoline companion: mirrored curves, a tapered abdomen and a small oval head.
 * Search state belongs to the caller; CSS supplies short, state-driven motion.
 */
export function createSpiderCompanion({ root, pet }) {
  if (!root || !pet) throw new TypeError('A spider dock and pet container are required.');
  const svg = element('svg', {
    viewBox: '0 0 68 80',
    class: 'spider-character',
    'aria-hidden': 'true',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.8,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });
  const silk = element('path', { d: 'M34 5V14', class: 'spider-hanging-silk' });
  const creature = element('g', { class: 'spider-creature' });
  svg.append(silk, creature);

  // Four open, flowing contours per side. Each meets the edge of the head.
  const legs = [
    'M30.8 41.7C24 36.5 23 29 23 23C23 18 21 15 17.5 12',
    'M30.1 43.5C23 42 19 38 16 33L10 25',
    'M30.3 46C23 46.5 19 50 15.5 55L10 63',
    'M31.6 48.1C27 53 25 57 25 62C25 66 23 69 20 72',
  ];
  for (const side of [-1, 1]) {
    legs.forEach((path, index) => {
      const group = element('g', {
        class: `spider-leg spider-leg-${index + 1} spider-leg-${side === -1 ? 'left' : 'right'}`,
        style: `--leg-delay:${index * 90 + (side === 1 ? 120 : 0)}ms;--leg-swing:${side * (index % 2 ? 2 : -2.5)}deg`,
      });
      group.append(element('path', {
        d: path,
        class: 'spider-leg-line',
        ...(side === 1 ? { transform: 'translate(68 0) scale(-1 1)' } : {}),
      }));
      creature.append(group);
    });
  }

  creature.append(element('path', {
    d: 'M34 18C29.5 22 27.5 26 27.5 29.5C27.5 33.5 30 37 34 39C38 37 40.5 33.5 40.5 29.5C40.5 26 38.5 22 34 18Z',
    class: 'spider-abdomen',
  }));
  creature.append(element('path', { d: 'M34 39V40', class: 'spider-neck' }));
  creature.append(element('ellipse', { cx: 34, cy: 44.5, rx: 4, ry: 4.5, class: 'spider-cephalothorax' }));
  pet.replaceChildren(svg);
  pet.setAttribute('aria-hidden', 'true');

  let destroyed = false;

  function setState(state) {
    if (destroyed) return;
    const next = STATES.has(state) ? state : 'idle';
    root.dataset.spiderState = next;
    pet.dataset.state = next;
  }
  function setMode(mode) {
    if (!destroyed) root.dataset.mode = mode === 'landscape' ? 'landscape' : 'diagram';
  }
  setState('idle');
  setMode('diagram');
  return {
    setState,
    setMode,
    destroy() {
      destroyed = true;
      pet.replaceChildren();
      delete pet.dataset.state;
      delete root.dataset.spiderState;
      delete root.dataset.mode;
    },
  };
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const DURATION = 900;
let nextRippleId = 0;

function svgElement(name, attributes) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

/** A brief click response, independent of selected state and search highlights. */
export function createNodeClickRipple(svg) {
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let active = true, destroyed = false, frame = 0, current = null;

  function cancel() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    current?.group.remove();
    current = null;
  }

  function available() {
    return active && !destroyed && !media?.matches && !document.hidden
      && svg.isConnected && !svg.closest('[hidden]');
  }

  function draw(now) {
    frame = 0;
    if (!current || !available() || !current.shape.isConnected) { cancel(); return; }
    const elapsed = Math.max(0, now - current.started);
    if (elapsed >= DURATION) { cancel(); return; }
    const box = current.shape.getBBox();
    const matrix = current.shape.getScreenCTM();
    const scale = Math.max(.001, Math.hypot(matrix?.a || 0, matrix?.b || 0));
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    // Use one radius even for wide rectangular nodes: feedback radiates as a
    // circle from the node's center rather than stretching with its label box.
    const radius = Math.max(box.width / 2, box.height / 2, 5 / scale);
    current.group.dataset.progress = (elapsed / DURATION).toFixed(3);
    current.rings.forEach((ring, index) => {
      const delay = index * 140;
      const progress = Math.max(0, Math.min(1, (elapsed - delay) / (DURATION - delay)));
      const ease = 1 - (1 - progress) ** 3;
      const expansion = (3 + ease * (index ? 23 : 32)) / scale;
      ring.setAttribute('cx', cx);
      ring.setAttribute('cy', cy);
      ring.setAttribute('r', radius + expansion);
      ring.setAttribute('opacity', elapsed < delay ? 0 : (index ? .36 : .56) * (1 - progress) ** 1.5);
    });
    frame = requestAnimationFrame(draw);
  }

  function play({ parent, shape, nodeId, section }) {
    cancel();
    if (!available() || !parent?.isConnected || !shape?.isConnected) return;
    const group = svgElement('g', {
      class: 'node-click-ripple', 'data-node-id': nodeId,
      'data-ripple-id': ++nextRippleId, 'aria-hidden': 'true', 'pointer-events': 'none',
    });
    if (section) group.dataset.section = section;
    const rings = [0, 1].map(index => svgElement('circle', {
      class: 'node-click-ripple-ring', fill: 'none',
      stroke: 'var(--section-color, var(--graph-focus-color, var(--accent, #3868b5)))',
      'stroke-width': index ? .85 : 1.2, 'vector-effect': 'non-scaling-stroke',
      'pointer-events': 'none', opacity: 0,
    }));
    group.append(...rings);
    parent.insertBefore(group, parent.firstChild);
    current = { group, rings, shape, started: performance.now() };
    draw(current.started);
  }

  const onMotionChange = () => { if (media?.matches) cancel(); };
  const onVisibilityChange = () => { if (document.hidden) cancel(); };
  media?.addEventListener('change', onMotionChange);
  document.addEventListener('visibilitychange', onVisibilityChange);

  return {
    play, cancel,
    setActive(value) { active = Boolean(value); if (!active) cancel(); },
    destroy() {
      destroyed = true;
      cancel();
      media?.removeEventListener('change', onMotionChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}

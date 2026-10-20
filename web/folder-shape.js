// The same clockwise polygon drives rendering, connector ports and hit testing.
// Standard folders have a left tab; decision nodes are pure rounded diamonds.
const STANDARD_CONTOUR = [
  [.03, 0], [.32, 0], [.44, .18], [.97, .18], [1, .24],
  [1, .94], [.97, 1], [.03, 1], [0, .94], [0, .06],
];
// Tangent quadratic corners are sampled into the exact polygon used everywhere.
// Normalizing the rounded contour restores all four extrema to the supplied box.
function roundedCorner(start, control, end) {
  return Array.from({ length: 17 }, (_, index) => {
    const t = index / 16, u = 1 - t;
    return start.map((coordinate, axis) => Number(((u * u * coordinate
      + 2 * u * t * control[axis] + t * t * end[axis] - .05) / .9).toFixed(12)));
  });
}
const DIAMOND_CONTOUR = [
  ...roundedCorner([.4, .1], [.5, 0], [.6, .1]),
  ...roundedCorner([.9, .4], [1, .5], [.9, .6]),
  ...roundedCorner([.6, .9], [.5, 1], [.4, .9]),
  ...roundedCorner([.1, .6], [0, .5], [.1, .4]),
];
const contourFor = variant => variant === 'rhombus' ? DIAMOND_CONTOUR : STANDARD_CONTOUR;
const EPSILON = 1e-9;
const cross = (ax, ay, bx, by) => ax * by - ay * bx;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const center = box => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/**
 * Exact clockwise vertices. The optional variant is the original source_shape:
 * rectangle/round_rectangle use a squared folder; rhombus uses a rounded
 * diamond without a tab. Discover keeps the default squared folder.
 */
export function folderPolygon(box, variant = 'rectangle') {
  return contourFor(variant).map(([x, y]) => ({ x: box.x + x * box.width, y: box.y + y * box.height }));
}

/** SVG path using exactly the same straight edges as the routing polygon. */
export function folderPath(box, variant = 'rectangle') {
  return `${folderPolygon(box, variant).map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')} Z`;
}

/** Safe text rectangle: centered in a diamond, below the tab in a folder. */
export function folderLabelBox(box, variant = 'rectangle') {
  const [left, top, width, height] = variant === 'rhombus' ? [.20, .30, .60, .40] : [.10, .28, .80, .57];
  return { x: box.x + box.width * left, y: box.y + box.height * top,
    width: box.width * width, height: box.height * height };
}

/**
 * Outermost boundary along a cardinal side. Offset is measured from the box
 * center on the transverse axis, so side-specific port spacing stays intact.
 */
export function folderBoundary(box, side, offset = 0, variant = 'rectangle') {
  const vertical = side === 'top' || side === 'bottom';
  const axis = vertical ? 'x' : 'y', other = vertical ? 'y' : 'x';
  const span = vertical ? box.width : box.height;
  const coordinate = clamp(center(box)[axis] + offset, box[axis], box[axis] + span);
  const vertices = folderPolygon(box, variant), intersections = [];
  for (let index = 0; index < vertices.length; index++) {
    const a = vertices[index], b = vertices[(index + 1) % vertices.length];
    if (coordinate < Math.min(a[axis], b[axis]) - EPSILON
      || coordinate > Math.max(a[axis], b[axis]) + EPSILON) continue;
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < EPSILON) {
      intersections.push(a[other], b[other]);
    } else {
      const t = clamp((coordinate - a[axis]) / delta, 0, 1);
      intersections.push(a[other] + (b[other] - a[other]) * t);
    }
  }
  const value = side === 'left' || side === 'top' ? Math.min(...intersections) : Math.max(...intersections);
  return { [axis]: coordinate, [other]: value };
}

/** First boundary hit by a ray from the box center, used by Discover links. */
export function folderRayBoundary(box, dx, dy, variant = 'rectangle') {
  if (Math.abs(dx) + Math.abs(dy) < EPSILON) return folderBoundary(box, 'right', 0, variant);
  const origin = center(box), vertices = folderPolygon(box, variant);
  let nearest = Infinity;
  for (let index = 0; index < vertices.length; index++) {
    const a = vertices[index], b = vertices[(index + 1) % vertices.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const denominator = cross(dx, dy, ex, ey);
    if (Math.abs(denominator) < EPSILON) continue;
    const ax = a.x - origin.x, ay = a.y - origin.y;
    const t = cross(ax, ay, ex, ey) / denominator;
    const u = cross(ax, ay, dx, dy) / denominator;
    if (t >= -EPSILON && u >= -EPSILON && u <= 1 + EPSILON) nearest = Math.min(nearest, Math.max(0, t));
  }
  return { x: origin.x + dx * nearest, y: origin.y + dy * nearest };
}

function distanceToEdge(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, squared = dx * dx + dy * dy;
  const t = squared ? clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / squared, 0, 1) : 0;
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

function nearBoundary(point, vertices, tolerance) {
  return vertices.some((a, index) => distanceToEdge(point, a, vertices[(index + 1) % vertices.length]) <= tolerance);
}

/** Distance-based boundary test; tolerance is in the box's coordinate units. */
export function pointOnFolderBoundary(point, box, tolerance = .001, variant = 'rectangle') {
  return nearBoundary(point, folderPolygon(box, variant), Math.max(0, tolerance));
}

function inside(point, vertices, tolerance) {
  if (nearBoundary(point, vertices, tolerance)) return false;
  let contained = false;
  for (let index = 0; index < vertices.length; index++) {
    const a = vertices[index], b = vertices[(index + 1) % vertices.length];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) contained = !contained;
  }
  return contained;
}

/**
 * True only for an interior collision, including the nonconvex tab shoulder.
 * Boundary-only contact and tangencies are allowed. Split at every edge
 * crossing before testing intervals; convex clipping would fill the tab void.
 */
export function segmentHitsFolder(a, b, box, tolerance = .001, variant = 'rectangle') {
  if (Math.max(a.x, b.x) < box.x || Math.min(a.x, b.x) > box.x + box.width
    || Math.max(a.y, b.y) < box.y || Math.min(a.y, b.y) > box.y + box.height) return false;
  const vertices = folderPolygon(box, variant), margin = Math.max(0, tolerance);
  if (inside(a, vertices, margin) || inside(b, vertices, margin)) return true;
  const dx = b.x - a.x, dy = b.y - a.y, squared = dx * dx + dy * dy;
  if (squared < EPSILON * EPSILON) return false;
  const cuts = [0, 1];
  for (let index = 0; index < vertices.length; index++) {
    const p = vertices[index], q = vertices[(index + 1) % vertices.length];
    const ex = q.x - p.x, ey = q.y - p.y;
    const px = p.x - a.x, py = p.y - a.y;
    const denominator = cross(dx, dy, ex, ey);
    if (Math.abs(denominator) < EPSILON) {
      if (Math.abs(cross(px, py, dx, dy)) < EPSILON) {
        cuts.push(clamp((px * dx + py * dy) / squared, 0, 1),
          clamp(((q.x - a.x) * dx + (q.y - a.y) * dy) / squared, 0, 1));
      }
      continue;
    }
    const t = cross(px, py, ex, ey) / denominator;
    const u = cross(px, py, dx, dy) / denominator;
    if (t >= 0 && t <= 1 && u >= -EPSILON && u <= 1 + EPSILON) cuts.push(t);
  }
  cuts.sort((one, two) => one - two);
  for (let index = 1; index < cuts.length; index++) {
    if (cuts[index] - cuts[index - 1] < EPSILON) continue;
    const t = (cuts[index] + cuts[index - 1]) / 2;
    if (inside({ x: a.x + dx * t, y: a.y + dy * t }, vertices, margin)) return true;
  }
  return false;
}

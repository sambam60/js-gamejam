// Shape segment generators — ported verbatim from public/game.js L1943-L2050.
// Segment counts, thickness defaults, and scanline intersection rules match game.js
// so solo (LocalSession) and server-authored shapes rasterize identically.

import type { DrawShapeDraft, Rect, SegmentedShape, ShapeKind, Vec2 } from "./types";

const LINE_THICKNESS = 6; // gj L1423

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function boundsFromSegments(segments: Rect[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const segment of segments) {
    minX = Math.min(minX, segment.x);
    minY = Math.min(minY, segment.y);
    maxX = Math.max(maxX, segment.x + segment.width);
    maxY = Math.max(maxY, segment.y + segment.height);
  }

  return {
    x: minX === Infinity ? 0 : minX,
    y: minY === Infinity ? 0 : minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function buildShape(
  ownerId: string,
  tick: number,
  shape: ShapeKind,
  segments: Rect[],
  extra: Partial<SegmentedShape> = {}
): SegmentedShape {
  const bounds = boundsFromSegments(segments);
  return {
    id: createId(shape),
    ownerId,
    shape,
    createdAtTick: tick,
    segments,
    ...bounds,
    ...extra
  };
}

// gj generateLineSegments (L1943-L1956)
export function generateLineSegments(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  thickness: number = LINE_THICKNESS
): Rect[] {
  const segs: Rect[] = [];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.max(1, Math.floor(len / 8));
  for (let i = 0; i < steps; i++) {
    const t1 = i / steps;
    const t2 = (i + 1) / steps;
    const sx = x1 + dx * t1;
    const sy = y1 + dy * t1;
    const ex = x1 + dx * t2;
    const ey = y1 + dy * t2;
    const mx = Math.min(sx, ex) - thickness / 2;
    const my = Math.min(sy, ey) - thickness / 2;
    segs.push({
      x: mx,
      y: my,
      width: Math.abs(ex - sx) + thickness,
      height: Math.abs(ey - sy) + thickness
    });
  }
  return segs;
}

// gj generateBezierSegments (L1958-L1971)
export function generateBezierSegments(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  thickness: number = LINE_THICKNESS
): Rect[] {
  const segs: Rect[] = [];
  const steps = 16;
  for (let i = 0; i < steps; i++) {
    const t1 = i / steps;
    const t2 = (i + 1) / steps;
    const bx1 =
      (1 - t1) * (1 - t1) * p0.x + 2 * (1 - t1) * t1 * p1.x + t1 * t1 * p2.x;
    const by1 =
      (1 - t1) * (1 - t1) * p0.y + 2 * (1 - t1) * t1 * p1.y + t1 * t1 * p2.y;
    const bx2 =
      (1 - t2) * (1 - t2) * p0.x + 2 * (1 - t2) * t2 * p1.x + t2 * t2 * p2.x;
    const by2 =
      (1 - t2) * (1 - t2) * p0.y + 2 * (1 - t2) * t2 * p1.y + t2 * t2 * p2.y;
    const mx = Math.min(bx1, bx2) - thickness / 2;
    const my = Math.min(by1, by2) - thickness / 2;
    segs.push({
      x: mx,
      y: my,
      width: Math.abs(bx2 - bx1) + thickness,
      height: Math.abs(by2 - by1) + thickness
    });
  }
  return segs;
}

// gj generateCircleSegments (L1973-L1987)
export function generateCircleSegments(cx: number, cy: number, r: number): Rect[] {
  const segs: Rect[] = [];
  const steps = Math.max(6, Math.ceil(r / 3));
  for (let i = 0; i < steps; i++) {
    const y0 = cy - r + (2 * r * i) / steps;
    const y1 = cy - r + (2 * r * (i + 1)) / steps;
    const midY = (y0 + y1) / 2;
    const dy = midY - cy;
    const halfW = Math.sqrt(Math.max(0, r * r - dy * dy));
    if (halfW > 0.5) {
      segs.push({ x: cx - halfW, y: y0, width: halfW * 2, height: y1 - y0 });
    }
  }
  return segs;
}

// gj generateTriangleSegments (L1989-L2017)
export function generateTriangleSegments(v1: Vec2, v2: Vec2, v3: Vec2): Rect[] {
  const segs: Rect[] = [];
  const minY = Math.min(v1.y, v2.y, v3.y);
  const maxY = Math.max(v1.y, v2.y, v3.y);
  const height = maxY - minY;
  if (height < 1) return segs;
  const steps = Math.max(6, Math.ceil(height / 3));
  const edges: [Vec2, Vec2][] = [
    [v1, v2],
    [v2, v3],
    [v3, v1]
  ];
  for (let i = 0; i < steps; i++) {
    const y0 = minY + (height * i) / steps;
    const y1 = minY + (height * (i + 1)) / steps;
    const midY = (y0 + y1) / 2;
    const xs: number[] = [];
    for (const [a, b] of edges) {
      // gj L2003: (a.y <= midY && b.y > midY) || (b.y <= midY && a.y > midY)
      if ((a.y <= midY && b.y > midY) || (b.y <= midY && a.y > midY)) {
        const t = (midY - a.y) / (b.y - a.y);
        xs.push(a.x + t * (b.x - a.x));
      }
    }
    if (xs.length >= 2) {
      const xMin = Math.min(...xs);
      const xMax = Math.max(...xs);
      if (xMax - xMin > 0.5) {
        segs.push({ x: xMin, y: y0, width: xMax - xMin, height: y1 - y0 });
      }
    }
  }
  return segs;
}

// gj generatePolygonSegments (L2019-L2050)
export function generatePolygonSegments(vertices: Vec2[]): Rect[] {
  const segs: Rect[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of vertices) {
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  const height = maxY - minY;
  if (height < 1) return segs;
  const steps = Math.max(6, Math.ceil(height / 3));
  for (let i = 0; i < steps; i++) {
    const y0 = minY + (height * i) / steps;
    const y1 = minY + (height * (i + 1)) / steps;
    const midY = (y0 + y1) / 2;
    const xs: number[] = [];
    for (let j = 0; j < vertices.length; j++) {
      const a = vertices[j];
      const b = vertices[(j + 1) % vertices.length];
      if ((a.y <= midY && b.y > midY) || (b.y <= midY && a.y > midY)) {
        const t = (midY - a.y) / (b.y - a.y);
        xs.push(a.x + t * (b.x - a.x));
      }
    }
    xs.sort((left, right) => left - right);
    for (let j = 0; j + 1 < xs.length; j += 2) {
      if (xs[j + 1] - xs[j] > 0.5) {
        segs.push({ x: xs[j], y: y0, width: xs[j + 1] - xs[j], height: y1 - y0 });
      }
    }
  }
  return segs;
}

export function shapeContainsPoint(shape: SegmentedShape, point: Vec2): boolean {
  return shape.segments.some(
    (segment) =>
      point.x >= segment.x &&
      point.x <= segment.x + segment.width &&
      point.y >= segment.y &&
      point.y <= segment.y + segment.height
  );
}

export function createShapeFromDraft(
  ownerId: string,
  tick: number,
  draft: DrawShapeDraft
): SegmentedShape | null {
  const tool = draft.tool === "square" ? "rect" : draft.tool;

  if (tool === "polygon") {
    const vertices = draft.points ?? [];
    if (vertices.length < 3) return null;
    return buildShape(ownerId, tick, "polygon", generatePolygonSegments(vertices), { vertices });
  }

  if (tool === "bezier") {
    const points = draft.points ?? [];
    if (points.length !== 3) return null;
    const [p0, p1, p2] = points;
    return buildShape(
      ownerId,
      tick,
      "bezier",
      generateBezierSegments(p0, p1, p2, LINE_THICKNESS),
      { p0, p1, p2 }
    );
  }

  const start = draft.start;
  const end = draft.end;
  if (!start || !end) return null;

  const sx = Math.min(start.x, end.x);
  const sy = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  if (tool === "rect") {
    if (width < 4 || height < 4) return null; // gj L1436: w>4 && h>4
    const segments = [{ x: sx, y: sy, width, height }];
    return buildShape(ownerId, tick, "rect", segments);
  }

  if (tool === "circle") {
    const r = Math.min(width, height) / 2;
    if (r <= 4) return null; // gj L1405: r>4
    const cx = (start.x + end.x) / 2;
    const cy = (start.y + end.y) / 2;
    return buildShape(ownerId, tick, "circle", generateCircleSegments(cx, cy, r), { cx, cy, r });
  }

  if (tool === "triangle") {
    if (width <= 4 || height <= 4) return null; // gj L1409: w>4 && h>4
    const v1 = { x: sx + width / 2, y: sy + height };
    const v2 = { x: sx, y: sy };
    const v3 = { x: sx + width, y: sy };
    return buildShape(
      ownerId,
      tick,
      "triangle",
      generateTriangleSegments(v1, v2, v3),
      { v1, v2, v3 }
    );
  }

  if (tool === "line") {
    const ldx = end.x - start.x;
    const ldy = end.y - start.y;
    const len = Math.hypot(ldx, ldy);
    if (len <= 8) return null; // gj L1422: len>8
    return buildShape(
      ownerId,
      tick,
      "line",
      generateLineSegments(start.x, start.y, end.x, end.y, LINE_THICKNESS),
      { x1: start.x, y1: start.y, x2: end.x, y2: end.y }
    );
  }

  return null;
}

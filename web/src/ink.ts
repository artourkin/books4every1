import { getStroke } from "perfect-freehand";

export type InkPoint = { x: number; y: number; pressure: number };
export type InkStroke = {
  id: string;
  tool: "pen" | "highlighter";
  color: string;
  width: number;
  points: InkPoint[];
};
export type InkPage = {
  page: number;
  revision: number;
  strokes: InkStroke[];
  updatedAt: string | null;
};
export type PageSize = { width: number; height: number };
export type InkTool = "pen" | "highlighter" | "eraser";

export function strokePath(stroke: InkStroke, size: PageSize) {
  const outline = getStroke(
    stroke.points.map((p) => [p.x * size.width, p.y * size.height, p.pressure]),
    {
      size: stroke.width * size.width,
      thinning: stroke.tool === "pen" ? 0.45 : 0,
      smoothing: 0.6,
      streamline: 0.35,
      simulatePressure: false,
      last: true,
    },
  );
  if (outline.length < 3) return "";
  // Midpoint quadratics smooth the outline without a large collection of DOM nodes.
  let d = `M${outline[0][0]},${outline[0][1]} Q`;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i],
      b = outline[(i + 1) % outline.length];
    d += `${a[0]},${a[1]} ${(a[0] + b[0]) / 2},${(a[1] + b[1]) / 2} `;
  }
  return d + "Z";
}
type XY = { x: number; y: number };
function distance(p: XY, a: XY, b: XY) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t =
    dx || dy
      ? Math.max(
          0,
          Math.min(
            1,
            ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy),
          ),
        )
      : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function side(a: XY, b: XY, c: XY) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function segmentsNear(a: XY, b: XY, c: XY, d: XY, r: number) {
  // End-point distances also handle dots and collinear segments.
  if (
    Math.min(
      distance(a, c, d),
      distance(b, c, d),
      distance(c, a, b),
      distance(d, a, b),
    ) <= r
  )
    return true;
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}
export function touchedStroke(
  stroke: InkStroke,
  from: InkPoint,
  to: InkPoint,
  size: PageSize,
  radius: number,
) {
  const xy = (p: XY) => ({ x: p.x * size.width, y: p.y * size.height });
  const a = xy(from),
    b = xy(to),
    tolerance = radius + stroke.width * size.width * 0.75;
  for (let i = 0; i < stroke.points.length; i++) {
    if (
      segmentsNear(
        a,
        b,
        xy(stroke.points[Math.max(0, i - 1)]),
        xy(stroke.points[i]),
        tolerance,
      )
    )
      return true;
  }
  return false;
}

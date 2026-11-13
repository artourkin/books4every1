import {
  memo,
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  strokePath,
  touchedStroke,
  type InkStroke,
  type InkPoint,
  type InkTool,
  type PageSize,
} from "./ink";

type Gesture = {
  pointerId: number;
  pointerType: string;
  tool: InkTool;
  stroke: InkStroke;
  erased: Set<string>;
  previous: InkPoint;
};
const SavedStroke = memo(function SavedStroke({
  stroke,
  size,
}: {
  stroke: InkStroke;
  size: PageSize;
}) {
  return (
    <path
      className="ink-stroke"
      data-stroke-id={stroke.id}
      data-tool={stroke.tool}
      d={strokePath(stroke, size)}
      fill={stroke.color}
      opacity={stroke.tool === "highlighter" ? 0.3 : 1}
    />
  );
});
export function PDFInkLayer({
  strokes,
  size,
  enabled,
  tool,
  color,
  width,
  drawWithTouch,
  onChange,
  onActive,
  onError,
}: {
  strokes: InkStroke[];
  size: PageSize;
  enabled: boolean;
  tool: InkTool;
  color: string;
  width: number;
  drawWithTouch: boolean;
  onChange: (strokes: InkStroke[]) => void;
  onActive: (active: boolean) => void;
  onError: (message: string) => void;
}) {
  const svg = useRef<SVGSVGElement>(null),
    draft = useRef<SVGPathElement>(null),
    gesture = useRef<Gesture | null>(null),
    frame = useRef(0),
    lastPen = useRef(-Infinity);
  const pan = useRef<{ id: number; x: number; y: number } | null>(null);
  const activeCallback = useRef(onActive);
  activeCallback.current = onActive;
  const clear = useCallback(() => {
    cancelAnimationFrame(frame.current);
    gesture.current = null;
    pan.current = null;
    draft.current?.setAttribute("d", "");
    svg.current
      ?.querySelectorAll<SVGPathElement>("[data-stroke-id]")
      .forEach((p) => p.style.removeProperty("visibility"));
    activeCallback.current(false);
  }, []);
  useEffect(() => {
    if (!enabled) clear();
    return clear;
  }, [enabled, clear]);
  useEffect(() => {
    const blur = () => clear();
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, [clear]);
  const point = (event: PointerEvent): InkPoint => {
    const bounds = svg.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
      pressure:
        event.pointerType === "pen" && event.pressure > 0
          ? event.pressure
          : 0.5,
    };
  };
  const capture = (e: ReactPointerEvent<SVGSVGElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* Synthetic events and interrupted pointers have no capture target. */
    }
  };
  const paint = () => {
    const g = gesture.current;
    if (!g || g.tool === "eraser") return;
    draft.current?.setAttribute("d", strokePath(g.stroke, size));
    draft.current?.setAttribute("fill", g.stroke.color);
    draft.current?.setAttribute(
      "opacity",
      g.tool === "highlighter" ? "0.3" : "1",
    );
  };
  const erase = (from: InkPoint, to: InkPoint) => {
    const g = gesture.current;
    if (!g) return;
    const radius =
      (7 / Math.max(1, svg.current!.getBoundingClientRect().width)) *
      size.width;
    for (const stroke of strokes) {
      if (
        !g.erased.has(stroke.id) &&
        touchedStroke(stroke, from, to, size, radius)
      ) {
        g.erased.add(stroke.id);
        svg.current
          ?.querySelectorAll<SVGPathElement>("[data-stroke-id]")
          .forEach((p) => {
            if (p.dataset.strokeId === stroke.id) p.style.visibility = "hidden";
          });
      }
    }
  };
  const append = (native: PointerEvent) => {
    const g = gesture.current;
    if (!g || g.pointerId !== native.pointerId) return;
    if (native.pointerType === "pen") lastPen.current = performance.now();
    const samples = native.getCoalescedEvents?.();
    for (const event of samples?.length ? samples : [native]) {
      const next = point(event);
      if (g.tool === "eraser") erase(g.previous, next);
      else if (g.stroke.points.length < 10000) {
        const prev = g.stroke.points[g.stroke.points.length - 1];
        if (
          Math.hypot(
            (next.x - prev.x) * size.width,
            (next.y - prev.y) * size.height,
          ) > 0.1
        )
          g.stroke.points.push(next);
      }
      g.previous = next;
    }
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(paint);
  };
  const down = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!enabled) return;
    if (e.pointerType === "touch" && !drawWithTouch) {
      if (gesture.current || performance.now() - lastPen.current < 650) return;
      pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      capture(e);
      return;
    }
    if (
      gesture.current ||
      (e.pointerType === "touch" && performance.now() - lastPen.current < 650)
    )
      return;
    const hardwareEraser =
      e.pointerType === "pen" && (e.button === 5 || (e.buttons & 32) !== 0);
    if (e.button !== 0 && !hardwareEraser) return;
    e.preventDefault();
    e.stopPropagation();
    window.getSelection()?.removeAllRanges();
    pan.current = null;
    if (e.pointerType === "pen") lastPen.current = performance.now();
    const start = point(e.nativeEvent);
    gesture.current = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      tool: hardwareEraser ? "eraser" : tool,
      stroke: {
        id:
          typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
                n.toString(16).padStart(2, "0"),
              ).join(""),
        tool: tool === "highlighter" ? "highlighter" : "pen",
        color,
        width: Math.max(0.0002, Math.min(0.1, width / size.width)),
        points: [start],
      },
      erased: new Set(),
      previous: start,
    };
    capture(e);
    onActive(true);
    if (gesture.current.tool === "eraser") erase(start, start);
    else paint();
  };
  const move = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerId === gesture.current?.pointerId) {
      e.preventDefault();
      append(e.nativeEvent);
    } else if (pan.current?.id === e.pointerId && !gesture.current) {
      const previous = pan.current;
      svg.current
        ?.closest(".pdf-document")
        ?.scrollBy(previous.x - e.clientX, previous.y - e.clientY);
      pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }
  };
  const up = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (pan.current?.id === e.pointerId) {
      pan.current = null;
      return;
    }
    if (gesture.current?.pointerId !== e.pointerId) return;
    append(e.nativeEvent);
    const g = gesture.current;
    clear();
    if (g.tool === "eraser") {
      if (g.erased.size) onChange(strokes.filter((s) => !g.erased.has(s.id)));
      return;
    }
    if (
      strokes.length >= 5000 ||
      strokes.reduce((n, s) => n + s.points.length, 0) +
        g.stroke.points.length >
        200000
    ) {
      onError(
        "This page has reached its handwriting limit. Erase some strokes before adding more.",
      );
      return;
    }
    onChange([...strokes, g.stroke]);
  };
  return (
    <svg
      ref={svg}
      className={`pdf-ink-layer ${enabled ? "ink-enabled" : ""} ink-tool-${tool}`}
      viewBox={`0 0 ${size.width} ${size.height}`}
      aria-label="PDF handwriting layer"
      role="img"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={(e) => {
        if (
          e.pointerId === gesture.current?.pointerId ||
          e.pointerId === pan.current?.id
        )
          clear();
      }}
      onLostPointerCapture={(e) => {
        if (
          e.pointerId === gesture.current?.pointerId ||
          e.pointerId === pan.current?.id
        )
          clear();
      }}
    >
      {strokes.map((s) => (
        <SavedStroke key={s.id} stroke={s} size={size} />
      ))}
      <path ref={draft} className="ink-draft" pointerEvents="none" />
    </svg>
  );
}

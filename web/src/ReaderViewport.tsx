import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  PenLine,
  Highlighter,
  Eraser,
} from "lucide-react";

import type { InkTool } from "./ink";

// Fixed UI uses visual-viewport coordinates, compensating for browser pinch zoom.
// This also keeps descendants inside the element promoted by requestFullscreen.
export function ReaderViewport({
  root,
  children,
  onZoomed,
}: {
  root: HTMLDivElement | null;
  children: ReactNode;
  onZoomed: (zoomed: boolean) => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!root || !layer.current) return;
    let frame = 0;
    const update = () => {
      const viewport = window.visualViewport,
        scale = viewport?.scale || 1;
      const width = (viewport?.width || innerWidth) * scale,
        height = (viewport?.height || innerHeight) * scale;
      const node = layer.current!;
      node.style.width = width + "px";
      node.style.height = height + "px";
      node.style.transform = `translate(${viewport?.offsetLeft || 0}px,${viewport?.offsetTop || 0}px) scale(${1 / scale})`;
      node.style.setProperty("--reader-viewport-height", height + "px");
      node.style.setProperty("--reader-viewport-width", width + "px");
      onZoomed(scale > 1.01);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
    };
  }, [root, onZoomed]);
  return root
    ? createPortal(
        <div ref={layer} className="reader-viewport-ui">
          {children}
        </div>,
        root,
      )
    : null;
}
export function ReaderViewportNavigation({
  page,
  pages,
  progress,
  pdf,
  loading,
  busy,
  optionsOpen,
  onMove,
  onPage,
  onOptions,
  shown,
  onShow,
  writing,
  tools,
  onWrite,
  tool,
}: {
  page: number;
  pages: number;
  progress: number;
  pdf: boolean;
  loading: boolean;
  busy: boolean;
  optionsOpen: boolean;
  onMove: (dir: number) => void;
  onPage: () => void;
  onOptions: () => void;
  shown: boolean;
  onShow: () => void;
  writing: boolean;
  tools: ReactNode;
  onWrite: () => void;
  tool: InkTool;
}) {
  if (!shown)
    return (
      <button
        className="icon reader-focus-reveal"
        aria-label="Show reading controls"
        disabled={busy}
        title={writing ? `${tool} · Show controls` : "Show controls"}
        aria-description={writing ? `${tool} active` : undefined}
        onClick={onShow}
      >
        {writing ? (
          tool === "eraser" ? (
            <Eraser size={20} />
          ) : tool === "highlighter" ? (
            <Highlighter size={20} />
          ) : (
            <PenLine size={20} />
          )
        ) : (
          <MoreHorizontal size={20} />
        )}
      </button>
    );
  return (
    <nav
      className={`reader-floating-navigation ${writing ? "reader-writing-controls" : ""}`}
      aria-label="Reading controls"
    >
      {pdf && (
        <span className="sr-only" aria-live="polite">
          Page {page} of {pages}
        </span>
      )}
      <button
        className="icon"
        aria-label="Previous page"
        onClick={() => onMove(-1)}
        disabled={loading || busy || (pdf && page <= 1)}
      >
        <ChevronLeft size={20} />
      </button>
      {pdf ? (
        <button
          className="reader-page-position"
          aria-label={`Go to page, page ${page} of ${pages || 0}`}
          onClick={onPage}
          disabled={busy}
        >
          {page} / {pages || "…"}
        </button>
      ) : (
        <span className="reader-progress">{Math.round(progress * 100)}%</span>
      )}
      <button
        className="icon"
        aria-label="Next page"
        onClick={() => onMove(1)}
        disabled={loading || busy || (pdf && page >= pages)}
      >
        <ChevronRight size={20} />
      </button>
      {pdf && !writing && (
        <button
          className="icon"
          aria-label="Draw on PDF"
          title="Write"
          onClick={onWrite}
          disabled={loading || busy}
        >
          <PenLine size={20} />
        </button>
      )}
      {tools}
      <button
        className="icon"
        aria-label="Reader options"
        aria-expanded={optionsOpen}
        aria-controls="reader-options"
        data-reader-popover-trigger
        disabled={busy}
        onClick={onOptions}
      >
        <MoreHorizontal size={20} />
      </button>
    </nav>
  );
}

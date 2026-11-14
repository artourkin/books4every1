import { useRef, useState, useEffect } from "react";
import {
  PenLine,
  Highlighter,
  Eraser,
  Undo2,
  Redo2,
  SlidersHorizontal,
  X,
  Check,
  LoaderCircle,
  AlertCircle,
  Download,
  RotateCw,
  MoreHorizontal,
} from "lucide-react";
import type { InkTool } from "./ink";
import type { usePDFInk } from "./usePDFInk";
const colors = [
  { name: "Graphite", value: "#394137" },
  { name: "Forest", value: "#526f52" },
  { name: "Blue", value: "#466caa" },
  { name: "Rose", value: "#bc636a" },
  { name: "Amber", value: "#e5bc43" },
];
export function PDFInkToolbar({
  ink,
  enabled,
  tool,
  onTool,
  color,
  onColor,
  width,
  onWidth,
  drawWithTouch,
  onTouch,
  busy,
  optionsOpen,
  onOptions,
  onCloseOptions,
  initialBrush = "pen",
  compact = false,
}: {
  compact?: boolean;
  initialBrush?: "pen" | "highlighter";
  ink: ReturnType<typeof usePDFInk>;
  enabled: boolean;
  tool: InkTool;
  onTool: (t: InkTool) => void;
  color: string;
  onColor: (c: string) => void;
  width: number;
  onWidth: (n: number) => void;
  drawWithTouch: boolean;
  onTouch: (v: boolean) => void;
  busy: boolean;
  optionsOpen: boolean;
  onOptions: () => void;
  onCloseOptions: () => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    if (!optionsOpen) setAdvanced(false);
  }, [optionsOpen]);
  const lastBrush = useRef<"pen" | "highlighter">(initialBrush);
  if (tool !== "eraser") lastBrush.current = tool;
  const BrushIcon = lastBrush.current === "highlighter" ? Highlighter : PenLine;
  const optionsButton = (
    <button
      className={`icon ${optionsOpen ? "active" : ""}`}
      aria-label="Pen options"
      title="Pen options"
      aria-expanded={optionsOpen}
      aria-controls="pen-options"
      data-reader-popover-trigger
      disabled={busy}
      onClick={() => {
        if (compact && tool === "eraser") onTool(lastBrush.current);
        onOptions();
      }}
    >
      {compact ? (
        <>
          <BrushIcon size={20} />
          <i
            className="pen-current-color"
            style={{ background: color }}
            aria-hidden="true"
          />
        </>
      ) : (
        <SlidersHorizontal size={20} />
      )}
    </button>
  );
  return (
    <>
      {enabled && (
        <div
          className={`ink-toolbar ${compact ? "dock-ink-tools" : ""}`}
          role="toolbar"
          aria-label="PDF writing tools"
        >
          {compact && optionsButton}
          {!compact && (
            <button
              className={`icon ${tool !== "eraser" ? "active" : ""}`}
              aria-label="Use drawing tool"
              title={
                lastBrush.current === "highlighter" ? "Highlighter" : "Pen"
              }
              aria-pressed={tool !== "eraser"}
              disabled={busy || !ink.loaded || ink.conflict}
              onClick={() => onTool(lastBrush.current)}
            >
              <BrushIcon size={20} />
            </button>
          )}
          <button
            className={`icon dock-eraser ${tool === "eraser" ? "active" : ""}`}
            aria-label="Stroke eraser"
            title="Erase stroke"
            aria-pressed={tool === "eraser"}
            disabled={busy || !ink.loaded || ink.conflict}
            onClick={() =>
              onTool(tool === "eraser" ? lastBrush.current : "eraser")
            }
          >
            <Eraser size={20} />
          </button>
          <button
            className="icon dock-undo"
            aria-label="Undo ink"
            title="Undo (⌘/Ctrl Z)"
            disabled={!ink.canUndo || busy}
            onClick={ink.undo}
          >
            <Undo2 size={20} />
          </button>
          {!compact && optionsButton}
          {optionsOpen && (
            <section
              className="reader-popover pen-options"
              id="pen-options"
              role="dialog"
              aria-label="Pen options"
            >
              <div className="popover-heading">
                <strong>Pen options</strong>
                <button
                  className={`icon pen-advanced-toggle ${advanced ? "active" : ""}`}
                  aria-label="More pen settings"
                  aria-expanded={advanced}
                  aria-controls="pen-advanced"
                  title="More pen settings"
                  onClick={() => setAdvanced(!advanced)}
                >
                  <MoreHorizontal size={18} />
                </button>
                <button
                  className="icon"
                  aria-label="Close pen options"
                  onClick={onCloseOptions}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="pen-quick-tools">
                <button
                  className={`icon ${tool === "pen" ? "active" : ""}`}
                  aria-label="Pen"
                  title="Pen"
                  aria-pressed={tool === "pen"}
                  onClick={() => onTool("pen")}
                  disabled={busy}
                >
                  <PenLine size={19} />
                </button>
                <button
                  className={`icon ${tool === "highlighter" ? "active" : ""}`}
                  aria-label="Ink highlighter"
                  title="Highlighter"
                  aria-pressed={tool === "highlighter"}
                  onClick={() => onTool("highlighter")}
                  disabled={busy}
                >
                  <Highlighter size={19} />
                </button>
                <button
                  className={`icon ${tool === "eraser" ? "active" : ""}`}
                  aria-label="Use eraser"
                  title="Eraser"
                  aria-pressed={tool === "eraser"}
                  onClick={() => onTool("eraser")}
                  disabled={busy}
                >
                  <Eraser size={19} />
                </button>
                <label className="pen-quick-width">
                  <span className="sr-only">Thickness</span>
                  <select
                    aria-label="Ink thickness"
                    disabled={busy || tool === "eraser"}
                    value={width}
                    onChange={(e) => onWidth(Number(e.target.value))}
                  >
                    {(tool === "highlighter"
                      ? [6, 12, 20, 30]
                      : [1.5, 3, 5, 8]
                    ).map((n) => (
                      <option key={n} value={n}>
                        {n} pt
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="ink-colors" aria-label="Ink colors">
                {colors.map((c) => (
                  <button
                    key={c.value}
                    aria-label={`${c.name} ink`}
                    title={c.name}
                    aria-pressed={color === c.value}
                    disabled={busy}
                    onClick={() => onColor(c.value)}
                  >
                    <i style={{ background: c.value }}>
                      {color === c.value && <Check size={13} />}
                    </i>
                  </button>
                ))}
              </div>
              {advanced && (
                <div id="pen-advanced">
                  <label className="ink-touch">
                    <span>Draw with a finger</span>
                    <input
                      type="checkbox"
                      aria-label="Finger drawing"
                      checked={drawWithTouch}
                      disabled={busy}
                      onChange={(e) => onTouch(e.target.checked)}
                    />
                  </label>
                  <div className="pen-history">
                    <button
                      className="popover-action"
                      aria-label="Undo last stroke"
                      disabled={!ink.canUndo || busy}
                      onClick={ink.undo}
                    >
                      <Undo2 size={18} />
                      Undo
                    </button>
                    <button
                      className="popover-action"
                      aria-label="Redo ink"
                      disabled={!ink.canRedo || busy}
                      onClick={ink.redo}
                    >
                      <Redo2 size={18} />
                      Redo
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </>
  );
}

export function PDFInkStatus({
  ink,
  page,
  busy,
  onReviewPage,
}: {
  ink: ReturnType<typeof usePDFInk>;
  page: number;
  busy: boolean;
  onReviewPage: (page: number) => void;
}) {
  const failedPage = ink.getErrorPage();
  const backgroundError = failedPage !== undefined && failedPage !== page;
  const download = () => {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { format: "folio-ink-v1", page, strokes: ink.strokes },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `folio-ink-page-${page}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div
      className={`ink-save-state ${ink.error || backgroundError ? "ink-save-error" : !ink.loaded || ink.pending ? "ink-save-pending" : "sr-only"}`}
      role="status"
      aria-live="polite"
    >
      {ink.error ? (
        <>
          <AlertCircle size={14} />
          <span>{ink.error}</span>
          <button
            onClick={download}
            title="Download a recovery copy of this page's strokes"
          >
            <Download size={13} />
            Save a copy
          </button>
          {ink.conflict ? (
            <button
              onClick={() => {
                if (
                  window.confirm(
                    "Reload saved handwriting? Your unsaved changes on this page will be replaced. Download a copy first to keep them.",
                  )
                )
                  void ink.reload();
              }}
            >
              <RotateCw size={13} />
              Reload saved ink
            </button>
          ) : (
            <button onClick={() => void ink.retry()}>
              <RotateCw size={13} />
              Retry
            </button>
          )}
        </>
      ) : backgroundError ? (
        <>
          <AlertCircle size={14} />
          <span>Ink on page {failedPage} has not saved.</span>
          <button disabled={busy} onClick={() => onReviewPage(failedPage!)}>
            Review page {failedPage}
          </button>
        </>
      ) : !ink.loaded ? (
        <>
          <LoaderCircle size={12} className="spin" />
          Loading ink…
        </>
      ) : ink.pending ? (
        <>
          <LoaderCircle size={12} className="spin" />
          Saving ink…
        </>
      ) : (
        <>
          <Check size={12} />
          Ink saved
        </>
      )}
    </div>
  );
}

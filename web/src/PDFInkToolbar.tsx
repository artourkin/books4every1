import { useRef } from "react";
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
  page,
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
  onReviewPage,
  optionsOpen,
  onOptions,
  onCloseOptions,
  initialBrush = "pen",
}: {
  initialBrush?: "pen" | "highlighter";
  ink: ReturnType<typeof usePDFInk>;
  page: number;
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
  onReviewPage: (page: number) => void;
  optionsOpen: boolean;
  onOptions: () => void;
  onCloseOptions: () => void;
}) {
  const lastBrush = useRef<"pen" | "highlighter">(initialBrush);
  if (tool !== "eraser") lastBrush.current = tool;
  const BrushIcon = lastBrush.current === "highlighter" ? Highlighter : PenLine;
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
    <>
      {enabled && (
        <div
          className="ink-toolbar"
          role="toolbar"
          aria-label="PDF writing tools"
        >
          <button
            className={`icon ${tool !== "eraser" ? "active" : ""}`}
            aria-label="Use drawing tool"
            title={lastBrush.current === "highlighter" ? "Highlighter" : "Pen"}
            aria-pressed={tool !== "eraser"}
            disabled={busy || !ink.loaded || ink.conflict}
            onClick={() => onTool(lastBrush.current)}
          >
            <BrushIcon size={20} />
          </button>
          <button
            className={`icon ${tool === "eraser" ? "active" : ""}`}
            aria-label="Stroke eraser"
            title="Erase stroke"
            aria-pressed={tool === "eraser"}
            disabled={busy || !ink.loaded || ink.conflict}
            onClick={() => onTool("eraser")}
          >
            <Eraser size={20} />
          </button>
          <button
            className="icon"
            aria-label="Undo ink"
            title="Undo (⌘/Ctrl Z)"
            disabled={!ink.canUndo || busy}
            onClick={ink.undo}
          >
            <Undo2 size={20} />
          </button>
          <button
            className={`icon ${optionsOpen ? "active" : ""}`}
            aria-label="Pen options"
            title="Pen options"
            aria-expanded={optionsOpen}
            aria-controls="pen-options"
            data-reader-popover-trigger
            disabled={busy}
            onClick={onOptions}
          >
            <SlidersHorizontal size={20} />
          </button>
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
                  className="icon"
                  aria-label="Close pen options"
                  onClick={onCloseOptions}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="pen-brushes">
                {(
                  [
                    { id: "pen", label: "Pen", icon: PenLine },
                    {
                      id: "highlighter",
                      label: "Ink highlighter",
                      icon: Highlighter,
                    },
                  ] as const
                ).map((t) => (
                  <button
                    className={lastBrush.current === t.id ? "active" : ""}
                    key={t.id}
                    aria-label={t.label}
                    aria-pressed={tool === t.id}
                    onClick={() => onTool(t.id)}
                  >
                    <t.icon size={18} />
                    {t.id === "pen" ? "Pen" : "Highlighter"}
                  </button>
                ))}
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
              <label className="ink-width">
                Thickness
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
              <button
                className="popover-action"
                aria-label="Redo ink"
                disabled={!ink.canRedo || busy}
                onClick={ink.redo}
              >
                <Redo2 size={18} />
                Redo last change
              </button>
            </section>
          )}
        </div>
      )}
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
    </>
  );
}

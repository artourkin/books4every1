import {
  PenLine,
  Highlighter,
  Eraser,
  Undo2,
  Redo2,
  MousePointer2,
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
  onEnabled,
  tool,
  onTool,
  color,
  onColor,
  width,
  onWidth,
  drawWithTouch,
  onTouch,
  busy,
}: {
  ink: ReturnType<typeof usePDFInk>;
  page: number;
  enabled: boolean;
  onEnabled: (v: boolean) => void;
  tool: InkTool;
  onTool: (t: InkTool) => void;
  color: string;
  onColor: (c: string) => void;
  width: number;
  onWidth: (n: number) => void;
  drawWithTouch: boolean;
  onTouch: (v: boolean) => void;
  busy: boolean;
}) {
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
    <div className={`ink-toolbar ${enabled ? "is-writing" : ""}`}>
      {enabled ? (
        <div
          className="ink-controls"
          role="toolbar"
          aria-label="PDF writing tools"
        >
          <div className="ink-tool-group">
            {(
              [
                { id: "pen", label: "Pen", icon: PenLine },
                {
                  id: "highlighter",
                  label: "Ink highlighter",
                  icon: Highlighter,
                },
                { id: "eraser", label: "Stroke eraser", icon: Eraser },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                className={`icon ${tool === t.id ? "active" : ""}`}
                aria-label={t.label}
                title={t.label}
                aria-pressed={tool === t.id}
                disabled={busy || !ink.loaded || ink.conflict}
                onClick={() => onTool(t.id)}
              >
                <t.icon size={18} />
              </button>
            ))}
          </div>
          <div className="ink-colors" aria-label="Ink colors">
            {colors.map((c) => (
              <button
                key={c.value}
                style={{ background: c.value }}
                aria-label={`${c.name} ink`}
                title={`${c.name} ink`}
                aria-pressed={color === c.value}
                disabled={busy || tool === "eraser"}
                onClick={() => onColor(c.value)}
              >
                {color === c.value && <Check size={12} />}
              </button>
            ))}
          </div>
          <label className="ink-width">
            Width
            <select
              aria-label="Ink thickness"
              disabled={busy || tool === "eraser"}
              value={width}
              onChange={(e) => onWidth(Number(e.target.value))}
            >
              {(tool === "highlighter" ? [6, 12, 20, 30] : [1.5, 3, 5, 8]).map(
                (n) => (
                  <option key={n} value={n}>
                    {n} pt
                  </option>
                ),
              )}
            </select>
          </label>
          <div className="ink-tool-group">
            <button
              className="icon"
              aria-label="Undo ink"
              title="Undo (⌘/Ctrl Z)"
              disabled={!ink.canUndo || busy}
              onClick={ink.undo}
            >
              <Undo2 size={18} />
            </button>
            <button
              className="icon"
              aria-label="Redo ink"
              title="Redo (⌘/Ctrl Shift Z)"
              disabled={!ink.canRedo || busy}
              onClick={ink.redo}
            >
              <Redo2 size={18} />
            </button>
          </div>
          <label className="ink-touch">
            <input
              type="checkbox"
              checked={drawWithTouch}
              disabled={busy}
              onChange={(e) => onTouch(e.target.checked)}
            />
            Finger drawing
          </label>
          <button
            className="ink-done"
            disabled={busy}
            onClick={() => onEnabled(false)}
          >
            <MousePointer2 size={14} />
            Read / select
          </button>
        </div>
      ) : (
        <button className="start-writing" onClick={() => onEnabled(true)}>
          <PenLine size={15} />
          Write on this PDF<span>Pen, highlighter & eraser</span>
        </button>
      )}
      <div
        className={`ink-save-state ${ink.error ? "ink-save-error" : ""}`}
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
    </div>
  );
}

import { PDFInkLayer } from "./PDFInkLayer";
import { PDFInkToolbar } from "./PDFInkToolbar";
import { usePDFInk } from "./usePDFInk";
import type { InkTool, PageSize } from "./ink";
import { useDialogFocus } from "./useDialogFocus";
import { useCallback, useEffect, useRef, useState } from "react";
import ePub from "epubjs";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Bookmark,
  NotebookPen,
  List,
  X,
  Sun,
  Moon,
  Minus,
  Plus,
  Check,
  Download,
  LoaderCircle,
  Highlighter,
  PenLine,
  AlertCircle,
} from "lucide-react";
import {
  api,
  updateBook,
  exportNotes,
  type Book,
  type Annotation,
  type Anchor,
} from "./api";
import { NoteCard } from "./NoteCard";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
const palette: Record<string, string> = {
  yellow: "#edda8c",
  green: "#b8d3bc",
  pink: "#e6bbc5",
  blue: "#b5cde4",
};
type Selection = { quote: string; anchor: Anchor };
// epub.js has event payloads without exported TypeScript definitions.
type EpubRendition = ReturnType<ReturnType<typeof ePub>["renderTo"]>;
export function Reader({
  book,
  onClose,
  onError,
}: {
  book: Book;
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const [notes, setNotes] = useState<Annotation[]>([]),
    [panel, setPanel] = useState<"notes" | "contents" | null>(null),
    [selection, setSelection] = useState<Selection | null>(null),
    [draft, setDraft] = useState(""),
    [color, setColor] = useState("yellow"),
    [page, setPage] = useState(
      book.format === "PDF" ? Math.max(1, Number(book.location) || 1) : 1,
    ),
    [pages, setPages] = useState(0),
    [progress, setProgress] = useState(book.progress),
    [chapter, setChapter] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [fontSize, setFontSize] = useState(
      () => Number(localStorage.getItem("folio-font-size")) || 100,
    ),
    [theme, setTheme] = useState(
      () => localStorage.getItem("folio-theme") || "paper",
    ),
    [toc, setToc] = useState<{ label: string; href: string; depth: number }[]>(
      [],
    );
  const mount = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    textLayer = useRef<HTMLDivElement>(null),
    pdfPage = useRef<HTMLDivElement>(null),
    rendition = useRef<EpubRendition | null>(null),
    epub = useRef<ReturnType<typeof ePub> | null>(null),
    pdf = useRef<pdfjs.PDFDocumentProxy | null>(null),
    highlighted = useRef<string[]>([]),
    position = useRef({ location: book.location, progress: book.progress }),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    [pdfReady, setPdfReady] = useState(false),
    [pdfWidth, setPdfWidth] = useState(800);
  const [inkEnabled, setInkEnabled] = useState(false),
    [inkTool, setInkTool] = useState<InkTool>("pen"),
    [inkColor, setInkColor] = useState("#394137"),
    [penWidth, setPenWidth] = useState(3),
    [markerWidth, setMarkerWidth] = useState(12),
    [drawWithTouch, setDrawWithTouch] = useState(false),
    [inkBusy, setInkBusy] = useState(false),
    [pdfSize, setPdfSize] = useState<PageSize>({ width: 612, height: 792 });
  const ink = usePDFInk(book.id, page, book.format === "PDF");
  const inkWidth = inkTool === "highlighter" ? markerWidth : penWidth;
  const changeInkMode = (enabled: boolean) => {
    setInkEnabled(enabled);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };
  useEffect(() => {
    if (!inkEnabled) return;
    const key = (event: KeyboardEvent) => {
      if (
        inkBusy ||
        (event.target as HTMLElement).closest("input,textarea,select") ||
        !(event.metaKey || event.ctrlKey)
      )
        return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) ink.redo();
        else ink.undo();
      }
      if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        ink.redo();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [inkEnabled, inkBusy, ink.undo, ink.redo]);
  const moveRef = useRef<(dir: number) => void>(() => {});
  useDialogFocus(Boolean(selection), ".selection-card");
  const remember = useCallback(
    (location: string, p: number) => {
      position.current = { location, progress: Math.max(0, Math.min(1, p)) };
      setProgress(position.current.progress);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void updateBook(book.id, position.current).catch((e) =>
          setError(e.message),
        );
      }, 700);
    },
    [book.id],
  );
  const refresh = useCallback(async () => {
    setNotes(await api<Annotation[]>("/annotations?bookId=" + book.id));
  }, [book.id]);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [refresh]);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    let loadingTask: pdfjs.PDFDocumentLoadingTask | undefined;
    const load = async () => {
      try {
        if (book.format === "PDF") {
          loadingTask = pdfjs.getDocument({
            url: `/api/v1/books/${book.id}/file`,
            cMapUrl: "/pdfjs/cmaps/",
            cMapPacked: true,
            standardFontDataUrl: "/pdfjs/standard_fonts/",
            wasmUrl: "/pdfjs/wasm/",
            iccUrl: "/pdfjs/iccs/",
          });
          const doc = await loadingTask.promise;
          if (disposed) {
            loadingTask.destroy();
            return;
          }
          pdf.current = doc;
          setPages(doc.numPages);
          setPage((p) => Math.min(p, doc.numPages));
          setPdfReady(true);
        } else {
          const response = await fetch(`/api/v1/books/${book.id}/file`, {
            signal: controller.signal,
          });
          if (!response.ok) throw new Error("Could not open this EPUB");
          const data = await response.arrayBuffer();
          if (disposed) return;
          const doc = ePub(data);
          epub.current = doc;
          const r = doc.renderTo(mount.current!, {
            width: "100%",
            height: "100%",
            spread: "none",
            flow: "paginated",
            allowScriptedContent: false,
          });
          rendition.current = r;
          r.themes.register("paper", {
            body: { color: "#34332f", background: "#fbfaf6" },
            "::selection": { background: "#edda8c" },
          });
          r.themes.register("night", {
            body: { color: "#dedbd3", background: "#252622" },
            a: { color: "#cdb995" },
          });
          r.themes.select(theme);
          r.themes.fontSize(`${fontSize}%`);
          r.on("keydown", (event: KeyboardEvent) => {
            if (event.key === "ArrowRight") {
              event.preventDefault();
              moveRef.current(1);
            }
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              moveRef.current(-1);
            }
          });
          r.on("selected", (cfi: string, contents: { window: Window }) => {
            const quote = contents.window.getSelection()?.toString().trim();
            if (quote) {
              setSelection({ quote, anchor: { cfi } });
              setDraft("");
            }
          });
          r.on(
            "relocated",
            (loc: {
              start: {
                cfi: string;
                href: string;
                percentage: number;
                displayed: { page: number; total: number };
              };
            }) => {
              if (disposed) return;
              setLoading(false);
              const p = doc.locations.length()
                ? doc.locations.percentageFromCfi(loc.start.cfi)
                : book.progress;
              remember(loc.start.cfi, p || 0);
              setChapter(
                loc.start.href
                  .split("/")
                  .pop()
                  ?.replace(/\.x?html?$/, "")
                  .replace(/[-_]/g, " ") || "",
              );
              setPage(loc.start.displayed.page);
              setPages(loc.start.displayed.total);
            },
          );
          await r.display(book.location || undefined);
          if (disposed) return;
          setLoading(false);
          const nav = await doc.loaded.navigation;
          const flat: { label: string; href: string; depth: number }[] = [];
          const flatten = (items: typeof nav.toc, depth = 0) =>
            items.forEach((i) => {
              flat.push({ label: i.label.trim(), href: i.href, depth });
              if (i.subitems) flatten(i.subitems, depth + 1);
            });
          flatten(nav.toc);
          setToc(flat);
          await doc.locations.generate(150);
          if (!disposed && position.current.location)
            remember(
              position.current.location,
              doc.locations.percentageFromCfi(position.current.location) || 0,
            );
        }
      } catch (e) {
        if (!disposed) {
          setError((e as Error).message || "Unable to open book");
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      disposed = true;
      controller.abort();
      if (timer.current) clearTimeout(timer.current);
      if (position.current.location)
        void updateBook(book.id, position.current).catch(onError);
      rendition.current?.destroy();
      epub.current?.destroy();
      rendition.current = null;
      epub.current = null;
      loadingTask?.destroy();
      pdf.current = null;
    };
    // The document mounts once; settings and annotations are applied separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);
  useEffect(() => {
    localStorage.setItem("folio-theme", theme);
    localStorage.setItem("folio-font-size", String(fontSize));
    rendition.current?.themes.select(theme);
    rendition.current?.themes.fontSize(`${fontSize}%`);
  }, [theme, fontSize]);
  useEffect(() => {
    if (book.format !== "PDF") return;
    const node = mount.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) =>
      setPdfWidth(Math.min(850, entries[0].contentRect.width - 48)),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [book.format]);
  useEffect(() => {
    if (!pdfReady || !pdf.current || !canvas.current || !textLayer.current)
      return;
    let disposed = false;
    let renderTask: pdfjs.RenderTask | undefined;
    let layer: pdfjs.TextLayer | undefined;
    const render = async () => {
      setLoading(true);
      try {
        const p = await pdf.current!.getPage(page);
        if (disposed) return;
        const initial = p.getViewport({ scale: 1 });
        setPdfSize({ width: initial.width, height: initial.height });
        const scale =
          Math.max(0.3, pdfWidth / initial.width) * (fontSize / 100);
        const viewport = p.getViewport({ scale });
        const c = canvas.current!;
        const dpr = window.devicePixelRatio || 1;
        c.width = Math.floor(viewport.width * dpr);
        c.height = Math.floor(viewport.height * dpr);
        c.style.width = viewport.width + "px";
        c.style.height = viewport.height + "px";
        pdfPage.current!.style.width = viewport.width + "px";
        pdfPage.current!.style.height = viewport.height + "px";
        const context = c.getContext("2d")!;
        renderTask = p.render({
          canvas: c,
          canvasContext: context,
          viewport,
          transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
        });
        await renderTask.promise;
        if (disposed) return;
        const content = await p.getTextContent();
        if (disposed) return;
        textLayer.current!.replaceChildren();
        textLayer.current!.style.setProperty(
          "--total-scale-factor",
          String(scale),
        );
        textLayer.current!.style.setProperty("--scale-round-x", "1px");
        textLayer.current!.style.setProperty("--scale-round-y", "1px");
        layer = new pdfjs.TextLayer({
          textContentSource: content,
          container: textLayer.current!,
          viewport,
        });
        await layer.render();
        if (disposed) return;
        setLoading(false);
        remember(
          String(page),
          pdf.current!.numPages === 1
            ? 1
            : (page - 1) / (pdf.current!.numPages - 1),
        );
      } catch (e) {
        if (!disposed) {
          setError((e as Error).message);
          setLoading(false);
        }
      }
    };
    void render();
    return () => {
      disposed = true;
      renderTask?.cancel();
      layer?.cancel();
    };
  }, [page, pdfReady, pdfWidth, fontSize, remember]);
  useEffect(() => {
    const r = rendition.current;
    if (!r) return;
    highlighted.current.forEach((cfi) => {
      try {
        r.annotations.remove(cfi, "highlight");
      } catch {}
    });
    highlighted.current = [];
    notes
      .filter((n) => n.kind === "highlight" && n.anchor.cfi)
      .forEach((n) => {
        try {
          r.annotations.highlight(
            n.anchor.cfi!,
            {},
            () => {
              setPanel("notes");
            },
            "folio-highlight",
            {
              fill: palette[n.color] || palette.yellow,
              "fill-opacity": "0.4",
              "mix-blend-mode": "multiply",
            },
          );
          highlighted.current.push(n.anchor.cfi!);
        } catch {}
      });
  }, [notes, loading]);
  const move = useCallback(
    (dir: number) => {
      setSelection(null);
      if (book.format === "PDF")
        setPage((p) => Math.max(1, Math.min(pages, p + dir)));
      else {
        const result =
          dir > 0 ? rendition.current?.next() : rendition.current?.prev();
        result?.catch((e) => setError((e as Error).message));
      }
    },
    [book.format, pages],
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select,button"))
        return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        move(1);
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        move(-1);
      }
      if (e.key === "Escape") setSelection(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [move]);
  moveRef.current = move;
  const pdfSelected = () => {
    if (book.format !== "PDF" || !pdfPage.current || inkEnabled) return;
    const s = window.getSelection();
    if (
      !s ||
      s.isCollapsed ||
      !s.toString().trim() ||
      !textLayer.current?.contains(s.anchorNode)
    )
      return;
    const bounds = pdfPage.current.getBoundingClientRect();
    const rects = Array.from(s.getRangeAt(0).getClientRects())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({
        x: (r.left - bounds.left) / bounds.width,
        y: (r.top - bounds.top) / bounds.height,
        w: r.width / bounds.width,
        h: r.height / bounds.height,
      }));
    setSelection({ quote: s.toString().trim(), anchor: { page, rects } });
    setDraft("");
  };
  const add = async (kind: "highlight" | "bookmark" | "note") => {
    setSaving(true);
    try {
      const anchor =
        kind === "bookmark"
          ? book.format === "PDF"
            ? { page }
            : { cfi: position.current.location }
          : selection?.anchor;
      if (!anchor) throw new Error("Select a passage first");
      await api(`/books/${book.id}/annotations`, {
        method: "POST",
        body: JSON.stringify({
          kind,
          quote:
            kind === "bookmark"
              ? book.format === "PDF"
                ? `Page ${page}`
                : chapter || "Bookmarked passage"
              : selection?.quote || "",
          note: draft,
          color,
          anchor,
        }),
      });
      await refresh();
      setSelection(null);
      setDraft("");
      window.getSelection()?.removeAllRanges();
      const contents = rendition.current?.getContents();
      if (Array.isArray(contents))
        contents.forEach((c) => c.window.getSelection()?.removeAllRanges());
      setPanel("notes");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const jump = (anchor: Anchor) => {
    if (anchor.page) setPage(anchor.page);
    if (anchor.cfi)
      rendition.current
        ?.display(anchor.cfi)
        .catch((e) => setError((e as Error).message));
  };
  const close = async () => {
    if (!(await ink.flush())) {
      if (ink.errorPage) setPage(ink.errorPage);
      setError(
        "Your handwriting has not saved. Retry or save a recovery copy before leaving.",
      );
      setInkEnabled(true);
      return;
    }
    try {
      if (position.current.location)
        await updateBook(book.id, position.current);
    } catch (e) {
      onError(e);
    }
    onClose();
  };
  return (
    <div className={`reader theme-${theme}`}>
      <header className="reader-header">
        <button className="back-library" onClick={() => void close()}>
          <ArrowLeft size={17} />
          <span>Library</span>
        </button>
        <div className="reader-book-name">
          <strong>{book.title}</strong>
          <span>
            {book.author}
            {book.sample ? " · Sample excerpt" : ""}
          </span>
        </div>
        <div className="reader-tools">
          {book.format === "PDF" && (
            <button
              className={`icon ${inkEnabled ? "active" : ""}`}
              aria-label="Draw on PDF"
              aria-pressed={inkEnabled}
              onClick={() => changeInkMode(!inkEnabled)}
              disabled={loading || inkBusy}
            >
              <PenLine size={19} />
            </button>
          )}
          <button
            className={`icon ${panel === "contents" ? "active" : ""}`}
            aria-label="Table of contents"
            onClick={() => setPanel(panel === "contents" ? null : "contents")}
          >
            <List size={20} />
          </button>
          <button
            className="icon"
            aria-label="Bookmark this page"
            onClick={() => void add("bookmark")}
            disabled={loading || saving}
          >
            <Bookmark size={19} />
          </button>
          <button
            className={`icon ${panel === "notes" ? "active" : ""}`}
            aria-label="Notes and highlights"
            onClick={() => setPanel(panel === "notes" ? null : "notes")}
          >
            <NotebookPen size={20} />
            <span className="tool-count">{notes.length || ""}</span>
          </button>
          <span className="tool-divider" />
          <button
            className="icon"
            aria-label="Decrease text size"
            onClick={() => setFontSize((s) => Math.max(70, s - 10))}
            disabled={fontSize <= 70}
          >
            <Minus size={16} />
          </button>
          <span className="font-value">Aa</span>
          <button
            className="icon"
            aria-label="Increase text size"
            onClick={() => setFontSize((s) => Math.min(180, s + 10))}
            disabled={fontSize >= 180}
          >
            <Plus size={16} />
          </button>
          <button
            className="icon"
            aria-label={
              theme === "night" ? "Use paper theme" : "Use dark theme"
            }
            onClick={() => setTheme(theme === "night" ? "paper" : "night")}
          >
            {theme === "night" ? <Sun size={19} /> : <Moon size={19} />}
          </button>
        </div>
      </header>
      {book.format === "PDF" && (
        <PDFInkToolbar
          ink={ink}
          page={page}
          enabled={inkEnabled}
          onEnabled={changeInkMode}
          tool={inkTool}
          onTool={setInkTool}
          color={inkColor}
          onColor={setInkColor}
          width={inkWidth}
          onWidth={inkTool === "highlighter" ? setMarkerWidth : setPenWidth}
          drawWithTouch={drawWithTouch}
          onTouch={setDrawWithTouch}
          busy={inkBusy}
        />
      )}
      <div className="reader-layout">
        <div className="reading-area">
          <div className="reader-chapter-label">
            {book.format === "PDF"
              ? `PAGE ${page} OF ${pages || "…"}`
              : chapter || "SETTLE INTO A STORY"}
          </div>
          <div
            className={`reader-document ${book.format === "PDF" ? "pdf-document" : "epub-document"}`}
            ref={mount}
          >
            {book.format === "PDF" && (
              <div
                className="pdf-page"
                ref={pdfPage}
                onMouseUp={pdfSelected}
                onTouchEnd={() => setTimeout(pdfSelected, 100)}
              >
                <canvas ref={canvas} />
                <div ref={textLayer} className="textLayer" />
                <PDFInkLayer
                  key={`${book.id}:${page}`}
                  strokes={ink.strokes}
                  size={pdfSize}
                  enabled={
                    inkEnabled &&
                    !loading &&
                    ink.loaded &&
                    !ink.loading &&
                    !ink.conflict
                  }
                  tool={inkTool}
                  color={inkColor}
                  width={inkWidth}
                  drawWithTouch={drawWithTouch}
                  onChange={ink.change}
                  onActive={setInkBusy}
                  onError={setError}
                />
                {notes
                  .filter(
                    (n) => n.kind === "highlight" && n.anchor.page === page,
                  )
                  .flatMap((n) =>
                    (n.anchor.rects || []).map((r, i) => (
                      <div
                        key={n.id + i}
                        className="pdf-highlight"
                        style={{
                          left: r.x * 100 + "%",
                          top: r.y * 100 + "%",
                          width: r.w * 100 + "%",
                          height: r.h * 100 + "%",
                          background: palette[n.color],
                        }}
                      />
                    )),
                  )}
              </div>
            )}
          </div>
          {loading && (
            <div className="reader-loading">
              <LoaderCircle size={26} className="spin" />
              <span>Opening a new world…</span>
            </div>
          )}
          {error && (
            <div role="alert" className="reader-error">
              <AlertCircle size={18} />
              <span>{error}</span>
              {ink.pending && (
                <button
                  className="text-button"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Leave without saving handwriting? Download a recovery copy first to keep your unsaved strokes.",
                      )
                    )
                      onClose();
                  }}
                >
                  Leave without saving
                </button>
              )}
              <button
                className="icon"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                <X size={16} />
              </button>
            </div>
          )}
          <footer className="reader-footer">
            <button
              className="secondary"
              aria-label="Previous page"
              onClick={() => move(-1)}
              disabled={loading || (book.format === "PDF" && page <= 1)}
            >
              <ChevronLeft size={19} />
              <span>Previous</span>
            </button>
            <div className="reader-progress">
              <span>{Math.round(progress * 100)}% through your book</span>
              <div className="progress-track">
                <i style={{ width: `${progress * 100}%` }} />
              </div>
            </div>
            <button
              className="secondary"
              aria-label="Next page"
              onClick={() => move(1)}
              disabled={loading || (book.format === "PDF" && page >= pages)}
            >
              <span>Next</span>
              <ChevronRight size={19} />
            </button>
          </footer>
          <div className="reader-hint">
            {inkEnabled
              ? "Write with a pen or mouse. Drag with a finger to scroll; enable finger drawing to sketch by touch."
              : "Select a passage to highlight it or leave a thought."}
          </div>
        </div>
        {panel && (
          <aside className="reader-panel">
            <div className="panel-heading">
              <h2>{panel === "notes" ? "In the margins" : "Contents"}</h2>
              <button
                className="icon"
                aria-label="Close reader panel"
                onClick={() => setPanel(null)}
              >
                <X size={18} />
              </button>
            </div>
            {panel === "contents" ? (
              <div className="toc">
                <div className="appearance-controls">
                  <span>Text size / zoom</span>
                  <button
                    className="secondary"
                    aria-label="Smaller reading text"
                    onClick={() => setFontSize((s) => Math.max(70, s - 10))}
                    disabled={fontSize <= 70}
                  >
                    <Minus size={15} />
                  </button>
                  <strong>{fontSize}%</strong>
                  <button
                    className="secondary"
                    aria-label="Larger reading text"
                    onClick={() => setFontSize((s) => Math.min(180, s + 10))}
                    disabled={fontSize >= 180}
                  >
                    <Plus size={15} />
                  </button>
                </div>
                {book.format === "PDF" ? (
                  <>
                    <label>
                      Go to page
                      <input
                        aria-label="Page number"
                        type="number"
                        min={1}
                        max={pages}
                        value={page}
                        onChange={(e) => {
                          const p = Number(e.target.value);
                          if (p >= 1 && p <= pages) setPage(p);
                        }}
                      />
                    </label>
                    <p>{pages} pages in this document.</p>
                  </>
                ) : (
                  toc.map((t, i) => (
                    <button
                      key={i}
                      style={{ paddingLeft: 16 + t.depth * 16 }}
                      onClick={() => {
                        rendition.current
                          ?.display(t.href)
                          .catch((e) => setError((e as Error).message));
                        setPanel(null);
                      }}
                    >
                      {t.label}
                      <ArrowRight size={14} />
                    </button>
                  ))
                )}
              </div>
            ) : (
              <>
                <div className="panel-subheading">
                  <span>{notes.length} saved thoughts</span>
                  <button
                    className="icon"
                    aria-label="Export book annotations"
                    onClick={() => exportNotes(notes, [book])}
                    disabled={!notes.length}
                  >
                    <Download size={16} />
                  </button>
                </div>
                {notes.length ? (
                  <div className="panel-notes">
                    {notes.map((n) => (
                      <NoteCard
                        key={n.id}
                        note={n}
                        onRead={() => jump(n.anchor)}
                        onDelete={async () => {
                          try {
                            await api(`/annotations/${n.id}`, {
                              method: "DELETE",
                            });
                            await refresh();
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                        onEdit={async (note) => {
                          try {
                            await api(`/annotations/${n.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({ note }),
                            });
                            await refresh();
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="panel-empty">
                    <NotebookPen size={30} />
                    <h3>A space for your thoughts.</h3>
                    <p>
                      Select a sentence that speaks to you, then save a
                      highlight or note.
                    </p>
                  </div>
                )}
              </>
            )}
          </aside>
        )}
      </div>
      {selection && (
        <div className="selection-overlay">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Annotate selected text"
            className="selection-card"
          >
            <div className="panel-heading">
              <h2>A thought in the margins.</h2>
              <button
                className="icon"
                aria-label="Cancel annotation"
                onClick={() => setSelection(null)}
              >
                <X size={19} />
              </button>
            </div>
            <blockquote>{selection.quote}</blockquote>
            <div className="annotation-colors">
              {Object.entries(palette).map(([name, hex]) => (
                <button
                  key={name}
                  style={{ background: hex }}
                  className={color === name ? "chosen" : ""}
                  aria-label={`${name} highlight`}
                  onClick={() => setColor(name)}
                >
                  {color === name && <Check size={15} />}
                </button>
              ))}
              <span>Make it memorable.</span>
            </div>
            <textarea
              aria-label="Annotation note"
              placeholder="What does this bring to mind? (optional)"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={50000}
            />
            <button
              className="primary full"
              disabled={saving}
              onClick={() => void add("highlight")}
            >
              <Highlighter size={16} />
              {saving
                ? "Saving…"
                : draft
                  ? "Save highlight & note"
                  : "Save highlight"}
            </button>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

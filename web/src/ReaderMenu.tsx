import {
  List,
  NotebookPen,
  Bookmark,
  Sun,
  Moon,
  Minus,
  Plus,
  X,
  Maximize,
  Minimize,
  Check,
  ArrowLeft,
  ChevronDown,
} from "lucide-react";
export function ReaderMenu({
  format,
  fontSize,
  onFontSize,
  theme,
  onTheme,
  onPanel,
  onBookmark,
  bookmarkDisabled,
  onClose,
  focused,
  nativeFullscreen,
  onFocus,
  floating,
  inkEnabled,
  onInkMode,
  onLibrary,
  onHideControls,
}: {
  format: "PDF" | "EPUB";
  fontSize: number;
  onFontSize: (n: number) => void;
  theme: string;
  onTheme: () => void;
  onPanel: (p: "notes" | "contents") => void;
  onBookmark: () => void;
  bookmarkDisabled: boolean;
  onClose: () => void;
  focused: boolean;
  nativeFullscreen: boolean;
  onFocus: () => void;
  floating: boolean;
  inkEnabled: boolean;
  onInkMode: () => void;
  onLibrary: () => void;
  onHideControls: () => void;
}) {
  return (
    <section
      className="reader-popover reader-menu"
      role="dialog"
      aria-label="Reader options"
      id="reader-options"
    >
      <div className="popover-heading">
        <strong>Reader options</strong>
        {floating && format === "PDF" && inkEnabled && (
          <button
            className="icon"
            aria-label="Finish writing"
            title="Done writing"
            onClick={onInkMode}
          >
            <Check size={18} />
          </button>
        )}
        <button
          className="icon"
          aria-label="Close reader options"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      {floating && (
        <button
          className="popover-action"
          aria-label="Library"
          onClick={onLibrary}
        >
          <ArrowLeft size={18} />
          Back to library
        </button>
      )}
      <div className="reader-menu-grid" aria-label="Navigation and notes">
        <button
          aria-label={
            format === "PDF" ? "Pages & navigation" : "Table of contents"
          }
          onClick={() => onPanel("contents")}
        >
          <List size={19} />
          <span>{format === "PDF" ? "Pages" : "Contents"}</span>
        </button>
        <button
          aria-label="Notes and highlights"
          onClick={() => onPanel("notes")}
        >
          <NotebookPen size={19} />
          <span>Notes</span>
        </button>
        <button
          aria-label="Bookmark this page"
          disabled={bookmarkDisabled}
          onClick={() => {
            onBookmark();
            onClose();
          }}
        >
          <Bookmark size={19} />
          <span>Bookmark</span>
        </button>
      </div>
      <div className="reader-menu-grid" aria-label="Reading appearance">
        <button
          aria-label={focused ? "Exit focus mode" : "Enter fullscreen"}
          onClick={onFocus}
        >
          {focused ? <Minimize size={19} /> : <Maximize size={19} />}
          <span>
            {focused
              ? nativeFullscreen
                ? "Exit fullscreen"
                : "Exit focus"
              : "Fullscreen"}
          </span>
        </button>
        {floating && (
          <button aria-label="Hide controls" onClick={onHideControls}>
            <ChevronDown size={19} />
            <span>Hide</span>
          </button>
        )}
        <button
          aria-label={theme === "night" ? "Use paper theme" : "Use dark theme"}
          onClick={onTheme}
        >
          {theme === "night" ? <Sun size={19} /> : <Moon size={19} />}
          <span>{theme === "night" ? "Paper" : "Dark"}</span>
        </button>
      </div>
      <div className="reader-size-control">
        <span>{format === "PDF" ? "Page zoom" : "Text size"}</span>
        <button
          className="icon"
          aria-label="Decrease text size"
          disabled={fontSize <= 70}
          onClick={() => onFontSize(Math.max(70, fontSize - 10))}
        >
          <Minus size={17} />
        </button>
        <output>{fontSize}%</output>
        <button
          className="icon"
          aria-label="Increase text size"
          disabled={fontSize >= 180}
          onClick={() => onFontSize(Math.min(180, fontSize + 10))}
        >
          <Plus size={17} />
        </button>
      </div>
    </section>
  );
}

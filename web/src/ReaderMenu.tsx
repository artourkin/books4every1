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
  PenLine,
  Check,
  ArrowLeft,
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
        <button
          className="icon"
          aria-label="Close reader options"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <button
        className="popover-action"
        aria-label={focused ? "Exit focus mode" : "Enter fullscreen"}
        onClick={onFocus}
      >
        {focused ? <Minimize size={18} /> : <Maximize size={18} />}{" "}
        {focused
          ? nativeFullscreen
            ? "Exit fullscreen"
            : "Exit focus mode"
          : "Focus / fullscreen"}
      </button>
      {floating && format === "PDF" && (
        <button
          className="popover-action"
          aria-label={inkEnabled ? "Finish writing" : "Draw on PDF"}
          onClick={onInkMode}
        >
          {inkEnabled ? <Check size={18} /> : <PenLine size={18} />}{" "}
          {inkEnabled ? "Done writing" : "Write on this PDF"}
        </button>
      )}
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
      <button className="popover-action" onClick={() => onPanel("contents")}>
        <List size={18} />{" "}
        {format === "PDF" ? "Pages & navigation" : "Table of contents"}
      </button>
      <button className="popover-action" onClick={() => onPanel("notes")}>
        <NotebookPen size={18} />
        Notes and highlights
      </button>
      <button
        className="popover-action"
        disabled={bookmarkDisabled}
        onClick={() => {
          onBookmark();
          onClose();
        }}
      >
        <Bookmark size={18} />
        Bookmark this page
      </button>
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
      <button
        className="popover-action"
        aria-label={theme === "night" ? "Use paper theme" : "Use dark theme"}
        onClick={onTheme}
      >
        {theme === "night" ? <Sun size={18} /> : <Moon size={18} />}{" "}
        {theme === "night" ? "Paper appearance" : "Dark appearance"}
      </button>
    </section>
  );
}

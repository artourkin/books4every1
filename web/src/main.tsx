import {
  PreferencesProvider,
  PreferencesError,
  usePreference,
  usePreferences,
} from "./preferences";
import { AccountSettings } from "./AccountSettings";
import { useDialogFocus } from "./useDialogFocus";
import { NoteCard } from "./NoteCard";
import React, { useEffect, useRef, useState, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpen,
  Library,
  Heart,
  NotebookPen,
  Plus,
  Search,
  ArrowRight,
  Grid2X2,
  List,
  Upload,
  X,
  MoreHorizontal,
  ChevronDown,
  Folder,
  HardDrive,
  Settings,
  LogOut,
  Download,
  Trash2,
  Feather,
  LoaderCircle,
  Menu,
  Lock,
  CheckCircle2,
} from "lucide-react";
import {
  api,
  updateBook,
  exportNotes,
  type Book,
  type Annotation,
  type User,
  type Session,
} from "./api";
const Reader = lazy(() =>
  import("./reader").then((m) => ({ default: m.Reader })),
);
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/libre-caslon-display/latin-400.css";
import "./style.css";

function App() {
  const preferences = usePreferences();
  const [user, setUser] = useState<User | null>(null),
    [accountsEnabled, setAccountsEnabled] = useState(false),
    [username, setUsername] = useState("");
  const [sort, setSort] = usePreference("librarySort"),
    [layout, setLayout] = usePreference("libraryLayout");
  const activateSession = (session: Session) => {
    setAuthenticated(session.authenticated);
    setPasswordRequired(session.passwordRequired);
    setAccountsEnabled(session.accountsEnabled);
    setUser(session.user);
    preferences.activate(
      session.authenticated ? session.profileId! : null,
      session.preferences,
    );
  };

  const [ready, setReady] = useState(false),
    [authenticated, setAuthenticated] = useState(false),
    [passwordRequired, setPasswordRequired] = useState(false),
    [password, setPassword] = useState("");
  const [books, setBooks] = useState<Book[]>([]),
    [collections, setCollections] = useState<string[]>([]),
    [notes, setNotes] = useState<Annotation[]>([]),
    [view, setView] = useState("library"),
    [query, setQuery] = useState(""),
    [format, setFormat] = useState("all");
  const [active, setActive] = useState<Book | null>(null),
    [detail, setDetail] = useState<Book | null>(null),
    [modal, setModal] = useState<"upload" | "collection" | "settings" | null>(
      null,
    ),
    [mobile, setMobile] = useState(false),
    [collectionName, setCollectionName] = useState("");
  const [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(""),
    [dragging, setDragging] = useState(false),
    [loading, setLoading] = useState(true);
  const input = useRef<HTMLInputElement>(null),
    search = useRef<HTMLInputElement>(null);
  const refresh = async () => {
    try {
      const [b, c, n] = await Promise.all([
        api<Book[]>("/books"),
        api<string[]>("/collections"),
        api<Annotation[]>("/annotations"),
      ]);
      setBooks(b);
      setCollections(c);
      setNotes(n);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    api<Session>("/session")
      .then((s) => {
        activateSession(s);
        setReady(true);
      })
      .catch((e) => {
        setError(e.message);
        setReady(true);
      });
  }, []);
  useEffect(() => {
    if (authenticated) void refresh();
  }, [authenticated]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        search.current?.focus();
      }
      if (e.key === "Escape") {
        setModal(null);
        setDetail(null);
        setMobile(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const handleError = (e: unknown) => setError((e as Error).message);
  const patch = async (book: Book, p: Partial<Book>) => {
    try {
      const b = await updateBook(book.id, p);
      setBooks((all) => all.map((x) => (x.id === b.id ? b : x)));
      if (detail?.id === b.id) setDetail(b);
    } catch (e) {
      handleError(e);
    }
  };
  const upload = async (files: FileList | File[]) => {
    setBusy(true);
    setError("");
    let count = 0;
    try {
      for (const file of Array.from(files)) {
        setUploading(file.name);
        const data = new FormData();
        data.append("file", file);
        await api("/books", { method: "POST", body: data });
        count++;
      }
      setModal(null);
      setView("library");
      setToast(
        `${count} ${count === 1 ? "book" : "books"} added to your library`,
      );
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
      setUploading("");
      await refresh();
      if (input.current) input.current.value = "";
    }
  };
  const samples = async () => {
    setBusy(true);
    try {
      await api("/samples", { method: "POST" });
      await refresh();
      setToast("Six little classics, ready to explore");
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };
  const navigate = (v: string) => {
    setView(v);
    setQuery("");
    setMobile(false);
    setFormat("all");
  };
  const reading = books
    .filter((b) => b.status === "reading")
    .sort((a, b) => (b.lastRead || "").localeCompare(a.lastRead || ""));
  let filtered = books.filter(
    (b) =>
      (view === "library" ||
        (view === "reading" && b.status === "reading") ||
        (view === "favorites" && b.favorite) ||
        (view === "finished" && b.status === "finished") ||
        (view.startsWith("collection:") && b.collection === view.slice(11))) &&
      (format === "all" || b.format === format) &&
      `${b.title} ${b.author}`.toLowerCase().includes(query.toLowerCase()),
  );
  filtered.sort((a, b) =>
    sort === "title"
      ? a.title.localeCompare(b.title)
      : sort === "author"
        ? a.author.localeCompare(b.author)
        : sort === "progress"
          ? b.progress - a.progress
          : b.addedAt.localeCompare(a.addedAt),
  );
  const title =
    view === "library"
      ? "Your library"
      : view === "reading"
        ? "Currently reading"
        : view === "favorites"
          ? "Your favorites"
          : view === "finished"
            ? "The finished shelf"
            : view === "notes"
              ? "Your notebook"
              : view.slice(11);
  const filteredNotes = notes.filter((n) =>
    `${n.quote} ${n.note} ${books.find((b) => b.id === n.bookId)?.title}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  useDialogFocus(Boolean(modal || detail), ".modal");
  if (!ready)
    return (
      <div className="boot">
        <BookOpen size={36} />
        <p>Opening your library…</p>
      </div>
    );
  if (!authenticated)
    return (
      <div className="login-page">
        <div className="login-art">
          <span className="wordmark">
            <BookOpen /> folio<span className="brand-dot">.</span>
          </span>
          <h1>
            A little room
            <br />
            for a lot of stories.
          </h1>
          <p>Your books. Your thoughts. Your own space.</p>
          <div className="login-books">
            <div />
            <div />
            <div />
          </div>
        </div>
        <form
          className="login-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const session = await api<Session>("/session", {
                method: "POST",
                body: JSON.stringify({ username, password }),
              });
              activateSession(session);
              setUsername("");
              setPassword("");
              setError("");
            } catch (e) {
              handleError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Lock size={26} />
          <h2>Welcome home.</h2>
          <p>
            {accountsEnabled
              ? "Sign in to your account."
              : "Enter your library password to settle in."}
          </p>
          {accountsEnabled && (
            <label>
              Username
              <input
                autoFocus
                autoComplete="username"
                required
                maxLength={32}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
          )}
          <label>
            {accountsEnabled ? "Password" : "Library password"}
            <input
              autoFocus={!accountsEnabled}
              autoComplete="current-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Opening…" : "Open my library"}
            <ArrowRight size={16} />
          </button>
        </form>
      </div>
    );
  if (active)
    return (
      <Suspense
        fallback={
          <div className="boot">
            <BookOpen size={30} />
            <p>Opening your book…</p>
          </div>
        }
      >
        <Reader
          book={active}
          onClose={() => {
            setActive(null);
            void refresh();
          }}
          onError={handleError}
        />
      </Suspense>
    );
  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
    >
      <PreferencesError />
      {mobile && (
        <div className="sidebar-scrim" onClick={() => setMobile(false)} />
      )}
      <aside className={`sidebar ${mobile ? "mobile-open" : ""}`}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("library");
          }}
          className="wordmark"
        >
          <BookOpen size={29} strokeWidth={1.7} /> folio
          <span className="brand-dot">.</span>
        </a>
        <p className="sidebar-tagline">A home for your books.</p>
        <div className="nav-label">MY LIBRARY</div>
        <nav>
          <button
            className={view === "library" ? "selected" : ""}
            onClick={() => navigate("library")}
          >
            <Library size={19} />
            <span>All books</span>
            <small>{books.length}</small>
          </button>
          <button
            className={view === "reading" ? "selected" : ""}
            onClick={() => navigate("reading")}
          >
            <BookOpen size={19} />
            <span>Currently reading</span>
            <small>{reading.length}</small>
          </button>
          <button
            className={view === "favorites" ? "selected" : ""}
            onClick={() => navigate("favorites")}
          >
            <Heart size={19} />
            <span>Favorites</span>
          </button>
          <button
            className={view === "finished" ? "selected" : ""}
            onClick={() => navigate("finished")}
          >
            <CheckCircle2 size={19} />
            <span>Finished</span>
          </button>
          <button
            className={view === "notes" ? "selected" : ""}
            onClick={() => navigate("notes")}
          >
            <NotebookPen size={19} />
            <span>Notes & highlights</span>
            <small>{notes.length || ""}</small>
          </button>
        </nav>
        <div className="nav-label collection-label">
          COLLECTIONS
          <button
            aria-label="New collection"
            onClick={() => setModal("collection")}
          >
            <Plus size={16} />
          </button>
        </div>
        <nav className="collections">
          {collections.map((c) => (
            <button
              key={c}
              className={view === "collection:" + c ? "selected" : ""}
              onClick={() => navigate("collection:" + c)}
            >
              <Folder size={18} />
              <span>{c}</span>
              <small>{books.filter((b) => b.collection === c).length}</small>
            </button>
          ))}
          <button
            className="muted new-collection"
            onClick={() => setModal("collection")}
          >
            <Plus size={17} />
            <span>New collection</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="your-space">
            <span className="little-icon">
              <HardDrive size={17} />
            </span>
            <div>
              <strong>Your books, your space</strong>
              <p>Self-hosted. Always yours.</p>
            </div>
            <span className="online-dot" />
          </div>
          <button
            className="settings-link"
            onClick={() => setModal("settings")}
          >
            <Settings size={17} />
            <span>Library settings</span>
          </button>
          <div className="sidebar-foot">
            Made for the love of reading <Heart size={11} />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMobile(true)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            My space <span>/</span>{" "}
            <strong>{view === "library" ? "Library" : title}</strong>
          </div>
          <div className="top-actions">
            <div className="search">
              <Search size={17} />
              <input
                ref={search}
                aria-label="Search library"
                placeholder={
                  view === "notes"
                    ? "Search your notes…"
                    : "Search your library…"
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd>⌘ K</kbd>
            </div>
            <button
              className="profile"
              onClick={() => setModal("settings")}
              aria-label="Library settings"
            >
              Y
            </button>
          </div>
        </header>
        <main>
          <section className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="tiny-line" />
                {view === "notes"
                  ? "THE WORDS THAT STAY WITH YOU"
                  : "A LITTLE SPACE TO GET LOST"}
              </div>
              <h1>
                {title}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {view === "library"
                  ? "Good stories deserve a place of their own."
                  : view === "notes"
                    ? "Ideas in the margins. Thoughts worth coming back to."
                    : view === "favorites"
                      ? "The books you keep close."
                      : view === "reading"
                        ? "Pick up where the world fell away."
                        : view === "finished"
                          ? "Every ending is a new beginning."
                          : "A shelf for the stories that belong together."}
              </p>
            </div>
            {view === "notes" ? (
              <button
                className="secondary"
                disabled={!notes.length}
                onClick={() => exportNotes(notes, books)}
              >
                <Download size={16} />
                Export notebook
              </button>
            ) : (
              <button className="primary" onClick={() => setModal("upload")}>
                <Plus size={18} /> Add books
              </button>
            )}
          </section>
          {error && (
            <div role="alert" className="error-banner">
              {error}
              <button
                className="icon"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {view === "library" && !query && (
            <section className="reading-section">
              <div className="section-heading">
                <h2>
                  Continue reading{" "}
                  <span className="section-count">{reading.length || ""}</span>
                </h2>
                {reading.length > 0 && (
                  <button
                    className="text-button"
                    onClick={() => navigate("reading")}
                  >
                    View all <ArrowRight size={14} />
                  </button>
                )}
              </div>
              {reading.length > 0 ? (
                <div className="continue-grid">
                  {reading.slice(0, 2).map((b) => (
                    <button
                      className="continue-card"
                      key={b.id}
                      onClick={() => setActive(b)}
                    >
                      <Cover book={b} compact />
                      <div className="continue-info">
                        <span className="eyebrow">
                          {b.format} {b.sample ? "· SAMPLE" : ""}
                        </span>
                        <h3>{b.title}</h3>
                        <p>{b.author}</p>
                        <div className="progress-track">
                          <i
                            style={{
                              width: `${Math.round(b.progress * 100)}%`,
                            }}
                          />
                        </div>
                        <div className="continue-meta">
                          <span>{Math.round(b.progress * 100)}% complete</span>
                          <span>
                            Keep reading <ArrowRight size={13} />
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="reading-welcome">
                  <div className="welcome-icon">
                    <BookOpen size={32} strokeWidth={1.2} />
                    <span>✦</span>
                  </div>
                  <div>
                    <h3>Your next chapter is waiting.</h3>
                    <p>
                      Open a book below and make a little time for yourself.
                    </p>
                  </div>
                  <span className="welcome-flourish">just one more page.</span>
                </div>
              )}
            </section>
          )}
          {view === "notes" ? (
            <>
              <div className="section-heading notebook-heading">
                <h2>
                  Collected thoughts{" "}
                  <span className="section-count">{notes.length}</span>
                </h2>
                <span className="subtle">Saved in your library</span>
              </div>
              {filteredNotes.length ? (
                <div className="notes-grid">
                  {filteredNotes.map((n) => (
                    <NoteCard
                      key={n.id}
                      note={n}
                      book={books.find((b) => b.id === n.bookId)}
                      onRead={() => {
                        const b = books.find((b) => b.id === n.bookId);
                        if (b)
                          setActive({
                            ...b,
                            location:
                              n.anchor.cfi ||
                              String(n.anchor.page || b.location),
                          });
                      }}
                      onDelete={async () => {
                        try {
                          await api(`/annotations/${n.id}`, {
                            method: "DELETE",
                          });
                          await refresh();
                        } catch (e) {
                          handleError(e);
                        }
                      }}
                      onEdit={async (text) => {
                        try {
                          await api(`/annotations/${n.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ note: text }),
                          });
                          await refresh();
                        } catch (e) {
                          handleError(e);
                        }
                      }}
                    />
                  ))}
                </div>
              ) : (
                <Empty
                  icon={<NotebookPen size={32} />}
                  title={
                    query
                      ? "No matching notes"
                      : "Keep the words that move you."
                  }
                  text={
                    query
                      ? "Try another search."
                      : "Select text while reading to highlight a passage or leave yourself a note."
                  }
                />
              )}
            </>
          ) : (
            <>
              <div className="library-toolbar">
                <div className="library-tabs">
                  {["all", "EPUB", "PDF"].map((f) => (
                    <button
                      key={f}
                      className={format === f ? "active" : ""}
                      onClick={() => setFormat(f)}
                    >
                      {f === "all"
                        ? "All books"
                        : f === "EPUB"
                          ? "Ebooks"
                          : "PDFs"}
                      <span>
                        {
                          books.filter((b) => f === "all" || b.format === f)
                            .length
                        }
                      </span>
                    </button>
                  ))}
                </div>
                <div className="view-controls">
                  <label className="sort-label">
                    <span>Sort by:</span>
                    <select
                      aria-label="Sort books"
                      value={sort}
                      onChange={(e) => setSort(e.target.value as typeof sort)}
                    >
                      <option value="recent">Recently added</option>
                      <option value="title">Title</option>
                      <option value="author">Author</option>
                      <option value="progress">Progress</option>
                    </select>
                    <ChevronDown size={13} />
                  </label>
                  <div className="layout-toggle">
                    <button
                      className={layout === "grid" ? "active" : ""}
                      onClick={() => setLayout("grid")}
                      aria-label="Grid view"
                    >
                      <Grid2X2 size={17} />
                    </button>
                    <button
                      className={layout === "list" ? "active" : ""}
                      onClick={() => setLayout("list")}
                      aria-label="List view"
                    >
                      <List size={18} />
                    </button>
                  </div>
                </div>
              </div>
              {loading ? (
                <div className="empty">
                  <LoaderCircle className="spin" size={28} />
                  <p>Unpacking your library…</p>
                </div>
              ) : filtered.length ? (
                <div className={layout === "grid" ? "book-grid" : "book-list"}>
                  {filtered.map((b) => (
                    <article key={b.id} className="book-card">
                      <button
                        className="cover-button"
                        onClick={() => setActive(b)}
                        aria-label={`Read ${b.title}`}
                      >
                        <Cover book={b} />
                        <span className="cover-hover">
                          <BookOpen size={20} /> Open book
                        </span>
                        {b.favorite && (
                          <span className="favorite-pin">
                            <Heart size={12} fill="currentColor" />
                          </span>
                        )}
                      </button>
                      <div className="book-caption">
                        <button
                          className="book-title"
                          onClick={() => setActive(b)}
                        >
                          {b.title}
                        </button>
                        <button
                          className="book-options icon"
                          aria-label={`Details for ${b.title}`}
                          onClick={() => setDetail(b)}
                        >
                          <MoreHorizontal size={19} />
                        </button>
                        <p>{b.author}</p>
                        <div className="book-meta">
                          <span>{b.format}</span>
                          {b.sample && <small>EXCERPT</small>}
                          <i />
                          <span>
                            {b.status === "finished"
                              ? "Finished"
                              : b.status === "reading"
                                ? `${Math.round(b.progress * 100)}% read`
                                : "Not started"}
                          </span>
                        </div>
                        {b.status === "reading" && (
                          <div className="mini-progress">
                            <i style={{ width: `${b.progress * 100}%` }} />
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty
                  icon={<Library size={32} />}
                  title={
                    query
                      ? "No books found"
                      : books.length
                        ? "A shelf with room to grow."
                        : "Every library begins with a book."
                  }
                  text={
                    query
                      ? "Try a different title or author."
                      : books.length
                        ? "Add books to this shelf from their book details."
                        : "Bring your EPUBs and PDFs. We’ll keep a place for your thoughts, too."
                  }
                >
                  {!query && (
                    <div className="empty-actions">
                      <button
                        className="primary"
                        onClick={() => setModal("upload")}
                      >
                        <Upload size={16} />
                        Upload your first book
                      </button>
                      {books.length === 0 && (
                        <button
                          className="text-button"
                          onClick={samples}
                          disabled={busy}
                        >
                          {busy
                            ? "Preparing samples…"
                            : "Or explore six classic excerpts"}
                          <ArrowRight size={14} />
                        </button>
                      )}
                    </div>
                  )}
                </Empty>
              )}
              {books.length > 0 && (
                <footer className="library-footer">
                  <span>
                    {filtered.length} {filtered.length === 1 ? "book" : "books"}{" "}
                    on this shelf <span className="footer-dot">·</span> A world
                    between the covers.
                  </span>
                  <span>
                    <Lock size={12} /> Private by nature.
                  </span>
                </footer>
              )}
            </>
          )}
          <input
            ref={input}
            type="file"
            accept=".pdf,.epub"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void upload(e.target.files);
            }}
          />
        </main>
      </div>
      {toast && (
        <div role="status" className="toast">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
      {dragging && (
        <div
          className="drop-overlay"
          onDragLeave={() => setDragging(false)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void upload(e.dataTransfer.files);
          }}
        >
          <Upload size={42} />
          <h2>Give your books a home.</h2>
          <p>Drop EPUB and PDF files here</p>
        </div>
      )}
      {modal && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setModal(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <button
              className="modal-close icon"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
              disabled={busy}
            >
              <X size={20} />
            </button>
            {modal === "upload" ? (
              <>
                <span className="modal-symbol">
                  <BookOpen size={26} />
                </span>
                <h2 id="modal-title">Make yourself at home.</h2>
                <p>
                  Bring a favorite. Discover a new one. Your library starts
                  here.
                </p>
                <button
                  className="upload-zone"
                  disabled={busy}
                  onClick={() => input.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragging(false);
                    void upload(e.dataTransfer.files);
                  }}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={30} />
                  ) : (
                    <Upload size={30} strokeWidth={1.4} />
                  )}
                  <strong>
                    {busy
                      ? `Adding ${uploading}…`
                      : "Choose files or drop them here"}
                  </strong>
                  <span>DRM-free EPUB & PDF · Up to 100 MB per book</span>
                </button>
                <p className="privacy-note">
                  <Lock size={13} /> Your files stay on your own server.
                </p>
                {error && (
                  <p role="alert" className="error-text">
                    {error}
                  </p>
                )}
              </>
            ) : modal === "collection" ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  try {
                    const name = collectionName.trim();
                    await api("/collections", {
                      method: "POST",
                      body: JSON.stringify({ name }),
                    });
                    await refresh();
                    navigate("collection:" + name);
                    setCollectionName("");
                    setModal(null);
                    setToast("A new shelf, just for you");
                  } catch (e) {
                    handleError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <span className="modal-symbol">
                  <Folder size={26} />
                </span>
                <h2 id="modal-title">A shelf of its own.</h2>
                <p>Gather books by topic, mood, or whatever feels right.</p>
                <label>
                  Collection name
                  <input
                    autoFocus
                    maxLength={80}
                    required
                    value={collectionName}
                    onChange={(e) => setCollectionName(e.target.value)}
                    placeholder="e.g. Slow Sunday reads"
                  />
                </label>
                <button className="primary full" disabled={busy}>
                  Create collection <Plus size={16} />
                </button>
                {error && <p className="error-text">{error}</p>}
              </form>
            ) : (
              <>
                <span className="modal-symbol">
                  <Settings size={26} />
                </span>
                <h2 id="modal-title">Your little corner.</h2>
                <p>Folio is an open-source home for your books.</p>
                <AccountSettings user={user} onSession={activateSession} />
                <div className="settings-row">
                  <HardDrive size={20} />
                  <div>
                    <strong>Stored on your server</strong>
                    <span>
                      {books.length} books ·{" "}
                      {(
                        books.reduce((s, b) => s + b.size, 0) /
                        1024 /
                        1024
                      ).toFixed(1)}{" "}
                      MB · {notes.length} annotations
                    </span>
                  </div>
                  <span className="status-pill">Local</span>
                </div>
                <div className="settings-row">
                  <Lock size={20} />
                  <div>
                    <strong>
                      {accountsEnabled
                        ? "Account sign-in"
                        : passwordRequired
                          ? "Password protected"
                          : "Private network mode"}
                    </strong>
                    <span>
                      {accountsEnabled
                        ? "Each user keeps their own reader preferences."
                        : passwordRequired
                          ? "Your library requires a password."
                          : "Create an owner account to enable individual sign-in."}
                    </span>
                  </div>
                </div>
                <button
                  className="secondary full"
                  onClick={async () => {
                    setModal(null);
                    await samples();
                  }}
                  disabled={busy}
                >
                  <Feather size={16} />
                  Add public-domain sample excerpts
                </button>
                <button
                  className="secondary full"
                  onClick={() => exportNotes(notes, books)}
                  disabled={!notes.length}
                >
                  <Download size={16} />
                  Export notes as Markdown
                </button>
                {view.startsWith("collection:") && (
                  <button
                    className="danger-link"
                    onClick={async () => {
                      try {
                        await api(
                          "/collections/" + encodeURIComponent(view.slice(11)),
                          { method: "DELETE" },
                        );
                        setModal(null);
                        navigate("library");
                        await refresh();
                      } catch (e) {
                        handleError(e);
                      }
                    }}
                  >
                    <Trash2 size={15} />
                    Delete this collection (keep books)
                  </button>
                )}
                {passwordRequired && (
                  <button
                    className="text-button full"
                    onClick={async () => {
                      try {
                        if (!(await preferences.flush()))
                          throw new Error(
                            "Your preferences have not saved. Retry before signing out.",
                          );
                        await api("/session", { method: "DELETE" });
                        preferences.activate(null);
                        setUser(null);
                        setAuthenticated(false);
                        setModal(null);
                        setBooks([]);
                        setNotes([]);
                        setCollections([]);
                        setError("");
                      } catch (e) {
                        handleError(e);
                      }
                    }}
                  >
                    <LogOut size={16} />
                    Sign out
                  </button>
                )}
                <p className="version">
                  Folio 0.1.0 · AGPL-3.0 · Made to be yours.
                </p>
              </>
            )}
          </section>
        </div>
      )}
      {detail && (
        <BookDetails
          book={detail}
          collections={collections}
          onClose={() => setDetail(null)}
          onPatch={(p) => patch(detail, p)}
          onRead={() => {
            setActive(detail);
            setDetail(null);
          }}
          onDelete={async () => {
            try {
              await api(`/books/${detail.id}`, { method: "DELETE" });
              setDetail(null);
              setToast("Book removed from your library");
              await refresh();
            } catch (e) {
              handleError(e);
            }
          }}
        />
      )}
    </div>
  );
}
export function Cover({
  book,
  compact = false,
}: {
  book: Book;
  compact?: boolean;
}) {
  return (
    <div
      className={`book-cover cover-${book.color} ${compact ? "compact-cover" : ""}`}
    >
      {book.cover ? (
        <img
          src={`/api/v1/books/${book.id}/cover`}
          alt={`Cover of ${book.title}`}
          loading="lazy"
        />
      ) : (
        <>
          <span className="cover-series">THE FOLIO LIBRARY</span>
          <div className="cover-rule" />
          <span className="cover-author">{book.author}</span>
          <div className="cover-art" aria-hidden="true">
            <i />
            <i />
            <i />
            <span>✦</span>
          </div>
          <span className="cover-name">{book.title}</span>
          <span className="cover-bottom">
            {book.sample
              ? "A CLASSIC EXCERPT"
              : book.format === "EPUB"
                ? "A WORLD IN WORDS"
                : "NOTES FROM THE WORLD"}
          </span>
        </>
      )}
      <div className="cover-spine" />
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{text}</p>
      {children}
    </div>
  );
}
function BookDetails({
  book,
  collections,
  onClose,
  onPatch,
  onRead,
  onDelete,
}: {
  book: Book;
  collections: string[];
  onClose: () => void;
  onPatch: (p: Partial<Book>) => void;
  onRead: () => void;
  onDelete: () => void;
}) {
  const [confirm, setConfirm] = useState(false),
    [editing, setEditing] = useState(false),
    [title, setTitle] = useState(book.title),
    [author, setAuthor] = useState(book.author);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal book-detail"
        role="dialog"
        aria-modal="true"
        aria-label="Book details"
      >
        <button
          className="modal-close icon"
          onClick={onClose}
          aria-label="Close details"
        >
          <X size={20} />
        </button>
        <div className="detail-cover">
          <Cover book={book} />
        </div>
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onPatch({ title, author });
              setEditing(false);
            }}
          >
            <label>
              Title
              <input
                value={title}
                required
                maxLength={500}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              Author
              <input
                value={author}
                maxLength={500}
                onChange={(e) => setAuthor(e.target.value)}
              />
            </label>
            <button className="primary full">Save details</button>
          </form>
        ) : (
          <>
            <h2>{book.title}</h2>
            <p>
              {book.author}{" "}
              <button className="inline-link" onClick={() => setEditing(true)}>
                Edit
              </button>
            </p>
          </>
        )}
        <div className="detail-tags">
          <span>{book.format}</span>
          <span>{(book.size / 1024 / 1024).toFixed(2)} MB</span>
          {book.sample && <span>Sample excerpt</span>}
        </div>
        <div className="detail-actions">
          <button className="primary" onClick={onRead}>
            <BookOpen size={17} />
            {book.status === "unread" ? "Start reading" : "Open book"}
          </button>
          <button
            className={`secondary ${book.favorite ? "is-favorite" : ""}`}
            aria-label={
              book.favorite ? "Remove from favorites" : "Add to favorites"
            }
            onClick={() => onPatch({ favorite: !book.favorite })}
          >
            <Heart size={19} fill={book.favorite ? "currentColor" : "none"} />
          </button>
          <a
            className="secondary"
            href={`/api/v1/books/${book.id}/file?download=1`}
            aria-label="Download book"
          >
            <Download size={18} />
          </a>
        </div>
        <label>
          On your shelf
          <select
            value={book.collection}
            onChange={(e) => onPatch({ collection: e.target.value })}
          >
            <option value="">No collection</option>
            {collections.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Reading status
          <select
            value={book.status}
            onChange={(e) =>
              onPatch({ status: e.target.value as Book["status"] })
            }
          >
            <option value="unread">Not started</option>
            <option value="reading">Currently reading</option>
            <option value="finished">Finished</option>
          </select>
        </label>
        {confirm ? (
          <div className="delete-confirm">
            <p>
              Remove this book and all its annotations? This cannot be undone.
            </p>
            <button className="danger-button" onClick={onDelete}>
              Delete book
            </button>
            <button className="text-button" onClick={() => setConfirm(false)}>
              Keep it
            </button>
          </div>
        ) : (
          <button className="danger-link" onClick={() => setConfirm(true)}>
            <Trash2 size={14} />
            Remove from library
          </button>
        )}
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <PreferencesProvider>
    <App />
  </PreferencesProvider>,
);

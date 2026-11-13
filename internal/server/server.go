package server

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type Config struct {
	DataDir, WebDir, Password, APIToken string
	SecureCookie                        bool
}
type Server struct {
	db       *sql.DB
	cfg      Config
	mux      *http.ServeMux
	attempts chan struct{}
}
type Book struct {
	ID         string  `json:"id"`
	Title      string  `json:"title"`
	Author     string  `json:"author"`
	Format     string  `json:"format"`
	Size       int64   `json:"size"`
	Cover      bool    `json:"cover"`
	Color      string  `json:"color"`
	AddedAt    string  `json:"addedAt"`
	LastRead   *string `json:"lastRead"`
	Progress   float64 `json:"progress"`
	Location   string  `json:"location"`
	Favorite   bool    `json:"favorite"`
	Status     string  `json:"status"`
	Collection string  `json:"collection"`
	Sample     bool    `json:"sample"`
}
type Annotation struct {
	ID        string          `json:"id"`
	BookID    string          `json:"bookId"`
	Kind      string          `json:"kind"`
	Quote     string          `json:"quote"`
	Note      string          `json:"note"`
	Color     string          `json:"color"`
	Anchor    json.RawMessage `json:"anchor"`
	CreatedAt string          `json:"createdAt"`
}

const bookColumns = `id,title,author,format,size,cover,color,added_at,last_read,progress,location,favorite,status,collection,sample`

func New(cfg Config) (*Server, error) {
	if err := os.MkdirAll(filepath.Join(cfg.DataDir, "books"), 0700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", filepath.Join(cfg.DataDir, "folio.db"))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY,title TEXT NOT NULL,author TEXT NOT NULL,format TEXT NOT NULL,size INTEGER NOT NULL,cover INTEGER NOT NULL DEFAULT 0,color TEXT NOT NULL,added_at TEXT NOT NULL,last_read TEXT,progress REAL NOT NULL DEFAULT 0,location TEXT NOT NULL DEFAULT '',favorite INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'unread',collection TEXT NOT NULL DEFAULT '',sample INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS annotations (id TEXT PRIMARY KEY,book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,kind TEXT NOT NULL,quote TEXT NOT NULL,note TEXT NOT NULL,color TEXT NOT NULL,anchor TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS ink_pages (book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,page INTEGER NOT NULL,revision INTEGER NOT NULL,strokes TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(book_id,page));
 CREATE TABLE IF NOT EXISTS collections (name TEXT PRIMARY KEY);
 CREATE INDEX IF NOT EXISTS annotation_book ON annotations(book_id);`)
	if err != nil {
		db.Close()
		return nil, err
	}
	s := &Server{db: db, cfg: cfg, mux: http.NewServeMux(), attempts: make(chan struct{}, 5)}
	s.routes()
	return s, nil
}
func (s *Server) Close() error { return s.db.Close() }
func id() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }
func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, message string) {
	respond(w, status, map[string]string{"error": message})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	return decodeSized(w, r, v, 1<<20)
}
func decodeSized(w http.ResponseWriter, r *http.Request, v any, limit int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		fail(w, 400, "Invalid request body")
		return false
	}
	if d.Decode(new(any)) != io.EOF {
		fail(w, 400, "Expected one JSON object")
		return false
	}
	return true
}
func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/v1/health", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 200, map[string]string{"status": "ok", "version": "0.1.0"})
	})
	s.mux.HandleFunc("GET /api/v1/session", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 200, map[string]bool{"authenticated": s.authorized(r), "passwordRequired": s.cfg.Password != ""})
	})
	s.mux.HandleFunc("POST /api/v1/session", s.login)
	s.mux.HandleFunc("DELETE /api/v1/session", func(w http.ResponseWriter, r *http.Request) {
		http.SetCookie(w, &http.Cookie{Name: "folio_session", Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: s.cfg.SecureCookie})
		w.WriteHeader(204)
	})
	s.mux.HandleFunc("GET /api/v1/books", s.books)
	s.mux.HandleFunc("POST /api/v1/books", s.upload)
	s.mux.HandleFunc("GET /api/v1/books/{id}", s.getBook)
	s.mux.HandleFunc("PATCH /api/v1/books/{id}", s.updateBook)
	s.mux.HandleFunc("DELETE /api/v1/books/{id}", s.deleteBook)
	s.mux.HandleFunc("GET /api/v1/books/{id}/file", s.file)
	s.mux.HandleFunc("GET /api/v1/books/{id}/cover", s.cover)
	s.mux.HandleFunc("GET /api/v1/books/{id}/ink/{page}", s.getInk)
	s.mux.HandleFunc("PUT /api/v1/books/{id}/ink/{page}", s.putInk)
	s.mux.HandleFunc("GET /api/v1/annotations", s.annotations)
	s.mux.HandleFunc("POST /api/v1/books/{id}/annotations", s.addAnnotation)
	s.mux.HandleFunc("PATCH /api/v1/annotations/{id}", s.updateAnnotation)
	s.mux.HandleFunc("DELETE /api/v1/annotations/{id}", s.deleteAnnotation)
	s.mux.HandleFunc("GET /api/v1/collections", s.collections)
	s.mux.HandleFunc("POST /api/v1/collections", s.addCollection)
	s.mux.HandleFunc("DELETE /api/v1/collections/{name}", s.deleteCollection)
	s.mux.HandleFunc("POST /api/v1/samples", s.samples)
	s.mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { fail(w, 404, "API endpoint not found") })
	s.mux.HandleFunc("/", s.static)
}
func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
			if r.Method != "GET" && r.Method != "HEAD" {
				if origin := r.Header.Get("Origin"); origin != "" {
					u, err := url.Parse(origin)
					if err != nil || u.Host != r.Host || (u.Scheme != "http" && u.Scheme != "https") {
						fail(w, 403, "Cross-origin requests are not allowed")
						return
					}
				}
			}
			if r.URL.Path != "/api/v1/session" && r.URL.Path != "/api/v1/health" && !s.authorized(r) {
				fail(w, 401, "Sign in to access your library")
				return
			}
		}
		s.mux.ServeHTTP(w, r)
	})
}
func (s *Server) authorized(r *http.Request) bool {
	if s.cfg.APIToken != "" && subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+s.cfg.APIToken)) == 1 {
		return true
	}
	if s.cfg.Password == "" {
		return true
	}
	c, e := r.Cookie("folio_session")
	if e != nil {
		return false
	}
	parts := strings.Split(c.Value, ".")
	if len(parts) != 2 {
		return false
	}
	expires, e := strconv.ParseInt(parts[0], 10, 64)
	return e == nil && expires > time.Now().Unix() && hmac.Equal([]byte(parts[1]), []byte(s.signature(parts[0])))
}
func (s *Server) signature(v string) string {
	h := hmac.New(sha256.New, []byte(s.cfg.Password))
	h.Write([]byte("folio-session:" + v))
	return hex.EncodeToString(h.Sum(nil))
}
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	select {
	case s.attempts <- struct{}{}:
	default:
		fail(w, 429, "Too many sign-in attempts. Try again shortly.")
		return
	}
	defer func() { time.AfterFunc(time.Second, func() { <-s.attempts }) }()
	var body struct {
		Password string `json:"password"`
	}
	if !decode(w, r, &body) {
		return
	}
	a, b := sha256.Sum256([]byte(body.Password)), sha256.Sum256([]byte(s.cfg.Password))
	if subtle.ConstantTimeCompare(a[:], b[:]) != 1 {
		fail(w, 401, "That password isn't right")
		return
	}
	exp := strconv.FormatInt(time.Now().Add(30*24*time.Hour).Unix(), 10)
	http.SetCookie(w, &http.Cookie{Name: "folio_session", Value: exp + "." + s.signature(exp), Path: "/", MaxAge: 30 * 24 * 3600, HttpOnly: true, Secure: s.cfg.SecureCookie, SameSite: http.SameSiteStrictMode})
	respond(w, 200, map[string]bool{"authenticated": true})
}

type scanner interface{ Scan(...any) error }

func scanBook(row scanner) (Book, error) {
	var b Book
	err := row.Scan(&b.ID, &b.Title, &b.Author, &b.Format, &b.Size, &b.Cover, &b.Color, &b.AddedAt, &b.LastRead, &b.Progress, &b.Location, &b.Favorite, &b.Status, &b.Collection, &b.Sample)
	return b, err
}
func (s *Server) book(bid string) (Book, error) {
	return scanBook(s.db.QueryRow("SELECT "+bookColumns+" FROM books WHERE id=?", bid))
}
func (s *Server) books(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query("SELECT " + bookColumns + " FROM books ORDER BY added_at DESC")
	if err != nil {
		fail(w, 500, "Could not load library")
		return
	}
	defer rows.Close()
	out := []Book{}
	for rows.Next() {
		b, e := scanBook(rows)
		if e != nil {
			fail(w, 500, "Could not load book")
			return
		}
		out = append(out, b)
	}
	respond(w, 200, out)
}
func (s *Server) getBook(w http.ResponseWriter, r *http.Request) {
	b, e := s.book(r.PathValue("id"))
	if e != nil {
		fail(w, 404, "Book not found")
		return
	}
	respond(w, 200, b)
}
func (s *Server) updateBook(w http.ResponseWriter, r *http.Request) {
	b, e := s.book(r.PathValue("id"))
	if e != nil {
		fail(w, 404, "Book not found")
		return
	}
	var p struct {
		Title      *string  `json:"title"`
		Author     *string  `json:"author"`
		Favorite   *bool    `json:"favorite"`
		Status     *string  `json:"status"`
		Collection *string  `json:"collection"`
		Progress   *float64 `json:"progress"`
		Location   *string  `json:"location"`
	}
	if !decode(w, r, &p) {
		return
	}
	if p.Title != nil {
		b.Title = strings.TrimSpace(*p.Title)
		if b.Title == "" || len(b.Title) > 500 {
			fail(w, 400, "Title must be between 1 and 500 characters")
			return
		}
	}
	if p.Author != nil {
		if len(*p.Author) > 500 {
			fail(w, 400, "Author is too long")
			return
		}
		b.Author = *p.Author
	}
	if p.Favorite != nil {
		b.Favorite = *p.Favorite
	}
	if p.Status != nil {
		if *p.Status != "unread" && *p.Status != "reading" && *p.Status != "finished" {
			fail(w, 400, "Invalid reading status")
			return
		}
		b.Status = *p.Status
	}
	if p.Collection != nil {
		b.Collection = *p.Collection
		if b.Collection != "" {
			var n int
			if s.db.QueryRow("SELECT count(*) FROM collections WHERE name=?", b.Collection).Scan(&n) != nil || n == 0 {
				fail(w, 400, "Collection not found")
				return
			}
		}
	}
	if p.Location != nil {
		if len(*p.Location) > 4096 {
			fail(w, 400, "Location is too long")
			return
		}
		b.Location = *p.Location
	}
	if p.Progress != nil {
		if *p.Progress < 0 || *p.Progress > 1 {
			fail(w, 400, "Progress must be between 0 and 1")
			return
		}
		b.Progress = *p.Progress
		t := now()
		b.LastRead = &t
		if b.Progress >= .995 {
			b.Status = "finished"
		} else {
			b.Status = "reading"
		}
	}
	_, e = s.db.Exec(`UPDATE books SET title=?,author=?,favorite=?,status=?,collection=?,progress=?,location=?,last_read=? WHERE id=?`, b.Title, b.Author, b.Favorite, b.Status, b.Collection, b.Progress, b.Location, b.LastRead, b.ID)
	if e != nil {
		fail(w, 500, "Could not save book")
		return
	}
	respond(w, 200, b)
}
func (s *Server) deleteBook(w http.ResponseWriter, r *http.Request) {
	b, e := s.book(r.PathValue("id"))
	if e != nil {
		fail(w, 404, "Book not found")
		return
	}
	if _, e = s.db.Exec("DELETE FROM books WHERE id=?", b.ID); e != nil {
		fail(w, 500, "Could not delete book")
		return
	}
	os.Remove(filepath.Join(s.cfg.DataDir, "books", b.ID+"."+strings.ToLower(b.Format)))
	os.Remove(filepath.Join(s.cfg.DataDir, "books", b.ID+".cover"))
	w.WriteHeader(204)
}
func (s *Server) file(w http.ResponseWriter, r *http.Request) {
	b, e := s.book(r.PathValue("id"))
	if e != nil {
		fail(w, 404, "Book not found")
		return
	}
	mime := "application/pdf"
	if b.Format == "EPUB" {
		mime = "application/epub+zip"
	}
	w.Header().Set("Content-Type", mime)
	if r.URL.Query().Get("download") == "1" {
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", b.ID+"."+strings.ToLower(b.Format)))
	}
	http.ServeFile(w, r, filepath.Join(s.cfg.DataDir, "books", b.ID+"."+strings.ToLower(b.Format)))
}
func (s *Server) cover(w http.ResponseWriter, r *http.Request) {
	b, e := s.book(r.PathValue("id"))
	if e != nil || !b.Cover {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, filepath.Join(s.cfg.DataDir, "books", b.ID+".cover"))
}
func (s *Server) annotations(w http.ResponseWriter, r *http.Request) {
	query := "SELECT id,book_id,kind,quote,note,color,anchor,created_at FROM annotations"
	args := []any{}
	if b := r.URL.Query().Get("bookId"); b != "" {
		query += " WHERE book_id=?"
		args = append(args, b)
	}
	rows, e := s.db.Query(query+" ORDER BY created_at DESC", args...)
	if e != nil {
		fail(w, 500, "Could not load annotations")
		return
	}
	defer rows.Close()
	out := []Annotation{}
	for rows.Next() {
		var a Annotation
		var anchor string
		if rows.Scan(&a.ID, &a.BookID, &a.Kind, &a.Quote, &a.Note, &a.Color, &anchor, &a.CreatedAt) != nil {
			fail(w, 500, "Could not load annotation")
			return
		}
		a.Anchor = json.RawMessage(anchor)
		out = append(out, a)
	}
	respond(w, 200, out)
}
func (s *Server) addAnnotation(w http.ResponseWriter, r *http.Request) {
	if _, e := s.book(r.PathValue("id")); e != nil {
		fail(w, 404, "Book not found")
		return
	}
	var a Annotation
	if !decode(w, r, &a) {
		return
	}
	if a.Kind != "highlight" && a.Kind != "bookmark" && a.Kind != "note" {
		fail(w, 400, "Invalid annotation kind")
		return
	}
	if a.Color != "yellow" && a.Color != "green" && a.Color != "pink" && a.Color != "blue" {
		a.Color = "yellow"
	}
	if len(a.Quote) > 50000 || len(a.Note) > 50000 || len(a.Anchor) > 100000 || !json.Valid(a.Anchor) {
		fail(w, 400, "Invalid or oversized annotation")
		return
	}
	var anchor struct {
		CFI   string `json:"cfi"`
		Page  int    `json:"page"`
		Rects []struct {
			X float64 `json:"x"`
			Y float64 `json:"y"`
			W float64 `json:"w"`
			H float64 `json:"h"`
		} `json:"rects"`
	}
	if json.Unmarshal(a.Anchor, &anchor) != nil || (anchor.CFI == "" && anchor.Page < 1) || len(anchor.CFI) > 4096 || (anchor.CFI != "" && !strings.HasPrefix(anchor.CFI, "epubcfi(")) || len(anchor.Rects) > 1000 {
		fail(w, 400, "Anchor must contain an EPUB CFI or PDF page")
		return
	}
	for _, rect := range anchor.Rects {
		if rect.X < 0 || rect.Y < 0 || rect.W <= 0 || rect.H <= 0 || rect.X+rect.W > 1.01 || rect.Y+rect.H > 1.01 {
			fail(w, 400, "Invalid highlight coordinates")
			return
		}
	}
	a.ID = id()
	a.BookID = r.PathValue("id")
	a.CreatedAt = now()
	_, e := s.db.Exec("INSERT INTO annotations VALUES(?,?,?,?,?,?,?,?)", a.ID, a.BookID, a.Kind, a.Quote, a.Note, a.Color, string(a.Anchor), a.CreatedAt)
	if e != nil {
		fail(w, 500, "Could not save annotation")
		return
	}
	respond(w, 201, a)
}
func (s *Server) updateAnnotation(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Note string `json:"note"`
	}
	if !decode(w, r, &p) {
		return
	}
	if len(p.Note) > 50000 {
		fail(w, 400, "Note is too long")
		return
	}
	result, e := s.db.Exec("UPDATE annotations SET note=? WHERE id=?", p.Note, r.PathValue("id"))
	if e != nil {
		fail(w, 500, "Could not save note")
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		fail(w, 404, "Annotation not found")
		return
	}
	w.WriteHeader(204)
}
func (s *Server) deleteAnnotation(w http.ResponseWriter, r *http.Request) {
	result, e := s.db.Exec("DELETE FROM annotations WHERE id=?", r.PathValue("id"))
	if e != nil {
		fail(w, 500, "Could not delete annotation")
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		fail(w, 404, "Annotation not found")
		return
	}
	w.WriteHeader(204)
}
func (s *Server) collections(w http.ResponseWriter, r *http.Request) {
	rows, e := s.db.Query("SELECT name FROM collections ORDER BY name")
	if e != nil {
		fail(w, 500, "Could not load collections")
		return
	}
	defer rows.Close()
	names := []string{}
	for rows.Next() {
		var n string
		rows.Scan(&n)
		names = append(names, n)
	}
	respond(w, 200, names)
}
func (s *Server) addCollection(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &b) {
		return
	}
	b.Name = strings.TrimSpace(b.Name)
	if len(b.Name) < 1 || len(b.Name) > 80 {
		fail(w, 400, "Collection names must be between 1 and 80 characters")
		return
	}
	if _, e := s.db.Exec("INSERT INTO collections(name) VALUES(?)", b.Name); e != nil {
		fail(w, 409, "That collection already exists")
		return
	}
	respond(w, 201, b)
}
func (s *Server) deleteCollection(w http.ResponseWriter, r *http.Request) {
	tx, e := s.db.Begin()
	if e != nil {
		fail(w, 500, "Could not update collection")
		return
	}
	defer tx.Rollback()
	_, e = tx.Exec("UPDATE books SET collection='' WHERE collection=?", r.PathValue("name"))
	if e == nil {
		_, e = tx.Exec("DELETE FROM collections WHERE name=?", r.PathValue("name"))
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		fail(w, 500, "Could not delete collection")
		return
	}
	w.WriteHeader(204)
}
func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; connect-src 'self' blob:; frame-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'")
	if r.Method != "GET" && r.Method != "HEAD" {
		http.NotFound(w, r)
		return
	}
	clean := filepath.Clean("/" + r.URL.Path)
	p := filepath.Join(s.cfg.WebDir, clean)
	if stat, e := os.Stat(p); e == nil && !stat.IsDir() {
		http.ServeFile(w, r, p)
		return
	}
	index := filepath.Join(s.cfg.WebDir, "index.html")
	if _, e := os.Stat(index); errors.Is(e, os.ErrNotExist) {
		fail(w, 503, "Web app not built. Run npm ci && npm run build in web/.")
		return
	}
	http.ServeFile(w, r, index)
}

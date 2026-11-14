package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"regexp"
	"strconv"
)

// Ink coordinates and brush width are fractions of the PDF page bounds.
// Keeping the source points, rather than a bitmap, lets other clients re-render ink.
type InkPoint struct {
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Pressure float64 `json:"pressure"`
}
type InkStroke struct {
	ID     string     `json:"id"`
	Tool   string     `json:"tool"`
	Color  string     `json:"color"`
	Width  float64    `json:"width"`
	Points []InkPoint `json:"points"`
}
type InkPage struct {
	Page      int         `json:"page"`
	Revision  int64       `json:"revision"`
	Strokes   []InkStroke `json:"strokes"`
	UpdatedAt *string     `json:"updatedAt"`
}

var inkColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
var strokeID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

func (s *Server) inkTarget(w http.ResponseWriter, r *http.Request) (string, int, bool) {
	b, err := s.book(principal(r).ID, r.PathValue("id"))
	if err != nil {
		fail(w, 404, "Book not found")
		return "", 0, false
	}
	if b.Format != "PDF" {
		fail(w, 400, "Handwriting is available for PDFs")
		return "", 0, false
	}
	page, err := strconv.Atoi(r.PathValue("page"))
	if err != nil || page < 1 || page > 100000 {
		fail(w, 400, "Invalid PDF page number")
		return "", 0, false
	}
	return b.ID, page, true
}
func (s *Server) getInk(w http.ResponseWriter, r *http.Request) {
	bid, page, ok := s.inkTarget(w, r)
	if !ok {
		return
	}
	result := InkPage{Page: page, Strokes: []InkStroke{}}
	var data string
	err := s.db.QueryRow("SELECT revision,strokes,updated_at FROM ink_pages WHERE book_id=? AND page=?", bid, page).Scan(&result.Revision, &data, &result.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		respond(w, 200, result)
		return
	}
	if err != nil || json.Unmarshal([]byte(data), &result.Strokes) != nil {
		fail(w, 500, "Could not load handwriting")
		return
	}
	respond(w, 200, result)
}
func validateInk(strokes []InkStroke) bool {
	if strokes == nil || len(strokes) > 5000 {
		return false
	}
	seen := map[string]bool{}
	points := 0
	valid := func(n float64) bool { return !math.IsNaN(n) && !math.IsInf(n, 0) && n >= 0 && n <= 1 }
	for _, stroke := range strokes {
		if !strokeID.MatchString(stroke.ID) || seen[stroke.ID] || (stroke.Tool != "pen" && stroke.Tool != "highlighter") || !inkColor.MatchString(stroke.Color) || !valid(stroke.Width) || stroke.Width < 0.0002 || stroke.Width > 0.1 || len(stroke.Points) < 1 || len(stroke.Points) > 10000 {
			return false
		}
		seen[stroke.ID] = true
		points += len(stroke.Points)
		if points > 200000 {
			return false
		}
		for _, p := range stroke.Points {
			if !valid(p.X) || !valid(p.Y) || !valid(p.Pressure) {
				return false
			}
		}
	}
	return true
}
func (s *Server) putInk(w http.ResponseWriter, r *http.Request) {
	bid, page, ok := s.inkTarget(w, r)
	if !ok {
		return
	}
	var body struct {
		Revision int64       `json:"revision"`
		Strokes  []InkStroke `json:"strokes"`
	}
	if !decodeSized(w, r, &body, 16<<20) {
		return
	}
	if body.Revision < 0 || body.Revision >= math.MaxInt64 || !validateInk(body.Strokes) {
		fail(w, 400, "Invalid handwriting: check stroke coordinates, size, and point limits")
		return
	}
	data, err := json.Marshal(body.Strokes)
	if err != nil {
		fail(w, 400, "Invalid handwriting")
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		fail(w, 500, "Could not save handwriting")
		return
	}
	defer tx.Rollback()
	var revision int64
	err = tx.QueryRow("SELECT revision FROM ink_pages WHERE book_id=? AND page=?", bid, page).Scan(&revision)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		fail(w, 500, "Could not read handwriting revision")
		return
	}
	if revision != body.Revision {
		respond(w, 409, map[string]any{"error": "This page changed in another tab. Download your ink before reloading the saved page.", "currentRevision": revision})
		return
	}
	updated := now()
	// Empty pages retain their revision, preventing a stale client from resurrecting erased strokes.
	_, err = tx.Exec(`INSERT INTO ink_pages(book_id,page,revision,strokes,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(book_id,page) DO UPDATE SET revision=excluded.revision,strokes=excluded.strokes,updated_at=excluded.updated_at`, bid, page, revision+1, string(data), updated)
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		fail(w, 500, "Could not save handwriting")
		return
	}
	respond(w, 200, InkPage{Page: page, Revision: revision + 1, Strokes: body.Strokes, UpdatedAt: &updated})
}

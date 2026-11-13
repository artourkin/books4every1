package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type Preferences struct {
	PenWidth       float64 `json:"penWidth"`
	MarkerWidth    float64 `json:"markerWidth"`
	InkColor       string  `json:"inkColor"`
	InkTool        string  `json:"inkTool"`
	InkBrush       string  `json:"inkBrush"`
	DrawWithTouch  bool    `json:"drawWithTouch"`
	FontSize       int     `json:"fontSize"`
	Theme          string  `json:"theme"`
	HighlightColor string  `json:"highlightColor"`
	LibraryLayout  string  `json:"libraryLayout"`
	LibrarySort    string  `json:"librarySort"`
}

func defaultPreferences() Preferences {
	return Preferences{PenWidth: 3, MarkerWidth: 12, InkColor: "#394137", InkTool: "pen", InkBrush: "pen", FontSize: 100, Theme: "paper", HighlightColor: "yellow", LibraryLayout: "grid", LibrarySort: "recent"}
}
func (s *Server) preferences(userID string) (Preferences, error) {
	prefs := defaultPreferences()
	var data string
	err := s.db.QueryRow("SELECT data FROM preferences WHERE user_id=?", userID).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return prefs, nil
	}
	if err != nil {
		return prefs, err
	}
	err = json.Unmarshal([]byte(data), &prefs)
	return prefs, err
}
func (s *Server) getPreferences(w http.ResponseWriter, r *http.Request) {
	u, ok := s.identity(r)
	if !ok {
		fail(w, 401, "Sign in to load your preferences")
		return
	}
	prefs, err := s.preferences(u.ID)
	if err != nil {
		fail(w, 500, "Could not load preferences")
		return
	}
	respond(w, 200, prefs)
}
func validPreferences(p Preferences) bool {
	has := func(value string, choices ...string) bool {
		for _, c := range choices {
			if value == c {
				return true
			}
		}
		return false
	}
	return (p.PenWidth == 1.5 || p.PenWidth == 3 || p.PenWidth == 5 || p.PenWidth == 8) && (p.MarkerWidth == 6 || p.MarkerWidth == 12 || p.MarkerWidth == 20 || p.MarkerWidth == 30) && inkColor.MatchString(p.InkColor) && has(p.InkTool, "pen", "highlighter", "eraser") && has(p.InkBrush, "pen", "highlighter") && p.FontSize >= 70 && p.FontSize <= 180 && has(p.Theme, "paper", "night") && has(p.HighlightColor, "yellow", "green", "pink", "blue") && has(p.LibraryLayout, "grid", "list") && has(p.LibrarySort, "recent", "title", "author", "progress")
}
func (s *Server) patchPreferences(w http.ResponseWriter, r *http.Request) {
	u, ok := s.identity(r)
	if !ok {
		fail(w, 401, "Sign in to save your preferences")
		return
	}
	if intended := r.Header.Get("X-Folio-Profile"); intended != "" && intended != u.ID {
		fail(w, 409, "The account changed in another tab. Reload before saving preferences.")
		return
	}
	var patch map[string]json.RawMessage
	if !decodeSized(w, r, &patch, 8192) {
		return
	}
	if patch == nil {
		fail(w, 400, "Preferences must be a JSON object")
		return
	}
	prefs := defaultPreferences()
	raw, _ := json.Marshal(prefs)
	var fields map[string]json.RawMessage
	json.Unmarshal(raw, &fields)
	for key, value := range patch {
		if _, ok := fields[key]; !ok || string(value) == "null" {
			fail(w, 400, "Unknown or empty preference: "+key)
			return
		}
	}
	// Merge inside the transaction so simultaneous changes to different settings survive.
	tx, err := s.db.Begin()
	if err != nil {
		fail(w, 500, "Could not save preferences")
		return
	}
	defer tx.Rollback()
	var data string
	err = tx.QueryRow("SELECT data FROM preferences WHERE user_id=?", u.ID).Scan(&data)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		fail(w, 500, "Could not load preferences")
		return
	}
	if err == nil {
		if json.Unmarshal([]byte(data), &fields) != nil {
			fail(w, 500, "Could not load preferences")
			return
		}
	}
	for key, value := range patch {
		fields[key] = value
	}
	raw, err = json.Marshal(fields)
	if err != nil || json.Unmarshal(raw, &prefs) != nil || !validPreferences(prefs) {
		fail(w, 400, "Invalid preference value")
		return
	}
	prefs.InkColor = strings.ToLower(prefs.InkColor)
	raw, _ = json.Marshal(prefs)
	_, err = tx.Exec("INSERT INTO preferences(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data", u.ID, string(raw))
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		fail(w, 500, "Could not save preferences")
		return
	}
	respond(w, 200, prefs)
}

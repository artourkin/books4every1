package server

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func testServer(t *testing.T, password string) (*Server, *httptest.Server) {
	t.Helper()
	s, e := New(Config{DataDir: t.TempDir(), WebDir: t.TempDir(), Password: password})
	if e != nil {
		t.Fatal(e)
	}
	h := httptest.NewServer(s.Handler())
	t.Cleanup(func() { h.Close(); s.Close() })
	return s, h
}
func request(t *testing.T, h *httptest.Server, method, path, body string, status int) []byte {
	t.Helper()
	req, _ := http.NewRequest(method, h.URL+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res, e := h.Client().Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer res.Body.Close()
	out, _ := io.ReadAll(res.Body)
	if res.StatusCode != status {
		t.Fatalf("%s %s: got %d, want %d: %s", method, path, res.StatusCode, status, out)
	}
	return out
}
func importTest(t *testing.T, h *httptest.Server, name string, data []byte, status int) Book {
	t.Helper()
	var b bytes.Buffer
	mw := multipart.NewWriter(&b)
	part, _ := mw.CreateFormFile("file", name)
	part.Write(data)
	mw.Close()
	req, _ := http.NewRequest("POST", h.URL+"/api/v1/books", &b)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, e := h.Client().Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer res.Body.Close()
	out, _ := io.ReadAll(res.Body)
	if res.StatusCode != status {
		t.Fatalf("import: got %d want %d: %s", res.StatusCode, status, out)
	}
	var book Book
	if status == 201 {
		if json.Unmarshal(out, &book) != nil {
			t.Fatal("invalid book response")
		}
	}
	return book
}
func TestLibraryLifecycleAndPersistence(t *testing.T) {
	s, h := testServer(t, "")
	b := importTest(t, h, "book.epub", sampleEPUB(sampleBooks[0]), 201)
	if b.Title != "Walden" || b.Author != "Henry David Thoreau" {
		t.Fatalf("metadata: %+v", b)
	}
	request(t, h, "POST", "/api/v1/collections", `{"name":"Nature"}`, 201)
	request(t, h, "PATCH", "/api/v1/books/"+b.ID, `{"progress":0.4,"location":"epubcfi(/6/2!/4/2:1)","favorite":true,"collection":"Nature"}`, 200)
	aData := request(t, h, "POST", "/api/v1/books/"+b.ID+"/annotations", `{"kind":"highlight","quote":"live deliberately","note":"Make time for this","color":"green","anchor":{"cfi":"epubcfi(/6/2!/4/2:1)"}}`, 201)
	var a Annotation
	json.Unmarshal(aData, &a)
	request(t, h, "PATCH", "/api/v1/annotations/"+a.ID, `{"note":"A thought revised"}`, 204)
	// A fresh database connection must preserve the library and its reading state.
	reopened, e := New(s.cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer reopened.Close()
	saved, e := reopened.book(b.ID)
	if e != nil || saved.Progress != .4 || !saved.Favorite || saved.Status != "reading" {
		t.Fatalf("persisted state: %+v %v", saved, e)
	}
	notes := request(t, h, "GET", "/api/v1/annotations?bookId="+b.ID, "", 200)
	if !bytes.Contains(notes, []byte("A thought revised")) {
		t.Fatal(string(notes))
	}
	// Range requests support PDF.js and future clients without downloading whole files.
	req, _ := http.NewRequest("GET", h.URL+"/api/v1/books/"+b.ID+"/file", nil)
	req.Header.Set("Range", "bytes=0-3")
	res, e := h.Client().Do(req)
	if e != nil {
		t.Fatal(e)
	}
	data, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 206 || string(data) != "PK\x03\x04" {
		t.Fatalf("range response %d: %q", res.StatusCode, data)
	}
	request(t, h, "DELETE", "/api/v1/collections/Nature", "", 204)
	saved, _ = s.book(b.ID)
	if saved.Collection != "" {
		t.Fatal("deleting collection should keep and unassign books")
	}
	request(t, h, "DELETE", "/api/v1/books/"+b.ID, "", 204)
	request(t, h, "GET", "/api/v1/books/"+b.ID, "", 404)
	if got := string(request(t, h, "GET", "/api/v1/annotations", "", 200)); strings.TrimSpace(got) != "[]" {
		t.Fatal("annotations not cascaded: " + got)
	}
}
func TestValidation(t *testing.T) {
	_, h := testServer(t, "")
	importTest(t, h, "fake.pdf", []byte("not a pdf"), 422)
	importTest(t, h, "fake.epub", []byte("not a zip"), 422)
	importTest(t, h, "script.html", []byte("<script/>"), 415)
	b := importTest(t, h, "test.pdf", []byte("%PDF-1.7\nfixture"), 201)
	for _, body := range []string{`{"title":""}`, `{"progress":1.1}`, `{"status":"other"}`, `{"collection":"missing"}`, `{"unknown":true}`} {
		request(t, h, "PATCH", "/api/v1/books/"+b.ID, body, 400)
	}
	request(t, h, "POST", "/api/v1/books/"+b.ID+"/annotations", `{"kind":"bad","anchor":{}}`, 400)
	request(t, h, "POST", "/api/v1/samples", "", 201)
	request(t, h, "POST", "/api/v1/samples", "", 201)
	var books []Book
	json.Unmarshal(request(t, h, "GET", "/api/v1/books", "", 200), &books)
	if len(books) != 7 {
		t.Fatalf("sample import should be idempotent, got %d books", len(books))
	}
}
func TestAuthAndOrigin(t *testing.T) {
	s, h := testServer(t, "a long test password")
	request(t, h, "GET", "/api/v1/books", "", 401)
	request(t, h, "POST", "/api/v1/session", `{"password":"wrong"}`, 401)
	req, _ := http.NewRequest("POST", h.URL+"/api/v1/session", strings.NewReader(`{"password":"a long test password"}`))
	res, e := h.Client().Do(req)
	if e != nil {
		t.Fatal(e)
	}
	res.Body.Close()
	cookies := res.Cookies()
	if res.StatusCode != 200 || len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatalf("login: %+v", res)
	}
	req, _ = http.NewRequest("GET", h.URL+"/api/v1/books", nil)
	req.AddCookie(cookies[0])
	res, e = h.Client().Do(req)
	if e != nil {
		t.Fatal(e)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatal("valid cookie rejected")
	}
	req, _ = http.NewRequest("POST", h.URL+"/api/v1/samples", nil)
	req.AddCookie(cookies[0])
	req.Header.Set("Origin", "https://evil.example")
	res, e = h.Client().Do(req)
	if e != nil {
		t.Fatal(e)
	}
	res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatal("cross-origin mutation accepted")
	}
	s.cfg.APIToken = "native-client-token"
	req, _ = http.NewRequest("GET", h.URL+"/api/v1/books", nil)
	req.Header.Set("Authorization", "Bearer native-client-token")
	res, e = h.Client().Do(req)
	if e != nil {
		t.Fatal(e)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatal("API token rejected")
	}
	if filepath.Base(s.cfg.DataDir) == "" {
		t.Fatal("missing data directory")
	}
}

package server

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func privateUpload(t *testing.T, c accountClient, name string, data []byte, extraOwner string) Book {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if extraOwner != "" {
		writer.WriteField("owner_id", extraOwner)
	}
	part, _ := writer.CreateFormFile("file", name)
	part.Write(data)
	writer.Close()
	req, _ := http.NewRequest("POST", c.url+"/api/v1/books", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	res, err := c.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode != 201 {
		t.Fatalf("private upload: %d %s", res.StatusCode, raw)
	}
	var book Book
	if err = json.Unmarshal(raw, &book); err != nil {
		t.Fatal(err)
	}
	return book
}
func TestPrivateLibraryEveryEndpointAndAccountDeletion(t *testing.T) {
	s, h := testServer(t, "")
	book := importTest(t, h, "owner.pdf", []byte("%PDF-1.7\nowner's original"), 201)
	request(t, h, "POST", "/api/v1/collections", `{"name":"Private"}`, 201)
	request(t, h, "PATCH", "/api/v1/books/"+book.ID, `{"collection":"Private","favorite":true,"progress":0.4,"location":"3"}`, 200)
	request(t, h, "PUT", "/api/v1/books/"+book.ID+"/ink/1", firstInk, 200)
	var note Annotation
	json.Unmarshal(request(t, h, "POST", "/api/v1/books/"+book.ID+"/annotations", `{"kind":"note","quote":"owner-only quotation","note":"owner's thought","anchor":{"page":1}}`, 201), &note)
	coverPath := filepath.Join(s.cfg.DataDir, "books", book.ID+".cover")
	os.WriteFile(coverPath, []byte("private-cover"), 0600)
	s.db.Exec("UPDATE books SET cover=1 WHERE id=?", book.ID)
	alice := accountBrowser(h)
	owner := createAccount(t, alice, "alice", false)
	otherUser := createAccount(t, alice, "bob", true)
	bob := accountBrowser(h)
	bob.login(t, "bob", "a secure test password")
	// Administrator status grants account management, never access to another library.
	for _, path := range []string{"/api/v1/books", "/api/v1/collections", "/api/v1/annotations", "/api/v1/annotations?bookId=" + book.ID} {
		if raw := strings.TrimSpace(string(bob.request(t, "GET", path, "", 200))); raw != "[]" {
			t.Fatalf("private list leaked: %s %s", path, raw)
		}
	}
	for _, path := range []string{"/api/v1/books/" + book.ID, "/api/v1/books/" + book.ID + "/file", "/api/v1/books/" + book.ID + "/file?download=1", "/api/v1/books/" + book.ID + "/cover", "/api/v1/books/" + book.ID + "/ink/1"} {
		bob.request(t, "GET", path, "", 404)
	}
	bob.request(t, "HEAD", "/api/v1/books/"+book.ID+"/file", "", 404)
	bob.request(t, "GET", "/api/v1/books/"+book.ID+"/file", "", 404, "Range", "bytes=0-3")
	bob.request(t, "PATCH", "/api/v1/books/"+book.ID, `{"progress":1,"title":"stolen"}`, 404)
	bob.request(t, "DELETE", "/api/v1/books/"+book.ID, "", 404)
	bob.request(t, "PUT", "/api/v1/books/"+book.ID+"/ink/1", firstInk, 404)
	bob.request(t, "POST", "/api/v1/books/"+book.ID+"/annotations", `{"kind":"bookmark","anchor":{"page":1}}`, 404)
	bob.request(t, "PATCH", "/api/v1/annotations/"+note.ID, `{"note":"changed"}`, 404)
	bob.request(t, "DELETE", "/api/v1/annotations/"+note.ID, "", 404)
	bob.request(t, "POST", "/api/v1/collections", `{"name":"Private"}`, 201)
	bob.request(t, "POST", "/api/v1/collections", `{"name":"Private"}`, 409)
	own := privateUpload(t, bob, "bob.pdf", []byte("%PDF-1.7\nbob's original"), owner.ID)
	alice.request(t, "GET", "/api/v1/books/"+own.ID, "", 404)
	alice.request(t, "POST", "/api/v1/collections", `{"name":"Owners-only"}`, 201)
	bob.request(t, "PATCH", "/api/v1/books/"+own.ID, `{"collection":"Owners-only"}`, 400)
	bob.request(t, "PATCH", "/api/v1/books/"+own.ID, `{"collection":"Private","location":"7","progress":0.8}`, 200)
	bob.request(t, "PATCH", "/api/v1/books/"+own.ID, `{"owner_id":"`+owner.ID+`"}`, 400)
	bob.request(t, "DELETE", "/api/v1/collections/Private", "", 204)
	var saved Book
	json.Unmarshal(alice.request(t, "GET", "/api/v1/books/"+book.ID, "", 200), &saved)
	if saved.Title != "owner" || saved.Collection != "Private" || saved.Location != "3" || saved.Progress != 0.4 || !saved.Favorite {
		t.Fatalf("other user modified owner state: %+v", saved)
	}
	if !bytes.Contains(alice.request(t, "GET", "/api/v1/annotations", "", 200), []byte("owner's thought")) {
		t.Fatal("other user changed private note")
	}
	if got := string(alice.request(t, "GET", "/api/v1/books/"+book.ID+"/file", "", 200)); got != "%PDF-1.7\nowner's original" {
		t.Fatal("owner's original changed")
	}
	if got := string(alice.request(t, "GET", "/api/v1/books/"+book.ID+"/cover", "", 200)); got != "private-cover" {
		t.Fatal("private cover lost")
	}
	bob.request(t, "PUT", "/api/v1/books/"+own.ID+"/ink/1", firstInk, 200)
	bob.request(t, "POST", "/api/v1/books/"+own.ID+"/annotations", `{"kind":"bookmark","anchor":{"page":1}}`, 201)
	bob.request(t, "PATCH", "/api/v1/me/preferences", `{"penWidth":8}`, 200)
	// The profile guard also protects creation endpoints after cross-tab switching.
	bob.request(t, "POST", "/api/v1/collections", `{"name":"stale-owner-collection"}`, 409, "X-Folio-Profile", owner.ID)
	bob.request(t, "DELETE", "/api/v1/session", "", 409, "X-Folio-Profile", owner.ID)
	bob.request(t, "GET", "/api/v1/books/"+own.ID, "", 200)
	alice.request(t, "DELETE", "/api/v1/users/"+otherUser.ID, "", 204)
	bob.request(t, "GET", "/api/v1/books", "", 401)
	if _, err := os.Stat(filepath.Join(s.cfg.DataDir, "books", own.ID+".pdf")); !os.IsNotExist(err) {
		t.Fatal("deleted user's original file remains")
	}
	for _, table := range []string{"books", "collections", "preferences"} {
		var n int
		column := "owner_id"
		if table == "preferences" {
			column = "user_id"
		}
		if err := s.db.QueryRow("SELECT count(*) FROM "+table+" WHERE "+column+"=?", otherUser.ID).Scan(&n); err != nil || n != 0 {
			t.Fatalf("deleted user still has %s: %d %v", table, n, err)
		}
	}
	for _, table := range []string{"annotations", "ink_pages"} {
		var n int
		s.db.QueryRow("SELECT count(*) FROM "+table+" WHERE book_id=?", own.ID).Scan(&n)
		if n != 0 {
			t.Fatal("deleted user's annotations remain")
		}
	}
	alice.request(t, "GET", "/api/v1/books/"+book.ID, "", 200)
}
func TestSamplesArePrivateAndAPITokenNeverMovesToAnotherUser(t *testing.T) {
	s, h := testServer(t, "")
	alice := accountBrowser(h)
	owner := createAccount(t, alice, "alice", false)
	createAccount(t, alice, "bob", true)
	bob := accountBrowser(h)
	bob.login(t, "bob", "a secure test password")
	var first, second []Book
	json.Unmarshal(alice.request(t, "POST", "/api/v1/samples", "", 201), &first)
	json.Unmarshal(bob.request(t, "POST", "/api/v1/samples", "", 201), &second)
	if len(first) != 6 || len(second) != 6 {
		t.Fatal("samples deduplicated across users")
	}
	for _, a := range first {
		for _, b := range second {
			if a.ID == b.ID {
				t.Fatal("sample objects are shared")
			}
		}
	}
	if got := string(bob.request(t, "POST", "/api/v1/samples", "", 201)); strings.TrimSpace(got) != "[]" {
		t.Fatal("samples not deduplicated within account")
	}
	s.cfg.APIToken = "private-owner-token"
	token := accountBrowser(h)
	token.request(t, "GET", "/api/v1/books/"+first[0].ID, "", 200, "Authorization", "Bearer private-owner-token")
	token.request(t, "GET", "/api/v1/books/"+second[0].ID, "", 404, "Authorization", "Bearer private-owner-token")
	bob.request(t, "DELETE", "/api/v1/users/"+owner.ID, "", 204)
	token.request(t, "GET", "/api/v1/books", "", 401, "Authorization", "Bearer private-owner-token")
	bob.request(t, "GET", "/api/v1/books/"+second[0].ID, "", 200)
}
func TestMigrationOfPrePrivacyDatabaseIsPrivateAndIdempotent(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "books"), 0700)
	db, err := sql.Open("sqlite", filepath.Join(dir, "folio.db"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE books(id TEXT PRIMARY KEY,title TEXT NOT NULL,author TEXT NOT NULL,format TEXT NOT NULL,size INTEGER NOT NULL,cover INTEGER NOT NULL,color TEXT NOT NULL,added_at TEXT NOT NULL,last_read TEXT,progress REAL NOT NULL,location TEXT NOT NULL,favorite INTEGER NOT NULL,status TEXT NOT NULL,collection TEXT NOT NULL,sample INTEGER NOT NULL);
 CREATE TABLE collections(name TEXT PRIMARY KEY);
 CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,admin INTEGER NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE annotations(id TEXT PRIMARY KEY,book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,kind TEXT NOT NULL,quote TEXT NOT NULL,note TEXT NOT NULL,color TEXT NOT NULL,anchor TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE ink_pages(book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,page INTEGER NOT NULL,revision INTEGER NOT NULL,strokes TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(book_id,page));
 INSERT INTO books VALUES('legacy-book','Original title','Author','PDF',24,1,'sage','2026-01-01',NULL,0.4,'3',1,'reading','Private',0);
 INSERT INTO collections VALUES('Private');
 INSERT INTO annotations VALUES('legacy-note','legacy-book','note','private quote','private note','yellow','{"page":1}','2026-01-01');`)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := hashPassword("migration-password")
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range []struct{ id, name, created string }{{"owner-id", "owner", "2026-01-01"}, {"other-id", "other", "2026-02-01"}} {
		if _, err = db.Exec("INSERT INTO users VALUES(?,?,?,1,?)", u.id, u.name, hash, u.created); err != nil {
			t.Fatal(err)
		}
	}
	var ink struct{ Strokes []InkStroke }
	json.Unmarshal([]byte(firstInk), &ink)
	strokes, _ := json.Marshal(ink.Strokes)
	if _, err = db.Exec("INSERT INTO ink_pages VALUES('legacy-book',1,7,?,'2026-01-01')", string(strokes)); err != nil {
		t.Fatal(err)
	}
	db.Close()
	original := []byte("%PDF-1.7\nlegacy original")
	os.WriteFile(filepath.Join(dir, "books", "legacy-book.pdf"), original, 0600)
	os.WriteFile(filepath.Join(dir, "books", "legacy-book.cover"), []byte("cover-original"), 0600)
	cfg := Config{DataDir: dir, WebDir: t.TempDir()}
	for attempt := 0; attempt < 2; attempt++ {
		s, err := New(cfg)
		if err != nil {
			t.Fatal(err)
		}
		h := httptest.NewServer(s.Handler())
		owner, other := accountBrowser(h), accountBrowser(h)
		owner.login(t, "owner", "migration-password")
		other.login(t, "other", "migration-password")
		var books []Book
		json.Unmarshal(owner.request(t, "GET", "/api/v1/books", "", 200), &books)
		if len(books) != 1 || books[0].Location != "3" || books[0].Collection != "Private" || !books[0].Favorite {
			t.Fatal("migration lost reading state")
		}
		var page InkPage
		json.Unmarshal(owner.request(t, "GET", "/api/v1/books/legacy-book/ink/1", "", 200), &page)
		if page.Revision != 7 || len(page.Strokes) != 1 {
			t.Fatal("migration lost handwriting")
		}
		if !bytes.Equal(owner.request(t, "GET", "/api/v1/books/legacy-book/file", "", 200), original) {
			t.Fatal("migration altered original")
		}
		if string(owner.request(t, "GET", "/api/v1/books/legacy-book/cover", "", 200)) != "cover-original" {
			t.Fatal("migration lost cover")
		}
		for _, resource := range []string{"books", "collections", "annotations"} {
			if strings.TrimSpace(string(other.request(t, "GET", "/api/v1/"+resource, "", 200))) != "[]" {
				t.Fatal("migration shared owner's content")
			}
		}
		other.request(t, "GET", "/api/v1/books/legacy-book", "", 404)
		h.Close()
		s.Close()
	}
}

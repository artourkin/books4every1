package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

const firstInk = `{"revision":0,"strokes":[{"id":"stroke-1","tool":"pen","color":"#394137","width":0.005,"points":[{"x":0.1,"y":0.2,"pressure":0.35},{"x":0.8,"y":0.6,"pressure":0.9}]}]}`

func TestInkPersistenceRevisionAndCascade(t *testing.T) {
	s, h := testServer(t, "")
	book := importTest(t, h, "drawing.pdf", []byte("%PDF-1.7\nfixture"), 201)
	path := "/api/v1/books/" + book.ID + "/ink/1"
	var blank InkPage
	json.Unmarshal(request(t, h, "GET", path, "", 200), &blank)
	if blank.Page != 1 || blank.Revision != 0 || blank.Strokes == nil {
		t.Fatalf("blank page: %+v", blank)
	}
	var saved InkPage
	json.Unmarshal(request(t, h, "PUT", path, firstInk, 200), &saved)
	if saved.Revision != 1 || len(saved.Strokes) != 1 || saved.Strokes[0].Points[1].Pressure != .9 {
		t.Fatalf("saved ink: %+v", saved)
	}
	request(t, h, "PUT", path, firstInk, 409)
	// Opening the same persistent directory with a fresh server simulates a restart.
	reopened, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	req, _ := http.NewRequest("GET", path, nil)
	rec := httptest.NewRecorder()
	reopened.Handler().ServeHTTP(rec, req)
	var persisted InkPage
	json.Unmarshal(rec.Body.Bytes(), &persisted)
	if persisted.Revision != 1 || len(persisted.Strokes) != 1 {
		t.Fatalf("persisted: %+v", persisted)
	}
	request(t, h, "PUT", path, `{"revision":1,"strokes":[]}`, 200)
	request(t, h, "PUT", path, strings.Replace(firstInk, `"revision":0`, `"revision":1`, 1), 409)
	var cleared InkPage
	json.Unmarshal(request(t, h, "GET", path, "", 200), &cleared)
	if cleared.Revision != 2 || len(cleared.Strokes) != 0 {
		t.Fatalf("clear retained revision: %+v", cleared)
	}
	// Ink must not appear as empty text notes, nor change original PDF bytes.
	if got := strings.TrimSpace(string(request(t, h, "GET", "/api/v1/annotations", "", 200))); got != "[]" {
		t.Fatal(got)
	}
	if got := string(request(t, h, "GET", "/api/v1/books/"+book.ID+"/file", "", 200)); got != "%PDF-1.7\nfixture" {
		t.Fatal("Original PDF changed")
	}
	request(t, h, "DELETE", "/api/v1/books/"+book.ID, "", 204)
	var count int
	s.db.QueryRow("SELECT count(*) FROM ink_pages WHERE book_id=?", book.ID).Scan(&count)
	if count != 0 {
		t.Fatal("Ink not deleted with book")
	}
}
func TestInkValidationAndIsolation(t *testing.T) {
	_, h := testServer(t, "")
	pdf := importTest(t, h, "drawing.pdf", []byte("%PDF-1.7\nfixture"), 201)
	epub := importTest(t, h, "book.epub", sampleEPUB(sampleBooks[0]), 201)
	path := "/api/v1/books/" + pdf.ID + "/ink/1"
	invalid := []string{`{"revision":-1,"strokes":[]}`, `{"revision":0,"strokes":null}`, strings.Replace(firstInk, `"x":0.1`, `"x":1.1`, 1), strings.Replace(firstInk, `"pressure":0.9`, `"pressure":-1`, 1), strings.Replace(firstInk, `"width":0.005`, `"width":0`, 1), strings.Replace(firstInk, `"tool":"pen"`, `"tool":"script"`, 1), strings.Replace(firstInk, `"#394137"`, `"url(evil)"`, 1), strings.Replace(firstInk, `"stroke-1"`, `"../bad"`, 1)}
	for _, body := range invalid {
		request(t, h, "PUT", path, body, 400)
	}
	request(t, h, "GET", "/api/v1/books/"+epub.ID+"/ink/1", "", 400)
	request(t, h, "GET", "/api/v1/books/"+pdf.ID+"/ink/0", "", 400)
	request(t, h, "GET", "/api/v1/books/missing/ink/1", "", 404)
	request(t, h, "PUT", path, firstInk, 200)
	var second InkPage
	json.Unmarshal(request(t, h, "GET", "/api/v1/books/"+pdf.ID+"/ink/2", "", 200), &second)
	if second.Revision != 0 || len(second.Strokes) != 0 {
		t.Fatal("Ink leaked to another page")
	}
	other := importTest(t, h, "other.pdf", []byte("%PDF-1.7\nother"), 201)
	request(t, h, "PUT", "/api/v1/books/"+other.ID+"/ink/1", firstInk, 200)
	var data struct {
		Strokes []InkStroke `json:"strokes"`
	}
	json.Unmarshal([]byte(firstInk), &data)
	data.Strokes = append(data.Strokes, data.Strokes[0])
	if validateInk(data.Strokes) {
		t.Fatal("duplicate stroke IDs accepted")
	}
	data.Strokes = data.Strokes[:1]
	data.Strokes[0].Points = make([]InkPoint, 10001)
	if validateInk(data.Strokes) {
		t.Fatal("oversized stroke accepted")
	}
}
func TestInkConcurrentWriters(t *testing.T) {
	_, h := testServer(t, "")
	book := importTest(t, h, "drawing.pdf", []byte("%PDF-1.7\nfixture"), 201)
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req, _ := http.NewRequest("PUT", h.URL+"/api/v1/books/"+book.ID+"/ink/1", bytes.NewBufferString(firstInk))
			res, err := h.Client().Do(req)
			if err != nil {
				codes <- 0
				return
			}
			io.Copy(io.Discard, res.Body)
			res.Body.Close()
			codes <- res.StatusCode
		}()
	}
	wg.Wait()
	close(codes)
	counts := map[int]int{}
	for code := range codes {
		counts[code]++
	}
	if counts[200] != 1 || counts[409] != 1 {
		t.Fatalf("concurrent status codes: %+v", counts)
	}
}

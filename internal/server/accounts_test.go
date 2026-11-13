package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
)

type accountClient struct {
	client *http.Client
	url    string
}

func accountBrowser(h *httptest.Server) accountClient {
	jar, _ := cookiejar.New(nil)
	return accountClient{&http.Client{Transport: h.Client().Transport, Jar: jar}, h.URL}
}
func (c accountClient) request(t *testing.T, method, path, body string, status int, headers ...string) []byte {
	t.Helper()
	req, _ := http.NewRequest(method, c.url+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	res, err := c.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	if res.StatusCode != status {
		t.Fatalf("%s %s got %d want %d: %s", method, path, res.StatusCode, status, data)
	}
	return data
}
func createAccount(t *testing.T, c accountClient, name string, admin bool) User {
	t.Helper()
	data, _ := json.Marshal(map[string]any{"username": name, "password": "a secure test password", "admin": admin})
	var user User
	json.Unmarshal(c.request(t, "POST", "/api/v1/users", string(data), 201), &user)
	return user
}
func (c accountClient) login(t *testing.T, name, password string) Session {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"username": name, "password": password})
	var s Session
	json.Unmarshal(c.request(t, "POST", "/api/v1/session", string(body), 200), &s)
	return s
}
func TestAccountsUpgradePreferencesAndIsolation(t *testing.T) {
	s, h := testServer(t, "")
	book := importTest(t, h, "existing.pdf", []byte("%PDF-1.7\nexisting"), 201)
	request(t, h, "PUT", "/api/v1/books/"+book.ID+"/ink/1", firstInk, 200)
	owner := accountBrowser(h)
	owner.request(t, "PATCH", "/api/v1/me/preferences", `{"penWidth":5,"theme":"night","fontSize":120}`, 200)
	s.cfg.Password = "upgrade-password"
	anonymous := accountBrowser(h)
	anonymous.request(t, "POST", "/api/v1/users", `{"username":"owner","password":"a secure test password"}`, 401)
	owner.login(t, "", "upgrade-password")
	oldCookie := owner.client.Jar.Cookies(mustURL(t, h.URL))[0]
	u := createAccount(t, owner, "Owner", false)
	if !u.Admin || u.Username != "owner" {
		t.Fatalf("owner: %+v", u)
	}
	var session Session
	json.Unmarshal(owner.request(t, "GET", "/api/v1/session", "", 200), &session)
	if !session.Authenticated || !session.AccountsEnabled || session.User == nil || session.Preferences.PenWidth != 5 || session.Preferences.Theme != "night" {
		t.Fatalf("owner session: %+v", session)
	}
	legacy := accountBrowser(h)
	legacy.client.Jar.SetCookies(mustURL(t, h.URL), []*http.Cookie{oldCookie})
	legacy.request(t, "GET", "/api/v1/books", "", 401)
	var stored string
	s.db.QueryRow("SELECT password_hash FROM users WHERE id=?", u.ID).Scan(&stored)
	if strings.Contains(stored, "a secure test password") || !verifyPassword(stored, "a secure test password") {
		t.Fatal("password hash not valid")
	}
	cookie := owner.client.Jar.Cookies(mustURL(t, h.URL))[0]
	s.db.QueryRow("SELECT token_hash FROM sessions WHERE user_id=?", u.ID).Scan(&stored)
	if stored == cookie.Value || len(stored) != 64 {
		t.Fatal("session secret stored in plaintext")
	}
	bob := createAccount(t, owner, "bob", false)
	other := accountBrowser(h)
	otherSession := other.login(t, "bob", "a secure test password")
	if otherSession.Preferences.PenWidth != 3 {
		t.Fatal("another user's preferences leaked")
	}
	other.request(t, "PATCH", "/api/v1/me/preferences", `{"penWidth":8,"markerWidth":30,"inkColor":"#466caa","drawWithTouch":true,"inkTool":"highlighter","inkBrush":"highlighter"}`, 200)
	var prefs Preferences
	json.Unmarshal(owner.request(t, "GET", "/api/v1/me/preferences", "", 200), &prefs)
	if prefs.PenWidth != 5 || prefs.DrawWithTouch {
		t.Fatalf("preferences not isolated: %+v", prefs)
	}
	other.request(t, "PATCH", "/api/v1/me/preferences", `{"penWidth":3}`, 409, "X-Folio-Profile", u.ID)
	for _, path := range []string{"/api/v1/users", "/api/v1/me/preferences"} {
		anonymous.request(t, "GET", path, "", 401)
	}
	other.request(t, "GET", "/api/v1/users", "", 403)
	other.request(t, "POST", "/api/v1/users", `{"username":"evil","password":"a long password","admin":true}`, 403)
	other.request(t, "DELETE", "/api/v1/users/"+u.ID, "", 403)
	// Library and existing handwriting remain shared and unchanged by account setup.
	if !bytes.Contains(other.request(t, "GET", "/api/v1/books", "", 200), []byte(book.ID)) {
		t.Fatal("existing library lost")
	}
	var ink InkPage
	json.Unmarshal(other.request(t, "GET", "/api/v1/books/"+book.ID+"/ink/1", "", 200), &ink)
	if ink.Revision != 1 || len(ink.Strokes) != 1 {
		t.Fatal("existing ink lost")
	}
	owner.request(t, "DELETE", "/api/v1/users/"+u.ID, "", 400)
	owner.request(t, "DELETE", "/api/v1/users/"+bob.ID, "", 204)
	other.request(t, "GET", "/api/v1/me/preferences", "", 401)
	var count int
	s.db.QueryRow("SELECT count(*) FROM preferences WHERE user_id=?", bob.ID).Scan(&count)
	if count != 0 {
		t.Fatal("deleted user's preferences remain")
	}
	if got := string(owner.request(t, "GET", "/api/v1/books/"+book.ID+"/file", "", 200)); got != "%PDF-1.7\nexisting" {
		t.Fatal("original book changed")
	}
	reopened, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	fresh := httptest.NewServer(reopened.Handler())
	defer fresh.Close()
	afterRestart := accountBrowser(fresh).login(t, "owner", "a secure test password")
	if afterRestart.Preferences.PenWidth != 5 || afterRestart.Preferences.FontSize != 120 {
		t.Fatal("preferences did not survive server restart")
	}
}
func TestPasswordChangesSessionRevocationAndRecovery(t *testing.T) {
	s, h := testServer(t, "")
	owner := accountBrowser(h)
	u := createAccount(t, owner, "owner", false)
	second := accountBrowser(h)
	second.login(t, "owner", "a secure test password")
	owner.request(t, "POST", "/api/v1/me/password", `{"currentPassword":"wrong","password":"new secure password"}`, 401)
	owner.request(t, "POST", "/api/v1/me/password", `{"currentPassword":"a secure test password","password":"new secure password"}`, 204)
	second.request(t, "GET", "/api/v1/books", "", 401)
	owner.request(t, "GET", "/api/v1/books", "", 200)
	cookie := owner.client.Jar.Cookies(mustURL(t, h.URL))[0]
	owner.request(t, "DELETE", "/api/v1/session", "", 204)
	owner.client.Jar.SetCookies(mustURL(t, h.URL), []*http.Cookie{cookie})
	owner.request(t, "GET", "/api/v1/books", "", 401)
	third := accountBrowser(h)
	third.login(t, "owner", "new secure password")
	var oldHash string
	s.db.QueryRow("SELECT password_hash FROM users WHERE id=?", u.ID).Scan(&oldHash)
	if err := s.ResetPassword("owner", "recovered owner password"); err != nil {
		t.Fatal(err)
	}
	if err := s.newSession(httptest.NewRecorder(), u.ID, oldHash); !errors.Is(err, errCredentialsChanged) {
		t.Fatalf("stale password verification created a session: %v", err)
	}
	if _, err := s.resetPassword("owner", "stale password change", oldHash); !errors.Is(err, errCredentialsChanged) {
		t.Fatalf("stale password change replaced newer credentials: %v", err)
	}
	third.request(t, "GET", "/api/v1/books", "", 401)
	third.login(t, "owner", "recovered owner password")
	s.db.Exec("UPDATE sessions SET expires_at=0 WHERE user_id=?", u.ID)
	third.request(t, "GET", "/api/v1/books", "", 401)
}
func TestPreferencesValidationAtomicPatchAndAdminReset(t *testing.T) {
	s, h := testServer(t, "")
	owner := accountBrowser(h)
	createAccount(t, owner, "owner", false)
	for _, body := range []string{`null`, `{"userId":"someone"}`, `{"penWidth":99}`, `{"markerWidth":1}`, `{"fontSize":181}`, `{"theme":"script"}`, `{"inkColor":"url(evil)"}`, `{"drawWithTouch":"true"}`, `{"penWidth":null}`, `{"inkTool":"script"}`, `{"libraryLayout":"invalid"}`} {
		owner.request(t, "PATCH", "/api/v1/me/preferences", body, 400)
	}
	var wg sync.WaitGroup
	statuses := make(chan int, 2)
	for _, body := range []string{`{"penWidth":8}`, `{"fontSize":150,"theme":"night"}`} {
		wg.Add(1)
		go func(body string) {
			defer wg.Done()
			req, _ := http.NewRequest("PATCH", owner.url+"/api/v1/me/preferences", strings.NewReader(body))
			res, e := owner.client.Do(req)
			if e != nil {
				statuses <- 0
				return
			}
			io.Copy(io.Discard, res.Body)
			res.Body.Close()
			statuses <- res.StatusCode
		}(body)
	}
	wg.Wait()
	close(statuses)
	for code := range statuses {
		if code != 200 {
			t.Fatalf("concurrent preferences patch: %d", code)
		}
	}
	var prefs Preferences
	json.Unmarshal(owner.request(t, "GET", "/api/v1/me/preferences", "", 200), &prefs)
	if prefs.PenWidth != 8 || prefs.FontSize != 150 || prefs.Theme != "night" {
		t.Fatalf("patch lost changes: %+v", prefs)
	}
	bob := createAccount(t, owner, "bob", false)
	browser := accountBrowser(h)
	browser.login(t, "bob", "a secure test password")
	owner.request(t, "POST", "/api/v1/users/"+bob.ID+"/password", `{"password":"reset password for bob"}`, 204)
	browser.request(t, "GET", "/api/v1/books", "", 401)
	browser.login(t, "bob", "reset password for bob")
	s.cfg.APIToken = "test-owner-api-token"
	anonymous := accountBrowser(h)
	anonymous.request(t, "GET", "/api/v1/users", "", 200, "Authorization", "Bearer test-owner-api-token")
}

func mustURL(t *testing.T, value string) *url.URL {
	t.Helper()
	u, err := url.Parse(value)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

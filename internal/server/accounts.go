package server

import (
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const legacyProfile = "legacy"
const passwordIterations = 600000

var errCredentialsChanged = errors.New("Account credentials changed. Sign in again.")

var usernamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_.-]{2,31}$`)

type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Admin    bool   `json:"admin"`
}
type Session struct {
	Authenticated    bool         `json:"authenticated"`
	PasswordRequired bool         `json:"passwordRequired"`
	AccountsEnabled  bool         `json:"accountsEnabled"`
	User             *User        `json:"user"`
	ProfileID        string       `json:"profileId,omitempty"`
	Preferences      *Preferences `json:"preferences,omitempty"`
}

func (s *Server) accountsEnabled() (bool, error) {
	var n int
	err := s.db.QueryRow("SELECT count(*) FROM users").Scan(&n)
	return n > 0, err
}
func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
func (s *Server) identity(r *http.Request) (User, bool) {
	if u, ok := r.Context().Value(principalKey{}).(User); ok {
		return u, true
	}
	enabled, err := s.accountsEnabled()
	if err != nil {
		return User{}, false
	}
	if s.cfg.APIToken != "" && subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+s.cfg.APIToken)) == 1 {
		if !enabled {
			return User{ID: legacyProfile, Admin: true}, true
		}
		var u User
		err = s.db.QueryRow("SELECT id,username,admin FROM users WHERE id=(SELECT value FROM app_metadata WHERE key='original_owner')").Scan(&u.ID, &u.Username, &u.Admin)
		return u, err == nil
	}
	if !enabled {
		if s.cfg.Password == "" {
			return User{ID: legacyProfile, Admin: true}, true
		}
		c, e := r.Cookie("folio_session")
		if e != nil {
			return User{}, false
		}
		parts := strings.Split(c.Value, ".")
		if len(parts) != 2 {
			return User{}, false
		}
		expires, e := strconv.ParseInt(parts[0], 10, 64)
		ok := e == nil && expires > time.Now().Unix() && hmac.Equal([]byte(parts[1]), []byte(s.signature(parts[0])))
		return User{ID: legacyProfile, Admin: true}, ok
	}
	c, e := r.Cookie("folio_session")
	if e != nil || len(c.Value) != 64 {
		return User{}, false
	}
	var u User
	err = s.db.QueryRow(`SELECT u.id,u.username,u.admin FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`, tokenHash(c.Value), time.Now().Unix()).Scan(&u.ID, &u.Username, &u.Admin)
	return u, err == nil
}
func (s *Server) authorized(r *http.Request) bool { _, ok := s.identity(r); return ok }
func (s *Server) signature(v string) string {
	h := hmac.New(sha256.New, []byte(s.cfg.Password))
	h.Write([]byte("folio-session:" + v))
	return hex.EncodeToString(h.Sum(nil))
}
func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	enabled, err := s.accountsEnabled()
	if err != nil {
		fail(w, 500, "Could not load accounts")
		return
	}
	u, ok := s.identity(r)
	result := Session{Authenticated: ok, PasswordRequired: s.cfg.Password != "" || enabled, AccountsEnabled: enabled}
	if ok {
		prefs, err := s.preferences(u.ID)
		if err != nil {
			fail(w, 500, "Could not load preferences")
			return
		}
		result.ProfileID = u.ID
		result.Preferences = &prefs
		if u.ID != legacyProfile {
			result.User = &u
		}
	}
	respond(w, 200, result)
}
func (s *Server) cookie(w http.ResponseWriter, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: "folio_session", Value: value, Path: "/", MaxAge: maxAge, HttpOnly: true, Secure: s.cfg.SecureCookie, SameSite: http.SameSiteStrictMode})
}
func (s *Server) newSession(w http.ResponseWriter, userID, passwordHash string) error {
	token := make([]byte, 32)
	if _, err := rand.Read(token); err != nil {
		return err
	}
	value := hex.EncodeToString(token)
	// A password reset between verification and insertion must not resurrect a session.
	result, err := s.db.Exec("INSERT INTO sessions(token_hash,user_id,expires_at) SELECT ?,id,? FROM users WHERE id=? AND password_hash=?", tokenHash(value), time.Now().Add(30*24*time.Hour).Unix(), userID, passwordHash)
	if err != nil {
		return err
	}
	if count, err := result.RowsAffected(); err != nil {
		return err
	} else if count != 1 {
		return errCredentialsChanged
	}
	s.db.Exec("DELETE FROM sessions WHERE expires_at<=?", time.Now().Unix())
	s.cookie(w, value, 30*24*3600)
	return nil
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if expected := r.Header.Get("X-Folio-Profile"); expected != "" {
		if user, ok := s.identity(r); ok && user.ID != expected {
			fail(w, 409, "The account changed in another tab. Reload to continue.")
			return
		}
	}
	if c, e := r.Cookie("folio_session"); e == nil {
		if _, err := s.db.Exec("DELETE FROM sessions WHERE token_hash=?", tokenHash(c.Value)); err != nil {
			fail(w, 500, "Could not sign out")
			return
		}
	}
	s.cookie(w, "", -1)
	w.WriteHeader(204)
}
func (s *Server) limitSignIn(w http.ResponseWriter) bool {
	select {
	case s.attempts <- struct{}{}:
		time.AfterFunc(time.Second, func() { <-s.attempts })
		return true
	default:
		fail(w, 429, "Too many sign-in attempts. Try again shortly.")
		return false
	}
}
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if !s.limitSignIn(w) {
		return
	}
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decodeSized(w, r, &body, 4096) {
		return
	}
	enabled, err := s.accountsEnabled()
	if err != nil {
		fail(w, 500, "Could not load accounts")
		return
	}
	if enabled {
		if len(body.Password) > 128 || len(body.Username) > 32 {
			fail(w, 401, "Username or password is incorrect")
			return
		}
		var userID, hash string
		err = s.db.QueryRow("SELECT id,password_hash FROM users WHERE username=?", strings.ToLower(strings.TrimSpace(body.Username))).Scan(&userID, &hash)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			fail(w, 500, "Could not sign in")
			return
		}
		if hash == "" {
			hash = "pbkdf2-sha256$600000$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000"
		}
		if !verifyPassword(hash, body.Password) || userID == "" {
			fail(w, 401, "Username or password is incorrect")
			return
		}
		if err := s.newSession(w, userID, hash); err != nil {
			if errors.Is(err, errCredentialsChanged) {
				fail(w, 401, err.Error())
				return
			}
			fail(w, 500, "Could not create session")
			return
		}
	} else {
		a, b := sha256.Sum256([]byte(body.Password)), sha256.Sum256([]byte(s.cfg.Password))
		if subtle.ConstantTimeCompare(a[:], b[:]) != 1 {
			fail(w, 401, "That password isn't right")
			return
		}
		exp := strconv.FormatInt(time.Now().Add(30*24*time.Hour).Unix(), 10)
		s.cookie(w, exp+"."+s.signature(exp), 30*24*3600)
	}
	// Use the same response shape as GET /session, with the newly issued cookie.
	cookies := (&http.Response{Header: w.Header()}).Cookies()
	if len(cookies) > 0 {
		r.Header.Del("Cookie")
		r.AddCookie(cookies[len(cookies)-1])
	}
	s.session(w, r)
}
func hashPassword(password string) (string, error) {
	if len(password) < 8 || len(password) > 128 {
		return "", errors.New("Use a password of 8–128 bytes")
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key, err := pbkdf2.Key(sha256.New, password, salt, passwordIterations, 32)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("pbkdf2-sha256$%d$%x$%x", passwordIterations, salt, key), nil
}
func verifyPassword(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return false
	}
	iterations, e := strconv.Atoi(parts[1])
	if e != nil || iterations < 100000 || iterations > 1000000 {
		return false
	}
	salt, e := hex.DecodeString(parts[2])
	if e != nil || len(salt) != 16 {
		return false
	}
	want, e := hex.DecodeString(parts[3])
	if e != nil || len(want) != 32 {
		return false
	}
	key, e := pbkdf2.Key(sha256.New, password, salt, iterations, 32)
	return e == nil && subtle.ConstantTimeCompare(key, want) == 1
}
func (s *Server) admin(w http.ResponseWriter, r *http.Request) (User, bool) {
	u, ok := s.identity(r)
	if !ok || !u.Admin {
		fail(w, 403, "Only an administrator can manage accounts")
		return u, false
	}
	return u, true
}
func (s *Server) users(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.admin(w, r); !ok {
		return
	}
	rows, err := s.db.Query("SELECT id,username,admin FROM users ORDER BY username")
	if err != nil {
		fail(w, 500, "Could not load accounts")
		return
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.Admin); err != nil {
			fail(w, 500, "Could not load account")
			return
		}
		out = append(out, u)
	}
	if rows.Err() != nil {
		fail(w, 500, "Could not load accounts")
		return
	}
	respond(w, 200, out)
}
func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.admin(w, r)
	if !ok {
		return
	}
	if !s.limitSignIn(w) {
		return
	}
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Admin    bool   `json:"admin"`
	}
	if !decodeSized(w, r, &body, 4096) {
		return
	}
	body.Username = strings.ToLower(strings.TrimSpace(body.Username))
	if !usernamePattern.MatchString(body.Username) {
		fail(w, 400, "Use 3–32 letters, numbers, dots, dashes, or underscores for the username")
		return
	}
	hash, err := hashPassword(body.Password)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		fail(w, 500, "Could not create account")
		return
	}
	defer tx.Rollback()
	var count int
	if err = tx.QueryRow("SELECT count(*) FROM users").Scan(&count); err != nil {
		fail(w, 500, "Could not create account")
		return
	}
	if actor.ID == legacyProfile && count != 0 {
		fail(w, 409, "An owner account already exists. Sign in to continue.")
		return
	}
	var taken int
	if err = tx.QueryRow("SELECT count(*) FROM users WHERE username=?", body.Username).Scan(&taken); err != nil {
		fail(w, 500, "Could not create account")
		return
	}
	if taken > 0 {
		fail(w, 409, "That username is already in use")
		return
	}
	u := User{ID: id(), Username: body.Username, Admin: count == 0 || body.Admin}
	if _, err = tx.Exec("INSERT INTO users(id,username,password_hash,admin,created_at) VALUES(?,?,?,?,?)", u.ID, u.Username, hash, u.Admin, now()); err == nil && count == 0 {
		_, err = tx.Exec("INSERT INTO preferences(user_id,data) SELECT ?,data FROM preferences WHERE user_id=?", u.ID, legacyProfile)
	}
	if err == nil && count == 0 {
		err = claimLegacyLibrary(tx, u.ID)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		fail(w, 500, "Could not create account")
		return
	}
	if count == 0 {
		if err := s.newSession(w, u.ID, hash); err != nil {
			fail(w, 500, "Account created. Sign in with your new username and password.")
			return
		}
	}
	respond(w, 201, u)
}
func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	u, ok := s.identity(r)
	if !ok || u.ID == legacyProfile {
		fail(w, 401, "Sign in with an account first")
		return
	}
	if !s.limitSignIn(w) {
		return
	}
	var body struct {
		CurrentPassword string `json:"currentPassword"`
		Password        string `json:"password"`
	}
	if !decodeSized(w, r, &body, 4096) {
		return
	}
	var hash string
	if err := s.db.QueryRow("SELECT password_hash FROM users WHERE id=?", u.ID).Scan(&hash); err != nil {
		fail(w, 500, "Could not load account")
		return
	}
	if len(body.CurrentPassword) > 128 || !verifyPassword(hash, body.CurrentPassword) {
		fail(w, 401, "Current password is incorrect")
		return
	}
	newHash, err := s.resetPassword(u.Username, body.Password, hash)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	if err := s.newSession(w, u.ID, newHash); err != nil {
		fail(w, 500, "Password changed. Sign in again.")
		return
	}
	w.WriteHeader(204)
}
func (s *Server) resetUserPassword(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.admin(w, r)
	if !ok {
		return
	}
	if actor.ID == r.PathValue("user") {
		fail(w, 400, "Change your own password using your account settings")
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if !decodeSized(w, r, &body, 4096) {
		return
	}
	var name string
	if err := s.db.QueryRow("SELECT username FROM users WHERE id=?", r.PathValue("user")).Scan(&name); err != nil {
		fail(w, 404, "Account not found")
		return
	}
	if err := s.ResetPassword(name, body.Password); err != nil {
		fail(w, 400, err.Error())
		return
	}
	w.WriteHeader(204)
}

// ResetPassword is also used by the local CLI for owner recovery. Existing sessions are revoked.
func (s *Server) ResetPassword(username, password string) error {
	_, err := s.resetPassword(username, password, "")
	return err
}
func (s *Server) resetPassword(username, password, expectedHash string) (string, error) {
	hash, err := hashPassword(password)
	if err != nil {
		return "", err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	var userID string
	if err = tx.QueryRow("SELECT id FROM users WHERE username=?", strings.ToLower(username)).Scan(&userID); err != nil {
		return "", errors.New("Account not found")
	}
	result, err := tx.Exec("UPDATE users SET password_hash=? WHERE id=? AND (?='' OR password_hash=?)", hash, userID, expectedHash, expectedHash)
	if err != nil {
		return "", err
	}
	if count, err := result.RowsAffected(); err != nil {
		return "", err
	} else if count != 1 {
		return "", errCredentialsChanged
	}
	_, err = tx.Exec("DELETE FROM sessions WHERE user_id=?", userID)
	if err != nil {
		return "", err
	}
	return hash, tx.Commit()
}
func (s *Server) deleteUser(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.admin(w, r)
	if !ok {
		return
	}
	target := r.PathValue("user")
	if target == actor.ID {
		fail(w, 400, "You cannot delete your own account")
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		fail(w, 500, "Could not delete account")
		return
	}
	defer tx.Rollback()
	var admin bool
	if err = tx.QueryRow("SELECT admin FROM users WHERE id=?", target).Scan(&admin); err != nil {
		fail(w, 404, "Account not found")
		return
	}
	var count int
	if admin {
		if err = tx.QueryRow("SELECT count(*) FROM users WHERE admin=1").Scan(&count); err != nil || count <= 1 {
			fail(w, 409, "Keep at least one administrator account")
			return
		}
	}
	rows, err := tx.Query("SELECT id,format FROM books WHERE owner_id=?", target)
	if err != nil {
		fail(w, 500, "Could not delete library")
		return
	}
	var removed []Book
	for rows.Next() {
		var book Book
		if err = rows.Scan(&book.ID, &book.Format); err != nil {
			rows.Close()
			fail(w, 500, "Could not delete library")
			return
		}
		removed = append(removed, book)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		fail(w, 500, "Could not delete library")
		return
	}
	if _, err = tx.Exec("DELETE FROM books WHERE owner_id=?", target); err == nil {
		_, err = tx.Exec("DELETE FROM collections WHERE owner_id=?", target)
	}
	if err != nil {
		fail(w, 500, "Could not delete library")
		return
	}
	if _, err = tx.Exec("DELETE FROM preferences WHERE user_id=?", target); err == nil {
		_, err = tx.Exec("DELETE FROM users WHERE id=?", target)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		fail(w, 500, "Could not delete account")
		return
	}
	for _, book := range removed {
		s.removeBookFiles(book)
	}
	w.WriteHeader(204)
}

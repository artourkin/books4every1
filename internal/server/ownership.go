package server

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type principalKey struct{}

func principal(r *http.Request) User { u, _ := r.Context().Value(principalKey{}).(User); return u }
func withPrincipal(r *http.Request, u User) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), principalKey{}, u))
}

// Older installations had a single library. Assign it once to the original
// owner; never make it visible to every account or reassign it on later starts.
func (s *Server) migrateLibraries() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("CREATE TABLE IF NOT EXISTS app_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)"); err != nil {
		return err
	}
	var found int
	if err = tx.QueryRow("SELECT count(*) FROM pragma_table_info('books') WHERE name='owner_id'").Scan(&found); err != nil {
		return err
	}
	if found == 0 {
		if _, err = tx.Exec("ALTER TABLE books ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'legacy'"); err != nil {
			return err
		}
	}
	if err = tx.QueryRow("SELECT count(*) FROM pragma_table_info('collections') WHERE name='owner_id'").Scan(&found); err != nil {
		return err
	}
	if found == 0 {
		if _, err = tx.Exec(`ALTER TABLE collections RENAME TO legacy_collections;
   CREATE TABLE collections(owner_id TEXT NOT NULL,name TEXT NOT NULL,PRIMARY KEY(owner_id,name));
   INSERT INTO collections(owner_id,name) SELECT 'legacy',name FROM legacy_collections;
   DROP TABLE legacy_collections;`); err != nil {
			return err
		}
	}
	if _, err = tx.Exec("CREATE INDEX IF NOT EXISTS book_owner ON books(owner_id)"); err != nil {
		return err
	}
	var owner string
	err = tx.QueryRow("SELECT value FROM app_metadata WHERE key='original_owner'").Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) {
		err = tx.QueryRow("SELECT id FROM users WHERE admin=1 ORDER BY created_at,id LIMIT 1").Scan(&owner)
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if owner != "" {
		if err = claimLegacyLibrary(tx, owner); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func claimLegacyLibrary(tx *sql.Tx, owner string) error {
	if _, err := tx.Exec("INSERT INTO app_metadata(key,value) VALUES('original_owner',?) ON CONFLICT(key) DO NOTHING", owner); err != nil {
		return err
	}
	if _, err := tx.Exec("UPDATE books SET owner_id=? WHERE owner_id=?", owner, legacyProfile); err != nil {
		return err
	}
	if _, err := tx.Exec("INSERT INTO collections(owner_id,name) SELECT ?,name FROM collections WHERE owner_id=? ON CONFLICT(owner_id,name) DO NOTHING", owner, legacyProfile); err != nil {
		return err
	}
	_, err := tx.Exec("DELETE FROM collections WHERE owner_id=?", legacyProfile)
	return err
}
func (s *Server) removeBookFiles(book Book) {
	os.Remove(filepath.Join(s.cfg.DataDir, "books", book.ID+"."+strings.ToLower(book.Format)))
	os.Remove(filepath.Join(s.cfg.DataDir, "books", book.ID+".cover"))
}

// Uploads can outlive a logout or owner setup. Resolve ownership at insertion
// inside a transaction, and reject uploads whose account was deleted meanwhile.
func (s *Server) insertOwnedBook(owner string, b Book) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if owner == legacyProfile {
		var original string
		err = tx.QueryRow("SELECT value FROM app_metadata WHERE key='original_owner'").Scan(&original)
		if err == nil {
			owner = original
		} else if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
	}
	var allowed int
	if owner == legacyProfile {
		err = tx.QueryRow("SELECT count(*)=0 FROM users").Scan(&allowed)
	} else {
		err = tx.QueryRow("SELECT count(*) FROM users WHERE id=?", owner).Scan(&allowed)
	}
	if err != nil {
		return err
	}
	if allowed != 1 {
		return fmt.Errorf("Account is no longer available")
	}
	_, err = tx.Exec("INSERT INTO books("+bookColumns+",owner_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", b.ID, b.Title, b.Author, b.Format, b.Size, b.Cover, b.Color, b.AddedAt, nil, 0, "", false, "unread", "", b.Sample, owner)
	if err != nil {
		return err
	}
	return tx.Commit()
}

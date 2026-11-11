package server

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const maxUpload = 100 << 20

var colors = []string{"sage", "clay", "ink", "sand", "rose", "ocean"}

func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUpload+(1<<20))
	if e := r.ParseMultipartForm(8 << 20); e != nil {
		fail(w, 413, "Upload a PDF or EPUB smaller than 100 MB")
		return
	}
	defer r.MultipartForm.RemoveAll()
	f, h, e := r.FormFile("file")
	if e != nil {
		fail(w, 400, "Choose a file to upload")
		return
	}
	defer f.Close()
	format := strings.ToUpper(strings.TrimPrefix(filepath.Ext(h.Filename), "."))
	if format != "PDF" && format != "EPUB" {
		fail(w, 415, "Folio supports DRM-free EPUB and PDF files")
		return
	}
	tmp, e := os.CreateTemp(filepath.Join(s.cfg.DataDir, "books"), "import-*")
	if e != nil {
		fail(w, 500, "Could not create upload")
		return
	}
	defer os.Remove(tmp.Name())
	size, e := io.Copy(tmp, io.LimitReader(f, maxUpload+1))
	tmp.Close()
	if e != nil || size > maxUpload {
		fail(w, 413, "File exceeds 100 MB")
		return
	}
	b, e := s.importFile(tmp.Name(), h.Filename, format, size, false)
	if e != nil {
		fail(w, 422, e.Error())
		return
	}
	respond(w, 201, b)
}
func (s *Server) importFile(source, name, format string, size int64, sample bool) (Book, error) {
	bid := id()
	b := Book{ID: bid, Title: strings.TrimSuffix(filepath.Base(name), filepath.Ext(name)), Author: "Unknown author", Format: format, Size: size, Color: colors[int(bid[0])%len(colors)], AddedAt: now(), Status: "unread", Sample: sample}
	var cover []byte
	if format == "PDF" {
		f, e := os.Open(source)
		if e != nil {
			return b, e
		}
		head := make([]byte, 1024)
		n, _ := f.Read(head)
		f.Close()
		if !bytes.Contains(head[:n], []byte("%PDF-")) {
			return b, fmt.Errorf("This file doesn't contain a valid PDF header")
		}
	} else {
		title, author, img, e := readEPUB(source)
		if e != nil {
			return b, e
		}
		if title != "" {
			b.Title = title
		}
		if author != "" {
			b.Author = author
		}
		cover = img
	}
	if len(b.Title) > 500 {
		b.Title = b.Title[:500]
	}
	if len(b.Author) > 500 {
		b.Author = b.Author[:500]
	}
	target := filepath.Join(s.cfg.DataDir, "books", b.ID+"."+strings.ToLower(b.Format))
	if e := os.Rename(source, target); e != nil {
		return b, e
	}
	b.Cover = len(cover) > 0
	if b.Cover {
		if e := os.WriteFile(filepath.Join(s.cfg.DataDir, "books", b.ID+".cover"), cover, 0600); e != nil {
			os.Remove(target)
			return b, e
		}
	}
	_, e := s.db.Exec("INSERT INTO books("+bookColumns+") VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", b.ID, b.Title, b.Author, b.Format, b.Size, b.Cover, b.Color, b.AddedAt, nil, 0, "", false, "unread", "", b.Sample)
	if e != nil {
		os.Remove(target)
		os.Remove(filepath.Join(s.cfg.DataDir, "books", b.ID+".cover"))
		return b, fmt.Errorf("Could not save imported book")
	}
	return b, nil
}

type containerXML struct {
	Rootfiles []struct {
		Path string `xml:"full-path,attr"`
	} `xml:"rootfiles>rootfile"`
}
type packageXML struct {
	Metadata struct {
		Title   string `xml:"title"`
		Creator string `xml:"creator"`
		Meta    []struct {
			Name    string `xml:"name,attr"`
			Content string `xml:"content,attr"`
		} `xml:"meta"`
	} `xml:"metadata"`
	Items []struct {
		ID         string `xml:"id,attr"`
		Href       string `xml:"href,attr"`
		Type       string `xml:"media-type,attr"`
		Properties string `xml:"properties,attr"`
	} `xml:"manifest>item"`
	Spine []struct {
		ID string `xml:"idref,attr"`
	} `xml:"spine>itemref"`
}

func readEPUB(name string) (string, string, []byte, error) {
	z, e := zip.OpenReader(name)
	if e != nil {
		return "", "", nil, fmt.Errorf("This file isn't a valid EPUB archive")
	}
	defer z.Close()
	if len(z.File) > 10000 {
		return "", "", nil, fmt.Errorf("EPUB contains too many entries")
	}
	files := map[string]*zip.File{}
	var total uint64
	for _, f := range z.File {
		if f.UncompressedSize64 > 512<<20 || total > 512<<20-f.UncompressedSize64 {
			return "", "", nil, fmt.Errorf("EPUB expands beyond the 512 MB limit")
		}
		total += f.UncompressedSize64
		files[f.Name] = f
	}
	read := func(p string, limit int64) ([]byte, error) {
		f := files[p]
		if f == nil {
			return nil, fmt.Errorf("Missing EPUB resource: %s", p)
		}
		if f.UncompressedSize64 > uint64(limit) {
			return nil, fmt.Errorf("EPUB resource too large")
		}
		r, e := f.Open()
		if e != nil {
			return nil, e
		}
		defer r.Close()
		return io.ReadAll(io.LimitReader(r, limit))
	}
	if files["META-INF/encryption.xml"] != nil {
		data, _ := read("META-INF/encryption.xml", 1<<20)
		if !bytes.Contains(data, []byte("http://www.idpf.org/2008/embedding")) && !bytes.Contains(data, []byte("http://ns.adobe.com/pdf/enc#RC")) {
			return "", "", nil, fmt.Errorf("Encrypted EPUBs are not supported. Import a DRM-free copy")
		}
	}
	data, e := read("META-INF/container.xml", 1<<20)
	if e != nil {
		return "", "", nil, fmt.Errorf("Missing EPUB container")
	}
	var c containerXML
	if xml.Unmarshal(data, &c) != nil || len(c.Rootfiles) == 0 {
		return "", "", nil, fmt.Errorf("Invalid EPUB container")
	}
	opf := c.Rootfiles[0].Path
	data, e = read(opf, 4<<20)
	if e != nil {
		return "", "", nil, fmt.Errorf("Missing EPUB package")
	}
	var p packageXML
	if xml.Unmarshal(data, &p) != nil || len(p.Spine) == 0 {
		return "", "", nil, fmt.Errorf("Invalid EPUB reading order")
	}
	coverID := ""
	for _, m := range p.Metadata.Meta {
		if m.Name == "cover" {
			coverID = m.Content
		}
	}
	var cover []byte
	for _, item := range p.Items {
		if strings.Contains(item.Properties, "cover-image") || (coverID != "" && item.ID == coverID) {
			img, e := read(path.Join(path.Dir(opf), item.Href), 8<<20)
			if e == nil {
				mime := http.DetectContentType(img)
				if mime == "image/jpeg" || mime == "image/png" || mime == "image/webp" {
					cover = img
				}
			}
			break
		}
	}
	return strings.TrimSpace(p.Metadata.Title), strings.TrimSpace(p.Metadata.Creator), cover, nil
}

package server

import (
	"archive/zip"
	"bytes"
	"fmt"
	"html"
	"net/http"
	"os"
	"path/filepath"
)

// All excerpts below were published before 1920 and are in the public domain
// in the US. Sample files are deliberately short and labeled as excerpts.
type sample struct{ Title, Author, Color, Heading, Text string }

var sampleBooks = []sample{
	{"Walden", "Henry David Thoreau", "sage", "Where I Lived, and What I Lived For", "I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived. I did not wish to live what was not life, living is so dear; nor did I wish to practise resignation, unless it was quite necessary. I wanted to live deep and suck out all the marrow of life, to live so sturdily and Spartan-like as to put to rout all that was not life, to cut a broad swath and shave close, to drive life into a corner, and reduce it to its lowest terms.\n\nOur life is frittered away by detail. An honest man has hardly need to count more than his ten fingers, or in extreme cases he may add his ten toes, and lump the rest. Simplicity, simplicity, simplicity! I say, let your affairs be as two or three, and not a hundred or a thousand; instead of a million count half a dozen, and keep your accounts on your thumb-nail."},
	{"Pride and Prejudice", "Jane Austen", "clay", "Chapter I", "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.\n\nHowever little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered as the rightful property of some one or other of their daughters.\n\n“My dear Mr. Bennet,” said his lady to him one day, “have you heard that Netherfield Park is let at last?”\n\nMr. Bennet replied that he had not.\n\n“But it is,” returned she; “for Mrs. Long has just been here, and she told me all about it.”\n\nMr. Bennet made no answer.\n\n“Do you not want to know who has taken it?” cried his wife impatiently.\n\n“You want to tell me, and I have no objection to hearing it.”\n\nThis was invitation enough."},
	{"Moby-Dick", "Herman Melville", "ocean", "Loomings", "Call me Ishmael. Some years ago—never mind how long precisely—having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world. It is a way I have of driving off the spleen and regulating the circulation.\n\nWhenever I find myself growing grim about the mouth; whenever it is a damp, drizzly November in my soul; whenever I find myself involuntarily pausing before coffin warehouses, and bringing up the rear of every funeral I meet; and especially whenever my hypos get such an upper hand of me, that it requires a strong moral principle to prevent me from deliberately stepping into the street, and methodically knocking people’s hats off—then, I account it high time to get to sea as soon as I can.\n\nThere now is your insular city of the Manhattoes, belted round by wharves as Indian isles by coral reefs—commerce surrounds it with her surf. Right and left, the streets take you waterward."},
	{"The Secret Garden", "Frances Hodgson Burnett", "rose", "There Is No One Left", "When Mary Lennox was sent to Misselthwaite Manor to live with her uncle everybody said she was the most disagreeable-looking child ever seen. It was true, too. She had a little thin face and a little thin body, thin light hair and a sour expression. Her hair was yellow, and her face was yellow because she had been born in India and had always been ill in one way or another.\n\nHer father had held a position under the English Government and had always been busy and ill himself, and her mother had been a great beauty who cared only to go to parties and amuse herself with gay people. She had not wanted a little girl at all, and when Mary was born she handed her over to the care of an Ayah, who was made to understand that if she wished to please the Mem Sahib she must keep the child out of sight as much as possible.\n\nSo when she was a sickly, fretful, ugly little baby she was kept out of the way, and when she became a sickly, fretful, toddling thing she was kept out of the way also."},
	{"Alice’s Adventures in Wonderland", "Lewis Carroll", "sand", "Down the Rabbit-Hole", "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, ‘and what is the use of a book,’ thought Alice ‘without pictures or conversations?’\n\nSo she was considering in her own mind (as well as she could, for the hot day made her feel very sleepy and stupid), whether the pleasure of making a daisy-chain would be worth the trouble of getting up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her.\n\nThere was nothing so very remarkable in that; nor did Alice think it so very much out of the way to hear the Rabbit say to itself, ‘Oh dear! Oh dear! I shall be late!’\n\nBut when the Rabbit actually took a watch out of its waistcoat-pocket, and looked at it, and then hurried on, Alice started to her feet, for it flashed across her mind that she had never before seen a rabbit with either a waistcoat-pocket, or a watch to take out of it."},
	{"Frankenstein", "Mary Shelley", "ink", "Letter I", "You will rejoice to hear that no disaster has accompanied the commencement of an enterprise which you have regarded with such evil forebodings. I arrived here yesterday, and my first task is to assure my dear sister of my welfare and increasing confidence in the success of my undertaking.\n\nI am already far north of London, and as I walk in the streets of Petersburgh, I feel a cold northern breeze play upon my cheeks, which braces my nerves and fills me with delight. Do you understand this feeling? This breeze, which has travelled from the regions towards which I am advancing, gives me a foretaste of those icy climes.\n\nInspirited by this wind of promise, my daydreams become more fervent and vivid. I try in vain to be persuaded that the pole is the seat of frost and desolation; it ever presents itself to my imagination as the region of beauty and delight."},
}

func sampleEPUB(b sample) []byte {
	var out bytes.Buffer
	z := zip.NewWriter(&out)
	h := &zip.FileHeader{Name: "mimetype", Method: zip.Store}
	f, _ := z.CreateHeader(h)
	f.Write([]byte("application/epub+zip"))
	entries := map[string]string{
		"META-INF/container.xml": `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
		"OEBPS/content.opf":      fmt.Sprintf(`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:folio:%s</dc:identifier><dc:title>%s</dc:title><dc:creator>%s</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="about" href="about.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/><itemref idref="about"/></spine></package>`, html.EscapeString(b.Title), html.EscapeString(b.Title), html.EscapeString(b.Author)),
		"OEBPS/nav.xhtml":        `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Opening excerpt</a></li><li><a href="about.xhtml">About this sample</a></li></ol></nav></body></html>`,
		"OEBPS/about.xhtml":      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>About this sample</title></head><body><h1>A little taste of a classic.</h1><p>This is a short public-domain excerpt, not the complete book. It is included to help you explore Folio. Upload a complete DRM-free EPUB or PDF to make this library your own.</p><p>Try selecting a sentence, adding a highlight, and leaving a thought in the notebook. Your progress and annotations stay on your server.</p></body></html>`,
	}
	body := ""
	for _, p := range splitParagraphs(b.Text) {
		body += "<p>" + html.EscapeString(p) + "</p>"
	}
	entries["OEBPS/chapter.xhtml"] = fmt.Sprintf(`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>%s</title><style>body{font-family:Georgia,serif;line-height:1.8;padding:1em}h1{font-weight:normal;line-height:1.25}p{margin:1em 0}.eyebrow{font:small-caps 12px sans-serif;letter-spacing:2px}</style></head><body><p class="eyebrow">%s · sample excerpt</p><h1>%s</h1>%s</body></html>`, html.EscapeString(b.Heading), html.EscapeString(b.Author), html.EscapeString(b.Heading), body)
	for name, content := range entries {
		f, _ := z.Create(name)
		f.Write([]byte(content))
	}
	z.Close()
	return out.Bytes()
}
func splitParagraphs(s string) []string {
	var out []string
	start := 0
	for i := 0; i+1 < len(s); i++ {
		if s[i] == '\n' && s[i+1] == '\n' {
			out = append(out, s[start:i])
			start = i + 2
			i++
		}
	}
	return append(out, s[start:])
}
func (s *Server) samples(w http.ResponseWriter, r *http.Request) {
	out := []Book{}
	for _, sample := range sampleBooks {
		var exists int
		s.db.QueryRow("SELECT count(*) FROM books WHERE owner_id=? AND sample=1 AND title=?", principal(r).ID, sample.Title).Scan(&exists)
		if exists > 0 {
			continue
		}
		data := sampleEPUB(sample)
		f, e := os.CreateTemp(filepath.Join(s.cfg.DataDir, "books"), "sample-*")
		if e != nil {
			fail(w, 500, "Could not create sample")
			return
		}
		_, e = f.Write(data)
		f.Close()
		if e != nil {
			os.Remove(f.Name())
			fail(w, 500, "Could not write sample")
			return
		}
		b, e := s.importFile(principal(r).ID, f.Name(), sample.Title+".epub", "EPUB", int64(len(data)), true)
		os.Remove(f.Name())
		if e != nil {
			fail(w, 500, "Could not import sample")
			return
		}
		s.db.Exec("UPDATE books SET color=? WHERE id=? AND owner_id=?", sample.Color, b.ID, principal(r).ID)
		b.Color = sample.Color
		out = append(out, b)
	}
	respond(w, 201, out)
}

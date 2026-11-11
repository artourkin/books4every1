package main

import (
	"context"
	"flag"
	"github.com/folio-reader/folio/internal/server"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
func main() {
	addr := flag.String("addr", env("FOLIO_ADDR", "127.0.0.1:8080"), "HTTP listen address")
	data := flag.String("data", env("FOLIO_DATA", "data"), "Persistent data directory")
	web := flag.String("web", env("FOLIO_WEB", "web/dist"), "Built web assets")
	flag.Parse()
	s, e := server.New(server.Config{DataDir: *data, WebDir: *web, Password: os.Getenv("FOLIO_PASSWORD"), APIToken: os.Getenv("FOLIO_API_TOKEN"), SecureCookie: os.Getenv("FOLIO_SECURE_COOKIE") == "true"})
	if e != nil {
		log.Fatal(e)
	}
	defer s.Close()
	if os.Getenv("FOLIO_PASSWORD") == "" {
		log.Print("Password protection is disabled. Keep this instance on a trusted network.")
	}
	srv := &http.Server{Addr: *addr, Handler: s.Handler(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 90 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(c)
	}()
	log.Printf("Folio is listening at http://%s", *addr)
	if e = srv.ListenAndServe(); e != nil && e != http.ErrServerClosed {
		log.Fatal(e)
	}
}

.PHONY: build test run dev
build:
	cd web && npm ci && npm run build
	go build -o bin/folio ./cmd/folio

test:
	go test -race ./...
	cd web && npm run build

run:
	./bin/folio

dev:
	go run ./cmd/folio

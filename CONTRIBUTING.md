# Contributing

Use Go 1.24+ and Node.js 24+. Start with the source setup in README.md.

```sh
go test -race ./...
go vet ./...
cd web
npm ci
npm run build
npx playwright install chromium
```

Then, from the repository root, build the test server:

```sh
go build -o bin/folio ./cmd/folio
cd web
npm run test:e2e
```

The browser tests start an isolated Go server on port 8081 with a temporary data directory. They test library organization, EPUB reading and highlights, PDF upload/rendering/highlights, persistence on reopening, export, mobile layout, upload errors, pressure events, ink erasing/undo/redo, stale-tab conflicts, and save recovery. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an existing Chromium executable. Go integration tests use temporary directories and HTTP servers.

Format Go with `gofmt -w cmd internal`. Run `npm run format` in `web/` for the frontend. Keep API and annotation changes documented in docs/API.md so other clients can implement them. Include meaningful tests for changes to persistence, imports, authentication, or reading behavior.

The EPUB.js dependency uses an npm override for its XML parser because the upstream version range selects a vulnerable older release. Preserve that override until the upstream dependency is updated. Run `npm audit --omit=dev` when updating dependencies.

Contributions are licensed under AGPL-3.0-only. Please avoid committing personal books, databases, passwords, or generated reader assets. The PDF test fixture contains original text authored for Folio and is covered by the repository license.

Pen tests dispatch browser Pointer Events with varying pressure and palm-like touch sequences. They verify application behavior, not physical stylus latency or OS palm rejection. Please test on actual iPad Safari/Apple Pencil and other pen hardware before claiming device compatibility.


The mobile reader tests use a 412×915 CSS viewport at device pixel ratio 3.5. They check the canvas pixel dimensions, density increases after CDP browser pinch zoom, bounded bitmap memory, retained text selection/ink, and the minimal toolbar's hit targets and menus. These are browser emulations, not a substitute for checking display quality and pen latency on a physical phone.

Account browser tests start a separate temporary server on loopback port 8082 for each test, exercising owner setup, account switching, per-device pen preferences, retry behavior, and cross-tab profile protection. Other reader tests reset the legacy profile to default preferences before each test. Backend tests cover migration, account authorization, salted password hashes, session revocation/expiry, preference validation, concurrent partial updates, owner recovery, private library access (including files/covers/downloads), per-user collections/samples, account deletion, and ownership migration.

Private-library migration tests open a database with the previous schema and multiple administrators, verify that only the original owner receives existing content, and reopen it to check idempotence. Browser tests verify that a login/logout in another tab removes the previous account’s private view.

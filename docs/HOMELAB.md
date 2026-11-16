# Deploy Folio on a homelab

Run these steps in an SSH session on your Docker host. You need Bash, curl, Docker Engine, and Docker Compose v2, with permission to run Docker. Folio publishes images for amd64 and arm64 hosts; source builds also need Git.

## Install a built release

Choose a version from [GitHub Releases](https://github.com/artourkin/folio/releases). Every PR has a prerelease for testing; stable releases are published after merge. Each release contains `compose.yaml`, `folio.env.example`, `SHA256SUMS`, and built Docker archives for both architectures. New images use `ghcr.io/artourkin/folio`.

For a fresh installation, create a permanent directory such as `~/folio`, download the release's Compose and environment files there, copy `folio.env.example` to `.env`, and set mode 600. Set a unique `FOLIO_PASSWORD`, your server's LAN IP in `FOLIO_BIND_ADDR`, and `FOLIO_PORT=8080`, then run `docker compose up -d`. The release Compose file pins its image version and requires no source checkout or build.

To try a PR on an existing installation, download its release's `compose.yaml` as `compose.release.yaml` into your existing installation directory, using the command in its prerelease notes. This separate file pins the image without changing a source checkout or your existing `.env`. Keep the same Compose project name and volume; a new directory can select a different, empty named volume. Then run:

```sh
docker compose -f compose.release.yaml pull folio
docker compose -f compose.release.yaml up -d folio
curl --fail http://reader.example.test:8080/api/v1/health
```

You can also download the architecture-specific `.tar.gz` and `SHA256SUMS`, verify the checksum, and load it with `docker load -i FILE.tar.gz`. Then start with `docker compose -f compose.release.yaml up -d --pull never folio`. These archives work without registry login. Use `amd64` on Intel/AMD hardware and `arm64` on ARM hardware. Continue using `-f compose.release.yaml` for maintenance of an upgraded installation; fresh installations using `compose.yaml` use the default `docker compose` command.

The first GHCR package may need its visibility changed to **Public** in the repository owner's GitHub package settings for anonymous registry pulls. GitHub's release archives remain directly downloadable either way. Package publishing uses the workflow's own token, with no personal registry secret.

## Install from source

Use `main` for the current app, including PDF handwriting. To test an unmerged pull request, replace `main` with its feature branch and switch back to `main` after the PR is merged.

```sh
git clone --branch main https://github.com/artourkin/folio.git folio
cd folio
./scripts/install-homelab.sh --port 8080
```

The installer uses the SSH connection's server IP as its bind address, generates a random password in a mode-600 `.env` file, builds the container, and verifies its health endpoint. It refuses to overwrite an existing `.env`. Pass `--bind 192.0.2.10` to choose a specific address. Docker and curl must be usable by your SSH account. The password stays on the server; view `FOLIO_PASSWORD` in `.env` from your own terminal to sign in.

For manual setup instead, copy `.env.example` to `.env`, set its permissions to 600, and edit it on the server. Choose your own password and replace the example IP with the server's LAN IPv4 address:

```dotenv
FOLIO_PASSWORD=choose-a-long-unique-password
FOLIO_BIND_ADDR=192.0.2.10
FOLIO_PORT=8080
FOLIO_SECURE_COOKIE=false
```

`FOLIO_BIND_ADDR` is an IP address, not a hostname. In a regular SSH session, the third field of `$SSH_CONNECTION` is the server address used by that connection. Use a stable LAN address (a DHCP reservation is useful) so the binding stays valid after reboot. For an IPv6 bind, surround the address with brackets, for example `[fd00::50]`.

Build and start:

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
curl --fail http://192.0.2.10:8080/api/v1/health
```

From another device on the same network, open `http://192.0.2.10:8080` or `http://reader.example.test:8080` if your local DNS resolves that hostname to the same IP. Sign in with the password from `.env`. Then open **Library settings → Create owner account** and choose an account username and password. The owner can add accounts; each has a private library and keeps pen and reader preferences across devices. Existing books, collections, reading progress, annotations, and ink are assigned only to the original owner. New users start with an empty library. Once accounts are enabled, use account credentials for sign-in; the generated `.env` password no longer authorizes access. No router port forwarding is needed for LAN use. If a host firewall blocks access, allow the chosen TCP port from your LAN subnet using the host's existing firewall setup.

The external host port is configured by `FOLIO_PORT`. The Go server continues listening on port 8080 **inside** the container; do not change `FOLIO_ADDR` to the host's IP or external port. Bind to the specific LAN address to avoid publishing the app on other host interfaces.

For an existing source checkout after the repository rename, update its remote:

```sh
git remote set-url origin https://github.com/artourkin/folio.git
```

For Docker upgrades, download the new release's Compose file into the existing installation directory. Its pinned image selects the new registry path. Older releases retain their original image references; keep the Compose project name and data volume to preserve your library.

## Verify and maintain

```sh
docker compose logs --tail=50 folio
# A release installation: select the desired FOLIO_IMAGE in .env, then:
docker compose pull folio
docker compose up -d --no-build folio
```

For a source-build installation instead:

```sh
git fetch origin
git switch main
git pull --ff-only
docker compose up -d --build
```

The container restarts automatically with Docker. `docker compose down` keeps the library volume. Avoid `down -v` when you want to retain books and annotations. Keep this checkout directory's name stable, or consistently use a fixed Compose project name, so updates reuse the same named volume.

Back up before upgrading. Release notes identify the exact source commit, image digest, architecture downloads, and version. `curl http://reader.example.test:8080/api/v1/health` returns the running version and revision; `docker compose exec folio /app/folio -version` prints the build details. Rollback of the image alone does not reverse database migrations; retain the matching data backup.

For backups, stop the app, copy the complete named data volume, then restart it. See the README backup instructions. The volume includes books, SQLite metadata, notes, and handwriting. Keep `.env` separately as it contains the sign-in configuration.

For HTTPS through an existing reverse proxy, bind Folio to a local/internal address appropriate for that proxy, preserve the original Host header, allow uploads of at least 101 MiB, and set `FOLIO_SECURE_COOKIE=true`. Keep it false for direct HTTP access; a secure cookie cannot be used on a normal HTTP LAN origin.

For a forgotten account password, use the stdin-based [owner recovery command in the README](../README.md#run-from-source). Backups now include accounts, password hashes, session hashes, and preferences in the same SQLite database. Restoring an older backup also restores that backup’s account/session state.

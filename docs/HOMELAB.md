# Deploy Folio on a homelab

Run these steps in an SSH session on your Docker host. You need Bash, Git, curl, Docker Engine, and Docker Compose v2, with permission to run Docker. Folio's image supports amd64 and arm64 hosts. Your server needs internet access during the first build.

## Install

Choose the version to deploy. The current PDF handwriting version is on `feat/pdf-ink`; `main` contains the original reader until that pull request is merged.

```sh
git clone --branch feat/pdf-ink https://github.com/artourkin/books4every1.git folio
cd folio
./scripts/install-homelab.sh --port 8123
```

The installer uses the SSH connection's server IP as its bind address, generates a random password in a mode-600 `.env` file, builds the container, and verifies its health endpoint. It refuses to overwrite an existing `.env`. Pass `--bind 192.168.1.50` to choose a specific address. Docker and curl must be usable by your SSH account. The password stays on the server; view `FOLIO_PASSWORD` in `.env` from your own terminal to sign in.

For manual setup instead, copy `.env.example` to `.env`, set its permissions to 600, and edit it on the server. Choose your own password and replace the example IP with the server's LAN IPv4 address:

```dotenv
FOLIO_PASSWORD=choose-a-long-unique-password
FOLIO_BIND_ADDR=192.168.1.50
FOLIO_PORT=8123
FOLIO_SECURE_COOKIE=false
```

`FOLIO_BIND_ADDR` is an IP address, not a hostname. In a regular SSH session, the third field of `$SSH_CONNECTION` is the server address used by that connection. Use a stable LAN address (a DHCP reservation is useful) so the binding stays valid after reboot. For an IPv6 bind, surround the address with brackets, for example `[fd00::50]`.

Build and start:

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
curl --fail http://192.168.1.50:8123/api/v1/health
```

From another device on the same network, open `http://192.168.1.50:8123` or `http://server.home:8123` if your local DNS resolves that hostname to the same IP. Sign in with the password from `.env`. No router port forwarding is needed for LAN use. If a host firewall blocks access, allow the chosen TCP port from your LAN subnet using the host's existing firewall setup.

The external host port is configured by `FOLIO_PORT`. The Go server continues listening on port 8080 **inside** the container; do not change `FOLIO_ADDR` to the host's IP or external port. Bind to the specific LAN address to avoid publishing the app on other host interfaces.

## Verify and maintain

```sh
docker compose logs --tail=50 folio
# Pull updates from your selected branch, rebuild, and restart:
git pull --ff-only
docker compose up -d --build
```

The container restarts automatically with Docker. `docker compose down` keeps the library volume. Avoid `down -v` when you want to retain books and annotations. Keep this checkout directory's name stable, or consistently use a fixed Compose project name, so updates reuse the same named volume.

For backups, stop the app, copy the complete named data volume, then restart it. See the README backup instructions. The volume includes books, SQLite metadata, notes, and handwriting. Keep `.env` separately as it contains the sign-in configuration.

For HTTPS through an existing reverse proxy, bind Folio to a local/internal address appropriate for that proxy, preserve the original Host header, allow uploads of at least 101 MiB, and set `FOLIO_SECURE_COOKIE=true`. Keep it false for direct HTTP access; a secure cookie cannot be used on a normal HTTP LAN origin.

#!/usr/bin/env bash
# First-time setup. Run on your Docker host inside an SSH session.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

folio_port=8080
folio_bind="${FOLIO_BIND_ADDR:-}"
usage() { printf 'Usage: %s [--port PORT] [--bind LAN_IP]\n' "$0"; }
fail() { printf '%s\n' "$1" >&2; exit 1; }
while (($#)); do
  case "$1" in
    --port) folio_port="${2:?--port requires a port}"; shift 2 ;;
    --bind) folio_bind="${2:?--bind requires a LAN IP}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
  esac
done
[[ "$folio_port" =~ ^[1-9][0-9]{0,4}$ ]] && ((folio_port <= 65535)) || fail 'Port must be an integer from 1 to 65535.'
[[ ! -e .env && ! -L .env ]] || fail 'An .env file already exists; no changes made. Edit its FOLIO_BIND_ADDR and FOLIO_PORT, then run docker compose up -d --build.'
if [[ -z "$folio_bind" ]]; then
  folio_bind="$(printf '%s\n' "${SSH_CONNECTION:-}" | awk '{print $3}')"
fi
[[ -n "$folio_bind" ]] || fail 'No SSH server address found. Pass --bind with the server LAN IP.'
case "$folio_bind" in
  0.0.0.0|'[::]'|::) fail 'Choose a specific LAN IP rather than an all-interface binding.' ;;
  *:*) [[ "$folio_bind" == \[*\] ]] || folio_bind="[$folio_bind]" ;;
esac
command -v docker >/dev/null || fail 'Docker is required on this host.'
command -v curl >/dev/null || fail 'curl is required for the deployment health check.'
docker compose version >/dev/null
docker info --format '{{.ServerVersion}}' >/dev/null

folio_password="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
[[ ${#folio_password} == 48 ]] || fail 'Could not generate a library password.'
# Noclobber also protects against another setup creating .env concurrently.
(
  set -o noclobber
  umask 077
  printf 'FOLIO_PASSWORD=%s\nFOLIO_BIND_ADDR=%s\nFOLIO_PORT=%s\nFOLIO_SECURE_COOKIE=false\n' \
    "$folio_password" "$folio_bind" "$folio_port" > .env
)
unset folio_password

docker compose config --quiet
docker compose up -d --build
folio_no_proxy="${folio_bind#\[}"
folio_no_proxy="${folio_no_proxy%\]}"
curl --noproxy "$folio_no_proxy" --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 --max-time 5 \
  "http://${folio_bind}:${folio_port}/api/v1/health"
printf '\nOpen http://%s:%s\nYour generated password is stored in %s/.env (FOLIO_PASSWORD).\n' "$folio_bind" "$folio_port" "$PWD"

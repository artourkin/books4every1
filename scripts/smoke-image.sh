#!/usr/bin/env bash
set -euo pipefail
folio_image="${1:?Pass an image reference}"
folio_version="${2:?Pass the expected version}"
folio_revision="${3:?Pass the expected revision}"
folio_container="$(docker run -d --read-only --security-opt no-new-privileges:true \
  --tmpfs /tmp:size=128m,mode=1777 -e FOLIO_PASSWORD=release-smoke-test-only \
  -p 127.0.0.1::8080 "$folio_image")"
trap 'docker rm -fv "$folio_container" >/dev/null' EXIT
folio_port="$(docker inspect -f '{{(index (index .NetworkSettings.Ports "8080/tcp") 0).HostPort}}' "$folio_container")"
folio_endpoint="http://127.0.0.1:$folio_port"
folio_health="$(curl --noproxy 127.0.0.1 --fail --silent --show-error --retry 15 --retry-connrefused --retry-delay 1 --max-time 3 "$folio_endpoint/api/v1/health")"
node --input-type=module - "$folio_health" "$folio_version" "$folio_revision" <<'JS'
import assert from 'node:assert/strict';
const [health, version, revision] = process.argv.slice(2);
const value = JSON.parse(health);
assert.equal(value.status, 'ok');
assert.equal(value.version, version);
assert.equal(value.revision, revision);
assert.ok(Number.isFinite(Date.parse(value.builtAt)));
JS
curl --noproxy 127.0.0.1 --fail --silent --show-error "$folio_endpoint/" | grep -q '/assets/.*\.js'
[[ "$(curl --noproxy 127.0.0.1 --silent --output /dev/null --write-out '%{http_code}' "$folio_endpoint/api/v1/books")" == 401 ]]
docker run --rm "$folio_image" -version | grep -F "Folio $folio_version (revision $folio_revision,"
printf 'Image smoke test passed: %s\n' "$folio_image"

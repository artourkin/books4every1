#!/usr/bin/env bash
set -euo pipefail
folio_assets="${1:?Pass the release asset directory}"
: "${IMAGE:?}" "${VERSION:?}" "${TAG:?}" "${SOURCE_SHA:?}"
folio_release_state="$(gh api graphql -f owner="${GITHUB_REPOSITORY%/*}" -f name="${GITHUB_REPOSITORY#*/}" -f tag="$TAG" \
  -f query='query($owner:String!,$name:String!,$tag:String!){repository(owner:$owner,name:$name){release(tagName:$tag){isDraft}}}' --jq '.data.repository.release | if . == null then "missing" elif .isDraft then "draft" else "published" end')"
if [[ "$folio_release_state" == published ]]; then
  printf 'Published release already exists; preserving its images and assets.\n'
  exit 0
fi
folio_amd64="$(cat "$folio_assets/digest-amd64.txt")"
folio_arm64="$(cat "$folio_assets/digest-arm64.txt")"
[[ "$folio_amd64" =~ ^sha256:[a-f0-9]{64}$ && "$folio_arm64" =~ ^sha256:[a-f0-9]{64}$ ]]
docker buildx imagetools create --tag "$IMAGE:$VERSION" "$IMAGE@$folio_amd64" "$IMAGE@$folio_arm64"
IMAGE_DIGEST="$(docker buildx imagetools inspect "$IMAGE:$VERSION" --format '{{json .Manifest}}' | node --input-type=module -e 'let s="";for await(const c of process.stdin)s+=c;console.log(JSON.parse(s).digest)')"
export IMAGE_DIGEST
[[ "$IMAGE_DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]
node scripts/release.mjs bundle "$folio_assets"
cp CHANGELOG.md "$folio_assets/CHANGELOG.md"
(
  cd "$folio_assets"
  sha256sum folio-*.tar.gz compose.yaml folio.env.example release.json CHANGELOG.md digest-*.txt > SHA256SUMS
)
folio_flags=(--latest=false)
if [[ "${PRERELEASE:-false}" == true ]]; then folio_flags+=(--prerelease); fi
if [[ "$folio_release_state" == missing ]]; then
  gh release create "$TAG" --target "$SOURCE_SHA" --title "Folio $VERSION" \
    --draft "${folio_flags[@]}" --notes-file "$folio_assets/release-notes.md"
fi
# Replacing assets is restricted to an unpublished draft, allowing failed
# uploads to be resumed without changing an already published release.
gh release upload "$TAG" "$folio_assets"/* --clobber
gh release edit "$TAG" --draft=false "${folio_flags[@]}" --notes-file "$folio_assets/release-notes.md"
{
  printf '### Folio %s\n\n' "$VERSION"
  printf '[Download release](https://github.com/%s/releases/tag/%s)\n\n' "$GITHUB_REPOSITORY" "$TAG"
  printf 'Image: `%s:%s`\n\nDigest: `%s`\n\n' "$IMAGE" "$VERSION" "$IMAGE_DIGEST"
  printf '```sh\ncurl -fL https://github.com/%s/releases/download/%s/compose.yaml -o compose.release.yaml\ndocker compose -f compose.release.yaml pull folio\ndocker compose -f compose.release.yaml up -d folio\n```\n' "$GITHUB_REPOSITORY" "$TAG"
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"

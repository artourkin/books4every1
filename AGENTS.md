# Repository instructions

Every PR must prepare a release, as requested by the maintainer:

- Increase `VERSION` above the current base branch. Use a patch increment for fixes and a minor increment for features; keep `web/package.json` and both root version fields in `web/package-lock.json` in sync.
- Add a section for that version in `CHANGELOG.md`, describing the final change and any upgrade considerations.
- Wait for the checks and Docker image jobs. Link the published GitHub prerelease and its exact image version in the PR description and final response. Include the command to use that image with the existing Compose installation.
- PR prereleases include the PR number and source commit in their versions. Never replace a published release or reuse a stable version for different source code.
- The workflow publishes Linux amd64/arm64 images, smoke-tests them, and attaches Docker archives, checksums, and deployment files. The stable release is published automatically after merge; preparing a PR does not authorize merging it or changing a running homelab.

Preserve per-user isolation of books, files, collections, preferences, and annotations. Keep previews and test servers on loopback with temporary data. Do not include personal books, databases, passwords, or private keys in commits or release artifacts.

# Changelog

Each PR prepares a versioned release. PR images are prereleases; merging publishes the stable version.

## 0.2.0

- Add versioned Docker images for Linux amd64 and arm64, tested before publication.
- Publish a GitHub prerelease for each PR revision, with downloadable Docker images, checksums, image digests, and deployment instructions.
- Publish the stable version and update the `latest` image after merge.
- Report the actual build version and revision through the health endpoint and `folio -version`.
- Allow existing Compose installations to switch to a prebuilt release image without changing their data volume.

This first packaged release also includes the previously merged private user libraries, saved pen preferences, PDF handwriting, compact mobile controls, retained zoomed PDF position, and finger page swipes.

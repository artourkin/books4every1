# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:24-alpine AS web
WORKDIR /app/web
COPY web/package*.json ./
# An optional CA secret supports TLS-inspecting build proxies.
# Keep dependencies in this build step rather than in an image layer.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci && rm -rf /root/.npm
COPY web/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.24-alpine AS backend
WORKDIR /app
COPY go.mod go.sum ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export SSL_CERT_FILE=/run/secrets/proxy_ca; fi; \
    go mod download
COPY . .
ARG TARGETOS
ARG TARGETARCH
ARG VERSION
ARG REVISION=unknown
ARG CREATED=unknown
RUN mkdir /data && CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath \
    -ldflags="-s -w -X github.com/folio-reader/folio.releaseVersion=${VERSION:-$(cat VERSION)} -X github.com/folio-reader/folio.Revision=$REVISION -X github.com/folio-reader/folio.BuiltAt=$CREATED" \
    -o /folio ./cmd/folio

FROM gcr.io/distroless/static-debian12:nonroot
ARG VERSION
ARG REVISION=unknown
ARG CREATED
ARG SOURCE_URL=https://github.com/artourkin/books4every1
LABEL org.opencontainers.image.title="Folio" \
    org.opencontainers.image.description="Self-hosted EPUB and PDF reader with private libraries and handwriting" \
    org.opencontainers.image.source=$SOURCE_URL \
    org.opencontainers.image.licenses="AGPL-3.0-only" \
    org.opencontainers.image.version=$VERSION \
    org.opencontainers.image.revision=$REVISION \
    org.opencontainers.image.created=$CREATED
WORKDIR /app
COPY --from=backend /folio /app/folio
COPY --from=backend --chown=65532:65532 /data /data
COPY --from=web /app/web/dist /app/web/dist
ENV FOLIO_ADDR=0.0.0.0:8080 FOLIO_DATA=/data FOLIO_WEB=/app/web/dist
VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["/app/folio"]

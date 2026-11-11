# syntax=docker/dockerfile:1
FROM node:24-alpine AS web
WORKDIR /app/web
COPY web/ ./
# An optional CA secret supports TLS-inspecting build proxies.
# Keep dependencies in this build step rather than in an image layer.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci && npm run build && rm -rf node_modules /root/.npm

FROM golang:1.24-alpine AS backend
WORKDIR /app
COPY . .
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export SSL_CERT_FILE=/run/secrets/proxy_ca; fi; \
    mkdir /data && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /folio ./cmd/folio \
    && rm -rf /go/pkg/mod /root/.cache/go-build

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=backend /folio /app/folio
COPY --from=backend --chown=65532:65532 /data /data
COPY --from=web /app/web/dist /app/web/dist
ENV FOLIO_ADDR=0.0.0.0:8080 FOLIO_DATA=/data FOLIO_WEB=/app/web/dist
VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["/app/folio"]

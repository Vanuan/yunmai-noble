FROM oven/bun:1.3.13-alpine AS bun

FROM node:22-alpine
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN apk add --update alpine-sdk eudev-dev linux-headers bluez python3 tini libstdc++ ca-certificates
WORKDIR /src
ENTRYPOINT ["/sbin/tini", "--"]

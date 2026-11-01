FROM node:22-alpine
RUN apk add --update alpine-sdk eudev-dev linux-headers bluez python3 tini
WORKDIR /src
ENTRYPOINT ["/sbin/tini", "--"]

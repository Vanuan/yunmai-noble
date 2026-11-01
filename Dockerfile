FROM node:6-alpine
RUN apk add --update alpine-sdk eudev-dev linux-headers bluez python tini
WORKDIR /src
ENTRYPOINT ["/sbin/tini", "--"]

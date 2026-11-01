FROM node:22-alpine
RUN apk add --update tini ca-certificates
WORKDIR /src

COPY package.json package-lock.json ./
COPY packages/node/package.json packages/node/
COPY packages/contract/package.json packages/contract/
RUN npm ci --omit=dev --omit=optional

COPY packages ./packages

ENV BLE_DRIVER=dbus
ENV DBUS_SYSTEM_BUS_ADDRESS=unix:path=/run/dbus/system_bus_socket

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "packages/node/ble.js"]

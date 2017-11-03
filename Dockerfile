
FROM arm32v6/node:8-alpine
RUN apk add --update alpine-sdk eudev-dev linux-headers python tini
RUN apk add --no-cache \
        readline \
    && apk add --no-cache --virtual .build-dependencies \
        gcc g++ make musl-dev dbus-dev libusb-compat-dev eudev-dev \
        libical-dev readline-dev glib-dev linux-headers \
        autoconf automake libtool \
    && mkdir -p bluez-deprecated \
    && cd bluez-deprecated \
    && curl -so bluez-5.44.tar.gz https://www.kernel.org/pub/linux/bluetooth/bluez-5.44.tar.gz \ 
    && tar -xzf bluez-5.44.tar.gz \
    && cd bluez-5.44 \
    && ./configure \
       --enable-deprecated \
       --disable-systemd \
       --enable-library \
    && make \
    && mv attrib/gatttool /usr/bin/ \
    && apk del .build-dependencies \
    && rm -rf /usr/src/bluez-deprecated


ADD package.json /src/package.json
ADD yarn.lock /src/yarn.lock
WORKDIR /src
RUN yarn install
ADD ble.js /src
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "ble.js"]

#!/bin/bash
set -e

MODE="${1:-dbus}"

if [ "$MODE" = "dbus" ]; then
  docker build -f Dockerfile -t yunmai-noble .
elif [ "$MODE" = "noble" ]; then
  docker build -f Dockerfile.noble -t yunmai-noble-legacy .
else
  echo "Usage: $0 [dbus|noble]" >&2
  exit 1
fi

docker stop yunmai 2>/dev/null || true
docker rm yunmai 2>/dev/null || true

if [ "$MODE" = "dbus" ]; then
  docker run -d --name yunmai \
    --publish 8080:8080 \
    --restart=always \
    -v /run/dbus/system_bus_socket:/run/dbus/system_bus_socket \
    yunmai-noble
else
  docker run -d --name yunmai \
    --privileged=true \
    --network=host \
    --restart=always \
    yunmai-noble-legacy
fi

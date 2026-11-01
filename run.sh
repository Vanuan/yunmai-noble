#!/bin/bash
set -e

docker build -t yunmai-noble .
docker stop yunmai 2>/dev/null || true
docker rm yunmai 2>/dev/null || true
docker run -d --name yunmai --expose 8080 --publish 8080:8080 --privileged=true --network=host --restart=always yunmai-noble

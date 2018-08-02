#!/bin/bash
docker stop yunmai && docker rm yunmai
docker run -d --name yunmai --expose 8080 --publish 8080:8080 --privileged=true --network=host --restart=always vanuan/yunmai-noble-arm32

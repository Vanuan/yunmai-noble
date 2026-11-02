## Install

The signed APT repository is the recommended channel: set it up once and
`apt upgrade` delivers later releases.

```sh
curl -fsSLO https://vanuan.github.io/yunmai-noble/apt/yunmai-noble-archive-keyring.deb
sudo apt install ./yunmai-noble-archive-keyring.deb
sudo apt update
sudo apt install yunmai-noble-full
```

The `amd64` and `arm64` packages for this release are attached below if you
prefer `sudo apt install ./<file>.deb`. See
[INSTALL.md](https://github.com/Vanuan/yunmai-noble/blob/master/INSTALL.md) for
headless installs, desktop clients for a remote service, the optional
simulator, upgrades, and removal.

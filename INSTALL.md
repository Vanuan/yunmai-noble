# Installing Yunmai Noble

Yunmai Noble ships as Debian packages for `amd64` and `arm64`. You do not need
Bun, Node, or Rust on the target machine.

| Package | Contents | When to install |
| --- | --- | --- |
| `yunmai-noble-full` | Service + desktop client (metapackage) | Normal desktop install |
| `yunmai-noble` | Service, web dashboard, bundled Bun, systemd unit | Headless server or Raspberry Pi |
| `yunmai-noble-desktop` | GPUI dashboard and simulator control app | Client for a remote service |
| `yunmai-noble-simulator` | Optional virtual scale on port 3100 | Demos and testing |

Supported systems: Debian 12 (bookworm) and newer, Ubuntu 24.04 and newer, and
Raspberry Pi OS Bookworm, on `amd64` or `arm64`.

## Install from the APT repository

This is the recommended path: it gives you `apt upgrade` for later releases.

### 1. Install the keyring and source

```sh
curl -fsSLO https://vanuan.github.io/yunmai-noble/apt/yunmai-noble-archive-keyring.deb
sudo apt install ./yunmai-noble-archive-keyring.deb
```

The package installs the signing key under `/usr/share/keyrings` and a deb822
source in `/etc/apt/sources.list.d`. Both are removed with the package.

### 2. Refresh the package lists

```sh
sudo apt update
```

You should see a line like:

```
Get:1 https://vanuan.github.io/yunmai-noble/apt stable InRelease
```

### 3. Install

```sh
sudo apt install yunmai-noble-full
```

For a headless host, install only the service:

```sh
sudo apt install yunmai-noble
```

For a laptop that should use a service on another machine, install only the
client and point it at that host:

```sh
sudo apt install yunmai-noble-desktop
yunmai-noble-desktop --historian http://pi.local:3000
```

The optional demo instance can be added at any time:

```sh
sudo apt install yunmai-noble-simulator
```

### 4. Check that it runs

```sh
systemctl status yunmai-noble
journalctl -u yunmai-noble -f
```

Open `http://127.0.0.1:3000/` for the web dashboard, or start **Yunmai Noble**
from the application menu. The desktop app opens Settings from the titlebar to
choose the simulator, D-Bus, or node-bindings driver.

### Manual repository setup

If you prefer not to install the keyring package, configure the repository by
hand:

```sh
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://vanuan.github.io/yunmai-noble/apt/yunmai-noble-archive-keyring.gpg \
  | sudo tee /etc/apt/keyrings/yunmai-noble.gpg >/dev/null
sudo tee /etc/apt/sources.list.d/yunmai-noble.sources <<'EOF'
Types: deb
URIs: https://vanuan.github.io/yunmai-noble/apt
Suites: stable
Components: main
Architectures: amd64 arm64
Signed-By: /etc/apt/keyrings/yunmai-noble.gpg
EOF
sudo apt update
```

`Architectures` may be narrowed to your host architecture, or the line can be
removed to use apt's defaults.

## Update

Refresh the lists and upgrade:

```sh
sudo apt update
sudo apt full-upgrade
```

If you prefer to upgrade only this stack:

```sh
sudo apt update
sudo apt install --only-upgrade yunmai-noble yunmai-noble-desktop yunmai-noble-full
```

Check what is installed and available:

```sh
apt policy yunmai-noble
dpkg -l 'yunmai-noble*'
```

The repository keeps the current release and up to two previous ones, so
`apt install yunmai-noble=0.2.2` works while that version is still in the
pool. Older versions are on the GitHub Releases page; download the `.deb` files
and install them together (see below) to go further back.

### Change the repository definition

Edit `/etc/apt/sources.list.d/yunmai-noble.sources` (suite, URL, or component),
then refresh:

```sh
sudo apt update
```

If the signing key ever changes, upgrade `yunmai-noble-archive-keyring` (or
replace `/etc/apt/keyrings/yunmai-noble.gpg` if you configured the repository
by hand) and run `sudo apt update` again.

### Remove the repository

```sh
sudo apt remove yunmai-noble-archive-keyring
sudo apt update
```

If you configured it by hand instead, delete the source and key files:

```sh
sudo rm /etc/apt/sources.list.d/yunmai-noble.sources \
        /etc/apt/keyrings/yunmai-noble.gpg
sudo apt update
```

## Install from a downloaded `.deb`

Use this if you do not want a repository. Download the assets for your
architecture from the [releases page](https://github.com/Vanuan/yunmai-noble/releases),
then install the metapackage and its two dependencies together:

```sh
sudo apt install ./yunmai-noble_0.2.2_amd64.deb \
                 ./yunmai-noble-desktop_0.2.2_amd64.deb \
                 ./yunmai-noble-full_0.2.2_all.deb
```

Replace `amd64` with `arm64` on ARM hosts and adjust `0.2.2` if you downloaded
a different release. `apt` resolves system dependencies and installs the local
files in one transaction; plain `dpkg -i` does not.

Optional demo instance:

```sh
sudo apt install ./yunmai-noble-simulator_0.2.2_amd64.deb
```

Verify the downloads before installing:

```sh
curl -fsSLO https://vanuan.github.io/yunmai-noble/apt/yunmai-noble-archive-keyring.gpg
gpg --import yunmai-noble-archive-keyring.gpg
gpg --verify SHA256SUMS.asc SHA256SUMS
sha256sum -c --ignore-missing SHA256SUMS
```

`SHA256SUMS` covers both architectures, so `--ignore-missing` checks only the
files you downloaded.

## Uninstall

```sh
sudo apt remove yunmai-noble-full yunmai-noble-desktop
sudo apt purge yunmai-noble yunmai-noble-simulator
sudo apt autoremove
```

`apt remove` stops and disables the services but keeps
`/var/lib/yunmai-noble` and `/var/lib/yunmai-noble-simulator`. `apt purge`
deletes those databases and, when the last service package goes, the `yunmai`
system user.

## Automatic updates

`unattended-upgrades` ignores third-party repositories unless they are allowed.
Add the origin in `/etc/apt/apt.conf.d/50unattended-upgrades`:

```
Unattended-Upgrade::Allowed-Origins {
    "Yunmai Noble:stable";
};
```

## Troubleshooting

**`NO_PUBKEY` or "not signed" on `apt update`**
Reinstall `yunmai-noble-archive-keyring`, or re-download the keyring file if
you configured the repository by hand. Check that `Signed-By` points at the
file that actually exists.

**`404 Not Found` or `Hash Sum mismatch`**
A Pages deployment may be replacing the repository. Wait a minute and run
`sudo apt update` again.

**`Unable to locate package yunmai-noble-full`**
Check the suite (`stable`), component (`main`), and architecture in the
`.sources` file, then run `sudo apt update`. Only `amd64` and `arm64` are
published.

**The service starts but finds no scale**
Install BlueZ and make sure the adapter is powered. If BlueZ was installed
after Yunmai Noble, add the service user to the group and restart:

```sh
sudo adduser yunmai bluetooth
sudo systemctl restart yunmai-noble
```

**The desktop client does not open**
It needs Wayland or X11, a working GL/Vulkan driver, and fontconfig. Run
`yunmai-noble-desktop` from a terminal to see the error, or point it at a
remote service with `yunmai-noble-desktop --historian http://host:3000`.

**Ports**

- `3000` — main service and web dashboard
- `3100` — optional simulator package

Configuration lives in `/etc/yunmai-noble/`; databases live in
`/var/lib/yunmai-noble/` and `/var/lib/yunmai-noble-simulator/`.

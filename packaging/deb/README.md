# Debian packages

Four application packages are built from one staged runtime, plus a
bootstrap keyring package:

| Package | Purpose | Port | Data |
| --- | --- | --- | --- |
| `yunmai-noble-full` | Metapackage: service + desktop client | — | — |
| `yunmai-noble` | Real scale service and web UI | `3000` | `/var/lib/yunmai-noble` |
| `yunmai-noble-desktop` | GPUI dashboard and simulator control app | — | — |
| `yunmai-noble-simulator` | Virtual scale for demos | `3100` | `/var/lib/yunmai-noble-simulator` |
| `yunmai-noble-archive-keyring` | Bootstrap: signing key + apt source | — | — |

The service and the GUI are separate so a headless Raspberry Pi install does
not pull X11, Wayland, or GL libraries. `yunmai-noble-full` is the
one-command install: it depends on the exact service and desktop versions.
`yunmai-noble-desktop` talks to the suite API over HTTP and only recommends
the local service, so it can point at a remote host.

`yunmai-noble-simulator` depends on the exact `yunmai-noble` version and adds
only a unit, a config file, a launcher, and a desktop entry. All packages run
from the same `/usr/lib/yunmai-noble` tree, so installing the simulator does
not duplicate the Bun runtime or the app sources.

The desktop client is the primary way to choose the driver: it starts the
selected suite driver and stops the others through `/api/suite`. When the
simulator driver is active, it launches `yunmai-noble-simulator-ui`, a remote
control for `/api/suite/simulator`. The simulator package is therefore optional
and only useful for running a demo instance in parallel with the real service.

## Layout

```
# yunmai-noble
/usr/bin/yunmai-noble                       wrapper -> bundled Bun + suite
/usr/lib/yunmai-noble/runtime/bun           bundled Bun (self-contained)
/usr/lib/yunmai-noble/packages/             app sources + node_modules + ui/dist
/usr/lib/systemd/system/yunmai-noble.service
/etc/yunmai-noble/config.toml               main conffile
/etc/yunmai-noble/config.env                main env overrides (conffile)
/var/lib/yunmai-noble/                      SQLite database

# yunmai-noble-desktop
/usr/bin/yunmai-noble-desktop               GPUI client
/usr/bin/yunmai-noble-simulator-ui          GPUI simulator control app
/usr/share/applications/yunmai-noble.desktop
/usr/share/icons/hicolor/scalable/apps/yunmai-noble.svg

# yunmai-noble-simulator
/usr/bin/yunmai-noble-simulator             launcher for the demo instance
/usr/lib/systemd/system/yunmai-noble-simulator.service
/etc/yunmai-noble/simulator.toml            simulator conffile
/etc/yunmai-noble/simulator.env             simulator env overrides (conffile)
/usr/share/applications/yunmai-noble-simulator.desktop
/var/lib/yunmai-noble-simulator/            SQLite database

# yunmai-noble-archive-keyring
/usr/share/keyrings/yunmai-noble-archive-keyring.gpg
/etc/apt/sources.list.d/yunmai-noble.sources   repository conffile
```

Both units run as the unprivileged `yunmai` user. The main unit joins the
`bluetooth` group when BlueZ is installed so it can reach `org.bluez` on the
system D-Bus.

## Build

```sh
bun install
packaging/deb/build.sh
# or: bun run deb
```

Outputs `dist/deb/yunmai-noble_<version>_<arch>.deb`,
`yunmai-noble-desktop_<version>_<arch>.deb`,
`yunmai-noble-full_<version>_all.deb`, and
`yunmai-noble-simulator_<version>_<arch>.deb`. The script builds the web UI,
stages a clean workspace copy, runs
`bun install --production --frozen-lockfile --omit=peer --omit=optional`,
builds the desktop client and simulator UI with Cargo, and assembles the
control trees.

Useful flags:

- `--skip-desktop` builds the service and simulator packages without the
  GPUI clients, the desktop package, or the metapackage.
- `--skip-bun` skips the bundled runtime; the wrapper then uses `bun` from
  `PATH` (development only).
- `--libc <version>` overrides the detected `libc6` minimum.
- `--stage <dir>` keeps the staged trees for inspection.

The identity published in the package metadata (the `Maintainer` field, the
changelog trailers, and the copyright holder) comes from
`packaging/maintainer.env`. Change it there rather than in the individual
`control.in`, `changelog`, and `copyright` files; the build scripts substitute
it into every package.

`--omit=optional` is what keeps the legacy `@abandonware/noble` addon out of
the package; it requires Node 22 and does not load under Bun. The `dbus`
driver is the only hardware path shipped.

The bootstrap keyring package needs the archive signing key and is built
separately:

```sh
packaging/deb/keyring.sh --out dist/deb
```

## Repository

`packaging/deb/repo.sh` turns the built packages into a signed APT tree, and
`.github/workflows/release.yml` publishes it to GitHub Pages under `/apt` and
attaches the `.deb` files to a GitHub Release on every `v*` tag. The repository
uses `Acquire-By-Hash` and seeds the previous generation from the live site, so
an `apt update` during a deployment can still resolve the old indices. It also
publishes `yunmai-noble-archive-keyring.deb` at a stable URL for first-time
setup. The release workflow also adds the two previous releases' packages, so
the repository keeps three versions for pinning and for the by-hash transition.
For Launchpad, `packaging/ppa/build-source.sh` repackages the same artifacts
into a source package; see [packaging/ppa/README.md](../ppa/README.md).
See [project/DISTRIBUTION.md](../../project/DISTRIBUTION.md) for the channel,
signing-key, and retention details.

## Install

```sh
# desktop + service from the local files
sudo apt install ./yunmai-noble_0.2.4_amd64.deb \
                 ./yunmai-noble-desktop_0.2.4_amd64.deb \
                 ./yunmai-noble-full_0.2.4_all.deb

# headless service only
sudo apt install ./yunmai-noble_0.2.4_amd64.deb

# optional parallel demo instance
sudo apt install ./yunmai-noble-simulator_0.2.4_amd64.deb
```

With the APT repository configured, `sudo apt install yunmai-noble-full` is
enough. To configure apt from a local build, build and install the bootstrap
package first:

```sh
packaging/deb/keyring.sh --out dist/deb
sudo apt install ./yunmai-noble-archive-keyring_0.2.4_all.deb
sudo apt update
sudo apt install yunmai-noble-full
```

[INSTALL.md](../../INSTALL.md) has the full install, update, and removal guide,
including the published repository setup.

The post-install script creates the `yunmai` user and data directories,
enables and starts the units, and reloads systemd. `apt remove` stops and
disables the units but keeps the databases; `apt purge` removes the data and
the user.

```sh
systemctl status yunmai-noble
journalctl -u yunmai-noble -f
xdg-open http://127.0.0.1:3000/
```

## Desktop launcher

The client probes `/health` before opening. When the historian is unreachable
and the URL is loopback, it starts the packaged system unit and waits for it.
`YUNMAI_SERVICE` selects the unit, which is how `yunmai-noble-simulator` (the
launcher in the simulator package) starts `yunmai-noble-simulator.service`
instead. `YUNMAI_AUTOSTART=none` disables the whole path. Without
`yunmai-noble`, the desktop client still works with `--historian <url>`
against a remote service.

## Driver support

`simulator` and `dbus` work from the packaged runtime. The default package
omits the native `noble` addon, so the suite does not advertise Node bindings:
it needs Node 22, `@abandonware/noble`, and `CAP_NET_RAW`/`CAP_NET_ADMIN` for
the service user. The desktop client disables the option; direct API starts
fail fast with that message instead of restarting. A future `--with-noble`
build can install the optional dependencies and add the Node dependency and
unit capabilities.

## Constraints

- The GPUI binaries link the build host's glibc; the script derives the
  `libc6` dependency from them. Build on the oldest distro you support, or
  use a container, when targeting older releases.
- The package is architecture-specific. Build `arm64` on an `arm64` host or
  with an `arm64` Bun binary; the Rust client needs a matching cross toolchain.
- `bluez` is recommended, not required: without it the historian and web UI
  still run, but the `dbus` driver cannot reach a scale.

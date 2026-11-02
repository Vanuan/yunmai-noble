# Launchpad PPA packaging

This builds a Debian **source package** from the release artifacts. It is a
repack, not a source build: `upstream/<package>/<arch>` contains the installed
tree extracted from the release `.deb`, and `debian/rules` installs the tree
matching `DEB_HOST_ARCH`. Nothing is compiled on Launchpad and no network
access is needed during the build.

## Why

Bun is not in Ubuntu, and the GPUI apps need a Rust toolchain newer than the one
in noble. Shipping the same binaries that the release workflow built and tested
lets Launchpad produce per-series, per-arch packages without downloading
anything.

This is acceptable for a PPA. It would not be accepted into the Debian or
Ubuntu archives.

## Prerequisites

- A Launchpad account and a PPA, for example
  `https://launchpad.net/~vanuan/+archive/ubuntu/yunmai-noble`
- Your GPG key registered at `https://launchpad.net/account/keys`
- `dput` or `dput-ng`

## Build the source package

```sh
gh release download v0.2.3 --repo Vanuan/yunmai-noble \
  --pattern '*.deb' --dir dist/release
packaging/ppa/build-source.sh --in dist/release --out dist/ppa --series noble
```

The input directory must contain `amd64` and `arm64` builds of `yunmai-noble`,
`yunmai-noble-desktop`, and `yunmai-noble-simulator`, plus the `all`
metapackage. The archive-keyring package is ignored.

Outputs in `dist/ppa/`:

```
yunmai-noble_<version>.orig.tar.xz
yunmai-noble_<debian-version>.debian.tar.xz
yunmai-noble_<debian-version>.dsc
yunmai-noble_<debian-version>_source.changes
```

Use `--no-sign` to produce an unsigned source package for inspection. The
signing key is taken from `--gpg-key`, `GPG_KEY_ID`, or the first secret key.

The release workflow also builds this source package and attaches it to the
GitHub release as `yunmai-noble_<version>_ppa-source.tar`. GitHub replaces `~`
in asset names with `.`, which would break the filenames referenced by the
`.changes`, so the source files are bundled with their original names. Extract
the tar and run `dput` on the `.changes` inside. The signing key must be
registered with Launchpad; the release workflow signs with the repository key.
For a passphrase-protected key, run the script where gpg-agent can unlock it.

## Upload

```sh
dput ppa:vanuan/yunmai-noble \
  dist/ppa/yunmai-noble_0.2.3-0ubuntu1~noble1_source.changes
```

If your `dput` does not support the `ppa:` shorthand, add this to
`~/.dput.cf`:

```
[yunmai-noble]
fqdn = ppa.launchpad.net
method = ftp
incoming = ~vanuan/ubuntu/yunmai-noble/
login = anonymous
```

and run `dput yunmai-noble <changes>`.

Enable `arm64` in the PPA settings to get the Raspberry Pi builds. Launchpad
builds one package set per enabled architecture; the source package already
contains both trees.

## Series

The changelog targets one Ubuntu series. For 26.04:

```sh
packaging/ppa/build-source.sh --in dist/release --out dist/ppa --series resolute
```

The version gets a `~resolute1` suffix; the upstream tarball is shared with the
noble upload. Upload both `.changes` files.

## Users

```sh
sudo add-apt-repository ppa:vanuan/yunmai-noble
sudo apt install yunmai-noble-full
```

Launchpad signs the PPA with its own key, so `yunmai-noble-archive-keyring` is
not used on this channel.

Do not enable both the Pages repository and the PPA: they publish the same
package names.

## Lintian notes

Source-package lintian will report `source-is-missing` for the prebuilt
binaries and, when run on a release older than the target series,
`bad-distribution-in-changes-file` for `noble` or `resolute`. Neither is a
Launchpad check; PPAs accept repacked binaries. The binary packages themselves
pass `lintian --fail-on error` with the same warnings as the release `.deb`
files.

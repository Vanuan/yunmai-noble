# Distribution

## Packages

Four application packages are built from one staged runtime by
`packaging/deb/build.sh`, plus a bootstrap keyring package built by
`packaging/deb/keyring.sh`:

| Package | Contents | Size |
| --- | --- | --- |
| `yunmai-noble` | Service, web UI, bundled Bun, systemd unit | ~30 MB |
| `yunmai-noble-desktop` | GPUI dashboard and simulator control app | ~17 MB |
| `yunmai-noble-full` | Metapackage: service + desktop | ~4 KB |
| `yunmai-noble-simulator` | Optional parallel demo instance | ~4 KB |
| `yunmai-noble-archive-keyring` | Signing key and apt source | ~4 KB |

See [packaging/deb/README.md](../packaging/deb/README.md) for the file layout
and build flags.

## Channels

| Channel | What | Where |
| --- | --- | --- |
| GitHub Releases | Versioned `.deb`, `SHA256SUMS`, `SHA256SUMS.asc` | `https://github.com/Vanuan/yunmai-noble/releases` |
| APT repository | Signed `stable` suite, `main` component, `amd64` + `arm64` | `https://vanuan.github.io/yunmai-noble/apt` |

`stable` tracks tagged releases. The APT repository keeps the current release
plus up to two previous ones, so recent versions can be pinned or downgraded;
older versions stay on Releases. A `snapshot` channel for every `master` build
is not implemented.

## Release workflow

`.github/workflows/release.yml` runs on any `v*` tag:

1. Checks that the tag matches `version` in `package.json`.
2. Builds on `amd64` and `arm64` in `buildpack-deps:bookworm`, so the binaries
   require glibc 2.36.
3. Runs `bun test packages`, `bun run typecheck`, and `cargo test --workspace`
   on `amd64`.
4. Builds the four application `.deb` files and uploads them as artifacts.
5. Imports the signing key, builds the keyring package and the APT repository,
   builds the PPA source package, deploys the site to GitHub Pages, and
   publishes the `.deb` files, checksums, and PPA source package as a GitHub
   Release.

CI runs separately in `.github/workflows/ci.yml` on every push to `master` and
on pull requests: Bun tests, typecheck, `cargo fmt`, Rust tests, and a bookworm
package build gated by `lintian --fail-on error`.

Setup once:

- Add the `GPG_PRIVATE_KEY` repository secret (armored secret key). Add
  `GPG_PASSPHRASE` only if the key has a passphrase.
- Enable Pages: **Settings → Pages → Build and deployment → Source: GitHub
  Actions**.
- Keep the repository public; the `ubuntu-24.04-arm` hosted runner is available
  for public repositories.

Then:

```sh
git tag v0.2.2
git push origin v0.2.2
```

## Launchpad PPA

`packaging/ppa/build-source.sh` repackages a tagged release into a Debian source
package: `upstream/<package>/<arch>` holds the release trees, and
`debian/rules` installs the one matching `DEB_HOST_ARCH`. The release workflow
builds this source package and attaches it to the GitHub Release; upload it with
`dput` after registering the signing key at Launchpad.

This channel ships prebuilt binaries (Bun, GPUI, and node_modules). PPAs allow
that; the Debian and Ubuntu archives do not. It supports the series you upload
for (`noble`, `resolute`) and both architectures. See
[packaging/ppa/README.md](../packaging/ppa/README.md).

Do not enable the Pages repository and the PPA at the same time: they publish
the same package names.

## Repository layout

```
https://vanuan.github.io/yunmai-noble/apt/
├── .nojekyll
├── yunmai-noble-archive-keyring.gpg
├── yunmai-noble-archive-keyring.deb        stable bootstrap URL
├── dists/stable/InRelease
├── dists/stable/Release{,.gpg}
├── dists/stable/main/binary-amd64/
│   ├── Packages{,.gz}
│   └── by-hash/SHA256/<hash>               current and previous indices
├── dists/stable/main/binary-arm64/         same layout
├── pool/main/<package>/*.deb
└── SHA256SUMS
```

`repo.sh` derives the architecture list from the packages, includes
`Architecture: all` packages in every index, and writes the `Release`
checksums itself so it does not need `apt-utils`. It scans with
`dpkg-scanpackages --multiversion`, so every retained version stays in the
index and can be pinned. `Release` advertises `Acquire-By-Hash: yes`; the
script copies the current indices into `by-hash/` and, with `--seed-url`,
downloads the live repository's previous indices so a client that fetched the
old `Release` can still resolve them during a deployment.

## Install from the repository

User-facing instructions live in [INSTALL.md](../INSTALL.md). In short, clients
download `yunmai-noble-archive-keyring.deb` from the repository root, install
it (it adds `/usr/share/keyrings/yunmai-noble-archive-keyring.gpg` and the
deb822 source), run `apt update`, then install `yunmai-noble-full`.

`unattended-upgrades` ignores third-party repositories unless they are allowed
explicitly. Add the origin in `/etc/apt/apt.conf.d/50unattended-upgrades`:

```
Unattended-Upgrade::Allowed-Origins {
    "Yunmai Noble:stable";
};
```

## Signing key

The key signs `dists/stable/InRelease`, `dists/stable/Release.gpg`, and
`SHA256SUMS.asc`; the public half is published as
`yunmai-noble-archive-keyring.gpg` and packaged with the apt source. Both
`repo.sh` and `keyring.sh` export it from whichever key they are given.

Generate an archive key once:

```sh
gpg --quick-generate-key "Yunmai Noble Archive <archive@yunmai.dev>" ed25519 sign 5y
gpg --armor --export-secret-keys <fingerprint>   # repository secret
```

Rotation: import the new key while keeping the old one, publish a keyring
package that contains both, sign one release with the new key, then drop the
old key from a later package version. Clients keep the key until they upgrade
the keyring package, so do not remove the old key in the same release that
introduces the new one.

## Local testing

Build the packages, then a repository without signing:

```sh
packaging/deb/build.sh
packaging/deb/keyring.sh --out dist/deb
packaging/deb/repo.sh --unsigned --in dist/deb --out dist/apt-test
```

Add `--seed-url file:$PWD/dist/apt-test` on a second run to exercise the
by-hash seed path.

With a throwaway key:

```sh
export GNUPGHOME=$(mktemp -d)
gpg --batch --passphrase '' --quick-gen-key "Test <test@example.com>" ed25519 sign 1d
packaging/deb/repo.sh --in dist/deb --out dist/apt-test
```

Verify signing and metadata with apt against `file:`:

```sh
mkdir -p /tmp/yunmai-apt/lists/partial /tmp/yunmai-apt/cache
printf 'deb [signed-by=%s/dist/apt-test/yunmai-noble-archive-keyring.gpg] file:%s/dist/apt-test stable main\n' \
  "$PWD" "$PWD" > /tmp/yunmai-apt/sources.list
apt-get -o Dir::Etc::sourcelist=/tmp/yunmai-apt/sources.list \
  -o Dir::Etc::sourceparts=/dev/null \
  -o Dir::State::lists=/tmp/yunmai-apt/lists \
  -o Dir::Cache=/tmp/yunmai-apt/cache \
  -o Dir::State::status=/tmp/yunmai-apt/status \
  -o APT::Sandbox::User=root \
  update
```

## Constraints

- GitHub Pages limits: 1 GB per published site and roughly 100 GB bandwidth per
  month. One release is about 85 MB across both architectures; the workflow
  carries the current and up to two previous releases (~250 MB), which leaves
  room for more. Use Releases for older history.
- The glibc baseline comes from the build image (`bookworm`, 2.36), so the
  packages run on Debian bookworm/trixie and Ubuntu 24.04+, not Ubuntu 22.04 or
  Raspberry Pi OS bullseye.
- The repository uses `Acquire-By-Hash` and keeps the current and previous
  index generations. If a client still reports a 404 or hash mismatch, retry
  `apt update` once.
- `repo.sh` rebuilds the output tree from its input. The release workflow adds
  the two previous releases' `.deb` assets before running it, and `--keep`
  (default 3) prunes older versions.

# Distribution

## Packages

Four packages are built from one staged runtime by `packaging/deb/build.sh`:

| Package | Contents | Size |
| --- | --- | --- |
| `yunmai-noble` | Service, web UI, bundled Bun, systemd unit | ~30 MB |
| `yunmai-noble-desktop` | GPUI dashboard and simulator control app | ~17 MB |
| `yunmai-noble-full` | Metapackage: service + desktop | ~4 KB |
| `yunmai-noble-simulator` | Optional parallel demo instance | ~4 KB |

See [packaging/deb/README.md](../packaging/deb/README.md) for the file layout
and build flags.

## Channels

| Channel | What | Where |
| --- | --- | --- |
| GitHub Releases | Versioned `.deb`, `SHA256SUMS`, `SHA256SUMS.asc` | `https://github.com/Vanuan/yunmai-noble/releases` |
| APT repository | Signed `stable` suite, `main` component, `amd64` + `arm64` | `https://vanuan.github.io/yunmai-noble/apt` |

`stable` tracks tagged releases. The APT repository holds the release that
produced the current Pages deployment; older versions stay on Releases. A
`snapshot` channel for every `master` build is not implemented.

## Release workflow

`.github/workflows/release.yml` runs on any `v*` tag:

1. Checks that the tag matches `version` in `package.json`.
2. Builds on `amd64` and `arm64` in `buildpack-deps:bookworm`, so the binaries
   require glibc 2.36.
3. Runs `bun test packages`, `bun run typecheck`, and `cargo test --workspace`
   on `amd64`.
4. Builds the four `.deb` files and uploads them as artifacts.
5. Imports the signing key, builds the repository with
   `packaging/deb/repo.sh`, deploys the site to GitHub Pages, and publishes the
   `.deb` files and checksums as a GitHub Release.

Setup once:

- Add the `GPG_PRIVATE_KEY` repository secret (armored secret key). Add
  `GPG_PASSPHRASE` only if the key has a passphrase.
- Enable Pages: **Settings → Pages → Build and deployment → Source: GitHub
  Actions**.
- Keep the repository public; the `ubuntu-24.04-arm` hosted runner is available
  for public repositories.

Then:

```sh
git tag v0.2.0
git push origin v0.2.0
```

## Repository layout

```
https://vanuan.github.io/yunmai-noble/apt/
├── .nojekyll
├── yunmai-noble-archive-keyring.gpg
├── dists/stable/InRelease
├── dists/stable/Release{,.gpg}
├── dists/stable/main/binary-amd64/Packages{,.gz}
├── dists/stable/main/binary-arm64/Packages{,.gz}
├── pool/main/<package>/*.deb
└── SHA256SUMS
```

`repo.sh` derives the architecture list from the packages, includes
`Architecture: all` packages in every index, and writes the `Release`
checksums itself so it does not need `apt-utils`.

## Install from the repository

User-facing instructions live in [INSTALL.md](../INSTALL.md). In short, clients
add `/etc/apt/keyrings/yunmai-noble.gpg` and a deb822 source for
`https://vanuan.github.io/yunmai-noble/apt` (suite `stable`, component `main`),
run `apt update`, then install `yunmai-noble-full`.

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
`yunmai-noble-archive-keyring.gpg`. `repo.sh` exports it from whichever key it
signs with.

Generate an archive key once:

```sh
gpg --quick-generate-key "Yunmai Noble Archive <archive@yunmai.dev>" ed25519 sign 5y
gpg --armor --export-secret-keys <fingerprint>   # repository secret
```

Rotation: import the new key while keeping the old one, sign one release with
both (`repo.sh` signs with one key, so publish the combined keyring manually),
then drop the old key. Clients keep the old key until they re-download the
keyring, so do not remove it from the published keyring immediately.

## Local testing

Build the packages, then a repository without signing:

```sh
packaging/deb/build.sh
packaging/deb/repo.sh --unsigned --in dist/deb --out dist/apt-test
```

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
  month. One release is about 47 MB across both architectures, and the Pages
  site is replaced on every deployment, so only the current release lives
  there. Use Releases for history.
- The glibc baseline comes from the build image (`bookworm`, 2.36), so the
  packages run on Debian bookworm/trixie and Ubuntu 24.04+, not Ubuntu 22.04 or
  Raspberry Pi OS bullseye.
- The repository does not use `Acquire-By-Hash`; while a deployment is running,
  a client can see a new `InRelease` with old index files. Retry `apt update` in
  that window.
- `repo.sh` rebuilds the output tree from its input. Pass multiple versions to
  make it keep them (`--keep`, default 3); with a single release it publishes
  only that version.

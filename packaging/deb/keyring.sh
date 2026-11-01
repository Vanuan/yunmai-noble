#!/usr/bin/env bash
#
# Build the bootstrap package that installs the archive signing key and the
# APT source. Run it with the signing key available:
#
#   packaging/deb/keyring.sh --out dist/deb
#
# The release workflow imports GPG_PRIVATE_KEY first and then calls this before
# packaging/deb/repo.sh, so the keyring package is published in the repository
# and attached to the release.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
PKG_DIR="$ROOT/packaging/deb/yunmai-noble-archive-keyring"
OUT="$ROOT/dist/deb"
VERSION=$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -n 1)
GPG_KEY=""

usage() {
  cat <<'EOF'
Usage: packaging/deb/keyring.sh [options]

  --out <dir>       output directory (default: dist/deb)
  --version <ver>   package version (default: root package.json version)
  --gpg-key <id>    signing key; defaults to GPG_KEY_ID or the first secret key
  -h, --help        show this help
EOF
}

log() {
  printf '==> %s\n' "$*"
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --out) OUT=${2:?--out requires a value}; shift 2 ;;
    --version) VERSION=${2:?--version requires a value}; shift 2 ;;
    --gpg-key) GPG_KEY=${2:?--gpg-key requires a value}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

case "$VERSION" in
  [0-9]*) ;;
  *) die "invalid version: $VERSION" ;;
esac

command -v gpg >/dev/null || die "gpg not found"
command -v dpkg-deb >/dev/null || die "dpkg-deb not found"

if [ -z "$GPG_KEY" ]; then
  GPG_KEY=${GPG_KEY_ID:-}
fi
if [ -z "$GPG_KEY" ]; then
  GPG_KEY=$(gpg --batch --list-secret-keys --with-colons 2>/dev/null |
    awk -F: '$1 == "sec" { print $5; exit }')
fi
[ -n "$GPG_KEY" ] || die "no signing key; pass --gpg-key or set GPG_KEY_ID"

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
PKG="$STAGE/pkg"

mkdir -p \
  "$PKG/DEBIAN" \
  "$PKG/usr/share/keyrings" \
  "$PKG/usr/share/doc/yunmai-noble-archive-keyring" \
  "$PKG/usr/share/lintian/overrides" \
  "$PKG/etc/apt/sources.list.d"

gpg --batch --export "$GPG_KEY" > \
  "$PKG/usr/share/keyrings/yunmai-noble-archive-keyring.gpg"
[ -s "$PKG/usr/share/keyrings/yunmai-noble-archive-keyring.gpg" ] ||
  die "export of $GPG_KEY produced an empty keyring"

cp "$PKG_DIR/yunmai-noble.sources" \
  "$PKG/etc/apt/sources.list.d/yunmai-noble.sources"
cp "$PKG_DIR/README.Debian" "$ROOT/packaging/deb/yunmai-noble/copyright" \
  "$PKG/usr/share/doc/yunmai-noble-archive-keyring/"
cp "$PKG_DIR/lintian-overrides" \
  "$PKG/usr/share/lintian/overrides/yunmai-noble-archive-keyring"
gzip -9n -c "$ROOT/packaging/deb/yunmai-noble/changelog" \
  > "$PKG/usr/share/doc/yunmai-noble-archive-keyring/changelog.gz"

printf '%s\n' /etc/apt/sources.list.d/yunmai-noble.sources \
  > "$PKG/DEBIAN/conffiles"

installed_size=$(du -sk "$PKG/usr" | awk '{print $1}')
sed \
  -e "s|@VERSION@|$VERSION|g" \
  -e "s|@INSTALLED_SIZE@|$installed_size|g" \
  "$PKG_DIR/control.in" > "$PKG/DEBIAN/control"

find "$PKG" -type d -exec chmod 0755 {} +
find "$PKG" -type f -exec chmod 0644 {} +

(
  cd "$PKG"
  find . -type f ! -path './DEBIAN/*' -printf '%P\0' |
    sort -z | xargs -0 md5sum
) > "$PKG/DEBIAN/md5sums"

mkdir -p "$OUT"
TARGET="$OUT/yunmai-noble-archive-keyring_${VERSION}_all.deb"
rm -f "$TARGET"
dpkg-deb --root-owner-group --build "$PKG" "$TARGET"

log "keyring package built from $GPG_KEY"
printf '  %s (%s)\n' "$TARGET" "$(du -h "$TARGET" | awk '{print $1}')"

#!/usr/bin/env bash
#
# Build a Launchpad source package from the release artifacts. This is the
# "Path A" packaging: the payload is the tree that the release workflow already
# built and tested, extracted per architecture. Launchpad only runs
# debian/rules, which installs the matching tree; nothing is compiled there.
#
#   packaging/ppa/build-source.sh --in dist/release --out dist/ppa --series noble
#   packaging/ppa/build-source.sh --in dist/release --out dist/ppa --series noble --no-sign
#
# Upload with dput after registering the signing key with Launchpad:
#   dput ppa:<user>/<ppa> dist/ppa/yunmai-noble_<version>_source.changes
set -euo pipefail
export LC_ALL=C

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
TEMPLATES="$ROOT/packaging/ppa/debian"
APP_DEB_DIR="$ROOT/packaging/deb"
# shellcheck source=../maintainer.env
. "$ROOT/packaging/maintainer.env"
MAINTAINER=${MAINTAINER:?packaging/maintainer.env must set MAINTAINER}

IN="$ROOT/dist/deb"
OUT="$ROOT/dist/ppa"
SERIES=noble
SIGN=1
GPG_KEY=""

usage() {
  cat <<'EOF'
Usage: packaging/ppa/build-source.sh [options]

  --in <dir>        directory with the release .deb files (default: dist/deb)
  --out <dir>       output directory (default: dist/ppa)
  --series <name>   Ubuntu series for the changelog (default: noble)
  --gpg-key <id>    upload key; defaults to GPG_KEY_ID or the first secret key
  --no-sign         build an unsigned source package (local testing only)
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
    --in) IN=${2:?--in requires a value}; shift 2 ;;
    --out) OUT=${2:?--out requires a value}; shift 2 ;;
    --series) SERIES=${2:?--series requires a value}; shift 2 ;;
    --gpg-key) GPG_KEY=${2:?--gpg-key requires a value}; shift 2 ;;
    --no-sign) SIGN=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

[ -d "$IN" ] || die "no such input directory: $IN"
command -v dpkg-deb >/dev/null || die "dpkg-deb not found"
command -v dpkg-buildpackage >/dev/null || die "dpkg-buildpackage not found (dpkg-dev)"
case "$SERIES" in
  [a-z]*) ;;
  *) die "invalid series: $SERIES" ;;
esac

VERSION=$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -n 1)
[ -n "$VERSION" ] || die "cannot read the version from package.json"
DEB_VERSION="${VERSION}-0ubuntu1~${SERIES}1"

if [ "$SIGN" -eq 1 ]; then
  if [ -z "$GPG_KEY" ]; then
    GPG_KEY=${GPG_KEY_ID:-}
  fi
  if [ -z "$GPG_KEY" ]; then
    GPG_KEY=$(gpg --batch --list-secret-keys --with-colons 2>/dev/null |
      awk -F: '$1 == "sec" { print $5; exit }')
  fi
  [ -n "$GPG_KEY" ] || die "no signing key; pass --gpg-key, set GPG_KEY_ID, or use --no-sign"
fi

shopt -s nullglob
debs=("$IN"/*.deb)
[ "${#debs[@]}" -gt 0 ] || die "no .deb files in $IN"

# Architectures come from the core package; every architecture needs all three
# architecture-specific packages.
archs=()
for deb in "$IN"/yunmai-noble_"${VERSION}"_*.deb; do
  arch=$(dpkg-deb -f "$deb" Architecture)
  [ "$arch" = "all" ] && continue
  case " ${archs[*]-} " in
    *" $arch "*) ;;
    *) archs+=("$arch") ;;
  esac
done
[ "${#archs[@]}" -gt 0 ] || die "no yunmai-noble packages for version $VERSION in $IN"
mapfile -t archs < <(printf '%s\n' "${archs[@]}" | sort)

for arch in "${archs[@]}"; do
  for pkg in yunmai-noble yunmai-noble-desktop yunmai-noble-simulator; do
    [ -f "$IN/${pkg}_${VERSION}_${arch}.deb" ] ||
      die "missing $IN/${pkg}_${VERSION}_${arch}.deb"
  done
done
[ -f "$IN/yunmai-noble-full_${VERSION}_all.deb" ] ||
  die "missing $IN/yunmai-noble-full_${VERSION}_all.deb"

ARCHS=$(printf '%s\n' "${archs[@]}" | paste -sd' ' -)
log "version $VERSION, series $SERIES, architectures $ARCHS"

SRC="$OUT/yunmai-noble-${VERSION}"
rm -rf "$SRC"
mkdir -p "$SRC/debian/source" "$SRC/upstream"

for arch in "${archs[@]}"; do
  for pkg in yunmai-noble yunmai-noble-desktop yunmai-noble-simulator; do
    mkdir -p "$SRC/upstream/$pkg/$arch"
    dpkg-deb -x "$IN/${pkg}_${VERSION}_${arch}.deb" "$SRC/upstream/$pkg/$arch"
  done
done
mkdir -p "$SRC/upstream/yunmai-noble-full/all"
dpkg-deb -x "$IN/yunmai-noble-full_${VERSION}_all.deb" \
  "$SRC/upstream/yunmai-noble-full/all"

log "staging debian/ metadata"
cp "$TEMPLATES/rules" "$SRC/debian/rules"
cp "$TEMPLATES/copyright" "$SRC/debian/copyright"
cp "$TEMPLATES/README.source" "$SRC/debian/README.source"
cp "$TEMPLATES/source/format" "$SRC/debian/source/format"

for pkg in yunmai-noble yunmai-noble-simulator; do
  for script in postinst prerm postrm; do
    cp "$APP_DEB_DIR/$pkg/$script" "$SRC/debian/$pkg.$script"
    # debhelper expects the token; the release packages do not use debhelper.
    sed -i 's/^exit 0$/#DEBHELPER#\n\nexit 0/' "$SRC/debian/$pkg.$script"
    chmod 0755 "$SRC/debian/$pkg.$script"
  done
done
chmod 0755 "$SRC/debian/rules"

sed \
  -e "s|@ARCHS@|$ARCHS|g" \
  -e "s|@MAINTAINER@|$MAINTAINER|g" \
  "$TEMPLATES/control.in" > "$SRC/debian/control"

if [ -n "${SOURCE_DATE_EPOCH:-}" ]; then
  DATE=$(date -R -d "@$SOURCE_DATE_EPOCH")
else
  DATE=$(date -R)
fi
sed \
  -e "s|@VERSION@|$DEB_VERSION|g" \
  -e "s|@UPSTREAM@|$VERSION|g" \
  -e "s|@SERIES@|$SERIES|g" \
  -e "s|@MAINTAINER@|$MAINTAINER|g" \
  -e "s|@DATE@|$DATE|g" \
  "$TEMPLATES/changelog.in" > "$SRC/debian/changelog"

log "creating the orig tarball"
ORIG="$OUT/yunmai-noble_${VERSION}.orig.tar.xz"
rm -f "$ORIG"
tar_opts=(--sort=name --owner=0 --group=0 --numeric-owner)
if [ -n "${SOURCE_DATE_EPOCH:-}" ]; then
  tar_opts+=(--mtime="@$SOURCE_DATE_EPOCH")
fi
tar --create --xz --file "$ORIG" --directory "$OUT" "${tar_opts[@]}" \
  --exclude="yunmai-noble-${VERSION}/debian" "yunmai-noble-${VERSION}"

log "building the source package"
(
  cd "$SRC"
  if [ "$SIGN" -eq 1 ]; then
    dpkg-buildpackage -S -sa -d -nc -k"$GPG_KEY"
  else
    dpkg-buildpackage -S -sa -d -nc -us -uc
  fi
)

CHANGES=$(find "$OUT" -maxdepth 1 -name "yunmai-noble_${DEB_VERSION}_source.changes" -print -quit)
[ -n "$CHANGES" ] || die "source build did not produce a .changes file"

log "done"
printf '  %s\n' "$CHANGES"
printf '  %s\n' "$ORIG"
printf '\nUpload after registering the key with Launchpad:\n'
printf '  dput ppa:<user>/<ppa> %s\n' "$CHANGES"

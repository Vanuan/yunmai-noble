#!/usr/bin/env bash
#
# Build the yunmai-noble service, desktop, metapackage, and simulator Debian
# packages with dpkg-deb. No fpm or cargo-deb: the runtime tree is staged
# explicitly so the same layout can be reused by CI or a Nix derivation later.
#
#   packaging/deb/build.sh
#   packaging/deb/build.sh --arch arm64 --version 0.2.1 --out dist/deb
#
set -euo pipefail

# dpkg-deb rejects an empty SOURCE_DATE_EPOCH, so treat it as unset.
[ -n "${SOURCE_DATE_EPOCH:-}" ] || unset SOURCE_DATE_EPOCH

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
PKG_DIR="$ROOT/packaging/deb"

ARCH=$(dpkg --print-architecture)
VERSION=$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -n 1)
OUT="$ROOT/dist/deb"
STAGE=""
BUN_ARG=""
LIBC_ARG=""
SKIP_DESKTOP=0
SKIP_BUN=0

usage() {
  cat <<'EOF'
Usage: packaging/deb/build.sh [options]

  --arch <arch>        target architecture (default: dpkg --print-architecture)
  --version <version>  package version (default: root package.json version)
  --out <dir>          output directory (default: dist/deb)
  --stage <dir>        staging directory (default: <out>/stage)
  --bun <path>         Bun binary to bundle (default: bun on PATH)
  --libc <version>     minimum glibc version (default: detected from binaries)
  --skip-desktop       do not build the GPUI clients, desktop package, or
                       metapackage
  --skip-bun           do not bundle Bun; the wrapper falls back to PATH
  -h, --help           show this help
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
    --arch) ARCH=${2:?--arch requires a value}; shift 2 ;;
    --version) VERSION=${2:?--version requires a value}; shift 2 ;;
    --out) OUT=${2:?--out requires a value}; shift 2 ;;
    --stage) STAGE=${2:?--stage requires a value}; shift 2 ;;
    --bun) BUN_ARG=${2:?--bun requires a value}; shift 2 ;;
    --libc) LIBC_ARG=${2:?--libc requires a value}; shift 2 ;;
    --skip-desktop) SKIP_DESKTOP=1; shift ;;
    --skip-bun) SKIP_BUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

case "$VERSION" in
  [0-9]*) ;;
  *) die "invalid version: $VERSION" ;;
esac

[ -n "$STAGE" ] || STAGE="$OUT/stage"
case "$STAGE" in
  /|"$ROOT") die "refusing to use $STAGE as the staging directory" ;;
esac

if [ -z "$BUN_ARG" ]; then
  BUN_ARG=$(command -v bun || true)
fi
[ -n "$BUN_ARG" ] || die "bun not found; pass --bun <path>"
BUN=$(readlink -f "$BUN_ARG")
[ -x "$BUN" ] || die "not executable: $BUN"

command -v dpkg-deb >/dev/null || die "dpkg-deb not found"

log "version $VERSION, architecture $ARCH"
log "staging in $STAGE"

rm -rf "$STAGE"
mkdir -p "$STAGE/app" "$STAGE/desktop" \
  "$STAGE/pkg/yunmai-noble" "$STAGE/pkg/yunmai-noble-desktop" \
  "$STAGE/pkg/yunmai-noble-full" "$STAGE/pkg/yunmai-noble-simulator"

log "building web UI"
(cd "$ROOT" && "$BUN" run build:ui)

log "copying runtime sources"
# Copy the workspace without development-only state. packages/ui/dist is kept
# while the root dist/ (package output) is not.
tar -C "$ROOT" \
  --exclude='./.git' \
  --exclude='./node_modules' \
  --exclude='./target' \
  --exclude='./data' \
  --exclude='./dist' \
  --exclude='./packaging' \
  --exclude='./apps' \
  --exclude='./docs' \
  --exclude='./project' \
  --exclude='./Cargo.toml' \
  --exclude='./Cargo.lock' \
  --exclude='./package-lock.json' \
  --exclude='./lab.toml' \
  --exclude='./run.sh' \
  --exclude='./.dockerignore' \
  --exclude='./.gitignore' \
  --exclude='./.nvmrc' \
  --exclude='./Dockerfile*' \
  -cf - . | tar -C "$STAGE/app" -xf -

find "$STAGE/app" -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) -delete

log "installing production dependencies"
(cd "$STAGE/app" && "$BUN" install \
  --production --frozen-lockfile --omit=peer --omit=optional)

find "$STAGE/app/node_modules" -type f \( -name '.npmignore' -o -name '.eslintignore' \) -delete

[ -d "$STAGE/app/node_modules/ws" ] || die "runtime is missing ws"
[ -f "$STAGE/app/packages/ui/dist/index.html" ] || die "dashboard build missing"
[ -f "$STAGE/app/packages/ui/dist/simulator/index.html" ] || die "simulator build missing"
if [ -e "$STAGE/app/node_modules/@abandonware" ]; then
  die "legacy noble addon was installed; do not ship it"
fi

if [ "$SKIP_BUN" -eq 0 ]; then
  log "bundling Bun runtime"
  mkdir -p "$STAGE/app/runtime"
  cp "$BUN" "$STAGE/app/runtime/bun"
  chmod 0755 "$STAGE/app/runtime/bun"
else
  log "skipping bundled Bun; wrapper will use bun from PATH"
fi

if [ "$SKIP_DESKTOP" -eq 0 ]; then
  log "building desktop client and simulator UI"
  (cd "$ROOT" && cargo build --release \
    -p yunmai-noble-desktop \
    -p yunmai-noble-simulator-ui)
  cp "$ROOT/target/release/yunmai-noble-desktop" "$STAGE/desktop/"
  cp "$ROOT/target/release/yunmai-noble-simulator-ui" "$STAGE/desktop/"
  chmod 0755 "$STAGE/desktop/yunmai-noble-desktop" \
    "$STAGE/desktop/yunmai-noble-simulator-ui"
else
  log "skipping desktop client"
fi

# The desktop binary is linked against the build host's glibc, so derive the
# dependency instead of hardcoding a version that would be wrong elsewhere.
detect_libc() {
  local binary=$1 version
  [ -f "$binary" ] || return 0
  command -v readelf >/dev/null 2>&1 || return 0
  version=$(readelf --version-info "$binary" 2>/dev/null |
    grep -o 'GLIBC_[0-9.]*' | sed 's/^GLIBC_//' | sort -Vu | tail -n 1 || true)
  printf '%s\n' "$version"
}

LIBC=$LIBC_ARG
if [ -z "$LIBC" ]; then
  for binary in "$STAGE/app/runtime/bun" "$STAGE/desktop/yunmai-noble-desktop"; do
    detected=$(detect_libc "$binary")
    if [ -n "$detected" ] && { [ -z "$LIBC" ] || [ "$(printf '%s\n%s\n' "$LIBC" "$detected" | sort -Vu | tail -n 1)" = "$detected" ]; }; then
      LIBC=$detected
    fi
  done
fi
[ -n "$LIBC" ] || LIBC=2.39
log "minimum libc6: $LIBC"

write_control() {
  local target=$1 installed_size
  installed_size=$(du -sk "$target/usr" 2>/dev/null | awk '{print $1}')
  [ -n "$installed_size" ] || installed_size=0
  sed \
    -e "s|@VERSION@|$VERSION|g" \
    -e "s|@ARCH@|$ARCH|g" \
    -e "s|@LIBC@|$LIBC|g" \
    -e "s|@INSTALLED_SIZE@|$installed_size|g" \
    "$2" > "$target/DEBIAN/control"
}

write_md5sums() {
  local target=$1
  (
    cd "$target"
    find . -type f ! -path './DEBIAN/*' -printf '%P\0' |
      sort -z | xargs -0 md5sum
  ) > "$target/DEBIAN/md5sums"
}

log "assembling yunmai-noble"
MAIN="$STAGE/pkg/yunmai-noble"
mkdir -p \
  "$MAIN/DEBIAN" \
  "$MAIN/usr/bin" \
  "$MAIN/usr/lib/systemd/system" \
  "$MAIN/usr/share/doc/yunmai-noble" \
  "$MAIN/usr/share/lintian/overrides" \
  "$MAIN/etc/yunmai-noble"

# Source files come from a working tree with mixed modes. Normalize them so
# nothing under /usr is world- or group-writable.
find "$STAGE/app" -type d -exec chmod 0755 {} +
find "$STAGE/app" -type f -exec chmod 0644 {} +
[ "$SKIP_BUN" -eq 1 ] || chmod 0755 "$STAGE/app/runtime/bun"

cp -a "$STAGE/app" "$MAIN/usr/lib/yunmai-noble"
cp "$PKG_DIR/yunmai-noble/yunmai-noble.service" "$MAIN/usr/lib/systemd/system/"
cp "$PKG_DIR/yunmai-noble/config.toml" "$MAIN/etc/yunmai-noble/"
cp "$PKG_DIR/yunmai-noble/config.env" "$MAIN/etc/yunmai-noble/"
cp "$PKG_DIR/yunmai-noble/README.Debian" "$MAIN/usr/share/doc/yunmai-noble/"
cp "$PKG_DIR/yunmai-noble/copyright" "$MAIN/usr/share/doc/yunmai-noble/"
cp "$PKG_DIR/yunmai-noble/lintian-overrides" \
  "$MAIN/usr/share/lintian/overrides/yunmai-noble"
gzip -9n -c "$PKG_DIR/yunmai-noble/changelog" \
  > "$MAIN/usr/share/doc/yunmai-noble/changelog.gz"
cp "$PKG_DIR/yunmai-noble/postinst" "$PKG_DIR/yunmai-noble/prerm" \
  "$PKG_DIR/yunmai-noble/postrm" "$MAIN/DEBIAN/"

cat > "$MAIN/usr/bin/yunmai-noble" <<'EOF'
#!/bin/sh
set -e
root=/usr/lib/yunmai-noble
if [ -x "$root/runtime/bun" ]; then
  PATH="$root/runtime:$PATH"
  export PATH
  exec "$root/runtime/bun" "$root/packages/suite/src/main.ts" "$@"
fi
if command -v bun >/dev/null 2>&1; then
  exec "$(command -v bun)" "$root/packages/suite/src/main.ts" "$@"
fi
echo "yunmai-noble: no Bun runtime found; reinstall the package" >&2
exit 1
EOF

printf '%s\n' /etc/yunmai-noble/config.toml /etc/yunmai-noble/config.env \
  > "$MAIN/DEBIAN/conffiles"
find "$MAIN" -type d -exec chmod 0755 {} +
write_control "$MAIN" "$PKG_DIR/yunmai-noble/control.in"
write_md5sums "$MAIN"

chmod 0755 "$MAIN/DEBIAN/postinst" "$MAIN/DEBIAN/prerm" \
  "$MAIN/DEBIAN/postrm" "$MAIN/usr/bin/yunmai-noble"
chmod 0644 "$MAIN/DEBIAN/control" "$MAIN/DEBIAN/conffiles" \
  "$MAIN/DEBIAN/md5sums" "$MAIN/usr/lib/systemd/system/yunmai-noble.service" \
  "$MAIN/etc/yunmai-noble/config.toml" "$MAIN/etc/yunmai-noble/config.env" \
  "$MAIN/usr/share/doc/yunmai-noble/README.Debian" \
  "$MAIN/usr/share/doc/yunmai-noble/copyright" \
  "$MAIN/usr/share/doc/yunmai-noble/changelog.gz" \
  "$MAIN/usr/share/lintian/overrides/yunmai-noble"

if [ "$SKIP_DESKTOP" -eq 0 ]; then
  log "assembling yunmai-noble-desktop"
  DESKTOP="$STAGE/pkg/yunmai-noble-desktop"
  mkdir -p \
    "$DESKTOP/DEBIAN" \
    "$DESKTOP/usr/bin" \
    "$DESKTOP/usr/share/applications" \
    "$DESKTOP/usr/share/icons/hicolor/scalable/apps" \
    "$DESKTOP/usr/share/doc/yunmai-noble-desktop"

  cp "$STAGE/desktop/yunmai-noble-desktop" \
    "$STAGE/desktop/yunmai-noble-simulator-ui" "$DESKTOP/usr/bin/"
  cp "$PKG_DIR/yunmai-noble-desktop/yunmai-noble.desktop" \
    "$DESKTOP/usr/share/applications/"
  cp "$PKG_DIR/yunmai-noble-desktop/yunmai-noble.svg" \
    "$DESKTOP/usr/share/icons/hicolor/scalable/apps/yunmai-noble.svg"
  cp "$PKG_DIR/yunmai-noble-desktop/README.Debian" \
    "$PKG_DIR/yunmai-noble/copyright" \
    "$DESKTOP/usr/share/doc/yunmai-noble-desktop/"
  gzip -9n -c "$PKG_DIR/yunmai-noble/changelog" \
    > "$DESKTOP/usr/share/doc/yunmai-noble-desktop/changelog.gz"

  find "$DESKTOP" -type d -exec chmod 0755 {} +
  write_control "$DESKTOP" "$PKG_DIR/yunmai-noble-desktop/control.in"
  write_md5sums "$DESKTOP"

  chmod 0755 "$DESKTOP/usr/bin/yunmai-noble-desktop" \
    "$DESKTOP/usr/bin/yunmai-noble-simulator-ui"
  chmod 0644 "$DESKTOP/DEBIAN/control" "$DESKTOP/DEBIAN/md5sums" \
    "$DESKTOP/usr/share/applications/yunmai-noble.desktop" \
    "$DESKTOP/usr/share/icons/hicolor/scalable/apps/yunmai-noble.svg" \
    "$DESKTOP/usr/share/doc/yunmai-noble-desktop/README.Debian" \
    "$DESKTOP/usr/share/doc/yunmai-noble-desktop/copyright" \
    "$DESKTOP/usr/share/doc/yunmai-noble-desktop/changelog.gz"

  log "assembling yunmai-noble-full"
  FULL="$STAGE/pkg/yunmai-noble-full"
  mkdir -p "$FULL/DEBIAN" "$FULL/usr/share/doc/yunmai-noble-full"
  cp "$PKG_DIR/yunmai-noble-full/README.Debian" \
    "$PKG_DIR/yunmai-noble/copyright" \
    "$FULL/usr/share/doc/yunmai-noble-full/"
  gzip -9n -c "$PKG_DIR/yunmai-noble/changelog" \
    > "$FULL/usr/share/doc/yunmai-noble-full/changelog.gz"

  find "$FULL" -type d -exec chmod 0755 {} +
  write_control "$FULL" "$PKG_DIR/yunmai-noble-full/control.in"
  write_md5sums "$FULL"

  chmod 0644 "$FULL/DEBIAN/control" "$FULL/DEBIAN/md5sums" \
    "$FULL/usr/share/doc/yunmai-noble-full/README.Debian" \
    "$FULL/usr/share/doc/yunmai-noble-full/copyright" \
    "$FULL/usr/share/doc/yunmai-noble-full/changelog.gz"
fi

log "assembling yunmai-noble-simulator"
SIM="$STAGE/pkg/yunmai-noble-simulator"
mkdir -p \
  "$SIM/DEBIAN" \
  "$SIM/usr/bin" \
  "$SIM/usr/lib/systemd/system" \
  "$SIM/usr/share/applications" \
  "$SIM/usr/share/doc/yunmai-noble-simulator" \
  "$SIM/etc/yunmai-noble"

cp "$PKG_DIR/yunmai-noble-simulator/yunmai-noble-simulator" "$SIM/usr/bin/"
cp "$PKG_DIR/yunmai-noble-simulator/yunmai-noble-simulator.service" \
  "$SIM/usr/lib/systemd/system/"
cp "$PKG_DIR/yunmai-noble-simulator/simulator.toml" "$SIM/etc/yunmai-noble/"
cp "$PKG_DIR/yunmai-noble-simulator/simulator.env" "$SIM/etc/yunmai-noble/"
cp "$PKG_DIR/yunmai-noble-simulator/README.Debian" \
  "$SIM/usr/share/doc/yunmai-noble-simulator/"
cp "$PKG_DIR/yunmai-noble-simulator/copyright" \
  "$SIM/usr/share/doc/yunmai-noble-simulator/"
gzip -9n -c "$PKG_DIR/yunmai-noble-simulator/changelog" \
  > "$SIM/usr/share/doc/yunmai-noble-simulator/changelog.gz"
cp "$PKG_DIR/yunmai-noble-simulator/postinst" \
  "$PKG_DIR/yunmai-noble-simulator/prerm" \
  "$PKG_DIR/yunmai-noble-simulator/postrm" "$SIM/DEBIAN/"

if [ "$SKIP_DESKTOP" -eq 0 ]; then
  cp "$PKG_DIR/yunmai-noble-simulator/yunmai-noble-simulator.desktop" \
    "$SIM/usr/share/applications/"
fi

printf '%s\n' /etc/yunmai-noble/simulator.toml \
  /etc/yunmai-noble/simulator.env > "$SIM/DEBIAN/conffiles"
find "$SIM" -type d -exec chmod 0755 {} +
write_control "$SIM" "$PKG_DIR/yunmai-noble-simulator/control.in"
write_md5sums "$SIM"

chmod 0755 "$SIM/DEBIAN/postinst" "$SIM/DEBIAN/prerm" "$SIM/DEBIAN/postrm" \
  "$SIM/usr/bin/yunmai-noble-simulator"
chmod 0644 "$SIM/DEBIAN/control" "$SIM/DEBIAN/conffiles" \
  "$SIM/DEBIAN/md5sums" \
  "$SIM/usr/lib/systemd/system/yunmai-noble-simulator.service" \
  "$SIM/etc/yunmai-noble/simulator.toml" \
  "$SIM/etc/yunmai-noble/simulator.env" \
  "$SIM/usr/share/doc/yunmai-noble-simulator/README.Debian" \
  "$SIM/usr/share/doc/yunmai-noble-simulator/copyright" \
  "$SIM/usr/share/doc/yunmai-noble-simulator/changelog.gz"
if [ "$SKIP_DESKTOP" -eq 0 ]; then
  chmod 0644 "$SIM/usr/share/applications/yunmai-noble-simulator.desktop"
fi

mkdir -p "$OUT"
MAIN_DEB="$OUT/yunmai-noble_${VERSION}_${ARCH}.deb"
DESKTOP_DEB="$OUT/yunmai-noble-desktop_${VERSION}_${ARCH}.deb"
FULL_DEB="$OUT/yunmai-noble-full_${VERSION}_all.deb"
SIM_DEB="$OUT/yunmai-noble-simulator_${VERSION}_${ARCH}.deb"

log "building packages"
rm -f "$MAIN_DEB" "$DESKTOP_DEB" "$FULL_DEB" "$SIM_DEB"
dpkg-deb --root-owner-group --build "$MAIN" "$MAIN_DEB"
if [ "$SKIP_DESKTOP" -eq 0 ]; then
  dpkg-deb --root-owner-group --build "$STAGE/pkg/yunmai-noble-desktop" "$DESKTOP_DEB"
  dpkg-deb --root-owner-group --build "$STAGE/pkg/yunmai-noble-full" "$FULL_DEB"
fi
dpkg-deb --root-owner-group --build "$SIM" "$SIM_DEB"

log "done"
printf '  %s (%s)\n' "$MAIN_DEB" "$(du -h "$MAIN_DEB" | awk '{print $1}')"
if [ "$SKIP_DESKTOP" -eq 0 ]; then
  printf '  %s (%s)\n' "$DESKTOP_DEB" "$(du -h "$DESKTOP_DEB" | awk '{print $1}')"
  printf '  %s (%s)\n' "$FULL_DEB" "$(du -h "$FULL_DEB" | awk '{print $1}')"
fi
printf '  %s (%s)\n' "$SIM_DEB" "$(du -h "$SIM_DEB" | awk '{print $1}')"

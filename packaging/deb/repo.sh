#!/usr/bin/env bash
#
# Build a signed APT repository from Debian packages. The tree is designed for
# GitHub Pages, so it can be published under a subpath such as
# https://vanuan.github.io/yunmai-noble/apt.
#
#   packaging/deb/repo.sh --in dist/deb --out dist/apt
#   packaging/deb/repo.sh --unsigned --in dist/deb --out dist/apt-test
#
# Signing uses the key from --gpg-key, GPG_KEY_ID, or the first secret key.
# GPG_PASSPHRASE is passed to gpg in loopback mode for CI.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
IN="$ROOT/dist/deb"
OUT="$ROOT/dist/apt"
SUITE=stable
COMPONENT=main
ORIGIN="Yunmai Noble"
LABEL="Yunmai Noble"
KEEP=3
UNSIGNED=0
GPG_KEY=""

usage() {
  cat <<'EOF'
Usage: packaging/deb/repo.sh [options]

  --in <dir>        directory containing .deb files (default: dist/deb)
  --out <dir>       repository root to create (default: dist/apt)
  --suite <name>    distribution name (default: stable)
  --component <c>   component name (default: main)
  --origin <name>   Release Origin field (default: Yunmai Noble)
  --label <name>    Release Label field (default: Yunmai Noble)
  --gpg-key <id>    signing key; defaults to GPG_KEY_ID or the first secret key
  --keep <n>        keep the newest n versions per package and arch (0 = all)
  --unsigned        skip signing; for local testing only
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
    --suite) SUITE=${2:?--suite requires a value}; shift 2 ;;
    --component) COMPONENT=${2:?--component requires a value}; shift 2 ;;
    --origin) ORIGIN=${2:?--origin requires a value}; shift 2 ;;
    --label) LABEL=${2:?--label requires a value}; shift 2 ;;
    --gpg-key) GPG_KEY=${2:?--gpg-key requires a value}; shift 2 ;;
    --keep) KEEP=${2:?--keep requires a value}; shift 2 ;;
    --unsigned) UNSIGNED=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

[ -d "$IN" ] || die "no such input directory: $IN"
command -v dpkg-deb >/dev/null || die "dpkg-deb not found"
command -v dpkg-scanpackages >/dev/null || die "dpkg-scanpackages not found"

shopt -s nullglob
debs=("$IN"/*.deb)
[ "${#debs[@]}" -gt 0 ] || die "no .deb files in $IN"

case "$OUT" in
  /|"$ROOT") die "refusing to use $OUT as the output directory" ;;
esac

log "reading ${#debs[@]} package(s) from $IN"

# Architecture list comes from the packages themselves: advertising an arch
# with no index would make apt fetch files that do not exist.
arches=()
for deb in "${debs[@]}"; do
  arch=$(dpkg-deb -f "$deb" Architecture)
  [ -n "$arch" ] || die "cannot read Architecture from $deb"
  [ "$arch" = "all" ] && continue
  case " ${arches[*]-} " in
    *" $arch "*) ;;
    *) arches+=("$arch") ;;
  esac
done
[ "${#arches[@]}" -gt 0 ] || die "no architecture-specific packages in $IN"
mapfile -t arches < <(printf '%s\n' "${arches[@]}" | sort)

log "architectures: ${arches[*]}, suite: $SUITE"

rm -rf "$OUT"
mkdir -p "$OUT/pool/$COMPONENT"
touch "$OUT/.nojekyll"

for deb in "${debs[@]}"; do
  package=$(dpkg-deb -f "$deb" Package)
  [ -n "$package" ] || die "cannot read Package from $deb"
  mkdir -p "$OUT/pool/$COMPONENT/$package"
  cp "$deb" "$OUT/pool/$COMPONENT/$package/"
done

if [ "$KEEP" -gt 0 ]; then
  log "keeping the newest $KEEP version(s) per package and architecture"
  rows=$(for deb in "$OUT/pool/$COMPONENT"/*/*.deb; do
    printf '%s\t%s\t%s\t%s\n' \
      "$(dpkg-deb -f "$deb" Package)" \
      "$(dpkg-deb -f "$deb" Architecture)" \
      "$(dpkg-deb -f "$deb" Version)" \
      "$deb"
  done)
  while IFS=$'\t' read -r package arch version deb; do
    [ -n "${deb:-}" ] && [ -f "$deb" ] && rm -f "$deb"
  done < <(printf '%s\n' "$rows" |
    sort -t $'\t' -k1,1 -k2,2 -k3,3Vr |
    awk -F '\t' '{ key = $1 FS $2; count[key]++; if (count[key] > keep) print }' keep="$KEEP")
  find "$OUT/pool" -mindepth 2 -type d -empty -delete
fi

for arch in "${arches[@]}"; do
  index="$OUT/dists/$SUITE/$COMPONENT/binary-$arch"
  mkdir -p "$index"
  (
    cd "$OUT"
    dpkg-scanpackages --arch "$arch" "pool/$COMPONENT" /dev/null 2>/dev/null
  ) > "$index/Packages"
  gzip -9n -c "$index/Packages" > "$index/Packages.gz"
done

log "writing $SUITE/Release"
dists="$OUT/dists/$SUITE"
release="$dists/Release"

if [ -n "${SOURCE_DATE_EPOCH:-}" ]; then
  date_value=$(date -u -R -d "@$SOURCE_DATE_EPOCH")
else
  date_value=$(date -u -R)
fi

{
  printf 'Origin: %s\n' "$ORIGIN"
  printf 'Label: %s\n' "$LABEL"
  printf 'Suite: %s\n' "$SUITE"
  printf 'Codename: %s\n' "$SUITE"
  printf 'Date: %s\n' "$date_value"
  printf 'Architectures: %s\n' "${arches[*]}"
  printf 'Components: %s\n' "$COMPONENT"
  printf 'Description: %s APT repository\n' "$LABEL"
  for algo in MD5Sum SHA1 SHA256; do
    case "$algo" in
      MD5Sum) cmd=md5sum ;;
      SHA1) cmd=sha1sum ;;
      SHA256) cmd=sha256sum ;;
    esac
    printf '%s:\n' "$algo"
    (
      cd "$dists"
      find "$COMPONENT" -type f \( -name 'Packages' -o -name 'Packages.gz' \) |
        sort | while IFS= read -r file; do
          printf ' %s %s %s\n' "$("$cmd" "$file" | cut -d' ' -f1)" "$(stat -c %s "$file")" "$file"
        done
    )
  done
} > "$release"

if [ "$UNSIGNED" -eq 1 ]; then
  log "skipping signing (--unsigned)"
else
  if [ -z "$GPG_KEY" ]; then
    GPG_KEY=${GPG_KEY_ID:-}
  fi
  if [ -z "$GPG_KEY" ]; then
    GPG_KEY=$(gpg --batch --list-secret-keys --with-colons 2>/dev/null |
      awk -F: '$1 == "sec" { print $5; exit }')
  fi
  [ -n "$GPG_KEY" ] || die "no signing key; pass --gpg-key, set GPG_KEY_ID, or use --unsigned"

  gpg_opts=(--batch --yes)
  if [ -n "${GPG_PASSPHRASE:-}" ]; then
    gpg_opts+=(--pinentry-mode loopback --passphrase "$GPG_PASSPHRASE")
  fi

  log "signing with $GPG_KEY"
  gpg "${gpg_opts[@]}" --armor --detach-sign -o "$dists/Release.gpg" "$release"
  gpg "${gpg_opts[@]}" --clearsign -o "$dists/InRelease" "$release"
  gpg --batch --export "$GPG_KEY" > "$OUT/yunmai-noble-archive-keyring.gpg"
fi

(
  cd "$OUT"
  find pool -type f -name '*.deb' -print0 | sort -z | xargs -0 -r sha256sum
) > "$OUT/SHA256SUMS"

log "done"
if [ "$UNSIGNED" -eq 1 ]; then
  printf '  %s\n' "$OUT/dists/$SUITE/Release"
else
  printf '  %s\n' "$OUT/dists/$SUITE/InRelease"
fi
printf '  %s\n' "$OUT/SHA256SUMS"

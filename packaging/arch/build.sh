#!/usr/bin/env bash
# Собирает и ставит Arch-пакет из текущего тега. Запускать из корня репозитория:
#   ./packaging/arch/build.sh            # собрать и поставить (makepkg -si)
#   ./packaging/arch/build.sh --build    # только собрать пакет, без установки
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
# Версию берём из PKGBUILD, чтобы не дублировать.
pkgver="$(awk -F= '/^pkgver=/{print $2}' "$here/PKGBUILD")"
tag="v${pkgver}"

echo "Готовлю исходник из тега ${tag}…"
git -C "$here/../.." archive --format=tar.gz \
  --prefix="Synapse-${pkgver}/" \
  -o "$here/synapse-notes-${pkgver}.tar.gz" \
  "$tag"

cd "$here"
if [[ "${1:-}" == "--build" ]]; then
  makepkg -f
else
  makepkg -si
fi

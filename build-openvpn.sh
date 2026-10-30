#!/bin/sh
# Build res/openvpn from the official OpenVPN, OpenSSL, LZO and LZ4 sources.
#
#   ./build-openvpn.sh
#
# Needs Podman or Docker; nothing else is installed on this machine. The build
# runs in a pinned Alpine image and cross-compiles a static 32-bit ARMv7 binary
# (see openvpn-build/build.sh for the versions and their pinned checksums).
# Writes com.sk.app.lgtv-vpn/res/openvpn and openvpn-build/BUILDINFO.
set -eu

# Alpine 3.24 (multi-arch index, so it runs natively on x86-64 and arm64 hosts).
IMAGE=docker.io/library/alpine@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a
REPO=$(cd "$(dirname "$0")" && pwd)

if command -v podman >/dev/null 2>&1; then
  ENGINE=podman
elif command -v docker >/dev/null 2>&1; then
  ENGINE=docker
else
  echo "Install Podman or Docker first." >&2
  exit 1
fi

OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
$ENGINE run --rm \
  -v "$REPO/openvpn-build/build.sh:/build.sh:ro" \
  -v "$OUT:/out" \
  "$IMAGE" sh /build.sh

install -m 755 "$OUT/openvpn" "$REPO/com.sk.app.lgtv-vpn/res/openvpn"
cp "$OUT/BUILDINFO" "$REPO/openvpn-build/BUILDINFO"
echo "Wrote com.sk.app.lgtv-vpn/res/openvpn"

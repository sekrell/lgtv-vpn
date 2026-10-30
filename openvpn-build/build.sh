#!/bin/sh
# Builds a static OpenVPN for the TV (32-bit ARMv7, musl) from the official
# sources. Runs inside an Alpine container started by ../build-openvpn.sh and
# writes /out/openvpn plus /out/BUILDINFO.
#
# Every source is pinned by SHA-256. When bumping a version, check the new
# tarball before updating its hash: OpenVPN publishes GPG signatures
# (security@openvpn.net, F554A3687412CFFEBDEFE0A312F5F7B42F2B01E7), OpenSSL
# publishes .sha256 files, and Alpine's aports list SHA-512s for all of them.
set -eu

OPENVPN_VERSION=2.7.8
OPENVPN_SHA256=c070d1d2440b5a6fca6c2c68645c98cd492116ac36ef4f0946177115532c8e36
OPENSSL_VERSION=3.5.9
OPENSSL_SHA256=603f5602e2eef00d77fbd429d34dcd5822bb301757a1bc9cdb24c670f1eb859a
LZO_VERSION=2.10
LZO_SHA256=c0f892943208266f9b6543b3ae308fab6284c5c90e627931446fb49b4221a072
LZ4_VERSION=1.10.0
LZ4_SHA256=537512904744b35e232912055ccf8ec66d768639ff3abe5788d90d792ec5f48b
# OpenVPN 2.7 requires libcap-ng on Linux. GitHub's source archive, as Alpine uses.
LIBCAPNG_VERSION=0.9.6
LIBCAPNG_SHA256=399040138e0ca62fa2bcabd63da9af4431a246ef7a654561a0ca3cb00010a539

# Zig's C compiler cross-compiles to ARMv7 with musl built in, so no emulation or
# separate toolchain is needed. musl also makes a fully static binary that doesn't
# depend on the TV's own libraries (unlike static glibc, whose DNS lookups do).
TARGET=arm-linux-musleabihf
export ZIG_GLOBAL_CACHE_DIR=/tmp/zig-cache ZIG_LOCAL_CACHE_DIR=/tmp/zig-cache
export CC="zig cc -target $TARGET -mcpu=generic+v7a" AR="zig ar" RANLIB="zig ranlib"
export CFLAGS="-O2" LDFLAGS="-static -s"
# Fixed timestamp (OpenVPN 2.7.8's release date) for build dates that end up in the
# binary, such as OpenSSL's "built on", so rebuilding gives a byte-identical file.
export SOURCE_DATE_EPOCH=1791331200
PREFIX=/tmp/deps
JOBS=$(nproc)

# binutils only satisfies autoconf's check for an `ld`; zig does the linking.
apk add --no-cache zig make perl curl file binutils pkgconf autoconf automake libtool >/dev/null
export PKG_CONFIG_PATH=$PREFIX/lib/pkgconfig PKG_CONFIG_LIBDIR=$PREFIX/lib/pkgconfig

# Run a build step quietly; show its output only if it fails.
quiet() {
  "$@" > /tmp/step.log 2>&1 || { tail -n 40 /tmp/step.log >&2; echo "Failed: $*" >&2; exit 1; }
}

fetch() { # fetch <url> <sha256>
  name=$(basename "$1")
  curl -sSfL -o "/tmp/$name" "$1"
  echo "$2  /tmp/$name" | sha256sum -c -s || { echo "Checksum mismatch for $name" >&2; exit 1; }
  tar -xzf "/tmp/$name" -C /tmp
  echo "verified $name"
}

fetch "https://github.com/openssl/openssl/releases/download/openssl-$OPENSSL_VERSION/openssl-$OPENSSL_VERSION.tar.gz" $OPENSSL_SHA256
fetch "https://www.oberhumer.com/opensource/lzo/download/lzo-$LZO_VERSION.tar.gz" $LZO_SHA256
fetch "https://github.com/lz4/lz4/releases/download/v$LZ4_VERSION/lz4-$LZ4_VERSION.tar.gz" $LZ4_SHA256
fetch "https://github.com/stevegrubb/libcap-ng/archive/v$LIBCAPNG_VERSION/libcap-ng-$LIBCAPNG_VERSION.tar.gz" $LIBCAPNG_SHA256
fetch "https://github.com/OpenVPN/openvpn/releases/download/v$OPENVPN_VERSION/openvpn-$OPENVPN_VERSION.tar.gz" $OPENVPN_SHA256

echo "Building OpenSSL $OPENSSL_VERSION..."
cd /tmp/openssl-$OPENSSL_VERSION
quiet ./Configure linux-armv4 no-shared no-tests no-docs no-apps no-module no-engine \
  --prefix=$PREFIX --libdir=lib --openssldir=/etc/ssl
quiet make -j"$JOBS" build_libs
quiet make install_dev

echo "Building LZO $LZO_VERSION..."
cd /tmp/lzo-$LZO_VERSION
quiet ./configure --host=$TARGET --prefix=$PREFIX --disable-shared --enable-static
quiet make -j"$JOBS"
quiet make install

echo "Building LZ4 $LZ4_VERSION..."
cd /tmp/lz4-$LZ4_VERSION
quiet make -C lib -j"$JOBS" liblz4.a
install -D -m 644 lib/liblz4.a $PREFIX/lib/liblz4.a
install -m 644 lib/lz4.h lib/lz4hc.h lib/lz4frame.h $PREFIX/include/
mkdir -p $PREFIX/lib/pkgconfig
printf 'Name: lz4\nDescription: lz4\nVersion: %s\nLibs: -L%s/lib -llz4\nCflags: -I%s/include\n' \
  $LZ4_VERSION $PREFIX $PREFIX > $PREFIX/lib/pkgconfig/liblz4.pc

echo "Building libcap-ng $LIBCAPNG_VERSION..."
cd /tmp/libcap-ng-$LIBCAPNG_VERSION
quiet ./autogen.sh
quiet ./configure --host=$TARGET --prefix=$PREFIX --disable-shared --enable-static --without-python3
quiet make -C src -j"$JOBS"
quiet make -C src install
printf 'Name: libcap-ng\nDescription: libcap-ng\nVersion: %s\nLibs: -L%s/lib -lcap-ng\nCflags: -I%s/include\n' \
  $LIBCAPNG_VERSION $PREFIX $PREFIX > $PREFIX/lib/pkgconfig/libcap-ng.pc

echo "Building OpenVPN $OPENVPN_VERSION..."
cd /tmp/openvpn-$OPENVPN_VERSION
quiet ./configure --host=$TARGET --prefix=/usr \
  --enable-static --disable-shared --disable-plugins --disable-dco \
  --disable-unit-tests --disable-selinux --disable-systemd \
  OPENSSL_CFLAGS="-I$PREFIX/include" OPENSSL_LIBS="-L$PREFIX/lib -lssl -lcrypto" \
  LZO_CFLAGS="-I$PREFIX/include" LZO_LIBS="-L$PREFIX/lib -llzo2" \
  LZ4_CFLAGS="-I$PREFIX/include" LZ4_LIBS="-L$PREFIX/lib -llz4"
quiet make -j"$JOBS"

install -m 755 src/openvpn/openvpn /out/openvpn
{
  echo "OpenVPN $OPENVPN_VERSION  sha256 $OPENVPN_SHA256"
  echo "OpenSSL $OPENSSL_VERSION  sha256 $OPENSSL_SHA256"
  echo "LZO $LZO_VERSION  sha256 $LZO_SHA256"
  echo "LZ4 $LZ4_VERSION  sha256 $LZ4_SHA256"
  echo "libcap-ng $LIBCAPNG_VERSION  sha256 $LIBCAPNG_SHA256"
  echo "Built with: $(zig version | sed 's/^/zig /'), target $TARGET, Alpine $(cat /etc/alpine-release)"
  echo "Binary: $(file -b /out/openvpn)"
  echo "Binary sha256: $(sha256sum /out/openvpn | cut -d' ' -f1)"
} > /out/BUILDINFO
cat /out/BUILDINFO

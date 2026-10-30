#!/bin/sh
# Install this checkout on a rooted LG TV as a separate app, next to the released one.
#
#   ./install-to-tv.sh <tv-ip> [profile.ovpn ...]
#
# Enable the SSH server in the Homebrew Channel settings first.
# Builds an IPK with the app id changed to $APP_ID (default com.sk.app.lgtv-vpn.dev,
# shown as "$APP_TITLE", default "VPN (dev)") and installs it with the TV's app installer.
# Running it again updates that app and keeps its profiles. On the first install it
# copies the released app's profiles; any files given after the IP are added too.
# It installs res/openvpn from this checkout, built by build-openvpn.sh.
#
# Environment: APP_ID, APP_TITLE, TV_USER (default root), TV_PORT (default 22).
set -eu

SRC_ID=com.sk.app.lgtv-vpn
APP_ID=${APP_ID:-$SRC_ID.dev}
APP_TITLE=${APP_TITLE:-VPN (dev)}
APPS=/media/developer/apps/usr/palm/applications
SRC_DIR=$(cd "$(dirname "$0")/$SRC_ID" && pwd)

if [ $# -lt 1 ]; then
  sed -n '2,14s/^# \{0,1\}//p' "$0"
  exit 1
fi
TV=$1
shift

WORK=$(mktemp -d)
# Reuse one SSH connection so a password is asked for only once.
trap 'ssh -o ControlPath="$WORK/ssh" -O exit "$TV" 2>/dev/null || true; rm -rf "$WORK"' EXIT
tv() {
  ssh -o ControlMaster=auto -o ControlPath="$WORK/ssh" -o ControlPersist=60 \
    -p "${TV_PORT:-22}" "${TV_USER:-root}@$TV" "$@"
}
# luna-send only works reliably with a terminal; without one its calls and output get lost.
luna() {
  tv -tt "timeout ${LUNA_TIMEOUT:-20} luna-send $*" 2>/dev/null < /dev/null | tr -d '\r'
}

echo "Connecting to $TV..."
tv true

# Stage the files the IPK installs: the app and its package info.
DATA=$WORK/data
APP=$DATA/usr/palm/applications/$APP_ID
mkdir -p "$APP" "$DATA/usr/palm/packages/$APP_ID"
COPYFILE_DISABLE=1 tar -C "$SRC_DIR" --exclude ./profiles -cf - . | tar -C "$APP" -xf -
mkdir "$APP/profiles"
STAMP=$(date +%s)
echo "$STAMP" > "$APP/.build-stamp"
sed -e "s/\"id\": *\"[^\"]*\"/\"id\": \"$APP_ID\"/" \
    -e "s/\"title\": *\"[^\"]*\"/\"title\": \"$APP_TITLE\"/" \
    "$SRC_DIR/appinfo.json" > "$APP/appinfo.json"
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$APP/appinfo.json")
printf '{\n  "id": "%s",\n  "version": "%s",\n  "app": "%s"\n}\n' "$APP_ID" "$VERSION" "$APP_ID" \
  > "$DATA/usr/palm/packages/$APP_ID/packageinfo.json"

chmod 755 "$APP/res/openvpn"

# Package it the way ares-package does: an ar archive of debian-binary,
# control.tar.gz and data.tar.gz.
echo "Building IPK..."
mkdir "$WORK/ctl"
cat > "$WORK/ctl/control" <<EOF
Package: $APP_ID
Version: $VERSION
Section: misc
Priority: optional
Architecture: all
Installed-Size: $(du -sk "$DATA" | cut -f1)000
Maintainer: N/A <nobody@example.com>
Description: $APP_TITLE
webOS-Package-Format-Version: 2
webOS-Packager-Version: x.y.x
EOF
printf '2.0\n' > "$WORK/debian-binary"
TAR_OWNER="--uid 0 --gid 0 --uname root --gname root"
# shellcheck disable=SC2086
COPYFILE_DISABLE=1 tar $TAR_OWNER -czf "$WORK/control.tar.gz" -C "$WORK/ctl" control
# shellcheck disable=SC2086
COPYFILE_DISABLE=1 tar $TAR_OWNER -czf "$WORK/data.tar.gz" -C "$DATA" usr
IPK=$WORK/${APP_ID}_${VERSION}_all.ipk
{
  printf '!<arch>\n'
  for f in debian-binary control.tar.gz data.tar.gz; do
    size=$(wc -c < "$WORK/$f" | tr -d ' ')
    printf '%-16s%-12s%-6s%-6s%-8s%-10s`\n' "$f" "$(date +%s)" 0 0 100644 "$size"
    cat "$WORK/$f"
    [ $((size % 2)) -eq 0 ] || printf '\n'
  done
} > "$IPK"

echo "Installing $APP_ID..."
# Reinstalling replaces the app folder, so keep its profiles aside.
tv "rm -rf /tmp/$APP_ID.profiles; if [ -d $APPS/$APP_ID/profiles ]; then cp -a $APPS/$APP_ID/profiles /tmp/$APP_ID.profiles; fi"
tv "cat > /tmp/$APP_ID.ipk" < "$IPK"
# Follow the installer's progress until this build's stamp shows up or it reports an error.
LUNA_TIMEOUT=180 luna -i luna://com.webos.appInstallService/dev/install \
  "'{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"/tmp/$APP_ID.ipk\",\"subscribe\":true}'" > "$WORK/install.log" &
INSTALLER=$!
result=timeout
i=0
while [ $i -lt 90 ]; do
  sleep 2
  i=$((i + 1))
  if tv "[ \"\$(cat $APPS/$APP_ID/.build-stamp 2>/dev/null)\" = $STAMP ]"; then
    result=ok
    break
  fi
  if grep -qiE '"returnValue": *false|errorText|"state": *"[^"]*fail' "$WORK/install.log"; then
    result=failed
    break
  fi
done
{ kill $INSTALLER && wait $INSTALLER; } 2>/dev/null || true
# The [l] keeps pkill from matching the shell running this command.
tv "rm -f /tmp/$APP_ID.ipk; pkill -f '[l]una-send -i luna://com.webos.appInstallService/dev/install'" || true
if [ $result != ok ]; then
  echo "Install failed ($result). Installer said:" >&2
  sed 's/^/  /' "$WORK/install.log" | tail -5 >&2
  exit 1
fi
tv "if [ -d /tmp/$APP_ID.profiles ]; then cp -a /tmp/$APP_ID.profiles/. $APPS/$APP_ID/profiles/ && rm -rf /tmp/$APP_ID.profiles;
    elif [ -d $APPS/$SRC_ID/profiles ]; then cp -a $APPS/$SRC_ID/profiles/. $APPS/$APP_ID/profiles/; fi"

for f in "$@"; do
  echo "Copying $(basename "$f") to profiles..."
  tv "cat > '$APPS/$APP_ID/profiles/$(basename "$f")'" < "$f"
done

echo "Starting $APP_TITLE..."
luna -n 1 luna://com.webos.applicationManager/closeByAppId "'{\"id\":\"$APP_ID\"}'" >/dev/null || true
sleep 1
luna -n 1 luna://com.webos.applicationManager/launch "'{\"id\":\"$APP_ID\"}'" | grep -q '"returnValue": *true' ||
  echo "Couldn't start the app; open \"$APP_TITLE\" from the TV's app list." >&2
echo "Done."

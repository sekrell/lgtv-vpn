#!/bin/sh
# Store the VPN login for a profile on the TV, so connecting doesn't ask for it.
#
#   ./copy-login.sh <tv-ip> <profile.ovpn> [login.txt]
#
# The profile must already be on the TV (see copy-profile.sh); give its file name.
# login.txt holds the username on the first line and the password on the second.
# Without it, the script asks for both and sends them straight to the TV.
# The login is saved next to the profile as <profile>.login (readable by root
# only), and the profile's auth-user-pass line is pointed at it.
#
# Environment: TV_IP (instead of the first argument), APP_ID,
# TV_USER (default root), TV_PORT (default 22).
set -eu

APPS=/media/developer/apps/usr/palm/applications

if [ -n "${TV_IP:-}" ] && [ $# -ge 1 ] && [ "${1%.ovpn}" != "$1" ]; then
  TV=$TV_IP
elif [ $# -ge 2 ]; then
  TV=$1
  shift
else
  sed -n '2,13s/^# \{0,1\}//p' "$0"
  exit 1
fi
PROFILE=$(basename "$1")
LOGIN_FILE=${2:-}
LOGIN=${PROFILE%.ovpn}.login

if [ -n "$LOGIN_FILE" ]; then
  [ -f "$LOGIN_FILE" ] || { echo "No such file: $LOGIN_FILE" >&2; exit 1; }
  [ "$(grep -c '' "$LOGIN_FILE")" -ge 2 ] ||
    { echo "$LOGIN_FILE needs the username on line 1 and the password on line 2." >&2; exit 1; }
fi

WORK=$(mktemp -d)
# Reuse one SSH connection so a password is asked for only once.
trap 'stty echo 2>/dev/null || true; ssh -o ControlPath="$WORK/ssh" -O exit "$TV" 2>/dev/null || true; rm -rf "$WORK"' EXIT
tv() {
  ssh -o ControlMaster=auto -o ControlPath="$WORK/ssh" -o ControlPersist=60 \
    -p "${TV_PORT:-22}" "${TV_USER:-root}@$TV" "$@"
}
# luna-send only works reliably with a terminal; without one its calls and output get lost.
luna() {
  tv -tt "timeout ${LUNA_TIMEOUT:-20} luna-send $*" 2>/dev/null < /dev/null | tr -d '\r'
}

echo "Connecting to $TV..."
if [ -z "${APP_ID:-}" ]; then
  if tv "test -f $APPS/com.sk.app.lgtv-vpn.dev/profiles/'$PROFILE'"; then
    APP_ID=com.sk.app.lgtv-vpn.dev
  else
    APP_ID=com.sk.app.lgtv-vpn
  fi
fi
DIR=$APPS/$APP_ID/profiles
if ! tv "test -f '$DIR/$PROFILE'"; then
  echo "$PROFILE isn't in $DIR. Copy it with copy-profile.sh first." >&2
  exit 1
fi
if ! tv "grep -q '^[[:space:]]*auth-user-pass' '$DIR/$PROFILE'"; then
  echo "$PROFILE doesn't ask for a username and password (no auth-user-pass line)." >&2
  exit 1
fi

# The login goes over stdin, never on a command line where other processes could see it.
if [ -n "$LOGIN_FILE" ]; then
  head -n 2 "$LOGIN_FILE" | tr -d '\r' | tv "umask 077; cat > '$DIR/$LOGIN'"
else
  printf 'VPN username: ' >&2
  read -r user
  printf 'VPN password: ' >&2
  stty -echo 2>/dev/null || true
  read -r pass
  stty echo 2>/dev/null || true
  echo >&2
  [ -n "$user" ] && [ -n "$pass" ] || { echo "Username and password can't be empty." >&2; exit 1; }
  printf '%s\n%s\n' "$user" "$pass" | tv "umask 077; cat > '$DIR/$LOGIN'"
  unset user pass
fi
tv "chmod 600 '$DIR/$LOGIN'"
echo "Saved the login as $DIR/$LOGIN"

# Point every auth-user-pass line at the login file. Rewrite in place so the file keeps its permissions.
tv "sed 's/^[[:space:]]*auth-user-pass.*/auth-user-pass $LOGIN/' '$DIR/$PROFILE' > '$DIR/$PROFILE.tmp' &&
    cat '$DIR/$PROFILE.tmp' > '$DIR/$PROFILE' && rm '$DIR/$PROFILE.tmp'"
echo "Updated $PROFILE: auth-user-pass $LOGIN"

# Relaunching a running app makes it reload its profiles.
luna -n 1 luna://com.webos.applicationManager/launch "'{\"id\":\"$APP_ID\"}'" >/dev/null || true
echo "Done. Connecting with ${PROFILE%.ovpn} won't ask for a login now."

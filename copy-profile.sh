#!/bin/sh
# Copy OpenVPN profiles to the TV.
#
#   ./copy-profile.sh <tv-ip> <profile.ovpn> [more.ovpn ...]
#
# Enable the SSH server in the Homebrew Channel settings first.
# Files the profile points to (ca, cert, key, tls-auth, auth-user-pass, ...)
# are copied along with it when they sit next to it. Profiles go to the dev
# app (com.sk.app.lgtv-vpn.dev) when it is installed, otherwise to the released
# app; set APP_ID to pick one. The app is then reopened so it lists them.
#
# Environment: TV_IP (instead of the first argument), APP_ID,
# TV_USER (default root), TV_PORT (default 22).
set -eu

APPS=/media/developer/apps/usr/palm/applications

if [ -n "${TV_IP:-}" ] && [ $# -ge 1 ] && [ -f "$1" ]; then
  TV=$TV_IP
elif [ $# -ge 2 ]; then
  TV=$1
  shift
else
  sed -n '2,13s/^# \{0,1\}//p' "$0"
  exit 1
fi

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

for f in "$@"; do
  [ -f "$f" ] || { echo "No such file: $f" >&2; exit 1; }
done

echo "Connecting to $TV..."
if [ -z "${APP_ID:-}" ]; then
  if tv "test -d $APPS/com.sk.app.lgtv-vpn.dev"; then
    APP_ID=com.sk.app.lgtv-vpn.dev
  else
    APP_ID=com.sk.app.lgtv-vpn
  fi
fi
DEST=$APPS/$APP_ID/profiles
if ! tv "test -d $APPS/$APP_ID"; then
  echo "$APP_ID isn't installed on the TV." >&2
  exit 1
fi

copy() { # copy <local file> <path relative to the profiles folder>
  echo "  $2"
  tv "mkdir -p \"\$(dirname '$DEST/$2')\" && cat > '$DEST/$2'" < "$1"
}

echo "Copying to $DEST:"
for f in "$@"; do
  copy "$f" "$(basename "$f")"
  # Copy the relative files the profile references, e.g. `ca ca.crt` or `tls-auth ta.key 1`.
  dir=$(dirname "$f")
  sed -n -E 's/^[[:space:]]*(ca|cert|key|tls-auth|tls-crypt|tls-crypt-v2|pkcs12|secret|dh|extra-certs|crl-verify|auth-user-pass|askpass)[[:space:]]+"?([^"[:space:]]+)"?.*/\2/p' "$f" |
    tr -d '\r' | sort -u | while read -r ref; do
      case $ref in
        /*|'[inline]') ;;
        *) if [ -f "$dir/$ref" ]; then
             copy "$dir/$ref" "$ref"
           else
             echo "  Warning: $(basename "$f") refers to $ref, which isn't next to it." >&2
           fi ;;
      esac
    done
done

# Relaunching a running app makes it reload its profiles.
luna -n 1 luna://com.webos.applicationManager/launch "'{\"id\":\"$APP_ID\"}'" | grep -q '"returnValue": *true' &&
  echo "Opened $APP_ID; the new profiles are in the list." ||
  echo "Done. Open the app on the TV and press Reload."

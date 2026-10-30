#!/bin/sh
# OpenVPN --up/--down hook: shows a TV toast when the tunnel comes up or goes down.
# OpenVPN runs it as root, so it works while the app is closed. It must always
# exit 0: a failing --up script makes OpenVPN give up on the connection.

APP_ID=$(basename "$(dirname "$(dirname "$0")")")
PROFILE=$(basename "${config:-VPN}" .ovpn | tr -d '"\\')

case "$script_type:${signal:-}" in
  up:*) message="VPN connected: $PROFILE" ;;
  down:sigterm | down:sigint) message="VPN disconnected" ;;
  down:*) message="VPN connection lost. Reconnecting…" ;;
  *) exit 0 ;;
esac

luna-send -n 1 luna://com.webos.notification/createToast \
  "{\"sourceId\":\"$APP_ID\",\"message\":\"$message\"}" >/dev/null 2>&1 &
exit 0

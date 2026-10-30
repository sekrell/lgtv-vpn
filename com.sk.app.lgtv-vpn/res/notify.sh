#!/bin/sh
# OpenVPN --up/--down hook: shows a TV toast when the tunnel comes up or goes down.
# OpenVPN runs it as root, so it works while the app is closed. It must always
# exit 0: a failing --up script makes OpenVPN give up on the connection.

APP_ID=$(basename "$(dirname "$(dirname "$0")")")
PROFILE=$(basename "${config:-VPN}" .ovpn | tr -d '"\\')

# $signal says why the tunnel went down. A deliberate stop is sigterm/sigint, or
# exit-with-notification when the profile uses explicit-exit-notify (most UDP ones).
case "$script_type:${signal:-}" in
  up:*) message="VPN connected: $PROFILE" ;;
  down:sigterm | down:sigint | down:exit-with-notification) message="VPN disconnected" ;;
  down:ping-exit | down:inactive) message="VPN connection lost" ;;
  down:*) message="VPN connection lost. Reconnecting…" ;;
  *) exit 0 ;;
esac

luna-send -n 1 luna://com.webos.notification/createToast \
  "{\"sourceId\":\"$APP_ID\",\"message\":\"$message\"}" >/dev/null 2>&1 &
exit 0

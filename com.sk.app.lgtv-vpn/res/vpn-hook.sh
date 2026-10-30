#!/bin/sh
# OpenVPN --up/--down hook, run as root (so it works while the app is closed):
# - shows a TV toast when the tunnel comes up or goes down;
# - blocks public IPv6 while the VPN is up. Profiles that only tunnel IPv4 would
#   otherwise let apps like YouTube and Netflix go around the VPN over IPv6.
#   Unreachable routes make IPv6 connections fail at once, so apps fall back to
#   IPv4 through the tunnel; the local network keeps its IPv6.
# Both can be switched off in the app, which writes them to hook-settings.
# It must always exit 0: a failing --up script makes OpenVPN give up on the connection.
#
#   vpn-hook.sh apply-ipv6   blocks or unblocks IPv6 to match the setting and whether
#                            OpenVPN runs (used by the app at launch and on toggling)

PATH=/usr/sbin:/usr/bin:/sbin:/bin:$PATH
APP_DIR=$(dirname "$(dirname "$0")")
APP_ID=$(basename "$APP_DIR")
PROFILE=$(basename "${config:-VPN}" .ovpn | tr -d '"\\')

# Settings default to on; only an explicit 0 turns one off.
setting() {
  [ "$(sed -n "s/^$1=\([01]\)\$/\1/p" "$APP_DIR/hook-settings" 2>/dev/null)" != 0 ]
}

block_ipv6() {
  ip -6 route replace unreachable ::/1 metric 1
  ip -6 route replace unreachable 8000::/1 metric 1
}
unblock_ipv6() {
  ip -6 route del unreachable ::/1 2>/dev/null
  ip -6 route del unreachable 8000::/1 2>/dev/null
}

if [ "${1:-}" = apply-ipv6 ]; then
  if setting BLOCK_IPV6 && pidof openvpn >/dev/null; then block_ipv6; else unblock_ipv6; fi
  exit 0
fi

# $signal says why the tunnel went down. A deliberate stop is sigterm/sigint, or
# exit-with-notification when the profile uses explicit-exit-notify (most UDP ones).
# While OpenVPN reconnects the IPv6 block stays, so nothing leaks in between.
case "$script_type:${signal:-}" in
  up:*)
    if setting BLOCK_IPV6; then block_ipv6; fi
    message="VPN connected: $PROFILE" ;;
  down:sigterm | down:sigint | down:exit-with-notification)
    unblock_ipv6
    message="VPN disconnected" ;;
  down:ping-exit | down:inactive)
    unblock_ipv6
    message="VPN connection lost" ;;
  down:*) message="VPN connection lost. Reconnecting…" ;;
  *) exit 0 ;;
esac

if setting NOTIFY; then
  luna-send -n 1 luna://com.webos.notification/createToast \
    "{\"sourceId\":\"$APP_ID\",\"message\":\"$message\"}" >/dev/null 2>&1 &
fi
exit 0

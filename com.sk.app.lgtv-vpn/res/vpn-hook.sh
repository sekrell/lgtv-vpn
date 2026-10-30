#!/bin/sh
# OpenVPN --up/--down hook, run as root (so it works while the app is closed):
# - shows a TV toast when the tunnel comes up or goes down;
# - blocks public IPv6 while the VPN is up. Profiles that only tunnel IPv4 would
#   otherwise let apps like YouTube and Netflix go around the VPN over IPv6.
#   Unreachable routes make IPv6 connections fail at once, so apps fall back to
#   IPv4 through the tunnel; the local network keeps its IPv6.
# - uses the DNS servers the VPN pushes while it is up. The TV's own resolver
#   (connman's proxy on 127.0.0.1) sends lookups out over Wi-Fi to the router even
#   with the VPN up, so the hook points the system resolver file straight at the
#   VPN's servers, which the VPN routes then reach through the tunnel.
# Each can be switched off in the app, which writes them to hook-settings.
# It must always exit 0: a failing --up script makes OpenVPN give up on the connection.
#
#   vpn-hook.sh apply   makes the IPv6 block and DNS match the settings and whether
#                       OpenVPN runs (used by the app at launch and on toggling)

PATH=/usr/sbin:/usr/bin:/sbin:/bin:$PATH
APP_DIR=$(dirname "$(dirname "$0")")
APP_ID=$(basename "$APP_DIR")
PROFILE=$(basename "${config:-VPN}" .ovpn | tr -d '"\\')
RESOLV=${RESOLV:-/etc/resolv.conf}
DNS_MARK="# lgtv-vpn: VPN DNS while connected"
DNS_SERVERS=$APP_DIR/vpn-dns          # servers pushed by the current connection
DNS_BACKUP=$APP_DIR/resolv.conf.orig  # the TV's own resolver file

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

# OpenVPN passes pushed options as foreign_option_1, _2, ... ("dhcp-option DNS 1.2.3.4").
save_pushed_dns() {
  i=1; : > "$DNS_SERVERS"
  while eval "opt=\${foreign_option_$i:-}"; [ -n "$opt" ]; do
    case $opt in "dhcp-option DNS "*) echo "${opt#dhcp-option DNS }" >> "$DNS_SERVERS" ;; esac
    i=$((i + 1))
  done
}
use_vpn_dns() {
  [ -s "$DNS_SERVERS" ] || return 0
  grep -q "^$DNS_MARK" "$RESOLV" 2>/dev/null || cp "$RESOLV" "$DNS_BACKUP"
  { echo "$DNS_MARK"; sed 's/^/nameserver /' "$DNS_SERVERS"; } > "$RESOLV"
}
restore_dns() {
  # Only undo our own change: connman may have rewritten the file since.
  if grep -q "^$DNS_MARK" "$RESOLV" 2>/dev/null && [ -s "$DNS_BACKUP" ]; then
    cat "$DNS_BACKUP" > "$RESOLV"
  fi
  rm -f "$DNS_BACKUP"
}

if [ "${1:-}" = apply ] || [ "${1:-}" = apply-ipv6 ]; then
  if pidof openvpn >/dev/null; then
    if setting BLOCK_IPV6; then block_ipv6; else unblock_ipv6; fi
    if setting VPN_DNS; then use_vpn_dns; else restore_dns; fi
  else
    unblock_ipv6
    restore_dns
  fi
  exit 0
fi

# $signal says why the tunnel went down. A deliberate stop is sigterm/sigint, or
# exit-with-notification when the profile uses explicit-exit-notify (most UDP ones).
# While OpenVPN reconnects the IPv6 block and VPN DNS stay, so nothing leaks in between.
case "$script_type:${signal:-}" in
  up:*)
    if setting BLOCK_IPV6; then block_ipv6; fi
    save_pushed_dns
    if setting VPN_DNS; then use_vpn_dns; fi
    message="VPN connected: $PROFILE" ;;
  down:sigterm | down:sigint | down:exit-with-notification)
    unblock_ipv6; restore_dns
    message="VPN disconnected" ;;
  down:ping-exit | down:inactive)
    unblock_ipv6; restore_dns
    message="VPN connection lost" ;;
  down:*) message="VPN connection lost. Reconnecting…" ;;
  *) exit 0 ;;
esac

if setting NOTIFY; then
  luna-send -n 1 luna://com.webos.notification/createToast \
    "{\"sourceId\":\"$APP_ID\",\"message\":\"$message\"}" >/dev/null 2>&1 &
fi
exit 0

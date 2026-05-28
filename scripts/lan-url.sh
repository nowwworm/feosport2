#!/usr/bin/env bash
# Print the LAN access URLs for the FeoSport2 stack.
# Works on any router (192.168.x, 10.x, 172.16-31.x) — no hardcoded IPs.
# Auto-skips VPN tunnels, loopback, AirDrop, bridges, Thunderbolt-bridge.

set -eu

PORT="${PORT:-80}"

for IFACE in $(ifconfig -l); do
  case "$IFACE" in utun*|bridge*|awdl*|llw*|lo*|gif*|stf*|anpi*|ap*) continue ;; esac
  IP=$(ipconfig getifaddr "$IFACE" 2>/dev/null || true)
  [ -z "$IP" ] && continue
  case "$IP" in
    10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*) ;;
    *) continue ;;
  esac
  MASK_HEX=$(ifconfig "$IFACE" | awk -v ip="$IP" '$1=="inet" && $2==ip {print $4; exit}')
  python3 - "$IFACE" "$IP" "$MASK_HEX" "$PORT" <<'PY'
import sys, ipaddress
iface, ip, mask_hex, port = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
bits = bin(int(mask_hex, 16)).count('1')
net  = ipaddress.IPv4Network(f'{ip}/{bits}', strict=False)
hostport = f'{ip}' if port == '80' else f'{ip}:{port}'
print(f'Interface : {iface}')
print(f'Network   : {net.with_prefixlen}  (range {net.network_address+1} – {net.broadcast_address-1})')
print()
print(f'  Frontend : http://{hostport}/')
print(f'  TMX      : http://{hostport}/tmx/')
print(f'  API      : http://{hostport}/api/')
PY
  exit 0
done

echo "No active LAN interface with a private IPv4 address found." >&2
exit 1

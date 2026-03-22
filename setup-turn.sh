#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  Mulle — TURN Server Setup (coturn)
#  Run this on your Ubuntu/Debian server as root
# ═══════════════════════════════════════════════════════════

set -e

# ── Config — EDIT THESE ─────────────────────────────────────
DOMAIN="${1:-$(curl -s ifconfig.me)}"   # your server IP or domain
SECRET="${2:-mulle_turn_secret_change_me}"
TURN_PORT=3478
TURNS_PORT=5349
# ────────────────────────────────────────────────────────────

echo "🔧 Installing coturn..."
apt-get update -qq
apt-get install -y coturn

echo "🔧 Enabling coturn service..."
sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn

echo "🔧 Writing /etc/turnserver.conf..."
cat > /etc/turnserver.conf << EOF
# Mulle TURN server config
listening-port=${TURN_PORT}
tls-listening-port=${TURNS_PORT}

# Your server IP or domain
realm=${DOMAIN}
server-name=${DOMAIN}

# HMAC-based short-lived credentials (matches server.js genTurnCreds)
use-auth-secret
static-auth-secret=${SECRET}

# Logging
log-file=/var/log/coturn/turnserver.log
simple-log

# Performance
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=172.16.0.0-172.31.255.255

# Uncomment and set these for TLS (needs SSL cert):
# cert=/etc/ssl/certs/turn.pem
# pkey=/etc/ssl/private/turn.key

# Allow all origins
no-tlsv1
no-tlsv1_1
EOF

mkdir -p /var/log/coturn

echo "🔧 Starting coturn..."
systemctl enable coturn
systemctl restart coturn
systemctl status coturn --no-pager

echo ""
echo "✅ TURN server running on ${DOMAIN}:${TURN_PORT}"
echo ""
echo "Now start Mulle with these env vars:"
echo ""
echo "  export TURN_DOMAIN=${DOMAIN}"
echo "  export TURN_SECRET=${SECRET}"
echo "  export TURN_PORT=${TURN_PORT}"
echo "  export TURN_TLS=${TURNS_PORT}"
echo "  node server.js"
echo ""
echo "Or add to your .env file:"
echo "  TURN_DOMAIN=${DOMAIN}"
echo "  TURN_SECRET=${SECRET}"

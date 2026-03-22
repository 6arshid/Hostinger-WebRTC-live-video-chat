#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  Mulle.live — نصب کامل خودکار با TURN server داخلی
#  اجرا کن:  sudo bash install.sh
# ═══════════════════════════════════════════════════════════════
set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info(){ echo -e "${BLUE}[•]${NC} $1"; }
ok()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn(){ echo -e "${YELLOW}[!]${NC} $1"; }
die() { echo -e "${RED}[✗] $1${NC}"; exit 1; }

[ "$EUID" -ne 0 ] && die "با root اجرا کن: sudo bash install.sh"
command -v apt-get &>/dev/null || die "فقط Ubuntu/Debian پشتیبانی میشه"

echo -e "\n${BLUE}╔══════════════════════════════════════╗"
echo -e "║    Mulle.live — نصب خودکار کامل     ║"
echo -e "╚══════════════════════════════════════╝${NC}\n"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || curl -s --max-time 5 api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
DOMAIN="${MULLE_DOMAIN:-$SERVER_IP}"
EXISTING_SECRET=$(grep TURN_SECRET /opt/mulle/.env 2>/dev/null | cut -d= -f2 || true)
TURN_SECRET="${EXISTING_SECRET:-$(openssl rand -hex 24)}"
APP_DIR="/opt/mulle"
PORT="${PORT:-3000}"

ok "IP سرور: $SERVER_IP"
ok "محل نصب: $APP_DIR"

info "بروزرسانی سیستم..."
apt-get update -qq 2>/dev/null

info "نصب Node.js 20..."
if ! command -v node &>/dev/null || [[ $(node -v 2>/dev/null | cut -d. -f1 | tr -d 'v') -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y nodejs >/dev/null 2>&1
fi
ok "Node.js: $(node -v)"

info "نصب coturn و ابزارها..."
apt-get install -y coturn netcat-openbsd >/dev/null 2>&1
ok "coturn نصب شد"

info "نصب pm2..."
npm install -g pm2 >/dev/null 2>&1
ok "pm2 نصب شد"

info "کانفیگ TURN server..."
grep -q "TURNSERVER_ENABLED=1" /etc/default/coturn 2>/dev/null || \
  sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn 2>/dev/null || \
  echo "TURNSERVER_ENABLED=1" >> /etc/default/coturn
mkdir -p /var/log/coturn
cat > /etc/turnserver.conf << TURNEOF
listening-port=3478
tls-listening-port=5349
realm=${DOMAIN}
server-name=${DOMAIN}
use-auth-secret
static-auth-secret=${TURN_SECRET}
log-file=/var/log/coturn/turnserver.log
simple-log
no-multicast-peers
no-tlsv1
no-tlsv1_1
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
TURNEOF
systemctl enable coturn >/dev/null 2>&1
systemctl restart coturn
sleep 2
systemctl is-active --quiet coturn && ok "TURN server روشنه ✓" || warn "TURN مشکل داشت"

info "نصب Mulle..."
mkdir -p "$APP_DIR"
[ -f "$SCRIPT_DIR/server.js" ] || die "server.js پیدا نشد! مطمئن شو zip رو باز کردی و داخل پوشه mulle_fixed هستی"
cp -r "$SCRIPT_DIR"/. "$APP_DIR/"
ok "فایل‌ها کپی شدن به $APP_DIR"

info "ساختن .env..."
cat > "$APP_DIR/.env" << ENVEOF
PORT=${PORT}
TURN_DOMAIN=${DOMAIN}
TURN_SECRET=${TURN_SECRET}
TURN_PORT=3478
TURN_TLS=5349
USE_TURN=true
NODE_ENV=production
ENVEOF
ok ".env ساخته شد"

info "نصب packages..."
cd "$APP_DIR" && npm install --production >/dev/null 2>&1
ok "packages نصب شدن"

info "راه‌اندازی Mulle با pm2..."
pm2 delete mulle 2>/dev/null || true
pm2 start server.js --name mulle
pm2 save >/dev/null 2>&1
env PATH=$PATH:/usr/bin pm2 startup systemd -u root --hp /root 2>/dev/null | grep "^sudo" | bash >/dev/null 2>&1 || true
sleep 3
pm2 show mulle | grep -q "online" && ok "Mulle روشنه ✓" || warn "مشکل — pm2 logs mulle رو چک کن"

info "باز کردن پورت‌های فایروال..."
if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "active"; then
  for p in ${PORT}/tcp 3478/tcp 3478/udp 5349/tcp 5349/udp; do
    ufw allow $p >/dev/null 2>&1 || true
  done
  ok "ufw پورت‌ها باز شدن"
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════╗"
echo -e "║          ✅  نصب کامل شد!              ║"
echo -e "╚═══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  🌐 سایت:   ${YELLOW}http://${SERVER_IP}:${PORT}${NC}"
echo -e "  🔄 TURN:   ${YELLOW}${DOMAIN}:3478${NC}"
echo ""
echo -e "  ${YELLOW}⚠️  پورت‌های مورد نیاز در پنل VPS:${NC}"
echo -e "     ${BLUE}${PORT}/TCP${NC}     — وبسایت"
echo -e "     ${BLUE}3478/TCP+UDP${NC}  — TURN"
echo -e "     ${BLUE}5349/TCP+UDP${NC}  — TURNS"
echo ""
echo -e "  📋 دستورات مفید:"
echo -e "     ${BLUE}pm2 logs mulle${NC}          — لاگ سایت"
echo -e "     ${BLUE}systemctl status coturn${NC}  — وضعیت TURN"
echo -e "     ${BLUE}pm2 restart mulle${NC}        — ریستارت"
echo ""
cat > /root/mulle-info.txt << EOF
Mulle.live Installation
Date: $(date)
Site: http://${SERVER_IP}:${PORT}
TURN: ${DOMAIN}:3478
Secret: ${TURN_SECRET}
EOF
ok "اطلاعات در /root/mulle-info.txt ذخیره شد"

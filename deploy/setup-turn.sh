#!/usr/bin/env bash
# Install and configure coturn for Qix calls. Run on the VPS as root:
#
#   cd /path/to/qix-www
#   sudo TURN_DOMAIN=turn.qqqix.ru ./deploy/setup-turn.sh
#
# Idempotent: re-running keeps the existing secret (rotating it would break
# calls that are mid-ICE-restart) and backs up whatever it replaces.
#
# What it does NOT touch: nginx config, PM2, the app. The last step prints the
# two lines to put in .env plus the reload command.
set -euo pipefail

TURN_DOMAIN="${TURN_DOMAIN:-}"
REALM="${REALM:-}"
PUBLIC_IP="${PUBLIC_IP:-}"
EMAIL="${EMAIL:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$HERE/turnserver.conf"
APP_ENV="$(dirname "$HERE")/.env"

die() {
	echo "error: $*" >&2
	exit 1
}
step() { echo; echo "== $*"; }

[ "$(id -u)" = 0 ] || die "run as root (sudo)"
[ -n "$TURN_DOMAIN" ] || die "set TURN_DOMAIN, e.g. TURN_DOMAIN=turn.qqqix.ru $0"
[ -f "$TEMPLATE" ] || die "template not found: $TEMPLATE"

# realm is what shows up in credentials; the registrable domain is conventional.
[ -n "$REALM" ] || REALM="$(echo "$TURN_DOMAIN" | awk -F. '{ if (NF>2) print $(NF-1)"."$NF; else print $0 }')"

if [ -z "$PUBLIC_IP" ]; then
	PUBLIC_IP="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
	[ -n "$PUBLIC_IP" ] || PUBLIC_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi
[ -n "$PUBLIC_IP" ] || die "could not determine the public IP, pass PUBLIC_IP=..."

echo "domain : $TURN_DOMAIN"
echo "realm  : $REALM"
echo "ip     : $PUBLIC_IP"

resolved="$(getent hosts "$TURN_DOMAIN" | awk '{print $1}' | head -1 || true)"
if [ "$resolved" != "$PUBLIC_IP" ]; then
	echo
	echo "warning: $TURN_DOMAIN resolves to '${resolved:-nothing}', not $PUBLIC_IP."
	echo "         The certificate step will fail until the A record points here."
fi

step "Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq coturn certbot curl >/dev/null
sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
grep -q '^TURNSERVER_ENABLED=1' /etc/default/coturn || echo 'TURNSERVER_ENABLED=1' >>/etc/default/coturn

step "Secret"
SECRET="$(grep -oP '^static-auth-secret=\K.*' /etc/turnserver.conf 2>/dev/null || true)"
if [ -n "$SECRET" ]; then
	echo "reusing the secret already in /etc/turnserver.conf"
else
	SECRET="$(openssl rand -hex 32)"
	echo "generated a new 32-byte secret"
fi

step "Certificate for turns:5349"
# --standalone needs port 80, which nginx owns; the hooks free it for the
# handshake and are stored in the renewal config so future renewals do the same.
# Swap to --webroot if a few seconds of downtime per renewal is unacceptable.
if [ -f "/etc/letsencrypt/live/$TURN_DOMAIN/fullchain.pem" ]; then
	echo "certificate already present, skipping certbot"
else
	acme=(
		--standalone --non-interactive --agree-tos --preferred-challenges http
		--pre-hook 'systemctl stop nginx || true'
		--post-hook 'systemctl start nginx || true'
		-d "$TURN_DOMAIN"
	)
	if [ -n "$EMAIL" ]; then
		acme+=(--email "$EMAIL")
	else
		acme+=(--register-unsafely-without-email)
	fi
	certbot certonly "${acme[@]}"
fi

step "Certificate renewal hook"
install -m 755 "$HERE/coturn-le-hook.sh" /etc/letsencrypt/renewal-hooks/deploy/coturn.sh
TURN_DOMAIN="$TURN_DOMAIN" /etc/letsencrypt/renewal-hooks/deploy/coturn.sh || true

step "Writing /etc/turnserver.conf"
if [ -f /etc/turnserver.conf ]; then
	cp /etc/turnserver.conf "/etc/turnserver.conf.bak.$(date +%s)"
	echo "kept a backup of the previous config"
fi
umask 077
sed -e "s|__PUBLIC_IP__|$PUBLIC_IP|g" \
	-e "s|__REALM__|$REALM|g" \
	-e "s|__TURN_DOMAIN__|$TURN_DOMAIN|g" \
	-e "s|__TURN_SECRET__|$SECRET|g" \
	"$TEMPLATE" >/etc/turnserver.conf
chmod 640 /etc/turnserver.conf
chown root:turnserver /etc/turnserver.conf

step "Firewall"
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
	for rule in 3478/tcp 3478/udp 5349/tcp 5349/udp 49160:49200/udp; do
		ufw allow "$rule" >/dev/null && echo "ufw allow $rule"
	done
else
	echo "ufw not active — open 3478/tcp+udp, 5349/tcp+udp and 49160:49200/udp yourself."
fi
echo "Remember the cloud provider's security group needs the same rules,"
echo "including the 49160-49200/udp relay range."

step "Starting coturn"
systemctl enable coturn >/dev/null 2>&1 || true
systemctl restart coturn
sleep 1
systemctl is-active --quiet coturn && echo "coturn is running" || die "coturn failed to start: journalctl -u coturn -n 40"

TURN_URL="turn:$TURN_DOMAIN:3478?transport=udp,turn:$TURN_DOMAIN:3478?transport=tcp,turns:$TURN_DOMAIN:5349?transport=tcp"

step "App configuration"
if [ -f "$APP_ENV" ] && ! grep -q '^TURN_SECRET=' "$APP_ENV"; then
	cp "$APP_ENV" "$APP_ENV.bak.$(date +%s)"
	{
		echo ""
		echo "# Added by deploy/setup-turn.sh"
		echo "TURN_URL=$TURN_URL"
		echo "TURN_SECRET=$SECRET"
	} >>"$APP_ENV"
	echo "appended TURN_URL and TURN_SECRET to $APP_ENV (previous version backed up)"
else
	echo "add these to $APP_ENV yourself:"
	echo
	echo "TURN_URL=$TURN_URL"
	echo "TURN_SECRET=$SECRET"
fi

cat <<EOF

== Done. Two things left:

  pm2 reload ecosystem.config.cjs --update-env

  turnutils_uclient -T -W '$SECRET' -u qix -v $TURN_DOMAIN   # expect a 'relay' line

EOF

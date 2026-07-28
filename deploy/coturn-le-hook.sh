#!/bin/sh
# Certbot deploy hook — /etc/letsencrypt/renewal-hooks/deploy/coturn.sh
#
# coturn runs as the `turnserver` user and cannot read /etc/letsencrypt/live,
# so the renewed pair is copied somewhere it can. Without this, turns: on 5349
# keeps serving the old certificate and stops working after 90 days.
#
# Install (as root):
#   install -m 755 deploy/coturn-le-hook.sh /etc/letsencrypt/renewal-hooks/deploy/coturn.sh
#   TURN_DOMAIN=turn.example.com /etc/letsencrypt/renewal-hooks/deploy/coturn.sh
set -eu

# certbot exports RENEWED_LINEAGE; the fallback is for the manual first run.
LINEAGE="${RENEWED_LINEAGE:-/etc/letsencrypt/live/${TURN_DOMAIN:-}}"

if [ ! -f "$LINEAGE/fullchain.pem" ]; then
	echo "coturn hook: no certificate at $LINEAGE, nothing to do" >&2
	exit 0
fi

install -d -o turnserver -g turnserver -m 750 /etc/coturn
install -o turnserver -g turnserver -m 600 "$LINEAGE/fullchain.pem" /etc/coturn/fullchain.pem
install -o turnserver -g turnserver -m 600 "$LINEAGE/privkey.pem" /etc/coturn/privkey.pem

systemctl restart coturn
echo "coturn hook: certificate from $LINEAGE installed, coturn restarted"

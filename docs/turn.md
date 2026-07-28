# TURN (coturn) for calls

## Why it is required

A call is peer-to-peer. STUN alone only tells each side what its public address
looks like — that is enough when at least one of them can accept an inbound
packet. Two phones on mobile data are both behind carrier-grade NAT, so neither
can, and the call gets stuck on "Соединение" until it fails. A TURN server
relays the media instead, and that is the one path that always works.

Rule of thumb: STUN covers most Wi-Fi-to-Wi-Fi calls, TURN covers the rest.
Budget for relay traffic — a voice call is ~50 kbit/s each way, a video call
~1–2 Mbit/s, and it crosses the VPS twice.

## Setup

Point a hostname at the VPS first:

```
turn.qqqix.ru.  A  <PUBLIC_IP>
```

Then, on the server, in the deployed copy of this repository:

```sh
cd /path/to/qix-www
sudo TURN_DOMAIN=turn.qqqix.ru EMAIL=admin@qqqix.ru ./deploy/setup-turn.sh
pm2 reload ecosystem.config.cjs --update-env
```

`deploy/setup-turn.sh` installs coturn and certbot, gets a certificate for
`turns:`, renders [`deploy/turnserver.conf`](../deploy/turnserver.conf) into
`/etc/turnserver.conf` with a generated 32-byte secret, installs
[`deploy/coturn-le-hook.sh`](../deploy/coturn-le-hook.sh) as a certbot renewal hook, opens
the firewall, starts the service, and appends `TURN_URL`/`TURN_SECRET` to `.env`.
It is safe to re-run: the existing secret is kept and replaced files are backed
up.

`certbot --standalone` needs port 80, which nginx owns, so the script registers
pre/post hooks that stop and start nginx around the challenge. That means a few
seconds of downtime whenever the certificate renews. Switch the renewal to
`--webroot` if that matters.

Overridable: `REALM` (defaults to the registrable domain), `PUBLIC_IP`
(auto-detected), `EMAIL` (omitted means registering without one).

## Verify

**The server itself** — a `relay` line means allocation works:

```sh
turnutils_uclient -T -W "$(grep -oP '^static-auth-secret=\K.*' /etc/turnserver.conf)" \
  -u qix -v turn.qqqix.ru
```

**Credential delivery** — in the devtools console of a logged-in tab, during a
call:

```js
(await (await fetch('/api/calls')).json()).call.iceServers;
```

There must be an entry with `turn:`/`turns:` URLs whose `username` starts with a
unix timestamp in the future. Pasting that entry into
[Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)
must produce a candidate of type `relay`.

**End to end** — with two accounts on different networks (one on mobile data),
start a call and open `chrome://webrtc-internals`. The selected candidate pair
should be `succeeded`; on a strict network its local candidate type is `relay`.

## How the credentials work

`src/lib/server/calls.ts` signs a fresh pair per user and puts it in every call
DTO: `username` is `<unix-expiry>:<userId>`, `credential` is
`base64(HMAC-SHA1(TURN_SECRET, username))`, valid 12 hours. coturn verifies it
with the same secret (`use-auth-secret`), so there are no TURN accounts to
manage and nothing long-lived is exposed to clients.

Rotating `TURN_SECRET` invalidates outstanding credentials — calls in the middle
of an ICE restart at that moment will drop, so rotate during a quiet period, and
change it in `/etc/turnserver.conf` and `.env` together.

`TURN_USERNAME`/`TURN_CREDENTIAL` remain as a fallback for a throwaway local
coturn. Do not use them in production: that password reaches every client that
makes a call and stays valid until someone rotates it by hand.

## Notes

- **Env vars reach the app through `ecosystem.config.cjs`.** PM2 runs
  `build/index.js` directly, so the `--env-file=.env` in `pnpm start` never
  applies; the config parses `.env` itself and passes the values in `env`. A new
  variable has to be added there too, or it is undefined at runtime.
- **Keep PM2 at `instances: 1`.** Call state and the SSE subscriber map live in
  the process's memory (`src/lib/server/calls.ts`, `src/lib/server/events.ts`).
  Cluster mode would put the two participants in different workers and no signal
  would ever be delivered.
- **TURN does not go through nginx** — coturn owns 3478/5349 directly. nginx only
  matters for signalling: `/api/events` is SSE, so that location needs
  `proxy_buffering off;` and a `proxy_read_timeout` well above the 45 s ring
  timeout, otherwise invites arrive late or not at all.
- **`turns:` on 5349 covers most restrictive networks.** Port 443 covers nearly
  all of them, but only if nothing else on that IP uses it — with nginx on 443
  coturn needs a second address.
- Relay ports (`49160-49200/udp`) must be open in the cloud provider's security
  group as well as in ufw. Miss them and allocation succeeds while the call stays
  silent — the most common way this setup fails.

/**
 * PM2 config for VPS. Copy/adjust ORIGIN to the exact URL from the browser address bar
 * (scheme + host, no trailing slash). Example: http://217.60.240.76
 *
 * Usage:
 *   pnpm build
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * After editing .env or this file:
 *   pm2 reload ecosystem.config.cjs --update-env
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

/**
 * `.env`, parsed here rather than by Node.
 *
 * `pnpm start` runs `node --env-file=.env build`, but PM2 launches
 * `build/index.js` directly, so that flag never applies and anything not listed
 * in `env` below is simply undefined at runtime — which silently disables Web
 * Push and TURN instead of failing loudly. Parsing the file here keeps secrets
 * out of the repository while still getting them into the process.
 *
 * Deliberately not `--env-file` in `node_args`: it is a hard error on a box
 * without a `.env`, and `--env-file-if-exists` does not exist before Node 22.
 */
function dotenv() {
	let raw;
	try {
		raw = readFileSync(join(__dirname, '.env'), 'utf8');
	} catch {
		return {};
	}
	const out = {};
	for (const line of raw.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		let value = trimmed.slice(eq + 1).trim();
		const quoted =
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"));
		if (quoted && value.length >= 2) value = value.slice(1, -1);
		out[key] = value;
	}
	return out;
}

const file = dotenv();

/** Shell environment wins, so `VAR=x pm2 reload … --update-env` still overrides `.env`. */
const pick = (key, fallback = '') => process.env[key] ?? file[key] ?? fallback;

module.exports = {
	apps: [
		{
			name: 'qix',
			script: 'build/index.js',
			// Must stay 1: call state and the SSE subscriber map live in this
			// process's memory (src/lib/server/calls.ts, src/lib/server/events.ts).
			// In cluster mode two participants land in different workers and no
			// signal is ever delivered.
			instances: 1,
			exec_mode: 'fork',
			env: {
				NODE_ENV: 'production',
				// MUST match the URL users open (http vs https, with :port if not 80/443)
				ORIGIN: pick('ORIGIN', 'https://qqqix.ru'),
				HOST: '0.0.0.0',
				PORT: pick('PORT', '3000'),
				// Avatar/banner uploads (default adapter limit is 512K)
				BODY_SIZE_LIMIT: pick('BODY_SIZE_LIMIT', '8M'),

				// Web Push
				VAPID_PUBLIC_KEY: pick('VAPID_PUBLIC_KEY'),
				VAPID_PRIVATE_KEY: pick('VAPID_PRIVATE_KEY'),
				VAPID_SUBJECT: pick('VAPID_SUBJECT', 'mailto:admin@qqqix.ru'),

				// TURN relay for calls — see docs/turn.md. Without TURN_URL the app
				// falls back to STUN only, which fails between two mobile networks.
				TURN_URL: pick('TURN_URL'),
				TURN_SECRET: pick('TURN_SECRET'),
				TURN_USERNAME: pick('TURN_USERNAME'),
				TURN_CREDENTIAL: pick('TURN_CREDENTIAL')
			}
		}
	]
};

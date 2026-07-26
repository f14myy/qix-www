/**
 * Origins the native Qix apps talk to us from.
 *
 * Tauri serves the bundled frontend from a fixed internal origin that differs
 * per platform, and none of them are the site's own origin. Two separate
 * mechanisms need this list:
 *
 *   - CORS, applied in `hooks.server.ts`;
 *   - SvelteKit's CSRF check, which rejects cross-origin form/multipart posts
 *     before `handle` ever runs — so it has to be configured at build time in
 *     `vite.config.ts`. That is why this module is importable from both.
 *
 * Extra origins can be added at build time with APP_TRUSTED_ORIGINS
 * (comma-separated), e.g. a LAN dev URL for testing on a real phone.
 */

/** Windows and Android webviews. */
const TAURI_HTTP = ['http://tauri.localhost', 'https://tauri.localhost'];
/** macOS, iOS and Linux webviews use a custom scheme. */
const TAURI_CUSTOM = ['tauri://localhost'];
/** `tauri dev` loads the frontend from the Vite dev server. */
const TAURI_DEV = [
	'http://localhost:1420',
	'http://127.0.0.1:1420',
	// Android emulator reaches the host dev server through this alias.
	'http://10.0.2.2:1420'
];

const fromEnv = (process.env.APP_TRUSTED_ORIGINS ?? '')
	.split(',')
	.map((s) => s.trim().replace(/\/$/, ''))
	.filter(Boolean);

export const APP_ORIGIN_LIST: string[] = [
	...TAURI_HTTP,
	...TAURI_CUSTOM,
	...TAURI_DEV,
	...fromEnv
];

export const APP_ORIGINS: ReadonlySet<string> = new Set(APP_ORIGIN_LIST);

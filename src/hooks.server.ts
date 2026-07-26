import type { Handle } from '@sveltejs/kit';
import {
	deleteSession,
	getUserFromSession,
	SESSION_COOKIE,
	toPublicUser,
	touchSession
} from '$lib/server/auth';
import { isUserBanned } from '$lib/server/admin';
import { ensureBuiltInChannels, ensureUserInBuiltInChannels } from '$lib/server/channels';
import { APP_ORIGINS } from '$lib/server/appOrigins';

let channelsReady = false;

const CORS_METHODS = 'GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS';
const CORS_HEADERS = 'authorization,content-type';

/**
 * The native apps (Tauri desktop + Android) run on their own webview origin, so
 * the SameSite=Lax session cookie never reaches us. They authenticate with the
 * session id instead:
 *
 *   - `Authorization: Bearer <id>` for anything driven by fetch();
 *   - `?t=<id>` for URLs the webview loads by itself — `<img src>`, `<video src>`
 *     and EventSource, none of which can carry a custom header.
 *
 * The query form is restricted to safe methods so a session id that leaks into a
 * log or a Referer can never be replayed as a state change.
 */
function resolveSessionId(event: Parameters<Handle>[0]['event']): string | undefined {
	const cookie = event.cookies.get(SESSION_COOKIE);
	if (cookie) return cookie;

	const auth = event.request.headers.get('authorization');
	if (auth?.toLowerCase().startsWith('bearer ')) {
		const token = auth.slice(7).trim();
		if (token) return token;
	}

	if (event.request.method === 'GET' || event.request.method === 'HEAD') {
		const token = event.url.searchParams.get('t')?.trim();
		if (token) return token;
	}

	return undefined;
}

function corsHeaders(origin: string | null): Record<string, string> | null {
	if (!origin || !APP_ORIGINS.has(origin)) return null;
	return {
		'access-control-allow-origin': origin,
		'access-control-allow-methods': CORS_METHODS,
		'access-control-allow-headers': CORS_HEADERS,
		'access-control-max-age': '86400',
		vary: 'Origin'
	};
}

export const handle: Handle = async ({ event, resolve }) => {
	if (!channelsReady) {
		ensureBuiltInChannels();
		channelsReady = true;
	}

	const cors = corsHeaders(event.request.headers.get('origin'));

	// Preflight never reaches a route handler — answer it before touching the DB.
	if (event.request.method === 'OPTIONS' && cors) {
		return new Response(null, { status: 204, headers: cors });
	}

	const sessionId = resolveSessionId(event);
	const user = getUserFromSession(sessionId);

	const withCors = (response: Response) => {
		if (cors) for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
		return response;
	};

	if (user && isUserBanned(user)) {
		if (sessionId) deleteSession(sessionId, event.cookies);
		event.locals.user = null;
		event.locals.sessionId = null;
		return withCors(await resolve(event));
	}

	event.locals.user = user ? toPublicUser(user) : null;
	event.locals.sessionId = user && sessionId ? sessionId : null;
	if (sessionId && user) {
		touchSession(sessionId);
		ensureUserInBuiltInChannels(user.id);
	}
	return withCors(await resolve(event));
};

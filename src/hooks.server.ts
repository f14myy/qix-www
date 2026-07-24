import type { Handle } from '@sveltejs/kit';
import { getUserFromSession, SESSION_COOKIE, toPublicUser } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
	const sessionId = event.cookies.get(SESSION_COOKIE);
	const user = getUserFromSession(sessionId);
	event.locals.user = user ? toPublicUser(user) : null;
	event.locals.sessionId = user && sessionId ? sessionId : null;
	return resolve(event);
};

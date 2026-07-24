import type { Handle } from '@sveltejs/kit';
import {
	deleteSession,
	getUserFromSession,
	SESSION_COOKIE,
	toPublicUser
} from '$lib/server/auth';
import { isUserBanned } from '$lib/server/admin';

export const handle: Handle = async ({ event, resolve }) => {
	const sessionId = event.cookies.get(SESSION_COOKIE);
	const user = getUserFromSession(sessionId);

	if (user && isUserBanned(user)) {
		if (sessionId) deleteSession(sessionId, event.cookies);
		event.locals.user = null;
		event.locals.sessionId = null;
		return resolve(event);
	}

	event.locals.user = user ? toPublicUser(user) : null;
	event.locals.sessionId = user && sessionId ? sessionId : null;
	return resolve(event);
};

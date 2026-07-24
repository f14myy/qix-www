import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteSession, listSessions } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { sessions } from '$lib/server/schema';
import { and, eq, ne } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	return json({ sessions: listSessions(locals.user.id, locals.sessionId) });
};

export const DELETE: RequestHandler = async ({ request, locals, cookies }) => {
	if (!locals.user || !locals.sessionId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = await request.json().catch(() => null);
	const all = !!(body as { all?: unknown })?.all;
	const id = String((body as { id?: unknown })?.id ?? '');

	if (all) {
		db.delete(sessions)
			.where(and(eq(sessions.userId, locals.user.id), ne(sessions.id, locals.sessionId)))
			.run();
		return json({ ok: true });
	}

	if (!id) return json({ error: 'Session id required' }, { status: 400 });
	if (id === locals.sessionId) {
		deleteSession(id, cookies);
		return json({ ok: true, loggedOut: true });
	}

	db.delete(sessions)
		.where(and(eq(sessions.id, id), eq(sessions.userId, locals.user.id)))
		.run();
	return json({ ok: true });
};

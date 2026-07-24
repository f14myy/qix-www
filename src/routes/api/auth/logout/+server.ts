import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteSession } from '$lib/server/auth';

export const POST: RequestHandler = async ({ locals, cookies }) => {
	if (locals.sessionId) {
		deleteSession(locals.sessionId, cookies);
	}
	return json({ ok: true });
};

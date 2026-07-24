import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteSession } from '$lib/server/auth';
import { deleteSubscription } from '$lib/server/push';

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	if (locals.sessionId) {
		deleteSession(locals.sessionId, cookies);
	}

	if (locals.user) {
		try {
			const body = await request.json().catch(() => null);
			const endpoint = String((body as { endpoint?: unknown })?.endpoint ?? '');
			if (endpoint) deleteSubscription(locals.user.id, endpoint);
		} catch {
			/* ignore */
		}
	}

	return json({ ok: true });
};

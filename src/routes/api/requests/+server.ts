import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	acceptMessageRequest,
	createMessageRequest,
	declineMessageRequest,
	listIncomingRequests
} from '$lib/server/features';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { normalizeUsername, validateUsername } from '$lib/server/auth';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	return json({ requests: listIncomingRequests(locals.user.id) });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = await request.json().catch(() => null);
	const peerUsernameRaw = String((body as { peerUsername?: unknown })?.peerUsername ?? '');
	const note = String((body as { note?: unknown })?.note ?? '');
	const usernameError = validateUsername(peerUsernameRaw);
	if (usernameError) return json({ error: usernameError }, { status: 400 });

	const peer = db
		.select()
		.from(users)
		.where(eq(users.username, normalizeUsername(peerUsernameRaw)))
		.get();
	if (!peer) return json({ error: 'User not found' }, { status: 404 });

	try {
		const result = createMessageRequest(locals.user.id, peer.id, note);
		if (result.chatId) {
			return json({ chatId: result.chatId }, { status: 201 });
		}
		return json({ requestId: result.request?.id, pending: true }, { status: 201 });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 400 });
	}
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = await request.json().catch(() => null);
	const id = String((body as { id?: unknown })?.id ?? '');
	const action = String((body as { action?: unknown })?.action ?? '');
	if (!id) return json({ error: 'id required' }, { status: 400 });

	try {
		if (action === 'accept') {
			const chatId = acceptMessageRequest(id, locals.user.id);
			return json({ chatId });
		}
		if (action === 'decline') {
			declineMessageRequest(id, locals.user.id);
			return json({ ok: true });
		}
		return json({ error: 'Invalid action' }, { status: 400 });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 400 });
	}
};

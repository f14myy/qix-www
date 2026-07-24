import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { normalizeUsername, validateUsername } from '$lib/server/auth';
import { listChatsForUser } from '$lib/server/chats';
import { db } from '$lib/server/db';
import { createMessageRequest } from '$lib/server/features';
import { users } from '$lib/server/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const archived = url.searchParams.get('archived') === '1';
	return json({ chats: listChatsForUser(locals.user.id, { archived }) });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => null);
	const peerUsernameRaw = String((body as { peerUsername?: unknown })?.peerUsername ?? '');
	const note = String((body as { note?: unknown })?.note ?? '');

	const usernameError = validateUsername(peerUsernameRaw);
	if (usernameError) return json({ error: usernameError }, { status: 400 });

	const peerUsername = normalizeUsername(peerUsernameRaw);
	if (peerUsername === locals.user.username) {
		return json({ error: 'Cannot chat with yourself' }, { status: 400 });
	}

	const peer = db.select().from(users).where(eq(users.username, peerUsername)).get();
	if (!peer) return json({ error: 'User not found' }, { status: 404 });

	try {
		const result = createMessageRequest(locals.user.id, peer.id, note);
		if (result.chatId) {
			return json(
				{ chatId: result.chatId, peer: { id: peer.id, username: peer.username } },
				{ status: 201 }
			);
		}
		return json(
			{
				pending: true,
				requestId: result.request?.id,
				peer: { id: peer.id, username: peer.username }
			},
			{ status: 202 }
		);
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 403 });
	}
};

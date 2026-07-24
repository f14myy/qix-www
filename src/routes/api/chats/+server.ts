import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { normalizeUsername, validateUsername } from '$lib/server/auth';
import { createDm, listChatsForUser } from '$lib/server/chats';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	return json({ chats: listChatsForUser(locals.user.id) });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => null);
	const peerUsernameRaw = String((body as { peerUsername?: unknown })?.peerUsername ?? '');

	const usernameError = validateUsername(peerUsernameRaw);
	if (usernameError) return json({ error: usernameError }, { status: 400 });

	const peerUsername = normalizeUsername(peerUsernameRaw);
	if (peerUsername === locals.user.username) {
		return json({ error: 'Cannot chat with yourself' }, { status: 400 });
	}

	const peer = db.select().from(users).where(eq(users.username, peerUsername)).get();
	if (!peer) return json({ error: 'User not found' }, { status: 404 });

	const chatId = createDm(locals.user.id, peer.id);
	return json({ chatId, peer: { id: peer.id, username: peer.username } }, { status: 201 });
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { normalizeUsername, validateUsername } from '$lib/server/auth';
import { blockUser, listBlockedUsers } from '$lib/server/settings';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	return json({ blocked: listBlockedUsers(locals.user.id) });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => null)) as {
		userId?: string;
		username?: string;
	} | null;

	let targetId = typeof body?.userId === 'string' ? body.userId : '';

	if (!targetId && body?.username) {
		const err = validateUsername(body.username);
		if (err) return json({ error: err }, { status: 400 });
		const peer = db
			.select()
			.from(users)
			.where(eq(users.username, normalizeUsername(body.username)))
			.get();
		if (!peer) return json({ error: 'User not found' }, { status: 404 });
		targetId = peer.id;
	}

	if (!targetId) return json({ error: 'userId or username required' }, { status: 400 });
	if (targetId === locals.user.id) {
		return json({ error: 'Cannot block yourself' }, { status: 400 });
	}

	const exists = db.select({ id: users.id }).from(users).where(eq(users.id, targetId)).get();
	if (!exists) return json({ error: 'User not found' }, { status: 404 });

	blockUser(locals.user.id, targetId);
	return json({ blocked: listBlockedUsers(locals.user.id) }, { status: 201 });
};

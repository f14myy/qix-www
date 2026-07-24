import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { normalizeUsername } from '$lib/server/auth';
import { toPublicProfile } from '$lib/server/chats';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const username = normalizeUsername(params.username);
	const user = db.select().from(users).where(eq(users.username, username)).get();
	if (!user) return json({ error: 'Not found' }, { status: 404 });
	return json({ profile: toPublicProfile(user) });
};

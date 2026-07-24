import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { reportUser } from '$lib/server/features';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = await request.json().catch(() => null);
	const userId = String((body as { userId?: unknown })?.userId ?? '');
	const reason = String((body as { reason?: unknown })?.reason ?? '');
	if (!userId) return json({ error: 'userId required' }, { status: 400 });
	const target = db.select().from(users).where(eq(users.id, userId)).get();
	if (!target) return json({ error: 'Not found' }, { status: 404 });

	try {
		const id = reportUser(locals.user.id, userId, reason || 'No reason given');
		return json({ id }, { status: 201 });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 400 });
	}
};

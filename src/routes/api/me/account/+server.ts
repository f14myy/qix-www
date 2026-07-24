import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteSession, verifyPassword } from '$lib/server/auth';
import { purgeUserAccount } from '$lib/server/admin';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { eq } from 'drizzle-orm';

export const DELETE: RequestHandler = async ({ request, locals, cookies }) => {
	if (!locals.user || !locals.sessionId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = await request.json().catch(() => null);
	const password = String((body as { password?: unknown })?.password ?? '');
	if (!password) return json({ error: 'Password required' }, { status: 400 });

	const user = db.select().from(users).where(eq(users.id, locals.user.id)).get();
	if (!user || !(await verifyPassword(password, user.passwordHash))) {
		return json({ error: 'Password is incorrect' }, { status: 401 });
	}

	const result = await purgeUserAccount(user.id);
	if (!result.ok) return json({ error: result.error }, { status: 400 });

	deleteSession(locals.sessionId, cookies);
	return json({ ok: true });
};

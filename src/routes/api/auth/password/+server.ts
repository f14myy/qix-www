import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	hashPassword,
	revokeOtherSessions,
	validatePassword,
	verifyPassword
} from '$lib/server/auth';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || !locals.sessionId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = await request.json().catch(() => null);
	const current = String((body as { current?: unknown })?.current ?? '');
	const next = String((body as { next?: unknown })?.next ?? '');

	const passwordError = validatePassword(next);
	if (passwordError) return json({ error: passwordError }, { status: 400 });
	if (!current) return json({ error: 'Current password required' }, { status: 400 });

	const user = db.select().from(users).where(eq(users.id, locals.user.id)).get();
	if (!user || !(await verifyPassword(current, user.passwordHash))) {
		return json({ error: 'Current password is incorrect' }, { status: 401 });
	}

	const passwordHash = await hashPassword(next);
	db.update(users).set({ passwordHash }).where(eq(users.id, user.id)).run();
	revokeOtherSessions(user.id, locals.sessionId);

	return json({ ok: true });
};

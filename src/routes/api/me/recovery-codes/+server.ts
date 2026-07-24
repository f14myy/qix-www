import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	countUnusedRecoveryCodes,
	regenerateRecoveryCodes,
	verifyPassword
} from '$lib/server/auth';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	return json({ remaining: countUnusedRecoveryCodes(locals.user.id) });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => null);
	const password = String((body as { password?: unknown })?.password ?? '');
	if (!password) return json({ error: 'Password required' }, { status: 400 });

	const user = db.select().from(users).where(eq(users.id, locals.user.id)).get();
	if (!user || !(await verifyPassword(password, user.passwordHash))) {
		return json({ error: 'Password is incorrect' }, { status: 401 });
	}

	const codes = regenerateRecoveryCodes(user.id);
	return json({ codes });
};

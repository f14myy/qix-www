import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	createSession,
	normalizeUsername,
	validatePassword,
	validateUsername,
	verifyPassword
} from '$lib/server/auth';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	const usernameRaw = String((body as { username?: unknown }).username ?? '');
	const password = String((body as { password?: unknown }).password ?? '');

	const usernameError = validateUsername(usernameRaw);
	if (usernameError) return json({ error: usernameError }, { status: 400 });

	const passwordError = validatePassword(password);
	if (passwordError) return json({ error: passwordError }, { status: 400 });

	const username = normalizeUsername(usernameRaw);
	const user = db.select().from(users).where(eq(users.username, username)).get();
	if (!user || !(await verifyPassword(password, user.passwordHash))) {
		return json({ error: 'Invalid username or password' }, { status: 401 });
	}

	await createSession(user.id, cookies);

	return json({ user: { id: user.id, username: user.username } });
};

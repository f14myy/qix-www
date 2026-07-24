import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	createSession,
	hashPassword,
	normalizeUsername,
	validatePassword,
	validateUsername
} from '$lib/server/auth';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { createId } from '$lib/server/id';
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
	const existing = db.select().from(users).where(eq(users.username, username)).get();
	if (existing) {
		return json({ error: 'Username is already taken' }, { status: 409 });
	}

	const id = createId();
	const passwordHash = await hashPassword(password);

	db.insert(users)
		.values({
			id,
			username,
			passwordHash,
			createdAt: new Date()
		})
		.run();

	await createSession(id, cookies);

	return json({ user: { id, username } }, { status: 201 });
};

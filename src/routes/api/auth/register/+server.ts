import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	createSession,
	cookieSecureFromRequest,
	hashPassword,
	normalizeUsername,
	regenerateRecoveryCodes,
	validatePassword,
	validateUsername
} from '$lib/server/auth';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { createId } from '$lib/server/id';
import { clientIp, rateLimit } from '$lib/server/rateLimit';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	const ip = clientIp(request, getClientAddress);
	const limited = rateLimit(`register:${ip}`);
	if (!limited.ok) {
		return json(
			{ error: 'Too many attempts. Try again later.' },
			{ status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } }
		);
	}

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

	const codes = regenerateRecoveryCodes(id);
	const token = await createSession(id, cookies, request.headers.get('user-agent'), {
		secure: cookieSecureFromRequest(request)
	});

	return json({ user: { id, username }, recoveryCodes: codes, token }, { status: 201 });
};

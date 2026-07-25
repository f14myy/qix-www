import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	createSession,
	cookieSecureFromRequest,
	normalizeUsername,
	validateUsername,
	verifyPassword
} from '$lib/server/auth';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { clientIp, rateLimit } from '$lib/server/rateLimit';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	const ip = clientIp(request, getClientAddress);
	const limited = rateLimit(`login:${ip}`);
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
	if (!password || password.length > 128) {
		return json({ error: 'Invalid username or password' }, { status: 401 });
	}

	const username = normalizeUsername(usernameRaw);
	const user = db.select().from(users).where(eq(users.username, username)).get();
	if (!user || !(await verifyPassword(password, user.passwordHash))) {
		return json({ error: 'Invalid username or password' }, { status: 401 });
	}

	if (user.bannedAt) {
		const reason = user.bannedReason?.trim();
		return json(
			{
				error: reason ? `Account banned: ${reason}` : 'This account has been banned'
			},
			{ status: 403 }
		);
	}

	await createSession(user.id, cookies, request.headers.get('user-agent'), {
		secure: cookieSecureFromRequest(request)
	});

	return json({ user: { id: user.id, username: user.username } });
};

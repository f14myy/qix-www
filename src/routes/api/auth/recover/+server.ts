import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	consumeRecoveryCode,
	createSession,
	hashPassword,
	normalizeUsername,
	validatePassword,
	validateUsername
} from '$lib/server/auth';
import { db } from '$lib/server/db';
import { sessions, users } from '$lib/server/schema';
import { clientIp, rateLimit } from '$lib/server/rateLimit';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	const ip = clientIp(request, getClientAddress);
	const limited = rateLimit(`recover:${ip}`, 8);
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
	const code = String((body as { code?: unknown }).code ?? '');
	const newPassword = String((body as { newPassword?: unknown }).newPassword ?? '');

	const usernameError = validateUsername(usernameRaw);
	if (usernameError) return json({ error: usernameError }, { status: 400 });

	const passwordError = validatePassword(newPassword);
	if (passwordError) return json({ error: passwordError }, { status: 400 });

	if (!code.trim()) return json({ error: 'Recovery code required' }, { status: 400 });

	const username = normalizeUsername(usernameRaw);
	const user = db.select().from(users).where(eq(users.username, username)).get();
	if (!user || user.bannedAt) {
		return json({ error: 'Invalid username or recovery code' }, { status: 401 });
	}

	const ok = await consumeRecoveryCode(user.id, code);
	if (!ok) {
		return json({ error: 'Invalid username or recovery code' }, { status: 401 });
	}

	const passwordHash = await hashPassword(newPassword);
	db.update(users).set({ passwordHash }).where(eq(users.id, user.id)).run();
	db.delete(sessions).where(eq(sessions.userId, user.id)).run();
	await createSession(user.id, cookies, request.headers.get('user-agent'));

	return json({ ok: true });
};

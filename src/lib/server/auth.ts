import { createHash, randomBytes } from 'node:crypto';
import { eq, and, gt, ne, isNull } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import { hash, compare } from 'bcryptjs';
import { db } from './db';
import { recoveryCodes, sessions, users, type User } from './schema';
import { createId } from './id';

export const SESSION_COOKIE = 'qix_session';
const SESSION_DAYS = 30;
const USERNAME_RE = /^[a-zA-Z0-9]{3,9}$/;
const SESSION_TOUCH_MS = 5 * 60 * 1000;

export function normalizeUsername(raw: string): string {
	return raw.trim().toLowerCase();
}

export function validateUsername(raw: string): string | null {
	const username = normalizeUsername(raw);
	if (!USERNAME_RE.test(username)) {
		return 'Username must be 3–9 characters, English letters and digits only';
	}
	return null;
}

/** New passwords (register / change / recover). */
export function validatePassword(password: string): string | null {
	if (password.length < 8) return 'Password must be at least 8 characters';
	if (password.length > 128) return 'Password is too long';
	return null;
}

export async function hashPassword(password: string): Promise<string> {
	return hash(password, 10);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
	return compare(password, passwordHash);
}

export function labelUserAgent(ua: string | null | undefined): string {
	if (!ua) return 'Unknown device';
	const s = ua.slice(0, 180);
	let browser = 'Browser';
	if (/Edg\//i.test(s)) browser = 'Edge';
	else if (/Chrome\//i.test(s) && !/Chromium/i.test(s)) browser = 'Chrome';
	else if (/Firefox\//i.test(s)) browser = 'Firefox';
	else if (/Safari\//i.test(s) && !/Chrome/i.test(s)) browser = 'Safari';

	let os = 'device';
	if (/Android/i.test(s)) os = 'Android';
	else if (/iPhone|iPad|iPod/i.test(s)) os = 'iOS';
	else if (/Windows/i.test(s)) os = 'Windows';
	else if (/Mac OS X|Macintosh/i.test(s)) os = 'macOS';
	else if (/Linux/i.test(s)) os = 'Linux';

	return `${browser} · ${os}`;
}

export async function createSession(
	userId: string,
	cookies: Cookies,
	userAgent?: string | null,
	opts?: { secure?: boolean }
): Promise<void> {
	const id = createId(24);
	const now = new Date();
	const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
	const ua = userAgent?.slice(0, 512) || null;

	// Re-login / cookie flapping on the same browser used to stack duplicate rows.
	if (ua) {
		db.delete(sessions)
			.where(and(eq(sessions.userId, userId), eq(sessions.userAgent, ua)))
			.run();
	}

	db.insert(sessions)
		.values({
			id,
			userId,
			expiresAt,
			userAgent: ua,
			createdAt: now,
			lastSeenAt: now
		})
		.run();

	const secure = opts?.secure ?? false;

	cookies.set(SESSION_COOKIE, id, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		expires: expiresAt
	});
}

/** Drop older rows that share the same user-agent (keeps current + newest per UA). */
export function pruneDuplicateSessions(userId: string, currentSessionId: string | null): void {
	const rows = db
		.select()
		.from(sessions)
		.where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
		.all();

	const keep = new Set<string>();
	const bestByUa = new Map<string, { id: string; t: number }>();

	for (const r of rows) {
		if (r.id === currentSessionId) {
			keep.add(r.id);
			const key = r.userAgent || `id:${r.id}`;
			bestByUa.set(key, {
				id: r.id,
				t: Number.MAX_SAFE_INTEGER
			});
		}
	}

	const sorted = [...rows].sort((a, b) => {
		const ta = a.lastSeenAt?.getTime() ?? a.createdAt?.getTime() ?? 0;
		const tb = b.lastSeenAt?.getTime() ?? b.createdAt?.getTime() ?? 0;
		return tb - ta;
	});

	for (const r of sorted) {
		if (keep.has(r.id)) continue;
		const key = r.userAgent || `id:${r.id}`;
		const t = r.lastSeenAt?.getTime() ?? r.createdAt?.getTime() ?? 0;
		const best = bestByUa.get(key);
		if (!best) {
			bestByUa.set(key, { id: r.id, t });
			keep.add(r.id);
			continue;
		}
		if (t > best.t) {
			keep.delete(best.id);
			bestByUa.set(key, { id: r.id, t });
			keep.add(r.id);
		}
	}

	for (const r of rows) {
		if (!keep.has(r.id)) {
			db.delete(sessions).where(eq(sessions.id, r.id)).run();
		}
	}
}

/** Prefer proxy proto so Secure cookies are not set on plain HTTP behind nginx. */
export function cookieSecureFromRequest(request: Request): boolean {
	const xf = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
	if (xf === 'https') return true;
	if (xf === 'http') return false;
	try {
		return new URL(request.url).protocol === 'https:';
	} catch {
		return false;
	}
}

export function deleteSession(sessionId: string, cookies: Cookies): void {
	db.delete(sessions).where(eq(sessions.id, sessionId)).run();
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

export function revokeOtherSessions(userId: string, keepSessionId: string): number {
	return db
		.delete(sessions)
		.where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)))
		.run().changes;
}

export function touchSession(sessionId: string): void {
	const row = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
	if (!row) return;
	const last = row.lastSeenAt?.getTime() ?? 0;
	if (Date.now() - last < SESSION_TOUCH_MS) return;
	db.update(sessions)
		.set({ lastSeenAt: new Date() })
		.where(eq(sessions.id, sessionId))
		.run();
}

export function getUserFromSession(sessionId: string | undefined): User | null {
	if (!sessionId) return null;

	const row = db
		.select({ user: users })
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
		.get();

	return row?.user ?? null;
}

export type SessionDTO = {
	id: string;
	label: string;
	createdAt: string | null;
	lastSeenAt: string | null;
	current: boolean;
};

export function listSessions(userId: string, currentSessionId: string | null): SessionDTO[] {
	pruneDuplicateSessions(userId, currentSessionId);

	const rows = db
		.select()
		.from(sessions)
		.where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
		.all();

	return rows
		.map((r) => ({
			id: r.id,
			label: labelUserAgent(r.userAgent),
			createdAt: r.createdAt ? r.createdAt.toISOString() : null,
			lastSeenAt: r.lastSeenAt ? r.lastSeenAt.toISOString() : null,
			current: r.id === currentSessionId
		}))
		.sort((a, b) => {
			if (a.current !== b.current) return a.current ? -1 : 1;
			const ta = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
			const tb = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
			return tb - ta;
		});
}

function hashRecoveryCode(code: string): string {
	const normalized = code.replace(/[\s-]/g, '').toUpperCase();
	return createHash('sha256').update(normalized).digest('hex');
}

function formatRecoveryCode(raw: string): string {
	const hex = raw.toUpperCase();
	return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

/** Replace all recovery codes for user; returns plaintext codes once. */
export function regenerateRecoveryCodes(userId: string): string[] {
	db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId)).run();
	const plain: string[] = [];
	for (let i = 0; i < 8; i++) {
		const raw = randomBytes(6).toString('hex').slice(0, 12);
		const code = formatRecoveryCode(raw);
		plain.push(code);
		db.insert(recoveryCodes)
			.values({
				id: createId(),
				userId,
				codeHash: hashRecoveryCode(code),
				usedAt: null
			})
			.run();
	}
	return plain;
}

export function countUnusedRecoveryCodes(userId: string): number {
	return (
		db
			.select()
			.from(recoveryCodes)
			.where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)))
			.all().length
	);
}

export async function consumeRecoveryCode(
	userId: string,
	code: string
): Promise<boolean> {
	const hash = hashRecoveryCode(code);
	const row = db
		.select()
		.from(recoveryCodes)
		.where(
			and(
				eq(recoveryCodes.userId, userId),
				eq(recoveryCodes.codeHash, hash),
				isNull(recoveryCodes.usedAt)
			)
		)
		.get();
	if (!row) return false;
	db.update(recoveryCodes)
		.set({ usedAt: new Date() })
		.where(eq(recoveryCodes.id, row.id))
		.run();
	return true;
}

export type PublicUser = {
	id: string;
	username: string;
	displayName: string | null;
	avatarPath: string | null;
};

export function toPublicUser(user: User): PublicUser {
	return {
		id: user.id,
		username: user.username,
		displayName: user.displayName,
		avatarPath: user.avatarPath
	};
}

import { eq, and, gt } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import { hash, compare } from 'bcryptjs';
import { db } from './db';
import { sessions, users, type User } from './schema';
import { createId } from './id';

export const SESSION_COOKIE = 'qix_session';
const SESSION_DAYS = 30;
const USERNAME_RE = /^[a-zA-Z0-9]{3,9}$/;

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

export function validatePassword(password: string): string | null {
	if (password.length < 4) return 'Password must be at least 4 characters';
	if (password.length > 128) return 'Password is too long';
	return null;
}

export async function hashPassword(password: string): Promise<string> {
	return hash(password, 10);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
	return compare(password, passwordHash);
}

export async function createSession(userId: string, cookies: Cookies): Promise<void> {
	const id = createId(24);
	const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

	db.insert(sessions).values({ id, userId, expiresAt }).run();

	cookies.set(SESSION_COOKIE, id, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: process.env.NODE_ENV === 'production',
		expires: expiresAt
	});
}

export function deleteSession(sessionId: string, cookies: Cookies): void {
	db.delete(sessions).where(eq(sessions.id, sessionId)).run();
	cookies.delete(SESSION_COOKIE, { path: '/' });
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

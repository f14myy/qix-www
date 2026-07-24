import { error } from '@sveltejs/kit';
import { and, count, desc, eq, gte, isNotNull, like, or, sql } from 'drizzle-orm';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ADMIN_USERNAME, isAdmin, type AdminUserFilter, type AdminUserSort } from '$lib/admin';
import { db, uploadsDir } from './db';
import {
	attachments,
	blocks,
	chatMembers,
	chats,
	messageReactions,
	messages,
	sessions,
	users,
	type User
} from './schema';
import { isOnline } from './chats';
import { getUserBadges } from './badges';
import { normalizeBannerKey, type BadgeDTO, type BannerKey } from '$lib/badges';
import { unblockUser } from './settings';

export { ADMIN_USERNAME, isAdmin };
export type { AdminUserFilter, AdminUserSort };

export const ADMIN_PAGE_SIZE = 30;

export function requireAdmin(user: App.Locals['user']): asserts user is NonNullable<App.Locals['user']> {
	if (!user || !isAdmin(user)) error(403, 'Forbidden');
}

export function isUserBanned(user: Pick<User, 'bannedAt'> | null | undefined): boolean {
	return !!user?.bannedAt;
}

export function revokeAllSessions(userId: string): number {
	const res = db.delete(sessions).where(eq(sessions.userId, userId)).run();
	return res.changes;
}

export type AdminStats = {
	usersTotal: number;
	usersOnline: number;
	usersBanned: number;
	usersNew24h: number;
	usersNew7d: number;
	chats: number;
	messagesTotal: number;
	messages24h: number;
	attachments: number;
	reactions: number;
	sessions: number;
	blocks: number;
	messagesByDay: Array<{ day: string; count: number }>;
};

export function getAdminStats(): AdminStats {
	const now = Date.now();
	const day = 86_400_000;
	const since24h = new Date(now - day);
	const since7d = new Date(now - 7 * day);
	const onlineCutoff = new Date(now - 60_000);

	const usersTotal = db.select({ n: count() }).from(users).get()?.n ?? 0;
	const usersBanned =
		db.select({ n: count() }).from(users).where(isNotNull(users.bannedAt)).get()?.n ?? 0;
	const usersOnline =
		db
			.select({ n: count() })
			.from(users)
			.where(and(isNotNull(users.lastSeenAt), gte(users.lastSeenAt, onlineCutoff)))
			.get()?.n ?? 0;
	const usersNew24h =
		db.select({ n: count() }).from(users).where(gte(users.createdAt, since24h)).get()?.n ?? 0;
	const usersNew7d =
		db.select({ n: count() }).from(users).where(gte(users.createdAt, since7d)).get()?.n ?? 0;
	const chatsN = db.select({ n: count() }).from(chats).get()?.n ?? 0;
	const messagesTotal = db.select({ n: count() }).from(messages).get()?.n ?? 0;
	const messages24h =
		db.select({ n: count() }).from(messages).where(gte(messages.createdAt, since24h)).get()?.n ?? 0;
	const attachmentsN = db.select({ n: count() }).from(attachments).get()?.n ?? 0;
	const reactionsN = db.select({ n: count() }).from(messageReactions).get()?.n ?? 0;
	const sessionsN =
		db
			.select({ n: count() })
			.from(sessions)
			.where(gte(sessions.expiresAt, new Date()))
			.get()?.n ?? 0;
	const blocksN = db.select({ n: count() }).from(blocks).get()?.n ?? 0;

	const dayRows = db
		.select({
			day: sql<string>`date(${messages.createdAt} / 1000, 'unixepoch')`,
			count: sql<number>`count(*)`
		})
		.from(messages)
		.where(gte(messages.createdAt, since7d))
		.groupBy(sql`date(${messages.createdAt} / 1000, 'unixepoch')`)
		.all();

	const byDay = new Map(dayRows.map((r) => [r.day, Number(r.count)]));
	const messagesByDay: Array<{ day: string; count: number }> = [];
	for (let i = 6; i >= 0; i--) {
		const d = new Date(now - i * day);
		const key = d.toISOString().slice(0, 10);
		messagesByDay.push({ day: key, count: byDay.get(key) ?? 0 });
	}

	return {
		usersTotal,
		usersOnline,
		usersBanned,
		usersNew24h,
		usersNew7d,
		chats: chatsN,
		messagesTotal,
		messages24h,
		attachments: attachmentsN,
		reactions: reactionsN,
		sessions: sessionsN,
		blocks: blocksN,
		messagesByDay
	};
}

export type AdminUserListItem = {
	id: string;
	username: string;
	displayName: string | null;
	avatarPath: string | null;
	createdAt: string;
	lastSeenAt: string | null;
	bannedAt: string | null;
	bannedReason: string | null;
	online: boolean;
	messageCount: number;
};

export function listAdminUsers(opts: {
	q?: string;
	page?: number;
	filter?: AdminUserFilter;
	sort?: AdminUserSort;
}): {
	users: AdminUserListItem[];
	total: number;
	page: number;
	pages: number;
	filter: AdminUserFilter;
	sort: AdminUserSort;
} {
	const page = Math.max(1, opts.page ?? 1);
	const q = (opts.q ?? '').trim().toLowerCase();
	const filter = (['all', 'online', 'banned', 'badge', 'new'] as const).includes(
		opts.filter as AdminUserFilter
	)
		? (opts.filter as AdminUserFilter)
		: 'all';
	const sort = (['created', 'messages', 'seen'] as const).includes(opts.sort as AdminUserSort)
		? (opts.sort as AdminUserSort)
		: 'created';

	const now = Date.now();
	const onlineCutoff = new Date(now - 60_000);
	const newCutoff = new Date(now - 7 * 86_400_000);

	const conditions = [];
	if (q) {
		conditions.push(
			or(like(users.username, `%${q}%`), like(sql`lower(coalesce(${users.displayName}, ''))`, `%${q}%`))
		);
	}
	if (filter === 'banned') conditions.push(isNotNull(users.bannedAt));
	if (filter === 'online') {
		conditions.push(and(isNotNull(users.lastSeenAt), gte(users.lastSeenAt, onlineCutoff), sql`${users.bannedAt} IS NULL`));
	}
	if (filter === 'new') conditions.push(gte(users.createdAt, newCutoff));
	if (filter === 'badge') {
		conditions.push(
			sql`exists (select 1 from user_badges ub where ub.user_id = ${users.id})`
		);
	}

	const where = conditions.length ? and(...conditions) : undefined;

	const total = db.select({ n: count() }).from(users).where(where).get()?.n ?? 0;
	const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
	const offset = (page - 1) * ADMIN_PAGE_SIZE;

	const msgCountSql = sql<number>`(select count(*) from messages m where m.sender_id = ${users.id})`;

	const order =
		sort === 'messages'
			? desc(msgCountSql)
			: sort === 'seen'
				? sql`${users.lastSeenAt} IS NULL ASC, ${users.lastSeenAt} DESC`
				: desc(users.createdAt);

	const rows = db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			avatarPath: users.avatarPath,
			createdAt: users.createdAt,
			lastSeenAt: users.lastSeenAt,
			bannedAt: users.bannedAt,
			bannedReason: users.bannedReason,
			messageCount: msgCountSql
		})
		.from(users)
		.where(where)
		.orderBy(order)
		.limit(ADMIN_PAGE_SIZE)
		.offset(offset)
		.all();

	return {
		page,
		pages,
		total,
		filter,
		sort,
		users: rows.map((r) => ({
			id: r.id,
			username: r.username,
			displayName: r.displayName,
			avatarPath: r.avatarPath,
			createdAt: r.createdAt.toISOString(),
			lastSeenAt: r.lastSeenAt ? r.lastSeenAt.toISOString() : null,
			bannedAt: r.bannedAt ? r.bannedAt.toISOString() : null,
			bannedReason: r.bannedReason,
			online: isOnline(r.lastSeenAt),
			messageCount: Number(r.messageCount)
		}))
	};
}

export type AdminUserDetail = AdminUserListItem & {
	bio: string | null;
	sessionCount: number;
	chatCount: number;
	blockedByCount: number;
	blockingCount: number;
	bannerKey: BannerKey;
	bannerPath: string | null;
	badges: BadgeDTO[];
};

export function getAdminUser(userId: string): AdminUserDetail | null {
	const u = db.select().from(users).where(eq(users.id, userId)).get();
	if (!u) return null;

	const messageCount =
		db.select({ n: count() }).from(messages).where(eq(messages.senderId, userId)).get()?.n ?? 0;
	const sessionCount =
		db
			.select({ n: count() })
			.from(sessions)
			.where(and(eq(sessions.userId, userId), gte(sessions.expiresAt, new Date())))
			.get()?.n ?? 0;
	const chatCount =
		db.select({ n: count() }).from(chatMembers).where(eq(chatMembers.userId, userId)).get()?.n ?? 0;
	const blockingCount =
		db.select({ n: count() }).from(blocks).where(eq(blocks.blockerId, userId)).get()?.n ?? 0;
	const blockedByCount =
		db.select({ n: count() }).from(blocks).where(eq(blocks.blockedId, userId)).get()?.n ?? 0;

	return {
		id: u.id,
		username: u.username,
		displayName: u.displayName,
		avatarPath: u.avatarPath,
		bio: u.bio,
		createdAt: u.createdAt.toISOString(),
		lastSeenAt: u.lastSeenAt ? u.lastSeenAt.toISOString() : null,
		bannedAt: u.bannedAt ? u.bannedAt.toISOString() : null,
		bannedReason: u.bannedReason,
		online: isOnline(u.lastSeenAt),
		messageCount,
		sessionCount,
		chatCount,
		blockingCount,
		blockedByCount,
		bannerKey: normalizeBannerKey(u.bannerKey),
		bannerPath: u.bannerPath,
		badges: getUserBadges(userId)
	};
}

export function banUser(
	userId: string,
	reason: string | null,
	actorUsername: string
): { ok: true } | { ok: false; error: string } {
	const u = db.select().from(users).where(eq(users.id, userId)).get();
	if (!u) return { ok: false, error: 'User not found' };
	if (u.username === ADMIN_USERNAME || u.username === actorUsername) {
		return { ok: false, error: 'Cannot ban admin' };
	}
	db.update(users)
		.set({
			bannedAt: new Date(),
			bannedReason: (reason ?? '').trim().slice(0, 200) || null
		})
		.where(eq(users.id, userId))
		.run();
	revokeAllSessions(userId);
	return { ok: true };
}

export function unbanUser(userId: string): { ok: true } | { ok: false; error: string } {
	const u = db.select().from(users).where(eq(users.id, userId)).get();
	if (!u) return { ok: false, error: 'User not found' };
	db.update(users)
		.set({ bannedAt: null, bannedReason: null })
		.where(eq(users.id, userId))
		.run();
	return { ok: true };
}

export function listAdminBans(): AdminUserListItem[] {
	const rows = db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			avatarPath: users.avatarPath,
			createdAt: users.createdAt,
			lastSeenAt: users.lastSeenAt,
			bannedAt: users.bannedAt,
			bannedReason: users.bannedReason,
			messageCount: sql<number>`(select count(*) from messages m where m.sender_id = ${users.id})`
		})
		.from(users)
		.where(isNotNull(users.bannedAt))
		.orderBy(desc(users.bannedAt))
		.all();

	return rows.map((r) => ({
		id: r.id,
		username: r.username,
		displayName: r.displayName,
		avatarPath: r.avatarPath,
		createdAt: r.createdAt.toISOString(),
		lastSeenAt: r.lastSeenAt ? r.lastSeenAt.toISOString() : null,
		bannedAt: r.bannedAt ? r.bannedAt.toISOString() : null,
		bannedReason: r.bannedReason,
		online: false,
		messageCount: Number(r.messageCount)
	}));
}

async function removeFile(path: string | null | undefined) {
	if (!path) return;
	try {
		await unlink(join(uploadsDir, path));
	} catch {
		/* ignore */
	}
}

export async function deleteUserAccount(
	userId: string,
	actorUsername: string
): Promise<{ ok: true } | { ok: false; error: string }> {
	const u = db.select().from(users).where(eq(users.id, userId)).get();
	if (!u) return { ok: false, error: 'User not found' };
	if (u.username === ADMIN_USERNAME || u.username === actorUsername) {
		return { ok: false, error: 'Cannot delete admin' };
	}

	const files = db
		.select({ path: attachments.path })
		.from(attachments)
		.innerJoin(messages, eq(attachments.messageId, messages.id))
		.where(eq(messages.senderId, userId))
		.all();

	await removeFile(u.avatarPath);
	for (const f of files) await removeFile(f.path);

	db.delete(users).where(eq(users.id, userId)).run();
	return { ok: true };
}

export type AdminMessageItem = {
	id: string;
	chatId: string;
	body: string;
	kind: string;
	createdAt: string;
	deletedAt: string | null;
	sender: {
		id: string;
		username: string;
		displayName: string | null;
		avatarPath: string | null;
	};
};

export function listAdminMessages(opts: {
	q?: string;
	username?: string;
	page?: number;
}): { messages: AdminMessageItem[]; total: number; page: number; pages: number } {
	const page = Math.max(1, opts.page ?? 1);
	const q = (opts.q ?? '').trim();
	const username = (opts.username ?? '').trim().toLowerCase();
	const offset = (page - 1) * ADMIN_PAGE_SIZE;

	const conditions = [];
	if (q) conditions.push(like(messages.body, `%${q}%`));
	if (username) conditions.push(eq(users.username, username));
	const where = conditions.length ? and(...conditions) : undefined;

	const total =
		db
			.select({ n: count() })
			.from(messages)
			.innerJoin(users, eq(messages.senderId, users.id))
			.where(where)
			.get()?.n ?? 0;
	const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));

	const rows = db
		.select({
			id: messages.id,
			chatId: messages.chatId,
			body: messages.body,
			kind: messages.kind,
			createdAt: messages.createdAt,
			deletedAt: messages.deletedAt,
			senderId: users.id,
			username: users.username,
			displayName: users.displayName,
			avatarPath: users.avatarPath
		})
		.from(messages)
		.innerJoin(users, eq(messages.senderId, users.id))
		.where(where)
		.orderBy(desc(messages.createdAt))
		.limit(ADMIN_PAGE_SIZE)
		.offset(offset)
		.all();

	return {
		page,
		pages,
		total,
		messages: rows.map((r) => ({
			id: r.id,
			chatId: r.chatId,
			body: r.body,
			kind: r.kind,
			createdAt: r.createdAt.toISOString(),
			deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
			sender: {
				id: r.senderId,
				username: r.username,
				displayName: r.displayName,
				avatarPath: r.avatarPath
			}
		}))
	};
}

export function softDeleteMessage(messageId: string): { ok: true } | { ok: false; error: string } {
	const msg = db.select().from(messages).where(eq(messages.id, messageId)).get();
	if (!msg) return { ok: false, error: 'Not found' };
	if (msg.deletedAt) return { ok: true };
	db.update(messages)
		.set({ deletedAt: new Date(), body: '' })
		.where(eq(messages.id, messageId))
		.run();
	return { ok: true };
}

export type AdminBlockItem = {
	blockerId: string;
	blockerUsername: string;
	blockerDisplayName: string | null;
	blockedId: string;
	blockedUsername: string;
	blockedDisplayName: string | null;
	createdAt: string;
};

export function listAdminBlocks(opts?: { page?: number }): {
	blocks: AdminBlockItem[];
	total: number;
	page: number;
	pages: number;
} {
	const page = Math.max(1, opts?.page ?? 1);
	const offset = (page - 1) * ADMIN_PAGE_SIZE;
	const total = db.select({ n: count() }).from(blocks).get()?.n ?? 0;
	const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));

	const blocker = db
		.select({
			blockerId: blocks.blockerId,
			blockedId: blocks.blockedId,
			createdAt: blocks.createdAt,
			blockerUsername: users.username,
			blockerDisplayName: users.displayName
		})
		.from(blocks)
		.innerJoin(users, eq(blocks.blockerId, users.id))
		.orderBy(desc(blocks.createdAt))
		.limit(ADMIN_PAGE_SIZE)
		.offset(offset)
		.all();

	const items: AdminBlockItem[] = blocker.map((r) => {
		const blocked = db
			.select({ username: users.username, displayName: users.displayName })
			.from(users)
			.where(eq(users.id, r.blockedId))
			.get();
		return {
			blockerId: r.blockerId,
			blockerUsername: r.blockerUsername,
			blockerDisplayName: r.blockerDisplayName,
			blockedId: r.blockedId,
			blockedUsername: blocked?.username ?? '?',
			blockedDisplayName: blocked?.displayName ?? null,
			createdAt: r.createdAt.toISOString()
		};
	});

	return { page, pages, total, blocks: items };
}

export function adminRemoveBlock(blockerId: string, blockedId: string): void {
	unblockUser(blockerId, blockedId);
}

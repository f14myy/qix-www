import { and, desc, eq, gt, ne, sql } from 'drizzle-orm';
import { normalizeBannerKey, type BadgeDTO } from '$lib/badges';
import { db } from './db';
import {
	attachments,
	chatMembers,
	chats,
	linkPreviews,
	messageReactions,
	messages,
	users
} from './schema';
import { createId } from './id';
import { getUserBadges } from './badges';
import {
	canSeeLastSeen,
	getBlockedIdsForUser,
	getUserSettings
} from './settings';

export type AttachmentDTO = {
	id: string;
	filename: string;
	mime: string;
	size: number;
};

export type LinkPreviewDTO = {
	url: string;
	title: string | null;
	description: string | null;
	imageUrl: string | null;
};

export type ReactionDTO = {
	emoji: string;
	count: number;
	me: boolean;
};

export type ReplyPreviewDTO = {
	id: string;
	senderId: string;
	body: string;
	deleted: boolean;
};

export type MessageDTO = {
	id: string;
	chatId: string;
	senderId: string;
	body: string;
	kind: string;
	createdAt: string;
	editedAt: string | null;
	deletedAt: string | null;
	replyTo: ReplyPreviewDTO | null;
	attachments: AttachmentDTO[];
	linkPreview: LinkPreviewDTO | null;
	reactions: ReactionDTO[];
};

export type ChatListItem = {
	id: string;
	peer: {
		id: string;
		username: string;
		displayName: string | null;
		avatarPath: string | null;
		lastSeenAt: string | null;
		badges: BadgeDTO[];
	};
	unreadCount: number;
	pinned: boolean;
	muted: boolean;
	lastMessage: {
		id: string;
		body: string;
		createdAt: string;
		senderId: string;
		hasAttachment: boolean;
		kind: string;
		deleted: boolean;
	} | null;
};

export type PublicProfile = {
	id: string;
	username: string;
	displayName: string | null;
	bio: string | null;
	avatarPath: string | null;
	bannerPath: string | null;
	lastSeenAt: string | null;
	createdAt: string;
	bannerKey: string;
	badges: BadgeDTO[];
};

export function isOnline(lastSeenAt: Date | null | undefined, now = Date.now()): boolean {
	if (!lastSeenAt) return false;
	return now - lastSeenAt.getTime() < 60_000;
}

export function isChatMember(chatId: string, userId: string): boolean {
	const row = db
		.select({ chatId: chatMembers.chatId })
		.from(chatMembers)
		.where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)))
		.get();
	return !!row;
}

export function getChatMemberIds(chatId: string): string[] {
	return db
		.select({ userId: chatMembers.userId })
		.from(chatMembers)
		.where(eq(chatMembers.chatId, chatId))
		.all()
		.map((r) => r.userId);
}

export function findDmChatId(userA: string, userB: string): string | null {
	const row = db
		.select({ chatId: chatMembers.chatId })
		.from(chatMembers)
		.where(eq(chatMembers.userId, userA))
		.all()
		.find((mine) => {
			const other = db
				.select({ userId: chatMembers.userId })
				.from(chatMembers)
				.where(and(eq(chatMembers.chatId, mine.chatId), eq(chatMembers.userId, userB)))
				.get();
			return !!other;
		});

	return row?.chatId ?? null;
}

export function createDm(userA: string, userB: string): string {
	const existing = findDmChatId(userA, userB);
	if (existing) return existing;

	const chatId = createId();
	const now = new Date();

	db.transaction((tx) => {
		tx.insert(chats).values({ id: chatId, createdAt: now }).run();
		tx.insert(chatMembers)
			.values([
				{ chatId, userId: userA, lastReadAt: now, muted: false },
				{ chatId, userId: userB, lastReadAt: now, muted: false }
			])
			.run();
	});

	return chatId;
}

export function getPeer(chatId: string, userId: string): PublicProfile | null {
	const row = db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			bio: users.bio,
			avatarPath: users.avatarPath,
			bannerPath: users.bannerPath,
			lastSeenAt: users.lastSeenAt,
			createdAt: users.createdAt,
			bannerKey: users.bannerKey
		})
		.from(chatMembers)
		.innerJoin(users, eq(chatMembers.userId, users.id))
		.where(and(eq(chatMembers.chatId, chatId), ne(chatMembers.userId, userId)))
		.get();

	if (!row) return null;
	const showSeen = canSeeLastSeen(row.id, userId);
	return {
		id: row.id,
		username: row.username,
		displayName: row.displayName,
		bio: row.bio,
		avatarPath: row.avatarPath,
		bannerPath: row.bannerPath,
		lastSeenAt: showSeen && row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
		createdAt: row.createdAt.toISOString(),
		bannerKey: normalizeBannerKey(row.bannerKey),
		badges: getUserBadges(row.id)
	};
}

export function getPeerLastReadAt(chatId: string, userId: string): Date | null {
	const peer = getPeer(chatId, userId);
	if (!peer) return null;

	const peerSettings = getUserSettings(peer.id);
	const mySettings = getUserSettings(userId);
	if (!peerSettings.readReceipts || !mySettings.readReceipts) return null;

	const row = db
		.select({ lastReadAt: chatMembers.lastReadAt })
		.from(chatMembers)
		.where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, peer.id)))
		.get();
	return row?.lastReadAt ?? null;
}

export function getMyLastReadAt(chatId: string, userId: string): Date | null {
	const row = db
		.select({ lastReadAt: chatMembers.lastReadAt })
		.from(chatMembers)
		.where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)))
		.get();
	return row?.lastReadAt ?? null;
}

export function markChatRead(chatId: string, userId: string): void {
	db.update(chatMembers)
		.set({ lastReadAt: new Date() })
		.where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)))
		.run();
}

export function setChatPrefs(
	chatId: string,
	userId: string,
	prefs: { pinned?: boolean; muted?: boolean }
): void {
	const patch: { pinnedAt?: Date | null; muted?: boolean } = {};
	if (prefs.pinned !== undefined) patch.pinnedAt = prefs.pinned ? new Date() : null;
	if (prefs.muted !== undefined) patch.muted = prefs.muted;
	db.update(chatMembers)
		.set(patch)
		.where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)))
		.run();
}

function countUnread(chatId: string, userId: string): number {
	const membership = db
		.select({ lastReadAt: chatMembers.lastReadAt })
		.from(chatMembers)
		.where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)))
		.get();

	const lastReadAt = membership?.lastReadAt ?? new Date(0);

	const row = db
		.select({ count: sql<number>`count(*)` })
		.from(messages)
		.where(
			and(
				eq(messages.chatId, chatId),
				ne(messages.senderId, userId),
				gt(messages.createdAt, lastReadAt)
			)
		)
		.get();

	return Number(row?.count ?? 0);
}

export function listChatsForUser(userId: string): ChatListItem[] {
	const memberships = db
		.select({
			chatId: chatMembers.chatId,
			pinnedAt: chatMembers.pinnedAt,
			muted: chatMembers.muted
		})
		.from(chatMembers)
		.where(eq(chatMembers.userId, userId))
		.all();

	const items: ChatListItem[] = [];

	for (const m of memberships) {
		const peer = getPeer(m.chatId, userId);
		if (!peer) continue;

		const last = db
			.select()
			.from(messages)
			.where(eq(messages.chatId, m.chatId))
			.orderBy(desc(messages.createdAt))
			.limit(1)
			.get();

		let hasAttachment = false;
		if (last) {
			const att = db
				.select({ id: attachments.id })
				.from(attachments)
				.where(eq(attachments.messageId, last.id))
				.limit(1)
				.get();
			hasAttachment = !!att;
		}

		items.push({
			id: m.chatId,
			peer: {
				id: peer.id,
				username: peer.username,
				displayName: peer.displayName,
				avatarPath: peer.avatarPath,
				lastSeenAt: peer.lastSeenAt,
				badges: peer.badges
			},
			unreadCount: countUnread(m.chatId, userId),
			pinned: !!m.pinnedAt,
			muted: !!m.muted,
			lastMessage: last
				? {
						id: last.id,
						body: last.deletedAt ? '' : last.body,
						createdAt: last.createdAt.toISOString(),
						senderId: last.senderId,
						hasAttachment: last.deletedAt ? false : hasAttachment,
						kind: last.kind,
						deleted: !!last.deletedAt
					}
				: null
		});
	}

	items.sort((a, b) => {
		if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
		const aTime = a.lastMessage?.createdAt ?? '';
		const bTime = b.lastMessage?.createdAt ?? '';
		return bTime.localeCompare(aTime);
	});

	return items;
}

function getReactions(messageId: string, viewerId?: string): ReactionDTO[] {
	const rows = db
		.select()
		.from(messageReactions)
		.where(eq(messageReactions.messageId, messageId))
		.all();

	const map = new Map<string, ReactionDTO>();
	for (const r of rows) {
		const cur = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, me: false };
		cur.count += 1;
		if (viewerId && r.userId === viewerId) cur.me = true;
		map.set(r.emoji, cur);
	}
	return [...map.values()];
}

function getLinkPreview(messageId: string): LinkPreviewDTO | null {
	const row = db.select().from(linkPreviews).where(eq(linkPreviews.messageId, messageId)).get();
	if (!row) return null;
	return {
		url: row.url,
		title: row.title,
		description: row.description,
		imageUrl: row.imageUrl
	};
}

function getReply(replyToId: string | null): ReplyPreviewDTO | null {
	if (!replyToId) return null;
	const row = db.select().from(messages).where(eq(messages.id, replyToId)).get();
	if (!row) return null;
	return {
		id: row.id,
		senderId: row.senderId,
		body: row.deletedAt ? '' : row.body.slice(0, 120),
		deleted: !!row.deletedAt
	};
}

export function getMessageAttachments(messageId: string): AttachmentDTO[] {
	return db
		.select({
			id: attachments.id,
			filename: attachments.filename,
			mime: attachments.mime,
			size: attachments.size
		})
		.from(attachments)
		.where(eq(attachments.messageId, messageId))
		.all();
}

export function toMessageDTO(
	row: typeof messages.$inferSelect,
	viewerId?: string
): MessageDTO {
	const deleted = !!row.deletedAt;
	return {
		id: row.id,
		chatId: row.chatId,
		senderId: row.senderId,
		body: deleted ? '' : row.body,
		kind: row.kind,
		createdAt: row.createdAt.toISOString(),
		editedAt: row.editedAt ? row.editedAt.toISOString() : null,
		deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
		replyTo: deleted ? null : getReply(row.replyToId),
		attachments: deleted ? [] : getMessageAttachments(row.id),
		linkPreview: deleted ? null : getLinkPreview(row.id),
		reactions: getReactions(row.id, viewerId)
	};
}

export function getMessageById(id: string) {
	return db.select().from(messages).where(eq(messages.id, id)).get() ?? null;
}

export function listMessages(
	chatId: string,
	viewerId?: string,
	limit = 100,
	before?: string
): MessageDTO[] {
	const query = db
		.select()
		.from(messages)
		.where(
			before
				? and(
						eq(messages.chatId, chatId),
						sql`${messages.createdAt} < (SELECT created_at FROM messages WHERE id = ${before})`
					)
				: eq(messages.chatId, chatId)
		)
		.orderBy(desc(messages.createdAt))
		.limit(limit);

	return query.all().reverse().map((row) => toMessageDTO(row, viewerId));
}

export function searchUsers(query: string, excludeUserId: string, limit = 20) {
	const q = query.trim().toLowerCase();
	if (!q) return [];

	const blocked = getBlockedIdsForUser(excludeUserId);
	const like = `%${q}%`;

	return db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			avatarPath: users.avatarPath
		})
		.from(users)
		.where(
			and(
				ne(users.id, excludeUserId),
				sql`(${users.username} LIKE ${like} OR lower(coalesce(${users.displayName}, '')) LIKE ${like})`
			)
		)
		.limit(limit * 2)
		.all()
		.filter((u) => !blocked.has(u.id))
		.slice(0, limit);
}

export type MessageSearchHit = {
	messageId: string;
	chatId: string;
	body: string;
	createdAt: string;
	peer: {
		id: string;
		username: string;
		displayName: string | null;
		avatarPath: string | null;
	};
};

export function searchMessages(userId: string, query: string, limit = 40): MessageSearchHit[] {
	const q = query.trim().toLowerCase();
	if (q.length < 2) return [];

	const like = `%${q}%`;
	const blocked = getBlockedIdsForUser(userId);

	const rows = db
		.select({
			messageId: messages.id,
			chatId: messages.chatId,
			body: messages.body,
			createdAt: messages.createdAt
		})
		.from(messages)
		.innerJoin(chatMembers, eq(chatMembers.chatId, messages.chatId))
		.where(
			and(
				eq(chatMembers.userId, userId),
				sql`${messages.deletedAt} IS NULL`,
				sql`${messages.kind} = 'text'`,
				sql`lower(${messages.body}) LIKE ${like}`
			)
		)
		.orderBy(desc(messages.createdAt))
		.limit(limit * 3)
		.all();

	const hits: MessageSearchHit[] = [];
	for (const row of rows) {
		const peer = getPeer(row.chatId, userId);
		if (!peer || blocked.has(peer.id)) continue;
		hits.push({
			messageId: row.messageId,
			chatId: row.chatId,
			body: row.body,
			createdAt: row.createdAt.toISOString(),
			peer: {
				id: peer.id,
				username: peer.username,
				displayName: peer.displayName,
				avatarPath: peer.avatarPath
			}
		});
		if (hits.length >= limit) break;
	}
	return hits;
}

export type GlobalSearchResult = {
	chats: ChatListItem[];
	people: Array<{
		id: string;
		username: string;
		displayName: string | null;
		avatarPath: string | null;
	}>;
	messages: MessageSearchHit[];
};

export function globalSearch(userId: string, query: string): GlobalSearchResult {
	const q = query.trim().toLowerCase();
	if (!q) return { chats: [], people: [], messages: [] };

	const allChats = listChatsForUser(userId);
	const chats = allChats.filter(
		(c) =>
			c.peer.username.includes(q) ||
			(c.peer.displayName?.toLowerCase().includes(q) ?? false) ||
			(c.lastMessage && !c.lastMessage.deleted && c.lastMessage.body.toLowerCase().includes(q))
	);

	const chatPeerIds = new Set(allChats.map((c) => c.peer.id));
	const people = searchUsers(q, userId, 24).filter((u) => !chatPeerIds.has(u.id));
	const messages = searchMessages(userId, q, 36);

	return { chats, people, messages };
}

export function touchPresence(userId: string): void {
	db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, userId)).run();
}

export function toPublicProfile(
	user: typeof users.$inferSelect,
	viewerId?: string | null
): PublicProfile {
	const showSeen =
		!viewerId || viewerId === user.id || canSeeLastSeen(user.id, viewerId);
	return {
		id: user.id,
		username: user.username,
		displayName: user.displayName,
		bio: user.bio,
		avatarPath: user.avatarPath,
		bannerPath: user.bannerPath,
		lastSeenAt: showSeen && user.lastSeenAt ? user.lastSeenAt.toISOString() : null,
		createdAt: user.createdAt.toISOString(),
		bannerKey: normalizeBannerKey(user.bannerKey),
		badges: getUserBadges(user.id)
	};
}

export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥'] as const;

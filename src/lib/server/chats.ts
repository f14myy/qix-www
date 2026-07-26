import { and, desc, eq, gt, ne, sql } from 'drizzle-orm';
import { normalizeBannerKey, type BadgeDTO } from '$lib/badges';
import type {
	AttachmentDTO,
	ChatListItem,
	LinkPreviewDTO,
	MessageDTO,
	PublicProfile,
	ReactionDTO,
	ReplyPreviewDTO
} from '$lib/types';
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
import { getChannelByChatId, ensureUserInBuiltInChannels } from './channels';
import {
	canSeeLastSeen,
	getBlockedIdsForUser,
	getUserSettings
} from './settings';

export type {
	AttachmentDTO,
	ChatListItem,
	LinkPreviewDTO,
	MessageDTO,
	PublicProfile,
	ReactionDTO,
	ReplyPreviewDTO
};
export { REACTION_EMOJIS } from '$lib/types';

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
	const memberships = db
		.select({ chatId: chatMembers.chatId })
		.from(chatMembers)
		.where(eq(chatMembers.userId, userA))
		.all();

	for (const mine of memberships) {
		// Built-in channels enroll everyone — never treat them as a DM.
		if (getChannelByChatId(mine.chatId)) continue;
		const chat = db.select().from(chats).where(eq(chats.id, mine.chatId)).get();
		if (!chat || chat.kind === 'channel' || chat.channelKey) continue;

		const members = getChatMemberIds(mine.chatId);
		if (members.length === 2 && members.includes(userB)) {
			return mine.chatId;
		}
	}

	return null;
}

export function createDm(userA: string, userB: string): string {
	const existing = findDmChatId(userA, userB);
	if (existing) return existing;

	const chatId = createId();
	const now = new Date();

	db.transaction((tx) => {
		tx.insert(chats)
			.values({ id: chatId, createdAt: now, kind: 'dm', posting: 'members' })
			.run();
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
			bannerKey: users.bannerKey,
			inviteCode: users.inviteCode,
			e2eePublicKey: users.e2eePublicKey
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
		badges: getUserBadges(row.id),
		inviteCode: row.inviteCode ?? null,
		e2eePublicKey: row.e2eePublicKey ?? null
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
	prefs: { pinned?: boolean; muted?: boolean; archived?: boolean }
): void {
	const patch: {
		pinnedAt?: Date | null;
		muted?: boolean;
		archivedAt?: Date | null;
	} = {};
	if (prefs.pinned !== undefined) patch.pinnedAt = prefs.pinned ? new Date() : null;
	if (prefs.muted !== undefined) patch.muted = prefs.muted;
	if (prefs.archived !== undefined) patch.archivedAt = prefs.archived ? new Date() : null;
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

export function listChatsForUser(userId: string, opts?: { archived?: boolean }): ChatListItem[] {
	ensureUserInBuiltInChannels(userId);
	const wantArchived = !!opts?.archived;
	const memberships = db
		.select({
			chatId: chatMembers.chatId,
			pinnedAt: chatMembers.pinnedAt,
			muted: chatMembers.muted,
			archivedAt: chatMembers.archivedAt
		})
		.from(chatMembers)
		.where(eq(chatMembers.userId, userId))
		.all()
		.filter((m) => (wantArchived ? !!m.archivedAt : !m.archivedAt));

	const items: ChatListItem[] = [];

	for (const m of memberships) {
		const channel = getChannelByChatId(m.chatId);
		const peer = channel ? null : getPeer(m.chatId, userId);
		if (!channel && !peer) continue;

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
			kind: channel ? 'channel' : 'dm',
			peer: peer
				? {
						id: peer.id,
						username: peer.username,
						displayName: peer.displayName,
						avatarPath: peer.avatarPath,
						lastSeenAt: peer.lastSeenAt,
						badges: peer.badges,
						e2eePublicKey: peer.e2eePublicKey
					}
				: null,
			channel: channel
				? { key: channel.key, title: channel.title, posting: channel.posting }
				: null,
			unreadCount: countUnread(m.chatId, userId),
			pinned: !!m.pinnedAt,
			muted: !!m.muted,
			archived: !!m.archivedAt,
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
		const aChannel = a.kind === 'channel' ? 1 : 0;
		const bChannel = b.kind === 'channel' ? 1 : 0;
		if (aChannel !== bChannel) return bChannel - aChannel;
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
	let thumbUrl: string | null = null;
	const att = db
		.select()
		.from(attachments)
		.where(eq(attachments.messageId, row.id))
		.limit(1)
		.get();
	if (att && (att.mime.startsWith('image/') || att.mime.startsWith('video/') || row.kind === 'voice')) {
		thumbUrl = `/api/files/${att.id}`;
	}
	return {
		id: row.id,
		senderId: row.senderId,
		body: row.deletedAt ? '' : row.body.slice(0, 120),
		deleted: !!row.deletedAt,
		kind: row.kind,
		thumbUrl: row.deletedAt ? null : thumbUrl
	};
}

export function getMessageAttachments(messageId: string): AttachmentDTO[] {
	return db
		.select({
			id: attachments.id,
			filename: attachments.filename,
			mime: attachments.mime,
			size: attachments.size,
			e2eeMeta: attachments.e2eeMeta
		})
		.from(attachments)
		.where(eq(attachments.messageId, messageId))
		.all()
		.map((a) => ({
			id: a.id,
			filename: a.filename,
			mime: a.mime,
			size: a.size,
			e2eeMeta: a.e2eeMeta ?? null
		}));
}

export function toMessageDTO(
	row: typeof messages.$inferSelect,
	viewerId?: string
): MessageDTO {
	const deleted = !!row.deletedAt;
	const expired = row.expiresAt && row.expiresAt.getTime() < Date.now();
	if (expired && !deleted) {
		db.update(messages)
			.set({ deletedAt: new Date(), body: '' })
			.where(eq(messages.id, row.id))
			.run();
		return toMessageDTO({ ...row, deletedAt: new Date(), body: '' }, viewerId);
	}
	return {
		id: row.id,
		chatId: row.chatId,
		senderId: row.senderId,
		body: deleted ? '' : row.body,
		kind: row.kind,
		createdAt: row.createdAt.toISOString(),
		editedAt: row.editedAt ? row.editedAt.toISOString() : null,
		deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
		expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
		forwardedFromId: row.forwardedFromId ?? null,
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
	} | null;
	channel: { key: string; title: string } | null;
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
		const channel = getChannelByChatId(row.chatId);
		if (channel) {
			hits.push({
				messageId: row.messageId,
				chatId: row.chatId,
				body: row.body,
				createdAt: row.createdAt.toISOString(),
				peer: null,
				channel: { key: channel.key, title: channel.title }
			});
		} else {
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
				},
				channel: null
			});
		}
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
	const chats = allChats.filter((c) => {
		if (c.kind === 'channel' && c.channel) {
			return (
				c.channel.key.includes(q) ||
				c.channel.title.toLowerCase().includes(q) ||
				(c.lastMessage && !c.lastMessage.deleted && c.lastMessage.body.toLowerCase().includes(q))
			);
		}
		if (!c.peer) return false;
		return (
			c.peer.username.includes(q) ||
			(c.peer.displayName?.toLowerCase().includes(q) ?? false) ||
			(c.lastMessage && !c.lastMessage.deleted && c.lastMessage.body.toLowerCase().includes(q))
		);
	});

	const chatPeerIds = new Set(allChats.filter((c) => c.peer).map((c) => c.peer!.id));
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
		badges: getUserBadges(user.id),
		inviteCode: user.inviteCode ?? null,
		e2eePublicKey: user.e2eePublicKey ?? null
	};
}

export function deleteChatForUser(chatId: string, userId: string): void {
	// Set archivedAt and clear user membership for non-channels or set archived
	db.update(chatMembers)
		.set({ archivedAt: new Date() })
		.where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)))
		.run();
}

export function deleteChatForEveryone(chatId: string, userId: string): void {
	if (!isChatMember(chatId, userId)) return;
	const channel = getChannelByChatId(chatId);
	if (channel) {
		// Built-in channel cannot be deleted for everyone, only archived/hidden for user
		deleteChatForUser(chatId, userId);
		return;
	}

	db.transaction((tx) => {
		const msgRows = tx
			.select({ id: messages.id })
			.from(messages)
			.where(eq(messages.chatId, chatId))
			.all();
		const msgIds = msgRows.map((m) => m.id);

		for (const mid of msgIds) {
			tx.delete(attachments).where(eq(attachments.messageId, mid)).run();
			tx.delete(messageReactions).where(eq(messageReactions.messageId, mid)).run();
			tx.delete(linkPreviews).where(eq(linkPreviews.messageId, mid)).run();
		}
		tx.delete(messages).where(eq(messages.chatId, chatId)).run();
		tx.delete(chatMembers).where(eq(chatMembers.chatId, chatId)).run();
		tx.delete(chats).where(eq(chats.id, chatId)).run();
	});
}

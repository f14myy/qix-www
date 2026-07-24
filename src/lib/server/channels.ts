import { and, eq } from 'drizzle-orm';
import { isAdmin } from '$lib/admin';
import { db } from './db';
import { chatMembers, chats, messages, users } from './schema';
import { createId } from './id';

export const CHANNEL_KEYS = {
	notifications: 'notifications',
	qix: 'qix'
} as const;

export type ChannelKey = (typeof CHANNEL_KEYS)[keyof typeof CHANNEL_KEYS];

export type ChannelPosting = 'admin' | 'none' | 'members';

export type ChannelInfo = {
	id: string;
	key: ChannelKey;
	title: string;
	posting: ChannelPosting;
};

const BUILTIN: Array<{
	id: string;
	key: ChannelKey;
	title: string;
	posting: ChannelPosting;
}> = [
	{
		id: 'ch_notifications',
		key: CHANNEL_KEYS.notifications,
		title: 'Notifications',
		posting: 'admin'
	},
	{
		id: 'ch_qix',
		key: CHANNEL_KEYS.qix,
		title: 'Qix',
		posting: 'admin'
	}
];

export function ensureBuiltInChannels(): void {
	const now = new Date();
	for (const ch of BUILTIN) {
		const existing = db.select().from(chats).where(eq(chats.id, ch.id)).get();
		if (!existing) {
			db.insert(chats)
				.values({
					id: ch.id,
					createdAt: now,
					kind: 'channel',
					channelKey: ch.key,
					title: ch.title,
					posting: ch.posting,
					disappearAfterSec: 0
				})
				.run();
		} else {
			db.update(chats)
				.set({
					kind: 'channel',
					channelKey: ch.key,
					title: ch.title,
					posting: ch.posting
				})
				.where(eq(chats.id, ch.id))
				.run();
		}
	}

	const admin = db.select().from(users).where(eq(users.username, 'f14my')).get();
	const qix = getChannelByKey(CHANNEL_KEYS.qix);
	if (admin && qix) {
		const hasWelcome = db
			.select({ id: messages.id })
			.from(messages)
			.where(eq(messages.chatId, qix.id))
			.limit(1)
			.get();
		if (!hasWelcome) {
			db.insert(messages)
				.values({
					id: createId(),
					chatId: qix.id,
					senderId: admin.id,
					body: 'Welcome to *Qix* — the official channel.\n\nPosts here are from the team. Formatting: *bold*, _italic_, `code`, ||spoiler||, [links](https://example.com).',
					kind: 'text',
					createdAt: now
				})
				.run();
		}
	}

	const notif = getChannelByKey(CHANNEL_KEYS.notifications);
	if (admin && notif) {
		const hasWelcome = db
			.select({ id: messages.id })
			.from(messages)
			.where(eq(messages.chatId, notif.id))
			.limit(1)
			.get();
		if (!hasWelcome) {
			db.insert(messages)
				.values({
					id: createId(),
					chatId: notif.id,
					senderId: admin.id,
					body: 'This is your *Notifications* channel.\n\nSystem updates and important alerts will appear here. Only the Qix team can post.',
					kind: 'text',
					createdAt: now
				})
				.run();
		}
	}
}

export function getChannelByKey(key: string): ChannelInfo | null {
	const row = db
		.select()
		.from(chats)
		.where(and(eq(chats.kind, 'channel'), eq(chats.channelKey, key)))
		.get();
	if (!row?.channelKey) return null;
	return {
		id: row.id,
		key: row.channelKey as ChannelKey,
		title: row.title || row.channelKey,
		posting: (row.posting as ChannelPosting) || 'none'
	};
}

export function getChannelByChatId(chatId: string): ChannelInfo | null {
	const row = db.select().from(chats).where(eq(chats.id, chatId)).get();
	if (!row || row.kind !== 'channel' || !row.channelKey) return null;
	return {
		id: row.id,
		key: row.channelKey as ChannelKey,
		title: row.title || row.channelKey,
		posting: (row.posting as ChannelPosting) || 'none'
	};
}

export function isChannelChat(chatId: string): boolean {
	return !!getChannelByChatId(chatId);
}

export function ensureUserInBuiltInChannels(userId: string): void {
	ensureBuiltInChannels();
	const now = new Date();
	for (const ch of BUILTIN) {
		const existing = db
			.select({ chatId: chatMembers.chatId })
			.from(chatMembers)
			.where(and(eq(chatMembers.chatId, ch.id), eq(chatMembers.userId, userId)))
			.get();
		if (!existing) {
			db.insert(chatMembers)
				.values({
					chatId: ch.id,
					userId,
					lastReadAt: now,
					muted: false,
					pinnedAt: now
				})
				.run();
		}
	}
}

export function canPostInChat(
	chatId: string,
	user: { id: string; username: string } | null | undefined
): boolean {
	if (!user) return false;
	const channel = getChannelByChatId(chatId);
	if (!channel) return true;
	if (channel.posting === 'none') return false;
	if (channel.posting === 'admin') return isAdmin(user);
	return true;
}

/** System / admin helper to post into Notifications. */
export function postSystemNotification(body: string, senderId?: string): string | null {
	ensureBuiltInChannels();
	const channel = getChannelByKey(CHANNEL_KEYS.notifications);
	if (!channel) return null;
	const sender =
		senderId ??
		db.select({ id: users.id }).from(users).where(eq(users.username, 'f14my')).get()?.id;
	if (!sender) return null;
	const id = createId();
	db.insert(messages)
		.values({
			id,
			chatId: channel.id,
			senderId: sender,
			body,
			kind: 'text',
			createdAt: new Date()
		})
		.run();
	return id;
}

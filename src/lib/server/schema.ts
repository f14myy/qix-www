import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
	id: text('id').primaryKey(),
	username: text('username').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	displayName: text('display_name'),
	bio: text('bio'),
	avatarPath: text('avatar_path'),
	lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
	locale: text('locale'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export const sessions = sqliteTable('sessions', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull()
});

export const chats = sqliteTable('chats', {
	id: text('id').primaryKey(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export const chatMembers = sqliteTable(
	'chat_members',
	{
		chatId: text('chat_id')
			.notNull()
			.references(() => chats.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		lastReadAt: integer('last_read_at', { mode: 'timestamp_ms' }),
		pinnedAt: integer('pinned_at', { mode: 'timestamp_ms' }),
		muted: integer('muted', { mode: 'boolean' }).notNull().default(false)
	},
	(t) => [primaryKey({ columns: [t.chatId, t.userId] })]
);

export const messages = sqliteTable('messages', {
	id: text('id').primaryKey(),
	chatId: text('chat_id')
		.notNull()
		.references(() => chats.id, { onDelete: 'cascade' }),
	senderId: text('sender_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	body: text('body').notNull().default(''),
	kind: text('kind').notNull().default('text'),
	replyToId: text('reply_to_id'),
	editedAt: integer('edited_at', { mode: 'timestamp_ms' }),
	deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export const attachments = sqliteTable('attachments', {
	id: text('id').primaryKey(),
	messageId: text('message_id')
		.notNull()
		.references(() => messages.id, { onDelete: 'cascade' }),
	filename: text('filename').notNull(),
	mime: text('mime').notNull(),
	size: integer('size').notNull(),
	path: text('path').notNull()
});

export const messageReactions = sqliteTable(
	'message_reactions',
	{
		messageId: text('message_id')
			.notNull()
			.references(() => messages.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		emoji: text('emoji').notNull()
	},
	(t) => [primaryKey({ columns: [t.messageId, t.userId] })]
);

export const linkPreviews = sqliteTable('link_previews', {
	id: text('id').primaryKey(),
	messageId: text('message_id')
		.notNull()
		.references(() => messages.id, { onDelete: 'cascade' }),
	url: text('url').notNull(),
	title: text('title'),
	description: text('description'),
	imageUrl: text('image_url')
});

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Chat = typeof chats.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;

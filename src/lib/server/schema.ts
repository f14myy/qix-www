import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
	id: text('id').primaryKey(),
	username: text('username').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	displayName: text('display_name'),
	bio: text('bio'),
	avatarPath: text('avatar_path'),
	bannerPath: text('banner_path'),
	lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
	locale: text('locale'),
	bannedAt: integer('banned_at', { mode: 'timestamp_ms' }),
	bannedReason: text('banned_reason'),
	bannerKey: text('banner_key').notNull().default('default'),
	inviteCode: text('invite_code'),
	e2eePublicKey: text('e2ee_public_key'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export const badges = sqliteTable('badges', {
	id: text('id').primaryKey(),
	label: text('label').notNull(),
	color: text('color').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export const userBadges = sqliteTable(
	'user_badges',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		badgeId: text('badge_id')
			.notNull()
			.references(() => badges.id, { onDelete: 'cascade' }),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [primaryKey({ columns: [t.userId, t.badgeId] })]
);

export const sessions = sqliteTable('sessions', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
	userAgent: text('user_agent'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }),
	lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' })
});

export const recoveryCodes = sqliteTable('recovery_codes', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	codeHash: text('code_hash').notNull(),
	usedAt: integer('used_at', { mode: 'timestamp_ms' })
});

export const chats = sqliteTable('chats', {
	id: text('id').primaryKey(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	pinnedMessageId: text('pinned_message_id'),
	disappearAfterSec: integer('disappear_after_sec').notNull().default(0),
	kind: text('kind').notNull().default('dm'),
	channelKey: text('channel_key'),
	title: text('title'),
	posting: text('posting').notNull().default('members')
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
		archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
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
	forwardedFromId: text('forwarded_from_id'),
	editedAt: integer('edited_at', { mode: 'timestamp_ms' }),
	deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
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
	path: text('path').notNull(),
	e2eeMeta: text('e2ee_meta')
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

export const userSettings = sqliteTable('user_settings', {
	userId: text('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	notifyMessages: integer('notify_messages', { mode: 'boolean' }).notNull().default(true),
	notifyReactions: integer('notify_reactions', { mode: 'boolean' }).notNull().default(true),
	notifySound: integer('notify_sound', { mode: 'boolean' }).notNull().default(true),
	haptics: integer('haptics', { mode: 'boolean' }).notNull().default(true),
	sendWithEnter: integer('send_with_enter', { mode: 'boolean' }).notNull().default(true),
	linkPreviews: integer('link_previews', { mode: 'boolean' }).notNull().default(true),
	confirmMessageDelete: integer('confirm_message_delete', { mode: 'boolean' }).notNull().default(true),
	autoPlayVoice: integer('auto_play_voice', { mode: 'boolean' }).notNull().default(true),
	lastSeenVisibility: text('last_seen_visibility').notNull().default('everyone'),
	lastSeenReciprocity: integer('last_seen_reciprocity', { mode: 'boolean' }).notNull().default(true),
	readReceipts: integer('read_receipts', { mode: 'boolean' }).notNull().default(true),
	showTyping: integer('show_typing', { mode: 'boolean' }).notNull().default(true),
	whoCanMessage: text('who_can_message').notNull().default('everyone'),
	profileVisibility: text('profile_visibility').notNull().default('everyone'),
	look: text('look').notNull().default('qix'),
	theme: text('theme').notNull().default('system'),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export const blocks = sqliteTable(
	'blocks',
	{
		blockerId: text('blocker_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		blockedId: text('blocked_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [primaryKey({ columns: [t.blockerId, t.blockedId] })]
);

export const pushSubscriptions = sqliteTable('push_subscriptions', {
	endpoint: text('endpoint').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	p256dh: text('p256dh').notNull(),
	auth: text('auth').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export const messageRequests = sqliteTable('message_requests', {
	id: text('id').primaryKey(),
	fromUserId: text('from_user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	toUserId: text('to_user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	note: text('note').notNull().default(''),
	status: text('status').notNull().default('pending'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export const userReports = sqliteTable('user_reports', {
	id: text('id').primaryKey(),
	reporterId: text('reporter_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	reportedId: text('reported_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	reason: text('reason').notNull().default(''),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' })
});

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Chat = typeof chats.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;

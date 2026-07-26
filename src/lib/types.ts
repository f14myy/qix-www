export type AttachmentDTO = {
	id: string;
	filename: string;
	mime: string;
	size: number;
	e2eeMeta: string | null;
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
	kind: string;
	thumbUrl: string | null;
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
	expiresAt: string | null;
	forwardedFromId: string | null;
	replyTo: ReplyPreviewDTO | null;
	attachments: AttachmentDTO[];
	linkPreview: LinkPreviewDTO | null;
	reactions: ReactionDTO[];
	/** Client-only: optimistic send state */
	sendStatus?: 'pending' | 'failed';
};

export type ChatListItem = {
	id: string;
	kind: 'dm' | 'channel';
	peer: {
		id: string;
		username: string;
		displayName: string | null;
		avatarPath: string | null;
		lastSeenAt: string | null;
		badges: import('$lib/badges').BadgeDTO[];
		e2eePublicKey: string | null;
	} | null;
	channel: {
		key: string;
		title: string;
		posting: 'admin' | 'none' | 'members';
	} | null;
	unreadCount: number;
	pinned: boolean;
	muted: boolean;
	archived: boolean;
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
	badges: import('$lib/badges').BadgeDTO[];
	inviteCode: string | null;
	e2eePublicKey: string | null;
};

export type MediaItemDTO = {
	attachmentId: string;
	messageId: string;
	mime: string;
	filename: string;
	createdAt: string;
	kind: 'image' | 'video' | 'file';
};

export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥'] as const;

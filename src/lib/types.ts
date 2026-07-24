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
	/** Client-only: optimistic send state */
	sendStatus?: 'pending' | 'failed';
};

export type ChatListItem = {
	id: string;
	peer: {
		id: string;
		username: string;
		displayName: string | null;
		avatarPath: string | null;
		lastSeenAt: string | null;
		badges: import('$lib/badges').BadgeDTO[];
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
	badges: import('$lib/badges').BadgeDTO[];
};

export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥'] as const;

import { and, eq, or } from 'drizzle-orm';
import { db } from './db';
import { blocks, chatMembers, userSettings, users } from './schema';
import {
	DEFAULT_SETTINGS,
	type LastSeenVisibility,
	type ProfileVisibility,
	type UserSettingsDTO,
	type WhoCanMessage
} from '../settingsTypes';

export type { LastSeenVisibility, ProfileVisibility, UserSettingsDTO, WhoCanMessage };
export { DEFAULT_SETTINGS };

function parseLastSeen(v: string | null | undefined): LastSeenVisibility {
	if (v === 'chats' || v === 'nobody' || v === 'everyone') return v;
	return 'everyone';
}

function parseWhoCan(v: string | null | undefined): WhoCanMessage {
	if (v === 'chats' || v === 'everyone' || v === 'nobody') return v;
	return 'everyone';
}

function parseProfileVis(v: string | null | undefined): ProfileVisibility {
	if (v === 'chats' || v === 'nobody' || v === 'everyone') return v;
	return 'everyone';
}

function findDmBetween(userA: string, userB: string): string | null {
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

function rowToDto(existing: typeof userSettings.$inferSelect): UserSettingsDTO {
	return {
		notifyMessages: !!existing.notifyMessages,
		notifyReactions: !!existing.notifyReactions,
		notifySound: existing.notifySound === undefined ? true : !!existing.notifySound,
		haptics: !!existing.haptics,
		sendWithEnter: !!existing.sendWithEnter,
		linkPreviews: !!existing.linkPreviews,
		confirmMessageDelete:
			existing.confirmMessageDelete === undefined ? true : !!existing.confirmMessageDelete,
		autoPlayVoice: existing.autoPlayVoice === undefined ? true : !!existing.autoPlayVoice,
		lastSeenVisibility: parseLastSeen(existing.lastSeenVisibility),
		lastSeenReciprocity:
			existing.lastSeenReciprocity === undefined ? true : !!existing.lastSeenReciprocity,
		readReceipts: !!existing.readReceipts,
		showTyping: !!existing.showTyping,
		whoCanMessage: parseWhoCan(existing.whoCanMessage),
		profileVisibility: parseProfileVis(
			(existing as { profileVisibility?: string }).profileVisibility
		)
	};
}

export function ensureUserSettings(userId: string): UserSettingsDTO {
	const existing = db.select().from(userSettings).where(eq(userSettings.userId, userId)).get();
	if (existing) return rowToDto(existing);

	const now = new Date();
	db.insert(userSettings)
		.values({
			userId,
			...DEFAULT_SETTINGS,
			updatedAt: now
		})
		.run();
	return { ...DEFAULT_SETTINGS };
}

export function getUserSettings(userId: string): UserSettingsDTO {
	return ensureUserSettings(userId);
}

export function updateUserSettings(
	userId: string,
	patch: Partial<UserSettingsDTO>
): UserSettingsDTO {
	ensureUserSettings(userId);
	const next: Partial<typeof userSettings.$inferInsert> = { updatedAt: new Date() };

	if (patch.notifyMessages !== undefined) next.notifyMessages = patch.notifyMessages;
	if (patch.notifyReactions !== undefined) next.notifyReactions = patch.notifyReactions;
	if (patch.notifySound !== undefined) next.notifySound = patch.notifySound;
	if (patch.haptics !== undefined) next.haptics = patch.haptics;
	if (patch.sendWithEnter !== undefined) next.sendWithEnter = patch.sendWithEnter;
	if (patch.linkPreviews !== undefined) next.linkPreviews = patch.linkPreviews;
	if (patch.confirmMessageDelete !== undefined)
		next.confirmMessageDelete = patch.confirmMessageDelete;
	if (patch.autoPlayVoice !== undefined) next.autoPlayVoice = patch.autoPlayVoice;
	if (patch.lastSeenVisibility !== undefined) next.lastSeenVisibility = patch.lastSeenVisibility;
	if (patch.lastSeenReciprocity !== undefined)
		next.lastSeenReciprocity = patch.lastSeenReciprocity;
	if (patch.readReceipts !== undefined) next.readReceipts = patch.readReceipts;
	if (patch.showTyping !== undefined) next.showTyping = patch.showTyping;
	if (patch.whoCanMessage !== undefined) next.whoCanMessage = patch.whoCanMessage;
	if (patch.profileVisibility !== undefined) next.profileVisibility = patch.profileVisibility;

	db.update(userSettings).set(next).where(eq(userSettings.userId, userId)).run();
	return getUserSettings(userId);
}

export function isBlockedEither(a: string, b: string): boolean {
	const row = db
		.select({ blockerId: blocks.blockerId })
		.from(blocks)
		.where(
			or(
				and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
				and(eq(blocks.blockerId, b), eq(blocks.blockedId, a))
			)
		)
		.get();
	return !!row;
}

export function isBlockedBy(blockerId: string, blockedId: string): boolean {
	const row = db
		.select({ blockerId: blocks.blockerId })
		.from(blocks)
		.where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)))
		.get();
	return !!row;
}

export function blockUser(blockerId: string, blockedId: string): void {
	if (blockerId === blockedId) return;
	if (isBlockedBy(blockerId, blockedId)) return;
	db.insert(blocks)
		.values({ blockerId, blockedId, createdAt: new Date() })
		.run();
}

export function unblockUser(blockerId: string, blockedId: string): void {
	db.delete(blocks)
		.where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)))
		.run();
}

export type BlockedUserDTO = {
	id: string;
	username: string;
	displayName: string | null;
	avatarPath: string | null;
	blockedAt: string;
};

export function listBlockedUsers(blockerId: string): BlockedUserDTO[] {
	return db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			avatarPath: users.avatarPath,
			blockedAt: blocks.createdAt
		})
		.from(blocks)
		.innerJoin(users, eq(blocks.blockedId, users.id))
		.where(eq(blocks.blockerId, blockerId))
		.all()
		.map((r) => ({
			id: r.id,
			username: r.username,
			displayName: r.displayName,
			avatarPath: r.avatarPath,
			blockedAt: r.blockedAt.toISOString()
		}))
		.sort((a, b) => b.blockedAt.localeCompare(a.blockedAt));
}

export function canStartChat(
	fromUserId: string,
	toUserId: string
): { ok: true } | { ok: false; error: string } {
	if (fromUserId === toUserId) return { ok: false, error: 'Cannot chat with yourself' };
	if (isBlockedEither(fromUserId, toUserId)) {
		return { ok: false, error: 'Unable to message this user' };
	}

	const existing = findDmBetween(fromUserId, toUserId);
	if (existing) return { ok: true };

	const target = getUserSettings(toUserId);
	if (target.whoCanMessage === 'nobody') {
		return { ok: false, error: 'This user is not accepting new messages' };
	}
	if (target.whoCanMessage === 'chats') {
		return { ok: false, error: 'This user only accepts messages from existing chats' };
	}

	return { ok: true };
}

export function canSeeProfileDetails(ownerId: string, viewerId: string): boolean {
	if (ownerId === viewerId) return true;
	const v = getUserSettings(ownerId).profileVisibility;
	if (v === 'everyone') return true;
	if (v === 'nobody') return false;
	return !!findDmBetween(ownerId, viewerId);
}

export function canSeeLastSeen(
	ownerId: string,
	viewerId: string,
	visibility?: LastSeenVisibility
): boolean {
	if (ownerId === viewerId) return true;

	const viewerSettings = getUserSettings(viewerId);
	if (viewerSettings.lastSeenReciprocity && viewerSettings.lastSeenVisibility !== 'everyone') {
		return false;
	}

	const v = visibility ?? getUserSettings(ownerId).lastSeenVisibility;
	if (v === 'everyone') return true;
	if (v === 'nobody') return false;
	return !!findDmBetween(ownerId, viewerId);
}

export function getBlockedIdsForUser(userId: string): Set<string> {
	const rows = db
		.select({ other: blocks.blockedId })
		.from(blocks)
		.where(eq(blocks.blockerId, userId))
		.all();
	const incoming = db
		.select({ other: blocks.blockerId })
		.from(blocks)
		.where(eq(blocks.blockedId, userId))
		.all();
	return new Set([...rows.map((r) => r.other), ...incoming.map((r) => r.other)]);
}

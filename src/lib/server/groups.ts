import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { getUserBadges } from './badges';
import { db } from './db';
import { createId } from './id';
import { chatMembers, chats, messages, users } from './schema';
import { canSeeLastSeen, getBlockedIdsForUser } from './settings';
import {
	encodeSystemBody,
	decodeSystemBody,
	systemEventTakesUser,
	type SystemEvent,
	type SystemMessageMeta
} from '$lib/systemMessage';
import type { GroupInfoDTO, GroupMemberDTO, GroupRole, MessageSenderDTO } from '$lib/types';

/*
 * Groups.
 *
 * A group is a `chats` row with `kind = 'group'`, so every message, reaction,
 * attachment, pin, read-receipt and search path that already works for a DM works
 * here untouched. What this module adds on top is membership with roles, and the
 * system messages that narrate changes to it.
 *
 * Deliberately does NOT import ./chats: that module imports this one (for the
 * chat list and for resolving system-message names), and keeping the dependency
 * one-way avoids a cycle that Vite's SSR loader would have to untangle at
 * runtime. Anything shaped like a message DTO is therefore returned as an id for
 * the caller to hydrate.
 */

export const GROUP_TITLE_MAX = 60;
export const GROUP_DESC_MAX = 240;
/** A ceiling high enough never to be hit in practice, low enough to bound fanout. */
export const GROUP_MAX_MEMBERS = 250;
/** How many people one call to addGroupMembers may add. */
export const GROUP_ADD_BATCH_MAX = 50;

export type GroupPosting = 'members' | 'admins';
export type GroupInviting = 'members' | 'admins';

/**
 * The shape every mutation returns.
 *
 * `messageIds` and `notify` exist because this module does not publish: the HTTP
 * route does, once, after the transaction has committed. Returning them keeps the
 * fanout in one place instead of scattering SSE writes through the data layer.
 */
export type GroupResult = {
	error?: string;
	status?: number;
	/** System messages created by this call, oldest first. */
	messageIds: string[];
	/** Everyone to notify — including anyone who just lost access. */
	notify: string[];
};

function ok(messageIds: string[] = [], notify: string[] = []): GroupResult {
	return { messageIds, notify };
}

function fail(error: string, status = 400): GroupResult {
	return { error, status, messageIds: [], notify: [] };
}

/* ── Reading ──────────────────────────────────────────────────────────────── */

export function getGroup(chatId: string) {
	const row = db.select().from(chats).where(eq(chats.id, chatId)).get();
	if (!row || row.kind !== 'group') return null;
	return row;
}

export function isGroupChat(chatId: string): boolean {
	return !!getGroup(chatId);
}

function normalizeRole(value: string | null | undefined): GroupRole {
	return value === 'owner' || value === 'admin' ? value : 'member';
}

function normalizePosting(value: string | null | undefined): GroupPosting {
	return value === 'admins' ? 'admins' : 'members';
}

function normalizeInviting(value: string | null | undefined): GroupInviting {
	return value === 'admins' ? 'admins' : 'members';
}

export function getMemberRole(chatId: string, userId: string): GroupRole | null {
	const row = db
		.select({ role: chatMembers.role })
		.from(chatMembers)
		.where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)))
		.get();
	return row ? normalizeRole(row.role) : null;
}

function memberIds(chatId: string): string[] {
	return db
		.select({ userId: chatMembers.userId })
		.from(chatMembers)
		.where(eq(chatMembers.chatId, chatId))
		.all()
		.map((r) => r.userId);
}

export function countGroupMembers(chatId: string): number {
	const row = db
		.select({ count: sql<number>`count(*)` })
		.from(chatMembers)
		.where(eq(chatMembers.chatId, chatId))
		.get();
	return Number(row?.count ?? 0);
}

/** Just enough to draw a chat-list row, without loading the member list. */
export function getGroupSummary(
	chatId: string
): { title: string; avatarPath: string | null; memberCount: number } | null {
	const group = getGroup(chatId);
	if (!group) return null;
	return {
		title: group.title?.trim() || 'Group',
		avatarPath: group.avatarPath ?? null,
		memberCount: countGroupMembers(chatId)
	};
}

const ROLE_RANK: Record<GroupRole, number> = { owner: 0, admin: 1, member: 2 };

export function listGroupMembers(chatId: string, viewerId?: string): GroupMemberDTO[] {
	const rows = db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			avatarPath: users.avatarPath,
			lastSeenAt: users.lastSeenAt,
			role: chatMembers.role,
			joinedAt: chatMembers.joinedAt
		})
		.from(chatMembers)
		.innerJoin(users, eq(chatMembers.userId, users.id))
		.where(eq(chatMembers.chatId, chatId))
		.orderBy(asc(chatMembers.joinedAt))
		.all();

	const list = rows.map((r) => {
		// Each member's own privacy setting still applies inside a group.
		const showSeen = !viewerId || viewerId === r.id || canSeeLastSeen(r.id, viewerId);
		return {
			id: r.id,
			username: r.username,
			displayName: r.displayName,
			avatarPath: r.avatarPath,
			lastSeenAt: showSeen && r.lastSeenAt ? r.lastSeenAt.toISOString() : null,
			role: normalizeRole(r.role),
			joinedAt: r.joinedAt ? r.joinedAt.toISOString() : null,
			badges: getUserBadges(r.id)
		};
	});

	// Owner, then admins, then everyone else; alphabetical within a rank.
	list.sort((a, b) => {
		if (ROLE_RANK[a.role] !== ROLE_RANK[b.role]) return ROLE_RANK[a.role] - ROLE_RANK[b.role];
		const an = (a.displayName || a.username).toLowerCase();
		const bn = (b.displayName || b.username).toLowerCase();
		return an.localeCompare(bn);
	});
	return list;
}

export function canPostInGroup(chatId: string, userId: string): boolean {
	const group = getGroup(chatId);
	if (!group) return false;
	const role = getMemberRole(chatId, userId);
	if (!role) return false;
	if (normalizePosting(group.posting) === 'members') return true;
	return role !== 'member';
}

export function canManageGroup(chatId: string, userId: string): boolean {
	const role = getMemberRole(chatId, userId);
	return role === 'owner' || role === 'admin';
}

export function canInviteToGroup(chatId: string, userId: string): boolean {
	const group = getGroup(chatId);
	if (!group) return false;
	const role = getMemberRole(chatId, userId);
	if (!role) return false;
	if (normalizeInviting(group.inviting) === 'members') return true;
	return role !== 'member';
}

export function getGroupInfo(chatId: string, viewerId: string): GroupInfoDTO | null {
	const group = getGroup(chatId);
	if (!group) return null;
	const myRole = getMemberRole(chatId, viewerId);
	if (!myRole) return null;

	const canInvite = canInviteToGroup(chatId, viewerId);
	return {
		id: group.id,
		title: group.title?.trim() || 'Group',
		description: group.description?.trim() || null,
		avatarPath: group.avatarPath ?? null,
		ownerId: group.ownerId ?? '',
		memberCount: countGroupMembers(chatId),
		posting: normalizePosting(group.posting),
		inviting: normalizeInviting(group.inviting),
		myRole,
		canPost: canPostInGroup(chatId, viewerId),
		canInvite,
		canManage: myRole !== 'member',
		// A join link is a capability. Only hand it to someone allowed to invite.
		inviteCode: canInvite ? (group.inviteCode ?? null) : null,
		createdAt: group.createdAt.toISOString()
	};
}

/* ── System messages ─────────────────────────────────────────────────────── */

function displayNameOf(userId: string): string {
	const row = db
		.select({ username: users.username, displayName: users.displayName })
		.from(users)
		.where(eq(users.id, userId))
		.get();
	if (!row) return 'Someone';
	return row.displayName?.trim() || row.username;
}

/**
 * Resolves a stored system body into something renderable.
 *
 * Names are looked up at read time rather than baked in at write time, so a
 * rename updates old lines too, and a member who has since left still resolves —
 * their `users` row outlives their membership.
 */
export function systemMeta(row: {
	senderId: string;
	body: string;
	kind: string;
}): SystemMessageMeta | null {
	if (row.kind !== 'system') return null;
	const parsed = decodeSystemBody(row.body);
	if (!parsed) return null;

	const takesUser = systemEventTakesUser(parsed.event);

	return {
		event: parsed.event,
		actor: displayNameOf(row.senderId),
		target: takesUser && parsed.arg ? displayNameOf(parsed.arg) : null,
		text: !takesUser ? parsed.arg : null
	};
}

/**
 * Who wrote a message, for group bubbles only.
 *
 * DMs already name the person in the header and channels speak with one voice, so
 * only a group needs this — and resolving it here means a bubble from someone who
 * has since left the group still carries their name, which a client-side lookup
 * against the current member list could not do.
 */
export function groupSenderOf(row: {
	chatId: string;
	senderId: string;
	kind: string;
}): MessageSenderDTO | null {
	if (row.kind === 'system') return null;
	if (!isGroupChat(row.chatId)) return null;
	const u = db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			avatarPath: users.avatarPath
		})
		.from(users)
		.where(eq(users.id, row.senderId))
		.get();
	return u ?? null;
}

/**
 * Writes one system line.
 *
 * `senderId` is the actor, which means a system message is attributed like any
 * other message — that is what lets read counting, pagination and the "who wrote
 * last" logic in the chat list treat it uniformly.
 */
function writeSystem(
	chatId: string,
	actorId: string,
	event: SystemEvent,
	arg?: string | null,
	at = new Date()
): string {
	const id = createId();
	db.insert(messages)
		.values({
			id,
			chatId,
			senderId: actorId,
			body: encodeSystemBody(event, arg),
			kind: 'system',
			createdAt: at
		})
		.run();
	return id;
}

/* ── Creating ────────────────────────────────────────────────────────────── */

export function normalizeGroupTitle(raw: unknown): string {
	return String(raw ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, GROUP_TITLE_MAX);
}

function normalizeDescription(raw: unknown): string | null {
	const value = String(raw ?? '')
		.replace(/\r\n/g, '\n')
		.replace(/[ \t]+/g, ' ')
		.trim()
		.slice(0, GROUP_DESC_MAX);
	return value || null;
}

function freshInviteCode(): string {
	// Retried because the column is uniquely indexed; 10 hex chars collide about
	// never, but "about never" is not a guarantee worth crashing a create over.
	for (let i = 0; i < 8; i++) {
		const code = createId(5).slice(0, 10);
		const taken = db.select({ id: chats.id }).from(chats).where(eq(chats.inviteCode, code)).get();
		if (!taken) return code;
	}
	return createId(12);
}

/**
 * Filters a requested member list down to who may actually be added.
 *
 * Blocks are honoured in both directions: someone who blocked the inviter should
 * not be dragged into a room with them, and the inviter should not have to see
 * someone they blocked.
 */
function eligibleUserIds(actorId: string, requested: string[], excludeChatId?: string): string[] {
	const wanted = [...new Set(requested.map((id) => String(id ?? '').trim()).filter(Boolean))]
		.filter((id) => id !== actorId)
		.slice(0, GROUP_ADD_BATCH_MAX);
	if (!wanted.length) return [];

	const existing = db
		.select({ id: users.id, bannedAt: users.bannedAt })
		.from(users)
		.where(inArray(users.id, wanted))
		.all();
	const blocked = getBlockedIdsForUser(actorId);

	const already = excludeChatId ? new Set(memberIds(excludeChatId)) : new Set<string>();

	return existing
		.filter((u) => !u.bannedAt && !blocked.has(u.id) && !already.has(u.id))
		.map((u) => u.id);
}

export function createGroup(
	ownerId: string,
	titleRaw: unknown,
	requestedMemberIds: string[]
): { chatId?: string; error?: string; status?: number; messageIds: string[]; notify: string[] } {
	const title = normalizeGroupTitle(titleRaw);
	if (!title) return { error: 'Group needs a name', status: 400, messageIds: [], notify: [] };

	const invitees = eligibleUserIds(ownerId, requestedMemberIds);
	if (invitees.length + 1 > GROUP_MAX_MEMBERS) {
		return { error: 'Too many members', status: 400, messageIds: [], notify: [] };
	}

	const chatId = createId();
	const now = new Date();

	db.transaction((tx) => {
		tx.insert(chats)
			.values({
				id: chatId,
				createdAt: now,
				kind: 'group',
				title,
				ownerId,
				posting: 'members',
				inviting: 'members',
				inviteCode: freshInviteCode(),
				disappearAfterSec: 0
			})
			.run();
		tx.insert(chatMembers)
			.values([
				{ chatId, userId: ownerId, lastReadAt: now, muted: false, role: 'owner', joinedAt: now },
				...invitees.map((id) => ({
					chatId,
					userId: id,
					lastReadAt: null,
					muted: false,
					role: 'member',
					joinedAt: now
				}))
			])
			.run();
	});

	/*
	 * One line, not one per invitee: a group created with fifteen people should
	 * not open with fifteen near-identical rows. Later additions are individually
	 * interesting and do get their own line.
	 */
	const created = writeSystem(chatId, ownerId, 'group.created', null, now);

	return { chatId, messageIds: [created], notify: [ownerId, ...invitees] };
}

/* ── Membership ──────────────────────────────────────────────────────────── */

export function addGroupMembers(
	chatId: string,
	actorId: string,
	requested: string[]
): GroupResult & { added: string[] } {
	const group = getGroup(chatId);
	if (!group) return { ...fail('Not found', 404), added: [] };
	if (!canInviteToGroup(chatId, actorId)) {
		return { ...fail('Only admins can add members here', 403), added: [] };
	}

	const eligible = eligibleUserIds(actorId, requested, chatId);
	if (!eligible.length) return { ...ok([], memberIds(chatId)), added: [] };

	if (countGroupMembers(chatId) + eligible.length > GROUP_MAX_MEMBERS) {
		return { ...fail('Group is full', 400), added: [] };
	}

	const now = new Date();
	db.insert(chatMembers)
		.values(
			eligible.map((id) => ({
				chatId,
				userId: id,
				lastReadAt: null,
				muted: false,
				role: 'member',
				joinedAt: now
			}))
		)
		.run();

	/*
	 * Stamped one millisecond apart. Two rows sharing a created_at would order
	 * arbitrarily on reload, so "added Bob" and "added Carol" could swap places
	 * between the optimistic view and the next fetch.
	 */
	const messageIds = eligible.map((id, i) =>
		writeSystem(chatId, actorId, 'member.added', id, new Date(now.getTime() + i))
	);

	return { ...ok(messageIds, memberIds(chatId)), added: eligible };
}

export function removeGroupMember(chatId: string, actorId: string, targetId: string): GroupResult {
	const group = getGroup(chatId);
	if (!group) return fail('Not found', 404);
	const actorRole = getMemberRole(chatId, actorId);
	const targetRole = getMemberRole(chatId, targetId);
	if (!actorRole || !targetRole) return fail('Not found', 404);
	if (actorRole === 'member') return fail('Only admins can remove members', 403);
	if (targetId === actorId) return fail('Use leave instead', 400);
	if (targetRole === 'owner') return fail('The owner cannot be removed', 403);
	// An admin removing an admin is how a group loses its moderators to a feud.
	if (targetRole === 'admin' && actorRole !== 'owner') {
		return fail('Only the owner can remove an admin', 403);
	}

	const before = memberIds(chatId);
	db.delete(chatMembers)
		.where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, targetId)))
		.run();
	const messageIds = [writeSystem(chatId, actorId, 'member.removed', targetId)];
	return ok(messageIds, before);
}

/**
 * Picks who inherits a group when its owner walks out.
 *
 * Longest-standing admin first, then longest-standing member. Handing it to
 * whoever has been around longest is arbitrary but predictable, and it beats the
 * alternative of an ownerless group nobody can rename or moderate.
 */
function successorFor(chatId: string, leavingId: string): string | null {
	const rows = db
		.select({ userId: chatMembers.userId, role: chatMembers.role, joinedAt: chatMembers.joinedAt })
		.from(chatMembers)
		.where(and(eq(chatMembers.chatId, chatId), ne(chatMembers.userId, leavingId)))
		.orderBy(asc(chatMembers.joinedAt))
		.all();
	return (
		rows.find((r) => normalizeRole(r.role) === 'admin')?.userId ?? rows[0]?.userId ?? null
	);
}

export function leaveGroup(chatId: string, userId: string): GroupResult & { deleted?: boolean } {
	const group = getGroup(chatId);
	if (!group) return fail('Not found', 404);
	const role = getMemberRole(chatId, userId);
	if (!role) return fail('Not found', 404);

	const before = memberIds(chatId);
	const successor = role === 'owner' ? successorFor(chatId, userId) : null;

	db.delete(chatMembers)
		.where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)))
		.run();

	// Last one out: nothing is left to read, so take the room with them.
	if (countGroupMembers(chatId) === 0) {
		db.delete(chats).where(eq(chats.id, chatId)).run();
		return { ...ok([], before), deleted: true };
	}

	const now = new Date();
	const messageIds = [writeSystem(chatId, userId, 'member.left', null, now)];

	if (role === 'owner' && successor) {
		db.update(chatMembers)
			.set({ role: 'owner' })
			.where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, successor)))
			.run();
		db.update(chats).set({ ownerId: successor }).where(eq(chats.id, chatId)).run();
		messageIds.push(
			writeSystem(chatId, userId, 'group.ownerChanged', successor, new Date(now.getTime() + 1))
		);
	}

	return ok(messageIds, before);
}

export function setGroupRole(
	chatId: string,
	actorId: string,
	targetId: string,
	role: GroupRole
): GroupResult {
	const group = getGroup(chatId);
	if (!group) return fail('Not found', 404);
	if (getMemberRole(chatId, actorId) !== 'owner') {
		return fail('Only the owner can change roles', 403);
	}
	if (targetId === actorId) return fail('You already own this group', 400);
	const targetRole = getMemberRole(chatId, targetId);
	if (!targetRole) return fail('Not a member', 404);
	if (targetRole === role) return ok([], memberIds(chatId));

	const now = new Date();
	const messageIds: string[] = [];

	if (role === 'owner') {
		// Transfer: there is exactly one owner, so the old one steps down first.
		db.transaction((tx) => {
			tx.update(chatMembers)
				.set({ role: 'admin' })
				.where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, actorId)))
				.run();
			tx.update(chatMembers)
				.set({ role: 'owner' })
				.where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, targetId)))
				.run();
			tx.update(chats).set({ ownerId: targetId }).where(eq(chats.id, chatId)).run();
		});
		messageIds.push(writeSystem(chatId, actorId, 'group.ownerChanged', targetId, now));
	} else {
		db.update(chatMembers)
			.set({ role })
			.where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, targetId)))
			.run();
		messageIds.push(
			writeSystem(
				chatId,
				actorId,
				role === 'admin' ? 'role.promoted' : 'role.demoted',
				targetId,
				now
			)
		);
	}

	return ok(messageIds, memberIds(chatId));
}

/* ── Editing the group itself ────────────────────────────────────────────── */

export function updateGroup(
	chatId: string,
	actorId: string,
	patch: {
		title?: unknown;
		description?: unknown;
		posting?: unknown;
		inviting?: unknown;
	}
): GroupResult {
	const group = getGroup(chatId);
	if (!group) return fail('Not found', 404);
	const role = getMemberRole(chatId, actorId);
	if (!role) return fail('Not found', 404);
	if (role === 'member') return fail('Only admins can edit this group', 403);

	const set: {
		title?: string;
		description?: string | null;
		posting?: GroupPosting;
		inviting?: GroupInviting;
	} = {};
	const messageIds: string[] = [];
	const now = new Date();
	let stamp = 0;
	const nextStamp = () => new Date(now.getTime() + stamp++);

	if (patch.title !== undefined) {
		const title = normalizeGroupTitle(patch.title);
		if (!title) return fail('Group needs a name', 400);
		if (title !== (group.title ?? '')) {
			set.title = title;
			messageIds.push(writeSystem(chatId, actorId, 'group.renamed', title, nextStamp()));
		}
	}

	if (patch.description !== undefined) {
		const description = normalizeDescription(patch.description);
		if (description !== (group.description?.trim() || null)) {
			set.description = description;
			messageIds.push(
				writeSystem(
					chatId,
					actorId,
					description ? 'group.description' : 'group.descriptionCleared',
					null,
					nextStamp()
				)
			);
		}
	}

	/*
	 * Permission switches change silently. They are settings rather than events,
	 * and a group that flips "who can post" twice while deciding should not carry
	 * a permanent record of the deliberation.
	 */
	if (patch.posting !== undefined) set.posting = normalizePosting(String(patch.posting));
	if (patch.inviting !== undefined) set.inviting = normalizeInviting(String(patch.inviting));

	if (Object.keys(set).length) {
		db.update(chats).set(set).where(eq(chats.id, chatId)).run();
	}

	return ok(messageIds, memberIds(chatId));
}

export function setGroupPhoto(
	chatId: string,
	actorId: string,
	avatarPath: string | null
): GroupResult {
	const group = getGroup(chatId);
	if (!group) return fail('Not found', 404);
	const role = getMemberRole(chatId, actorId);
	if (!role || role === 'member') return fail('Only admins can change the photo', 403);

	db.update(chats).set({ avatarPath }).where(eq(chats.id, chatId)).run();
	const messageIds = [
		writeSystem(chatId, actorId, avatarPath ? 'group.photo' : 'group.photoCleared')
	];
	return ok(messageIds, memberIds(chatId));
}

/* ── Join links ──────────────────────────────────────────────────────────── */

export function rotateGroupInviteCode(
	chatId: string,
	actorId: string
): GroupResult & { code?: string } {
	const group = getGroup(chatId);
	if (!group) return { ...fail('Not found', 404) };
	const role = getMemberRole(chatId, actorId);
	if (!role || role === 'member') return { ...fail('Only admins can reset the link', 403) };

	const code = freshInviteCode();
	db.update(chats).set({ inviteCode: code }).where(eq(chats.id, chatId)).run();
	return { ...ok([], memberIds(chatId)), code };
}

export function findGroupByInviteCode(code: unknown) {
	const value = String(code ?? '')
		.trim()
		.toLowerCase();
	if (!value) return null;
	const row = db.select().from(chats).where(eq(chats.inviteCode, value)).get();
	if (!row || row.kind !== 'group') return null;
	return row;
}

export function joinGroupByCode(
	code: unknown,
	userId: string
): GroupResult & { chatId?: string; alreadyMember?: boolean } {
	const group = findGroupByInviteCode(code);
	if (!group) return { ...fail('This invite link is no longer valid', 404) };

	if (getMemberRole(group.id, userId)) {
		return { ...ok([], []), chatId: group.id, alreadyMember: true };
	}
	if (countGroupMembers(group.id) >= GROUP_MAX_MEMBERS) {
		return { ...fail('Group is full', 403) };
	}

	/*
	 * A link bypasses the inviting permission by design — that is what the link
	 * is for — but not blocks. If the owner blocked this person, or they blocked
	 * the owner, the link should not be the way around it.
	 */
	const ownerId = group.ownerId;
	if (ownerId) {
		const mine = getBlockedIdsForUser(userId);
		const theirs = getBlockedIdsForUser(ownerId);
		if (mine.has(ownerId) || theirs.has(userId)) {
			return { ...fail('This invite link is no longer valid', 404) };
		}
	}

	const now = new Date();
	db.insert(chatMembers)
		.values({
			chatId: group.id,
			userId,
			lastReadAt: null,
			muted: false,
			role: 'member',
			joinedAt: now
		})
		.run();

	const messageIds = [writeSystem(group.id, userId, 'member.joined', null, now)];
	return { ...ok(messageIds, memberIds(group.id)), chatId: group.id };
}

import { and, desc, eq, isNull } from 'drizzle-orm';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createId } from './id';
import { db, uploadsDir } from './db';
import {
	attachments,
	chats,
	messages,
	messageRequests,
	userReports,
	users
} from './schema';
import {
	createDm,
	findDmChatId,
	getChatMemberIds,
	getMessageById,
	isChatMember,
	toMessageDTO
} from './chats';
import { publishToChat, publishToChatMembers, publishToUser } from './events';
import { sendPushToUser } from './push';
import { getUserSettings, isBlockedEither } from './settings';
import { canPostInChat } from './channels';
import type { MediaItemDTO, MessageDTO } from '$lib/types';

export function purgeExpiredMessages(): number {
	const now = Date.now();
	const rows = db
		.select()
		.from(messages)
		.where(and(isNull(messages.deletedAt)))
		.all()
		.filter((m) => m.expiresAt && m.expiresAt.getTime() < now);
	const stamp = new Date();
	for (const r of rows) {
		db.update(messages)
			.set({ deletedAt: stamp, body: '' })
			.where(eq(messages.id, r.id))
			.run();
	}
	return rows.length;
}

export function getChatMeta(chatId: string) {
	return db.select().from(chats).where(eq(chats.id, chatId)).get() ?? null;
}

export function setPinnedMessage(chatId: string, messageId: string | null): void {
	if (messageId) {
		const msg = getMessageById(messageId);
		if (!msg || msg.chatId !== chatId || msg.deletedAt) {
			throw new Error('Invalid message');
		}
	}
	db.update(chats).set({ pinnedMessageId: messageId }).where(eq(chats.id, chatId)).run();
}

export function setDisappearAfter(chatId: string, sec: number): void {
	const allowed = [0, 86400, 604800];
	if (!allowed.includes(sec)) throw new Error('Invalid disappear setting');
	db.update(chats).set({ disappearAfterSec: sec }).where(eq(chats.id, chatId)).run();
}

export function listChatMedia(chatId: string, limit = 200): MediaItemDTO[] {
	purgeExpiredMessages();
	const rows = db
		.select({
			attachmentId: attachments.id,
			messageId: attachments.messageId,
			mime: attachments.mime,
			filename: attachments.filename,
			createdAt: messages.createdAt
		})
		.from(attachments)
		.innerJoin(messages, eq(attachments.messageId, messages.id))
		.where(and(eq(messages.chatId, chatId), isNull(messages.deletedAt)))
		.orderBy(desc(messages.createdAt))
		.limit(limit)
		.all();

	return rows.map((r) => ({
		attachmentId: r.attachmentId,
		messageId: r.messageId,
		mime: r.mime,
		filename: r.filename,
		createdAt: r.createdAt.toISOString(),
		kind: r.mime.startsWith('image/')
			? ('image' as const)
			: r.mime.startsWith('video/')
				? ('video' as const)
				: ('file' as const)
	}));
}

export function searchInChat(chatId: string, query: string, limit = 50): MessageDTO[] {
	const q = query.trim().toLowerCase();
	if (q.length < 2) return [];
	const rows = db
		.select()
		.from(messages)
		.where(and(eq(messages.chatId, chatId), isNull(messages.deletedAt)))
		.orderBy(desc(messages.createdAt))
		.limit(400)
		.all()
		.filter((m) => m.body.toLowerCase().includes(q))
		.slice(0, limit);
	return rows.map((r) => toMessageDTO(r));
}

async function copyAttachment(att: typeof attachments.$inferSelect, newMessageId: string) {
	const newId = createId();
	const ext = att.path.includes('.') ? att.path.slice(att.path.lastIndexOf('.')) : '';
	const storedName = `${newId}${ext}`;
	try {
		await copyFile(join(uploadsDir, att.path), join(uploadsDir, storedName));
	} catch {
		return;
	}
	db.insert(attachments)
		.values({
			id: newId,
			messageId: newMessageId,
			filename: att.filename,
			mime: att.mime,
			size: att.size,
			path: storedName,
			e2eeMeta: att.e2eeMeta
		})
		.run();
}

export async function forwardMessages(
	sourceChatId: string,
	targetChatId: string,
	messageIds: string[],
	senderId: string
): Promise<MessageDTO[]> {
	if (!isChatMember(sourceChatId, senderId) || !isChatMember(targetChatId, senderId)) {
		throw new Error('Forbidden');
	}
	const actor = db.select().from(users).where(eq(users.id, senderId)).get();
	if (!actor || !canPostInChat(targetChatId, actor)) {
		throw new Error('Cannot post in this chat');
	}
	const peer = getChatMeta(targetChatId);
	if (!peer) throw new Error('Not found');

	const meta = peer;
	const expireMs = meta?.disappearAfterSec ? meta.disappearAfterSec * 1000 : 0;
	const out: MessageDTO[] = [];

	for (const mid of messageIds.slice(0, 20)) {
		const src = getMessageById(mid);
		if (!src || src.chatId !== sourceChatId || src.deletedAt) continue;

		const id = createId();
		const createdAt = new Date();
		db.insert(messages)
			.values({
				id,
				chatId: targetChatId,
				senderId,
				body: src.body,
				kind: src.kind,
				replyToId: null,
				forwardedFromId: src.id,
				createdAt,
				expiresAt: expireMs ? new Date(createdAt.getTime() + expireMs) : null
			})
			.run();

		const atts = db.select().from(attachments).where(eq(attachments.messageId, src.id)).all();
		for (const a of atts) await copyAttachment(a, id);

		const dto = toMessageDTO(getMessageById(id)!, senderId);
		out.push(dto);
		publishToChat(targetChatId, 'message', dto);
	}

	if (out.length) {
		publishToChatMembers(getChatMemberIds(targetChatId), 'chat_update', { chatId: targetChatId });
	}
	return out;
}

export function createMessageRequest(fromUserId: string, toUserId: string, note = '') {
	if (fromUserId === toUserId) throw new Error('Cannot chat with yourself');
	if (isBlockedEither(fromUserId, toUserId)) throw new Error('Unable to message this user');

	const existingChat = findDmChatId(fromUserId, toUserId);
	if (existingChat) return { chatId: existingChat, request: null };

	const target = getUserSettings(toUserId);
	if (target.whoCanMessage === 'nobody') {
		throw new Error('This user is not accepting new messages');
	}
	if (target.whoCanMessage === 'everyone') {
		const chatId = createDm(fromUserId, toUserId);
		return { chatId, request: null };
	}

	// whoCanMessage === 'chats' → message request instead of hard deny
	const pending = db
		.select()
		.from(messageRequests)
		.where(
			and(
				eq(messageRequests.fromUserId, fromUserId),
				eq(messageRequests.toUserId, toUserId),
				eq(messageRequests.status, 'pending')
			)
		)
		.get();
	if (pending) return { chatId: null, request: pending, pending: true as const };

	const id = createId();
	const createdAt = new Date();
	db.insert(messageRequests)
		.values({
			id,
			fromUserId,
			toUserId,
			note: note.slice(0, 200),
			status: 'pending',
			createdAt
		})
		.run();

	publishToUser(toUserId, 'message_request', { id, fromUserId });
	void sendPushToUser(
		toUserId,
		{ title: 'Qix', body: 'New message request', href: '/requests', tag: `req-${id}` },
		{ kind: 'message' }
	);

	return {
		chatId: null,
		request: db.select().from(messageRequests).where(eq(messageRequests.id, id)).get()!,
		pending: true as const
	};
}

export function listIncomingRequests(userId: string) {
	const rows = db
		.select()
		.from(messageRequests)
		.where(and(eq(messageRequests.toUserId, userId), eq(messageRequests.status, 'pending')))
		.orderBy(desc(messageRequests.createdAt))
		.all();

	return rows.map((r) => {
		const from = db.select().from(users).where(eq(users.id, r.fromUserId)).get();
		return {
			id: r.id,
			note: r.note,
			createdAt: r.createdAt.toISOString(),
			from: from
				? {
						id: from.id,
						username: from.username,
						displayName: from.displayName,
						avatarPath: from.avatarPath
					}
				: null
		};
	});
}

export function acceptMessageRequest(requestId: string, userId: string) {
	const row = db.select().from(messageRequests).where(eq(messageRequests.id, requestId)).get();
	if (!row || row.toUserId !== userId || row.status !== 'pending') {
		throw new Error('Not found');
	}
	db.update(messageRequests)
		.set({ status: 'accepted' })
		.where(eq(messageRequests.id, requestId))
		.run();
	const chatId = createDm(row.fromUserId, row.toUserId);
	publishToUser(row.fromUserId, 'message_request_accepted', { chatId });
	return chatId;
}

export function declineMessageRequest(requestId: string, userId: string) {
	const row = db.select().from(messageRequests).where(eq(messageRequests.id, requestId)).get();
	if (!row || row.toUserId !== userId || row.status !== 'pending') {
		throw new Error('Not found');
	}
	db.update(messageRequests)
		.set({ status: 'declined' })
		.where(eq(messageRequests.id, requestId))
		.run();
}

export function reportUser(reporterId: string, reportedId: string, reason: string) {
	if (reporterId === reportedId) throw new Error('Invalid');
	const id = createId();
	db.insert(userReports)
		.values({
			id,
			reporterId,
			reportedId,
			reason: reason.slice(0, 500),
			createdAt: new Date(),
			resolvedAt: null
		})
		.run();
	return id;
}

export function listOpenReports() {
	return db
		.select({
			id: userReports.id,
			reason: userReports.reason,
			createdAt: userReports.createdAt,
			reporterId: userReports.reporterId,
			reportedId: userReports.reportedId
		})
		.from(userReports)
		.where(isNull(userReports.resolvedAt))
		.orderBy(desc(userReports.createdAt))
		.all()
		.map((r) => {
			const reporter = db.select().from(users).where(eq(users.id, r.reporterId)).get();
			const reported = db.select().from(users).where(eq(users.id, r.reportedId)).get();
			return {
				id: r.id,
				reason: r.reason,
				createdAt: r.createdAt.toISOString(),
				reporter: reporter
					? { id: reporter.id, username: reporter.username }
					: { id: r.reporterId, username: '?' },
				reported: reported
					? { id: reported.id, username: reported.username }
					: { id: r.reportedId, username: '?' }
			};
		});
}

export function resolveReport(id: string) {
	db.update(userReports)
		.set({ resolvedAt: new Date() })
		.where(eq(userReports.id, id))
		.run();
}

export function ensureInviteCode(userId: string): string {
	const u = db.select().from(users).where(eq(users.id, userId)).get();
	if (!u) throw new Error('Not found');
	if (u.inviteCode) return u.inviteCode;
	const code = createId(5).slice(0, 10);
	db.update(users).set({ inviteCode: code }).where(eq(users.id, userId)).run();
	return code;
}

export function findUserByInviteCode(code: string) {
	const c = code.trim().toLowerCase();
	if (!c) return null;
	return db.select().from(users).where(eq(users.inviteCode, c)).get() ?? null;
}

export function deleteMessagesBulk(chatId: string, messageIds: string[], userId: string) {
	const now = new Date();
	const updated: MessageDTO[] = [];
	for (const mid of messageIds) {
		const msg = getMessageById(mid);
		if (!msg || msg.chatId !== chatId || msg.senderId !== userId || msg.deletedAt) continue;
		db.update(messages)
			.set({ deletedAt: now, body: '' })
			.where(eq(messages.id, mid))
			.run();
		const dto = toMessageDTO(getMessageById(mid)!, userId);
		updated.push(dto);
		publishToChat(chatId, 'message_delete', dto);
	}
	return updated;
}

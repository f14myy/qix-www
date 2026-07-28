import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { messages } from '$lib/server/schema';
import {
	getChatMemberIds,
	getMessageById,
	isChatMember,
	toMessageDTO
} from '$lib/server/chats';
import { publishToChat, publishToChatMembers } from '$lib/server/events';
import { canManageGroup } from '$lib/server/groups';
import { and, eq } from 'drizzle-orm';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { id: chatId, mid } = params;
	if (!isChatMember(chatId, locals.user.id)) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const msg = getMessageById(mid);
	if (!msg || msg.chatId !== chatId) return json({ error: 'Not found' }, { status: 404 });
	if (msg.senderId !== locals.user.id) return json({ error: 'Forbidden' }, { status: 403 });
	if (msg.deletedAt) return json({ error: 'Deleted' }, { status: 400 });
	if (msg.kind === 'voice') return json({ error: 'Cannot edit voice' }, { status: 400 });
	// System lines are a record of what happened; the actor does not get to rewrite it.
	if (msg.kind === 'system') return json({ error: 'Cannot edit' }, { status: 400 });

	const body = await request.json().catch(() => null);
	const text = String((body as { body?: unknown })?.body ?? '').trim();
	if (!text) return json({ error: 'Empty' }, { status: 400 });

	db.update(messages)
		.set({ body: text, editedAt: new Date() })
		.where(and(eq(messages.id, mid), eq(messages.chatId, chatId)))
		.run();

	const updated = toMessageDTO(getMessageById(mid)!, locals.user.id);
	publishToChat(chatId, 'message_update', updated);
	return json({ message: updated });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { id: chatId, mid } = params;
	if (!isChatMember(chatId, locals.user.id)) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const msg = getMessageById(mid);
	if (!msg || msg.chatId !== chatId) return json({ error: 'Not found' }, { status: 404 });
	/*
	 * Anyone may delete their own message. In a group, moderators may also delete
	 * someone else's — a room with no way to remove abuse is not moderatable. They
	 * still cannot touch system lines, which are the record of their own actions.
	 */
	const isAuthor = msg.senderId === locals.user.id;
	const canModerate = msg.kind !== 'system' && canManageGroup(chatId, locals.user.id);
	if (!isAuthor && !canModerate) return json({ error: 'Forbidden' }, { status: 403 });

	db.update(messages)
		.set({ deletedAt: new Date(), body: '' })
		.where(eq(messages.id, mid))
		.run();

	const updated = toMessageDTO(getMessageById(mid)!, locals.user.id);
	publishToChat(chatId, 'message_delete', updated);
	publishToChatMembers(getChatMemberIds(chatId), 'chat_update', { chatId });
	return json({ message: updated });
};

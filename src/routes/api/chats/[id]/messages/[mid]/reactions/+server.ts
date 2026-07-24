import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { messageReactions } from '$lib/server/schema';
import {
	REACTION_EMOJIS,
	getMessageById,
	isChatMember,
	toMessageDTO
} from '$lib/server/chats';
import { publishToChat } from '$lib/server/events';
import { and, eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { id: chatId, mid } = params;
	if (!isChatMember(chatId, locals.user.id)) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const msg = getMessageById(mid);
	if (!msg || msg.chatId !== chatId || msg.deletedAt) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const body = await request.json().catch(() => null);
	const emoji = String((body as { emoji?: unknown })?.emoji ?? '');
	if (!(REACTION_EMOJIS as readonly string[]).includes(emoji)) {
		return json({ error: 'Invalid emoji' }, { status: 400 });
	}

	const existing = db
		.select()
		.from(messageReactions)
		.where(
			and(eq(messageReactions.messageId, mid), eq(messageReactions.userId, locals.user.id))
		)
		.get();

	if (existing?.emoji === emoji) {
		db.delete(messageReactions)
			.where(
				and(eq(messageReactions.messageId, mid), eq(messageReactions.userId, locals.user.id))
			)
			.run();
	} else if (existing) {
		db.update(messageReactions)
			.set({ emoji })
			.where(
				and(eq(messageReactions.messageId, mid), eq(messageReactions.userId, locals.user.id))
			)
			.run();
	} else {
		db.insert(messageReactions)
			.values({ messageId: mid, userId: locals.user.id, emoji })
			.run();
	}

	const updated = toMessageDTO(getMessageById(mid)!, locals.user.id);
	publishToChat(chatId, 'reaction', updated);
	return json({ message: updated });
};

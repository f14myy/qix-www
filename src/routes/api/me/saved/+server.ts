import { json } from '@sveltejs/kit';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { getMessageById, isChatMember, toMessageDTO } from '$lib/server/chats';
import { db } from '$lib/server/db';
import { messages, savedMessages } from '$lib/server/schema';

export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const rows = db
		.select({ messageId: savedMessages.messageId })
		.from(savedMessages)
		.where(eq(savedMessages.userId, locals.user.id))
		.orderBy(desc(savedMessages.createdAt))
		.limit(300)
		.all();
	if (!rows.length) return json({ messages: [] });
	const ids = rows.map((row) => row.messageId);
	const byId = new Map(
		db.select().from(messages).where(inArray(messages.id, ids)).all().map((message) => [message.id, message])
	);
	return json({
		messages: ids
			.map((id) => byId.get(id))
			.filter((message): message is NonNullable<typeof message> => !!message)
			.map((message) => toMessageDTO(message, locals.user!.id))
	});
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = await request.json().catch(() => null);
	const messageId = typeof body?.messageId === 'string' ? body.messageId : '';
	const message = messageId ? getMessageById(messageId) : null;
	if (!message || !isChatMember(message.chatId, locals.user.id)) {
		return json({ error: 'Message not found' }, { status: 404 });
	}
	db.insert(savedMessages)
		.values({ userId: locals.user.id, messageId, createdAt: new Date() })
		.onConflictDoNothing()
		.run();
	return json({ saved: true });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = await request.json().catch(() => null);
	const messageId = typeof body?.messageId === 'string' ? body.messageId : '';
	if (!messageId) return json({ error: 'Message id is required' }, { status: 400 });
	db.delete(savedMessages)
		.where(and(eq(savedMessages.userId, locals.user.id), eq(savedMessages.messageId, messageId)))
		.run();
	return json({ saved: false });
};

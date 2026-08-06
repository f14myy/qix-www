import { json } from '@sveltejs/kit';
import { asc, eq, inArray } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { attachments, chatMembers, chats, messages, users } from '$lib/server/schema';

/** Portable data export. File blobs stay on the server; their metadata is included. */
export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const membership = db.select().from(chatMembers).where(eq(chatMembers.userId, locals.user.id)).all();
	const chatIds = membership.map((row) => row.chatId);
	const own = db.select().from(users).where(eq(users.id, locals.user.id)).get();
	const exportedChats = chatIds.length ? db.select().from(chats).where(inArray(chats.id, chatIds)).all() : [];
	const exportedMessages = chatIds.length
		? db.select().from(messages).where(inArray(messages.chatId, chatIds)).orderBy(asc(messages.createdAt)).all()
		: [];
	const messageIds = exportedMessages.map((message) => message.id);
	const exportedAttachments = messageIds.length
		? db.select().from(attachments).where(inArray(attachments.messageId, messageIds)).all()
		: [];
	return new Response(
		JSON.stringify({
			format: 'qix-export',
			version: 1,
			exportedAt: new Date().toISOString(),
			profile: own
				? { username: own.username, displayName: own.displayName, bio: own.bio, createdAt: own.createdAt }
				: null,
			chats: exportedChats,
			messages: exportedMessages,
			attachments: exportedAttachments.map(({ path: _path, ...attachment }) => attachment)
		}),
		{
			headers: {
				'content-type': 'application/json; charset=utf-8',
				'content-disposition': `attachment; filename="qix-export-${new Date().toISOString().slice(0, 10)}.json"`,
				'cache-control': 'no-store'
			}
		}
	);
};

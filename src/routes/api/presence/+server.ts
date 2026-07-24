import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { touchPresence } from '$lib/server/chats';
import { publishToUser } from '$lib/server/events';
import { db } from '$lib/server/db';
import { chatMembers } from '$lib/server/schema';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	touchPresence(locals.user.id);

	const myChats = db
		.select({ chatId: chatMembers.chatId })
		.from(chatMembers)
		.where(eq(chatMembers.userId, locals.user.id))
		.all()
		.map((c) => c.chatId);

	const peerIds = new Set<string>();
	for (const chatId of myChats) {
		const members = db
			.select({ userId: chatMembers.userId })
			.from(chatMembers)
			.where(eq(chatMembers.chatId, chatId))
			.all();
		for (const m of members) {
			if (m.userId !== locals.user.id) peerIds.add(m.userId);
		}
	}

	const now = new Date().toISOString();
	for (const peerId of peerIds) {
		publishToUser(peerId, 'presence', {
			userId: locals.user.id,
			lastSeenAt: now
		});
	}

	return json({ ok: true });
};

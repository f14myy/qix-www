import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isChatMember, markChatRead } from '$lib/server/chats';
import { publishToChat } from '$lib/server/events';

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const chatId = params.id;
	if (!isChatMember(chatId, locals.user.id)) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	markChatRead(chatId, locals.user.id);
	publishToChat(chatId, 'read', {
		userId: locals.user.id,
		readAt: new Date().toISOString()
	});

	return json({ ok: true });
};

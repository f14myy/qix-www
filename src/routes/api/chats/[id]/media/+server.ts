import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isChatMember } from '$lib/server/chats';
import { listChatMedia, searchInChat } from '$lib/server/features';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const chatId = params.id;
	if (!isChatMember(chatId, locals.user.id)) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const q = url.searchParams.get('q');
	if (q != null) {
		return json({ messages: searchInChat(chatId, q) });
	}

	return json({ media: listChatMedia(chatId) });
};

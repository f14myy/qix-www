import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isChatMember } from '$lib/server/chats';
import { forwardMessages } from '$lib/server/features';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const chatId = params.id;
	if (!isChatMember(chatId, locals.user.id)) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const body = await request.json().catch(() => null);
	const targetChatId = String((body as { targetChatId?: unknown })?.targetChatId ?? '');
	const messageIds = Array.isArray((body as { messageIds?: unknown })?.messageIds)
		? ((body as { messageIds: unknown[] }).messageIds as unknown[])
				.map(String)
				.filter(Boolean)
		: [];

	if (!targetChatId || !messageIds.length) {
		return json({ error: 'targetChatId and messageIds required' }, { status: 400 });
	}

	try {
		const messages = await forwardMessages(chatId, targetChatId, messageIds, locals.user.id);
		return json({ messages }, { status: 201 });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 400 });
	}
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isChatMember } from '$lib/server/chats';
import { deleteMessagesBulk } from '$lib/server/features';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const chatId = params.id;
	if (!isChatMember(chatId, locals.user.id)) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const body = await request.json().catch(() => null);
	const messageIds = Array.isArray((body as { messageIds?: unknown })?.messageIds)
		? ((body as { messageIds: unknown[] }).messageIds as unknown[]).map(String).filter(Boolean)
		: [];
	if (!messageIds.length) return json({ error: 'messageIds required' }, { status: 400 });

	const messages = deleteMessagesBulk(chatId, messageIds, locals.user.id);
	return json({ messages });
};

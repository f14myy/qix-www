import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteChatForEveryone, deleteChatForUser, isChatMember } from '$lib/server/chats';
import { getChannelByChatId } from '$lib/server/channels';

export const DELETE: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const chatId = params.id;
	if (getChannelByChatId(chatId)) {
		return json({ error: 'System channels cannot be deleted' }, { status: 403 });
	}

	if (!isChatMember(chatId, locals.user.id)) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const body = await request.json().catch(() => null);
	const mode = (body as { mode?: string })?.mode ?? 'self';

	if (mode === 'everyone') {
		deleteChatForEveryone(chatId, locals.user.id);
	} else {
		deleteChatForUser(chatId, locals.user.id);
	}

	return json({ ok: true });
};

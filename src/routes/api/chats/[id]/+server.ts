import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteChatForEveryone, deleteChatForUser, isChatMember } from '$lib/server/chats';
import { getChatScreenData } from '$lib/server/chatScreen';
import { getChannelByChatId } from '$lib/server/channels';
import { getMemberRole, isGroupChat } from '$lib/server/groups';

/**
 * Everything the chat screen needs, in one request.
 *
 * Shares `getChatScreenData` with the `/chat/[id]` page load, so clients without
 * SSR (the native apps) open a chat with exactly the same data the site renders.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const data = getChatScreenData(params.id, locals.user);
	if (!data) return json({ error: 'Not found' }, { status: 404 });
	return json(data);
};

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
		/*
		 * "Delete for everyone" in a group would let any member destroy the room and
		 * its history. Groups have their own owner-only route for that; here it is
		 * refused rather than silently downgraded, so the client cannot believe the
		 * group is gone when it is not.
		 */
		if (isGroupChat(chatId) && getMemberRole(chatId, locals.user.id) !== 'owner') {
			return json({ error: 'Only the owner can delete this group' }, { status: 403 });
		}
		deleteChatForEveryone(chatId, locals.user.id);
	} else {
		deleteChatForUser(chatId, locals.user.id);
	}

	return json({ ok: true });
};

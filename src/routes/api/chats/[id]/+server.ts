import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	deleteChatForEveryone,
	deleteChatForUser,
	getMessageById,
	getMyLastReadAt,
	getPeer,
	getPeerLastReadAt,
	isChatMember,
	listMessages,
	toMessageDTO
} from '$lib/server/chats';
import { canPostInChat, getChannelByChatId } from '$lib/server/channels';
import { getChatMeta } from '$lib/server/features';
import { isAdmin } from '$lib/admin';

/**
 * Everything the chat screen needs, in one request.
 *
 * Mirrors the `/chat/[id]` page load so clients without SSR (the native apps)
 * open a chat with exactly the same data the site renders. Keep the two in sync.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const chatId = params.id;
	if (!isChatMember(chatId, locals.user.id)) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const channel = getChannelByChatId(chatId);
	const peer = channel ? null : getPeer(chatId, locals.user.id);
	if (!channel && !peer) return json({ error: 'Not found' }, { status: 404 });

	const peerLastReadAt = channel ? null : getPeerLastReadAt(chatId, locals.user.id);
	const myLastReadAt = getMyLastReadAt(chatId, locals.user.id);
	const meta = getChatMeta(chatId);
	const pinnedRow = meta?.pinnedMessageId ? getMessageById(meta.pinnedMessageId) : null;
	const pinnedMessage =
		pinnedRow && !pinnedRow.deletedAt ? toMessageDTO(pinnedRow, locals.user.id) : null;

	return json({
		chatId,
		kind: channel ? 'channel' : 'dm',
		peer,
		channel: channel
			? {
					key: channel.key,
					title: channel.title,
					posting: channel.posting,
					canPost: canPostInChat(chatId, locals.user)
				}
			: null,
		peerLastReadAt: peerLastReadAt ? peerLastReadAt.toISOString() : null,
		myLastReadAt: myLastReadAt ? myLastReadAt.toISOString() : null,
		messages: listMessages(chatId, locals.user.id, 100),
		pinnedMessageId: meta?.pinnedMessageId ?? null,
		disappearAfterSec: meta?.disappearAfterSec ?? 0,
		pinnedMessage,
		isAdmin: isAdmin(locals.user)
	});
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
		deleteChatForEveryone(chatId, locals.user.id);
	} else {
		deleteChatForUser(chatId, locals.user.id);
	}

	return json({ ok: true });
};

import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
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

export const load: PageServerLoad = async ({ params, locals }) => {
	const chatId = params.id;
	if (!isChatMember(chatId, locals.user!.id)) {
		error(404, 'Chat not found');
	}

	const channel = getChannelByChatId(chatId);
	const peer = channel ? null : getPeer(chatId, locals.user!.id);
	if (!channel && !peer) error(404, 'Chat not found');

	const peerLastReadAt = channel ? null : getPeerLastReadAt(chatId, locals.user!.id);
	const myLastReadAt = getMyLastReadAt(chatId, locals.user!.id);
	const meta = getChatMeta(chatId);
	const pinnedRow = meta?.pinnedMessageId ? getMessageById(meta.pinnedMessageId) : null;
	const pinnedMessage =
		pinnedRow && !pinnedRow.deletedAt ? toMessageDTO(pinnedRow, locals.user!.id) : null;

	return {
		chatId,
		kind: channel ? ('channel' as const) : ('dm' as const),
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
		messages: listMessages(chatId, locals.user!.id, 100),
		pinnedMessageId: meta?.pinnedMessageId ?? null,
		disappearAfterSec: meta?.disappearAfterSec ?? 0,
		pinnedMessage,
		isAdmin: isAdmin(locals.user)
	};
};

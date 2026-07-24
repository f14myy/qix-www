import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getPeer, getPeerLastReadAt, isChatMember, listMessages } from '$lib/server/chats';

export const load: PageServerLoad = async ({ params, locals }) => {
	const chatId = params.id;
	if (!isChatMember(chatId, locals.user!.id)) {
		error(404, 'Chat not found');
	}

	const peer = getPeer(chatId, locals.user!.id);
	if (!peer) error(404, 'Chat not found');

	const peerLastReadAt = getPeerLastReadAt(chatId, locals.user!.id);

	return {
		chatId,
		peer,
		peerLastReadAt: peerLastReadAt ? peerLastReadAt.toISOString() : null,
		messages: listMessages(chatId, locals.user!.id, 100)
	};
};

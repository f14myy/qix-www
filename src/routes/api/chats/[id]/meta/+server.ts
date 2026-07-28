import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMessageById, isChatMember } from '$lib/server/chats';
import { getChatMeta, setDisappearAfter, setPinnedMessage } from '$lib/server/features';
import { publishToChat } from '$lib/server/events';
import { canManageGroup, isGroupChat } from '$lib/server/groups';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const chatId = params.id;
	if (!isChatMember(chatId, locals.user.id)) {
		return json({ error: 'Not found' }, { status: 404 });
	}
	const meta = getChatMeta(chatId);
	const pinned = meta?.pinnedMessageId ? getMessageById(meta.pinnedMessageId) : null;
	return json({
		pinnedMessageId: meta?.pinnedMessageId ?? null,
		disappearAfterSec: meta?.disappearAfterSec ?? 0,
		pinnedExists: !!pinned && !pinned.deletedAt
	});
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const chatId = params.id;
	if (!isChatMember(chatId, locals.user.id)) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	/*
	 * Pinning and disappearing messages are chat-wide, so in a group they belong to
	 * whoever moderates it. In a DM both people already share every consequence.
	 */
	if (isGroupChat(chatId) && !canManageGroup(chatId, locals.user.id)) {
		return json({ error: 'Only admins can change this' }, { status: 403 });
	}

	const body = await request.json().catch(() => null);
	try {
		if ('pinnedMessageId' in (body as object)) {
			const mid = (body as { pinnedMessageId: string | null }).pinnedMessageId;
			setPinnedMessage(chatId, mid);
			publishToChat(chatId, 'chat_meta', { pinnedMessageId: mid });
		}
		if (typeof (body as { disappearAfterSec?: unknown })?.disappearAfterSec === 'number') {
			setDisappearAfter(chatId, (body as { disappearAfterSec: number }).disappearAfterSec);
			publishToChat(chatId, 'chat_meta', {
				disappearAfterSec: (body as { disappearAfterSec: number }).disappearAfterSec
			});
		}
		return json({ ok: true });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 400 });
	}
};

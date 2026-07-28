import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fanoutGroupResult } from '$lib/server/groupFanout';
import { createGroup, getGroupInfo, listGroupMembers } from '$lib/server/groups';

/**
 * Creating a group.
 *
 * A static segment under /api/chats, so it never collides with the 32-hex chat
 * ids that /api/chats/[id] matches.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => null)) as {
		title?: unknown;
		memberIds?: unknown;
	} | null;

	const requested = Array.isArray(body?.memberIds)
		? (body.memberIds as unknown[]).map((v) => String(v ?? ''))
		: [];

	const result = createGroup(locals.user.id, body?.title, requested);
	if (result.error || !result.chatId) {
		return json({ error: result.error ?? 'Failed' }, { status: result.status ?? 400 });
	}

	const chatId = result.chatId;
	fanoutGroupResult(chatId, { messageIds: result.messageIds, notify: result.notify });

	return json(
		{
			chatId,
			group: getGroupInfo(chatId, locals.user.id),
			members: listGroupMembers(chatId, locals.user.id)
		},
		{ status: 201 }
	);
};

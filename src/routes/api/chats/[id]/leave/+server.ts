import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { publishToChat } from '$lib/server/events';
import { fanoutGroupResult } from '$lib/server/groupFanout';
import { leaveGroup } from '$lib/server/groups';

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const chatId = params.id;
	const result = leaveGroup(chatId, locals.user.id);
	if (result.error) return json({ error: result.error }, { status: result.status ?? 400 });

	if (result.deleted) {
		// The last member left, so the room is gone rather than merely quieter.
		publishToChat(chatId, 'chat_deleted', { chatId });
	}
	fanoutGroupResult(chatId, result);

	return json({ ok: true, deleted: !!result.deleted });
};

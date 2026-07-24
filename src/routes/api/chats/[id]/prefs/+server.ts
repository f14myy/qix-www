import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isChatMember, setChatPrefs } from '$lib/server/chats';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const chatId = params.id;
	if (!isChatMember(chatId, locals.user.id)) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const body = await request.json().catch(() => null);
	const pinned = (body as { pinned?: unknown })?.pinned;
	const muted = (body as { muted?: unknown })?.muted;
	const archived = (body as { archived?: unknown })?.archived;

	setChatPrefs(chatId, locals.user.id, {
		pinned: typeof pinned === 'boolean' ? pinned : undefined,
		muted: typeof muted === 'boolean' ? muted : undefined,
		archived: typeof archived === 'boolean' ? archived : undefined
	});

	return json({ ok: true });
};

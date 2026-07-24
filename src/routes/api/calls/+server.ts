import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getUserCall, startCall, toCallDTO } from '$lib/server/calls';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const call = getUserCall(locals.user.id);
	if (!call || call.status === 'ended') return json({ call: null });
	return json({ call: toCallDTO(call, locals.user.id) });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = await request.json().catch(() => null);
	const chatId = String((body as { chatId?: unknown })?.chatId ?? '');
	const video = !!(body as { video?: unknown })?.video;
	if (!chatId) return json({ error: 'chatId required' }, { status: 400 });

	try {
		const call = startCall(chatId, locals.user.id, video);
		return json({ call: toCallDTO(call, locals.user.id) }, { status: 201 });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 400 });
	}
};

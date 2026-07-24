import type { RequestHandler } from './$types';
import { isChatMember, touchPresence } from '$lib/server/chats';
import { subscribe } from '$lib/server/events';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), {
			status: 401,
			headers: { 'content-type': 'application/json' }
		});
	}

	const chatId = params.id;
	if (!isChatMember(chatId, locals.user.id)) {
		return new Response(JSON.stringify({ error: 'Not found' }), {
			status: 404,
			headers: { 'content-type': 'application/json' }
		});
	}

	touchPresence(locals.user.id);
	const stream = subscribe(locals.user.id, chatId);

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive'
		}
	});
};

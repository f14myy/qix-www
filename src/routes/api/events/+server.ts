import type { RequestHandler } from './$types';
import { subscribe } from '$lib/server/events';
import { touchPresence } from '$lib/server/chats';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), {
			status: 401,
			headers: { 'content-type': 'application/json' }
		});
	}

	touchPresence(locals.user.id);
	const stream = subscribe(locals.user.id, null);

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive'
		}
	});
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { globalSearch } from '$lib/server/chats';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const q = (url.searchParams.get('q') ?? '').trim();
	if (!q) return json({ chats: [], people: [], messages: [] });

	return json(globalSearch(locals.user.id, q));
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchUsers } from '$lib/server/chats';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const q = url.searchParams.get('q') ?? '';
	const results = searchUsers(q, locals.user.id);
	return json({ users: results });
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listBlockedUsers, unblockUser } from '$lib/server/settings';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const userId = params.userId;
	if (!userId) return json({ error: 'Missing user' }, { status: 400 });

	unblockUser(locals.user.id, userId);
	return json({ blocked: listBlockedUsers(locals.user.id) });
};

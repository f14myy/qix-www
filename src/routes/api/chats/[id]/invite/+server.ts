import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGroupInfo, rotateGroupInviteCode } from '$lib/server/groups';

/**
 * Rotates the join link.
 *
 * A reset is the only way to revoke a link that has escaped, so this is the
 * revocation button as much as it is the refresh button.
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const result = rotateGroupInviteCode(params.id, locals.user.id);
	if (result.error) return json({ error: result.error }, { status: result.status ?? 400 });

	return json({ code: result.code, group: getGroupInfo(params.id, locals.user.id) });
};

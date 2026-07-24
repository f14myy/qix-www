import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ensureInviteCode, findUserByInviteCode } from '$lib/server/features';

export const GET: RequestHandler = async ({ url, locals }) => {
	const code = url.searchParams.get('code');
	if (code) {
		const user = findUserByInviteCode(code);
		if (!user || user.bannedAt) return json({ error: 'Invalid invite' }, { status: 404 });
		return json({
			user: {
				id: user.id,
				username: user.username,
				displayName: user.displayName,
				avatarPath: user.avatarPath
			}
		});
	}

	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const inviteCode = ensureInviteCode(locals.user.id);
	return json({ inviteCode, path: `/invite/${inviteCode}` });
};

import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { findUserByInviteCode } from '$lib/server/features';

export const load: PageServerLoad = async ({ params }) => {
	const user = findUserByInviteCode(params.code);
	if (!user || user.bannedAt) error(404, 'Invalid invite');
	return {
		profile: {
			id: user.id,
			username: user.username,
			displayName: user.displayName,
			avatarPath: user.avatarPath
		},
		code: params.code
	};
};

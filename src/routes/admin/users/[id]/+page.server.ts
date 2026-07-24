import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getAdminUser } from '$lib/server/admin';

export const load: PageServerLoad = async ({ params }) => {
	const user = getAdminUser(params.id);
	if (!user) error(404, 'Not found');
	return { profile: user };
};

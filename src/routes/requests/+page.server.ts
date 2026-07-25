import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listIncomingRequests } from '$lib/server/features';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	return {
		requests: listIncomingRequests(locals.user.id)
	};
};

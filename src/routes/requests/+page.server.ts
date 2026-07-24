import type { PageServerLoad } from './$types';
import { listIncomingRequests } from '$lib/server/features';

export const load: PageServerLoad = async ({ locals }) => {
	return {
		requests: listIncomingRequests(locals.user!.id)
	};
};

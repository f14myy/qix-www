import type { PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/admin';
import { listOpenReports } from '$lib/server/features';

export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals.user);
	return { reports: listOpenReports() };
};

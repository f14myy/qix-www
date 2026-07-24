import type { PageServerLoad } from './$types';
import { getAdminStats } from '$lib/server/admin';

export const load: PageServerLoad = async () => {
	return { stats: getAdminStats() };
};

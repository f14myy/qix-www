import type { PageServerLoad } from './$types';
import { listAdminBans } from '$lib/server/admin';

export const load: PageServerLoad = async () => {
	return { bans: listAdminBans() };
};

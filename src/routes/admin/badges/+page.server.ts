import type { PageServerLoad } from './$types';
import { listBadgesWithHolders } from '$lib/server/badges';

export const load: PageServerLoad = async () => {
	return { badges: listBadgesWithHolders() };
};

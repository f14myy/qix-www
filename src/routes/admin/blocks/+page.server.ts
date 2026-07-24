import type { PageServerLoad } from './$types';
import { listAdminBlocks } from '$lib/server/admin';

export const load: PageServerLoad = async ({ url }) => {
	const page = Number(url.searchParams.get('page') ?? '1') || 1;
	return listAdminBlocks({ page });
};

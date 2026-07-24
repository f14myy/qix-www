import type { PageServerLoad } from './$types';
import { listAdminMessages } from '$lib/server/admin';

export const load: PageServerLoad = async ({ url }) => {
	const q = url.searchParams.get('q') ?? '';
	const username = url.searchParams.get('username') ?? '';
	const page = Number(url.searchParams.get('page') ?? '1') || 1;
	return listAdminMessages({ q, username, page });
};

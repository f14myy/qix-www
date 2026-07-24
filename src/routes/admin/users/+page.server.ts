import type { PageServerLoad } from './$types';
import type { AdminUserFilter, AdminUserSort } from '$lib/admin';
import { listAdminUsers } from '$lib/server/admin';

export const load: PageServerLoad = async ({ url }) => {
	const q = url.searchParams.get('q') ?? '';
	const page = Number(url.searchParams.get('page') ?? '1') || 1;
	const filter = (url.searchParams.get('filter') ?? 'all') as AdminUserFilter;
	const sort = (url.searchParams.get('sort') ?? 'created') as AdminUserSort;
	return listAdminUsers({ q, page, filter, sort });
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listAdminUsers, requireAdmin } from '$lib/server/admin';
import type { AdminUserFilter, AdminUserSort } from '$lib/admin';

export const GET: RequestHandler = async ({ locals, url }) => {
	requireAdmin(locals.user);
	const q = url.searchParams.get('q') ?? '';
	const page = Number(url.searchParams.get('page') ?? '1') || 1;
	const filter = (url.searchParams.get('filter') ?? 'all') as AdminUserFilter;
	const sort = (url.searchParams.get('sort') ?? 'created') as AdminUserSort;
	return json(listAdminUsers({ q, page, filter, sort }));
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listAdminMessages, requireAdmin } from '$lib/server/admin';

export const GET: RequestHandler = async ({ locals, url }) => {
	requireAdmin(locals.user);
	const q = url.searchParams.get('q') ?? '';
	const username = url.searchParams.get('username') ?? '';
	const page = Number(url.searchParams.get('page') ?? '1') || 1;
	return json(listAdminMessages({ q, username, page }));
};

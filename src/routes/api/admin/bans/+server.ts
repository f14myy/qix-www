import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listAdminBans, requireAdmin } from '$lib/server/admin';

export const GET: RequestHandler = async ({ locals }) => {
	requireAdmin(locals.user);
	return json({ bans: listAdminBans() });
};

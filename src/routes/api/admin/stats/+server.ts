import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminStats, requireAdmin } from '$lib/server/admin';

export const GET: RequestHandler = async ({ locals }) => {
	requireAdmin(locals.user);
	return json({ stats: getAdminStats() });
};

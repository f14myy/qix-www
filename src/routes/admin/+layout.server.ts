import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { isAdmin } from '$lib/server/admin';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user || !isAdmin(locals.user)) error(403, 'Forbidden');
	return {};
};

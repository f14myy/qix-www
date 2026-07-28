import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getChatScreenData } from '$lib/server/chatScreen';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) redirect(303, '/login');
	const data = getChatScreenData(params.id, locals.user);
	if (!data) error(404, 'Chat not found');
	return data;
};

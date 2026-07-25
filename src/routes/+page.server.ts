import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listChatsForUser } from '$lib/server/chats';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	return {
		chats: listChatsForUser(locals.user.id)
	};
};

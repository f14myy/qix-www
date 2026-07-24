import type { PageServerLoad } from './$types';
import { listChatsForUser } from '$lib/server/chats';

export const load: PageServerLoad = async ({ locals }) => {
	return {
		chats: listChatsForUser(locals.user!.id)
	};
};

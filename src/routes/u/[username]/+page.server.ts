import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { normalizeUsername } from '$lib/server/auth';
import { toPublicProfile } from '$lib/server/chats';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ params, locals }) => {
	const username = normalizeUsername(params.username);
	const user = db.select().from(users).where(eq(users.username, username)).get();
	if (!user) error(404, 'Not found');

	return {
		profile: toPublicProfile(user),
		isSelf: user.id === locals.user!.id
	};
};

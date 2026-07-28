import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { toPublicProfile } from '$lib/server/chats';
import { normalizeHex } from '$lib/profileTheme';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) error(401, 'Unauthorized');
	const user = db.select().from(users).where(eq(users.id, locals.user.id)).get();
	if (!user) error(404, 'Not found');
	return {
		profile: toPublicProfile(user),
		// Unmerged, unlike the public projection: the editor has to know which of
		// the two sampled colours is which, so that removing an image clears the
		// right one and falls back to the other.
		auto: {
			banner: normalizeHex(user.profileAutoBanner),
			avatar: normalizeHex(user.profileAutoAvatar)
		}
	};
};

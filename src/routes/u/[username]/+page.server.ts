import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { normalizeUsername } from '$lib/server/auth';
import { findDmChatId, toPublicProfile } from '$lib/server/chats';
import { isBlockedBy, isBlockedEither, canSeeProfileDetails } from '$lib/server/settings';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ params, locals }) => {
	const username = normalizeUsername(params.username);
	const user = db.select().from(users).where(eq(users.username, username)).get();
	if (!user) error(404, 'Not found');

	const me = locals.user!.id;
	const isSelf = user.id === me;
	const blockedByMe = isBlockedBy(me, user.id);
	const blocked = isBlockedEither(me, user.id);
	const canSeeDetails = isSelf || canSeeProfileDetails(user.id, me);

	const profile = toPublicProfile(user, me);
	if (!canSeeDetails) {
		profile.bio = null;
		profile.avatarPath = null;
		profile.bannerPath = null;
		profile.displayName = null;
	}

	return {
		profile,
		isSelf,
		blockedByMe,
		blocked,
		profileLimited: !canSeeDetails,
		existingChatId: isSelf || blocked ? null : findDmChatId(me, user.id)
	};
};

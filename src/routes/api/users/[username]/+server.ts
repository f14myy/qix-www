import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { normalizeUsername } from '$lib/server/auth';
import { findDmChatId, toPublicProfile } from '$lib/server/chats';
import { canSeeProfileDetails, isBlockedBy, isBlockedEither } from '$lib/server/settings';
import { eq } from 'drizzle-orm';

/**
 * Mirrors the `/u/[username]` page load so clients without SSR (the native apps)
 * can render the same profile screen. Kept in sync deliberately: the visibility
 * trimming below is what enforces `profileVisibility`, so it must not be dropped
 * here just because this is "the API".
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const username = normalizeUsername(params.username);
	const user = db.select().from(users).where(eq(users.username, username)).get();
	if (!user) return json({ error: 'Not found' }, { status: 404 });

	const me = locals.user.id;
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

	return json({
		profile,
		isSelf,
		blockedByMe,
		blocked,
		profileLimited: !canSeeDetails,
		existingChatId: isSelf || blocked ? null : findDmChatId(me, user.id)
	});
};

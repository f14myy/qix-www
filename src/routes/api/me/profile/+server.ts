import { json } from '@sveltejs/kit';
import { unlink, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import type { RequestHandler } from './$types';
import { db, uploadsDir } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { createId } from '$lib/server/id';
import { toPublicProfile } from '$lib/server/chats';
import {
	normalizeHex,
	normalizeProfileStyle,
	type ProfileAutoColors,
	type ProfileStyle
} from '$lib/profileTheme';
import { eq } from 'drizzle-orm';

/**
 * The owner's own view of the sampled colours, unmerged — the editor needs both
 * so that removing the banner can fall back to the avatar's colour. Viewers of
 * someone else's profile only ever get the merged `profileAutoColor`.
 */
function autoColors(user: typeof users.$inferSelect): ProfileAutoColors {
	return {
		banner: normalizeHex(user.profileAutoBanner),
		avatar: normalizeHex(user.profileAutoAvatar)
	};
}

async function removeStoredUpload(path: string | null | undefined, prefix: string) {
	if (!path || !path.startsWith(prefix)) return;
	try {
		await unlink(join(uploadsDir, path));
	} catch {
		/* already gone */
	}
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const user = db.select().from(users).where(eq(users.id, locals.user.id)).get();
	if (!user) return json({ error: 'Not found' }, { status: 404 });
	return json({ profile: toPublicProfile(user), auto: autoColors(user) });
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const contentType = request.headers.get('content-type') ?? '';
	let displayName: string | null | undefined;
	let bio: string | null | undefined;
	let avatarFile: File | null = null;
	let bannerFile: File | null = null;
	let removeAvatar = false;
	let removeBanner = false;
	/** Profile colouring — see $lib/profileTheme. All four are optional. */
	let profileStyle: ProfileStyle | undefined;
	let profileColor: string | null | undefined;
	let profileColor2: string | null | undefined;
	/** Sampled in the browser from the file being uploaded, in the same request. */
	let autoBanner: string | null | undefined;
	let autoAvatar: string | null | undefined;

	/** Shared by the multipart and JSON branches. `''` means "clear it". */
	function readTheme(get: (key: string) => unknown, has: (key: string) => boolean) {
		if (has('profileStyle')) profileStyle = normalizeProfileStyle(get('profileStyle'));
		if (has('profileColor')) profileColor = normalizeHex(get('profileColor'));
		if (has('profileColor2')) profileColor2 = normalizeHex(get('profileColor2'));
		if (has('autoBannerColor')) autoBanner = normalizeHex(get('autoBannerColor'));
		if (has('autoAvatarColor')) autoAvatar = normalizeHex(get('autoAvatarColor'));
	}

	if (contentType.includes('multipart/form-data')) {
		const form = await request.formData();
		if (form.has('displayName')) {
			displayName = String(form.get('displayName') ?? '').trim().slice(0, 40) || null;
		}
		if (form.has('bio')) {
			bio = String(form.get('bio') ?? '').trim().slice(0, 160) || null;
		}
		const av = form.get('avatar');
		if (av instanceof File && av.size > 0) avatarFile = av;
		const bn = form.get('banner');
		if (bn instanceof File && bn.size > 0) bannerFile = bn;
		const remove = form.get('removeAvatar');
		if (remove === '1' || remove === 'true') removeAvatar = true;
		const removeBn = form.get('removeBanner');
		if (removeBn === '1' || removeBn === 'true') removeBanner = true;
		readTheme(
			(k) => form.get(k),
			(k) => form.has(k)
		);
	} else {
		const body = await request.json().catch(() => null);
		if (body && typeof body === 'object') {
			const b = body as Record<string, unknown>;
			if ('displayName' in b) {
				displayName = String(b.displayName ?? '').trim().slice(0, 40) || null;
			}
			if ('bio' in b) {
				bio = String(b.bio ?? '').trim().slice(0, 160) || null;
			}
			if (b.removeAvatar === true || b.removeAvatar === 1 || b.removeAvatar === '1') {
				removeAvatar = true;
			}
			if (b.removeBanner === true || b.removeBanner === 1 || b.removeBanner === '1') {
				removeBanner = true;
			}
			readTheme(
				(k) => b[k],
				(k) => k in b
			);
		}
	}

	const current = db.select().from(users).where(eq(users.id, locals.user.id)).get();
	if (!current) return json({ error: 'Not found' }, { status: 404 });

	const patch: {
		displayName?: string | null;
		bio?: string | null;
		avatarPath?: string | null;
		bannerPath?: string | null;
		profileStyle?: ProfileStyle;
		profileColor?: string | null;
		profileColor2?: string | null;
		profileAutoBanner?: string | null;
		profileAutoAvatar?: string | null;
	} = {};
	if (displayName !== undefined) patch.displayName = displayName;
	if (bio !== undefined) patch.bio = bio;
	if (profileStyle !== undefined) patch.profileStyle = profileStyle;
	if (profileColor !== undefined) patch.profileColor = profileColor;
	if (profileColor2 !== undefined) patch.profileColor2 = profileColor2;
	if (autoBanner !== undefined) patch.profileAutoBanner = autoBanner;
	if (autoAvatar !== undefined) patch.profileAutoAvatar = autoAvatar;

	if (avatarFile) {
		if (avatarFile.size > 5 * 1024 * 1024) {
			return json({ error: 'Avatar too large (max 5 MB)' }, { status: 400 });
		}
		const mime = avatarFile.type || '';
		if (!mime.startsWith('image/')) {
			return json({ error: 'Avatar must be an image' }, { status: 400 });
		}
		const attId = createId();
		const ext = extname(avatarFile.name).slice(0, 8) || '.jpg';
		const stored = `avatar_${attId}${ext}`;
		await writeFile(join(uploadsDir, stored), Buffer.from(await avatarFile.arrayBuffer()));
		await removeStoredUpload(current.avatarPath, 'avatar_');
		patch.avatarPath = stored;
	} else if (removeAvatar) {
		await removeStoredUpload(current.avatarPath, 'avatar_');
		patch.avatarPath = null;
		// The sampled colour describes an image that no longer exists.
		patch.profileAutoAvatar = null;
	}

	if (bannerFile) {
		if (bannerFile.size > 8 * 1024 * 1024) {
			return json({ error: 'Banner too large (max 8 MB)' }, { status: 400 });
		}
		const mime = bannerFile.type || '';
		if (!mime.startsWith('image/')) {
			return json({ error: 'Banner must be an image' }, { status: 400 });
		}
		const attId = createId();
		const ext = extname(bannerFile.name).slice(0, 8) || '.jpg';
		const stored = `banner_${attId}${ext}`;
		await writeFile(join(uploadsDir, stored), Buffer.from(await bannerFile.arrayBuffer()));
		await removeStoredUpload(current.bannerPath, 'banner_');
		patch.bannerPath = stored;
	} else if (removeBanner) {
		await removeStoredUpload(current.bannerPath, 'banner_');
		patch.bannerPath = null;
		patch.profileAutoBanner = null;
	}

	if (Object.keys(patch).length) {
		db.update(users).set(patch).where(eq(users.id, locals.user.id)).run();
	}

	const user = db.select().from(users).where(eq(users.id, locals.user.id)).get()!;
	return json({ profile: toPublicProfile(user), auto: autoColors(user) });
};

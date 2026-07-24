import { json } from '@sveltejs/kit';
import { unlink, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import type { RequestHandler } from './$types';
import { db, uploadsDir } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { createId } from '$lib/server/id';
import { toPublicProfile } from '$lib/server/chats';
import { eq } from 'drizzle-orm';

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
	return json({ profile: toPublicProfile(user) });
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
	} else {
		const body = await request.json().catch(() => null);
		if (body && typeof body === 'object') {
			const b = body as {
				displayName?: unknown;
				bio?: unknown;
				removeAvatar?: unknown;
				removeBanner?: unknown;
			};
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
		}
	}

	const current = db.select().from(users).where(eq(users.id, locals.user.id)).get();
	if (!current) return json({ error: 'Not found' }, { status: 404 });

	const patch: {
		displayName?: string | null;
		bio?: string | null;
		avatarPath?: string | null;
		bannerPath?: string | null;
	} = {};
	if (displayName !== undefined) patch.displayName = displayName;
	if (bio !== undefined) patch.bio = bio;

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
	}

	if (Object.keys(patch).length) {
		db.update(users).set(patch).where(eq(users.id, locals.user.id)).run();
	}

	const user = db.select().from(users).where(eq(users.id, locals.user.id)).get()!;
	return json({ profile: toPublicProfile(user) });
};

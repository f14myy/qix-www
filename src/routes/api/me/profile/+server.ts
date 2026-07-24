import { json } from '@sveltejs/kit';
import { writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import type { RequestHandler } from './$types';
import { db, uploadsDir } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { createId } from '$lib/server/id';
import { toPublicProfile } from '$lib/server/chats';
import { eq } from 'drizzle-orm';

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
	} else {
		const body = await request.json().catch(() => null);
		if (body && typeof body === 'object') {
			if ('displayName' in body) {
				displayName = String((body as { displayName?: unknown }).displayName ?? '')
					.trim()
					.slice(0, 40) || null;
			}
			if ('bio' in body) {
				bio = String((body as { bio?: unknown }).bio ?? '').trim().slice(0, 160) || null;
			}
		}
	}

	const patch: {
		displayName?: string | null;
		bio?: string | null;
		avatarPath?: string;
	} = {};
	if (displayName !== undefined) patch.displayName = displayName;
	if (bio !== undefined) patch.bio = bio;

	if (avatarFile) {
		if (avatarFile.size > 5 * 1024 * 1024) {
			return json({ error: 'Avatar too large' }, { status: 400 });
		}
		const mime = avatarFile.type || '';
		if (!mime.startsWith('image/')) {
			return json({ error: 'Avatar must be an image' }, { status: 400 });
		}
		const attId = createId();
		const ext = extname(avatarFile.name).slice(0, 8) || '.jpg';
		const stored = `avatar_${attId}${ext}`;
		await writeFile(join(uploadsDir, stored), Buffer.from(await avatarFile.arrayBuffer()));
		patch.avatarPath = stored;
	}

	if (Object.keys(patch).length) {
		db.update(users).set(patch).where(eq(users.id, locals.user.id)).run();
	}

	const user = db.select().from(users).where(eq(users.id, locals.user.id)).get()!;
	return json({ profile: toPublicProfile(user) });
};

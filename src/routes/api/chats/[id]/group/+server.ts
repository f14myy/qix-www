import { json } from '@sveltejs/kit';
import { unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { RequestHandler } from './$types';
import { deleteChatForEveryone } from '$lib/server/chats';
import { db, uploadsDir } from '$lib/server/db';
import { publishToChat, publishToChatMembers } from '$lib/server/events';
import { fanoutGroupResult } from '$lib/server/groupFanout';
import { createId } from '$lib/server/id';
import {
	getGroup,
	getGroupInfo,
	getMemberRole,
	listGroupMembers,
	setGroupPhoto,
	updateGroup,
	type GroupResult
} from '$lib/server/groups';
import { chatMembers } from '$lib/server/schema';
import { eq } from 'drizzle-orm';

const MAX_PHOTO_SIZE = 5 * 1024 * 1024;

async function removeStoredPhoto(path: string | null | undefined) {
	// Guarded by the prefix so a malformed row can never point unlink at a message
	// attachment or an avatar.
	if (!path || !path.startsWith('group_')) return;
	try {
		await unlink(join(uploadsDir, path));
	} catch {
		/* already gone */
	}
}

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const group = getGroupInfo(params.id, locals.user.id);
	if (!group) return json({ error: 'Not found' }, { status: 404 });
	return json({ group, members: listGroupMembers(params.id, locals.user.id) });
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const chatId = params.id;
	const current = getGroup(chatId);
	if (!current) return json({ error: 'Not found' }, { status: 404 });
	const role = getMemberRole(chatId, locals.user.id);
	if (!role) return json({ error: 'Not found' }, { status: 404 });
	if (role === 'member') return json({ error: 'Only admins can edit this group' }, { status: 403 });

	const contentType = request.headers.get('content-type') ?? '';
	const patch: {
		title?: unknown;
		description?: unknown;
		posting?: unknown;
		inviting?: unknown;
	} = {};
	let photoFile: File | null = null;
	let removePhoto = false;

	if (contentType.includes('multipart/form-data')) {
		const form = await request.formData();
		if (form.has('title')) patch.title = form.get('title');
		if (form.has('description')) patch.description = form.get('description');
		if (form.has('posting')) patch.posting = form.get('posting');
		if (form.has('inviting')) patch.inviting = form.get('inviting');
		const photo = form.get('photo');
		if (photo instanceof File && photo.size > 0) photoFile = photo;
		const rm = form.get('removePhoto');
		if (rm === '1' || rm === 'true') removePhoto = true;
	} else {
		const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
		if (body && typeof body === 'object') {
			if ('title' in body) patch.title = body.title;
			if ('description' in body) patch.description = body.description;
			if ('posting' in body) patch.posting = body.posting;
			if ('inviting' in body) patch.inviting = body.inviting;
			if (body.removePhoto === true || body.removePhoto === '1') removePhoto = true;
		}
	}

	/*
	 * Photo first: it can fail on size or type, and failing after the rename has
	 * already been written would leave the group half-edited with no way for the
	 * client to tell which half landed.
	 */
	let photoResult: GroupResult | null = null;
	if (photoFile) {
		if (photoFile.size > MAX_PHOTO_SIZE) {
			return json({ error: 'Photo too large (max 5 MB)' }, { status: 400 });
		}
		if (!(photoFile.type || '').startsWith('image/')) {
			return json({ error: 'Photo must be an image' }, { status: 400 });
		}
		const ext = extname(photoFile.name).slice(0, 8) || '.jpg';
		const stored = `group_${createId()}${ext}`;
		await writeFile(join(uploadsDir, stored), Buffer.from(await photoFile.arrayBuffer()));
		await removeStoredPhoto(current.avatarPath);
		photoResult = setGroupPhoto(chatId, locals.user.id, stored);
	} else if (removePhoto && current.avatarPath) {
		await removeStoredPhoto(current.avatarPath);
		photoResult = setGroupPhoto(chatId, locals.user.id, null);
	}

	const textResult = Object.keys(patch).length
		? updateGroup(chatId, locals.user.id, patch)
		: null;

	if (textResult?.error) {
		return json({ error: textResult.error }, { status: textResult.status ?? 400 });
	}
	if (photoResult?.error) {
		return json({ error: photoResult.error }, { status: photoResult.status ?? 400 });
	}

	for (const result of [photoResult, textResult]) {
		if (result) fanoutGroupResult(chatId, result);
	}

	return json({
		group: getGroupInfo(chatId, locals.user.id),
		members: listGroupMembers(chatId, locals.user.id)
	});
};

/** Owner-only: delete the group and every message in it, for everyone. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const chatId = params.id;
	const group = getGroup(chatId);
	if (!group) return json({ error: 'Not found' }, { status: 404 });
	if (getMemberRole(chatId, locals.user.id) !== 'owner') {
		return json({ error: 'Only the owner can delete this group' }, { status: 403 });
	}

	// Captured before the rows go away — afterwards there is nobody left to tell.
	const notify = db
		.select({ userId: chatMembers.userId })
		.from(chatMembers)
		.where(eq(chatMembers.chatId, chatId))
		.all()
		.map((r) => r.userId);

	await removeStoredPhoto(group.avatarPath);
	deleteChatForEveryone(chatId, locals.user.id);

	publishToChat(chatId, 'chat_deleted', { chatId });
	publishToChatMembers(notify, 'chat_update', { chatId });

	return json({ ok: true });
};

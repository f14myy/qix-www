import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getUserSettings,
	updateUserSettings,
	type LastSeenVisibility,
	type ProfileVisibility,
	type WhoCanMessage
} from '$lib/server/settings';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	return json({ settings: getUserSettings(locals.user.id) });
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body !== 'object') {
		return json({ error: 'Invalid body' }, { status: 400 });
	}

	const patch: Parameters<typeof updateUserSettings>[1] = {};

	const boolKeys = [
		'notifyMessages',
		'notifyReactions',
		'notifySound',
		'haptics',
		'sendWithEnter',
		'linkPreviews',
		'confirmMessageDelete',
		'autoPlayVoice',
		'readReceipts',
		'showTyping',
		'lastSeenReciprocity'
	] as const;

	for (const key of boolKeys) {
		if (typeof body[key] === 'boolean') patch[key] = body[key];
	}

	if (
		body.lastSeenVisibility === 'everyone' ||
		body.lastSeenVisibility === 'chats' ||
		body.lastSeenVisibility === 'nobody'
	) {
		patch.lastSeenVisibility = body.lastSeenVisibility as LastSeenVisibility;
	}

	if (
		body.whoCanMessage === 'everyone' ||
		body.whoCanMessage === 'chats' ||
		body.whoCanMessage === 'nobody'
	) {
		patch.whoCanMessage = body.whoCanMessage as WhoCanMessage;
	}

	if (
		body.profileVisibility === 'everyone' ||
		body.profileVisibility === 'chats' ||
		body.profileVisibility === 'nobody'
	) {
		patch.profileVisibility = body.profileVisibility as ProfileVisibility;
	}

	const settings = updateUserSettings(locals.user.id, patch);
	return json({ settings });
};

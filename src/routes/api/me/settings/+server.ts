import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getUserSettings,
	updateUserSettings,
	type LastSeenVisibility,
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
		'haptics',
		'sendWithEnter',
		'linkPreviews',
		'readReceipts',
		'showTyping'
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

	if (body.whoCanMessage === 'everyone' || body.whoCanMessage === 'chats') {
		patch.whoCanMessage = body.whoCanMessage as WhoCanMessage;
	}

	const settings = updateUserSettings(locals.user.id, patch);
	return json({ settings });
};

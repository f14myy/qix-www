import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteSubscription, isPushConfigured, saveSubscription } from '$lib/server/push';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!isPushConfigured()) {
		return json({ error: 'Push not configured' }, { status: 503 });
	}

	const body = await request.json().catch(() => null);
	const endpoint = String((body as { endpoint?: unknown })?.endpoint ?? '');
	const keys = (body as { keys?: { p256dh?: unknown; auth?: unknown } })?.keys;
	const p256dh = String(keys?.p256dh ?? '');
	const auth = String(keys?.auth ?? '');

	if (!endpoint || !p256dh || !auth) {
		return json({ error: 'Invalid subscription' }, { status: 400 });
	}

	saveSubscription(locals.user.id, { endpoint, keys: { p256dh, auth } });
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => null);
	const endpoint = String((body as { endpoint?: unknown })?.endpoint ?? '');
	if (!endpoint) return json({ error: 'Invalid subscription' }, { status: 400 });

	deleteSubscription(locals.user.id, endpoint);
	return json({ ok: true });
};

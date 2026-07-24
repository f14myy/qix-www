import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getVapidPublicKey, isPushConfigured } from '$lib/server/push';

export const GET: RequestHandler = async () => {
	if (!isPushConfigured()) {
		return json({ error: 'Push not configured' }, { status: 503 });
	}
	return json({ publicKey: getVapidPublicKey() });
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/admin';
import { createBadge, listBadgesWithHolders } from '$lib/server/badges';

export const GET: RequestHandler = async ({ locals }) => {
	requireAdmin(locals.user);
	// Holders are included so the native admin screen can render the same list
	// the SSR page builds. Additive — `id`/`label`/`color` are unchanged.
	return json({ badges: listBadgesWithHolders() });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	requireAdmin(locals.user);
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return json({ error: 'Invalid request' }, { status: 400 });
	}
	const label = String((body as { label?: unknown }).label ?? '');
	const color = String((body as { color?: unknown }).color ?? '#6b7280');
	const result = createBadge(label, color);
	if ('error' in result) return json({ error: result.error }, { status: 400 });
	return json({ badge: result });
};

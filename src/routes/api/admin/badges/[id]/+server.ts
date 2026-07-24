import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/admin';
import { deleteBadge, grantBadge, revokeBadge, updateBadge } from '$lib/server/badges';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	requireAdmin(locals.user);
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return json({ error: 'Invalid request' }, { status: 400 });
	}
	const patch: { label?: string; color?: string } = {};
	if ('label' in body) patch.label = String((body as { label?: unknown }).label ?? '');
	if ('color' in body) patch.color = String((body as { color?: unknown }).color ?? '');
	const result = updateBadge(params.id, patch);
	if ('error' in result) return json({ error: result.error }, { status: 404 });
	return json({ badge: result });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
	requireAdmin(locals.user);
	const body = await request.json().catch(() => null);
	const action =
		body && typeof body === 'object' ? String((body as { action?: unknown }).action ?? '') : '';

	if (action === 'grant') {
		const username =
			body && typeof body === 'object'
				? String((body as { username?: unknown }).username ?? '')
				: '';
		const result = grantBadge(params.id, username);
		if ('error' in result) {
			const status = result.error === 'User not found' || result.error === 'Badge not found' ? 404 : 400;
			return json({ error: result.error }, { status });
		}
		return json(result);
	}

	if (action === 'revoke') {
		const userId =
			body && typeof body === 'object' ? String((body as { userId?: unknown }).userId ?? '') : '';
		if (!userId) return json({ error: 'userId required' }, { status: 400 });
		const result = revokeBadge(params.id, userId);
		if ('error' in result) return json({ error: result.error }, { status: 404 });
		return json(result);
	}

	return json({ error: 'Unknown action' }, { status: 400 });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	requireAdmin(locals.user);
	const result = deleteBadge(params.id);
	if ('error' in result) return json({ error: result.error }, { status: 404 });
	return json({ ok: true });
};

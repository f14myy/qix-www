import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	banUser,
	deleteUserAccount,
	getAdminUser,
	requireAdmin,
	revokeAllSessions,
	unbanUser
} from '$lib/server/admin';

export const GET: RequestHandler = async ({ locals, params }) => {
	requireAdmin(locals.user);
	const user = getAdminUser(params.id);
	if (!user) return json({ error: 'Not found' }, { status: 404 });
	return json({ user });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	requireAdmin(locals.user);
	const result = await deleteUserAccount(params.id, locals.user.username);
	if (!result.ok) return json({ error: result.error }, { status: 400 });
	return json({ ok: true });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
	requireAdmin(locals.user);
	const body = await request.json().catch(() => null);
	const action = body && typeof body === 'object' ? String((body as { action?: unknown }).action ?? '') : '';

	if (action === 'ban') {
		const reason =
			body && typeof body === 'object'
				? String((body as { reason?: unknown }).reason ?? '')
				: '';
		const result = banUser(params.id, reason, locals.user.username);
		if (!result.ok) return json({ error: result.error }, { status: 400 });
		return json({ ok: true, user: getAdminUser(params.id) });
	}

	if (action === 'unban') {
		const result = unbanUser(params.id);
		if (!result.ok) return json({ error: result.error }, { status: 400 });
		return json({ ok: true, user: getAdminUser(params.id) });
	}

	if (action === 'revoke-sessions') {
		const n = revokeAllSessions(params.id);
		return json({ ok: true, revoked: n, user: getAdminUser(params.id) });
	}

	return json({ error: 'Unknown action' }, { status: 400 });
};

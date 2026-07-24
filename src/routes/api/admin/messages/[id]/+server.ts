import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin, softDeleteMessage } from '$lib/server/admin';

export const DELETE: RequestHandler = async ({ locals, params }) => {
	requireAdmin(locals.user);
	const result = softDeleteMessage(params.id);
	if (!result.ok) return json({ error: result.error }, { status: 404 });
	return json({ ok: true });
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRemoveBlock, listAdminBlocks, requireAdmin } from '$lib/server/admin';

export const GET: RequestHandler = async ({ locals, url }) => {
	requireAdmin(locals.user);
	const page = Number(url.searchParams.get('page') ?? '1') || 1;
	return json(listAdminBlocks({ page }));
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	requireAdmin(locals.user);
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return json({ error: 'Invalid request' }, { status: 400 });
	}
	const blockerId = String((body as { blockerId?: unknown }).blockerId ?? '');
	const blockedId = String((body as { blockedId?: unknown }).blockedId ?? '');
	if (!blockerId || !blockedId) {
		return json({ error: 'Missing ids' }, { status: 400 });
	}
	adminRemoveBlock(blockerId, blockedId);
	return json({ ok: true });
};

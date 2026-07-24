import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/admin';
import { listOpenReports, resolveReport } from '$lib/server/features';

export const GET: RequestHandler = async ({ locals }) => {
	requireAdmin(locals.user);
	return json({ reports: listOpenReports() });
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	requireAdmin(locals.user);
	const body = await request.json().catch(() => null);
	const id = String((body as { id?: unknown })?.id ?? '');
	if (!id) return json({ error: 'id required' }, { status: 400 });
	resolveReport(id);
	return json({ ok: true });
};

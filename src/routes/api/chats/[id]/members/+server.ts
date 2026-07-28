import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fanoutGroupResult } from '$lib/server/groupFanout';
import {
	addGroupMembers,
	getGroupInfo,
	getMemberRole,
	listGroupMembers
} from '$lib/server/groups';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!getMemberRole(params.id, locals.user.id)) {
		return json({ error: 'Not found' }, { status: 404 });
	}
	return json({ members: listGroupMembers(params.id, locals.user.id) });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const chatId = params.id;
	const body = (await request.json().catch(() => null)) as { userIds?: unknown } | null;
	const requested = Array.isArray(body?.userIds)
		? (body.userIds as unknown[]).map((v) => String(v ?? ''))
		: [];
	if (!requested.length) return json({ error: 'Nobody to add' }, { status: 400 });

	const result = addGroupMembers(chatId, locals.user.id, requested);
	if (result.error) return json({ error: result.error }, { status: result.status ?? 400 });

	fanoutGroupResult(chatId, result);

	return json({
		added: result.added,
		group: getGroupInfo(chatId, locals.user.id),
		members: listGroupMembers(chatId, locals.user.id)
	});
};

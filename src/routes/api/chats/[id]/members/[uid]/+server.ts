import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fanoutGroupResult } from '$lib/server/groupFanout';
import {
	getGroupInfo,
	listGroupMembers,
	removeGroupMember,
	setGroupRole
} from '$lib/server/groups';
import type { GroupRole } from '$lib/types';

/** Promote, demote, or hand over ownership. Owner only — enforced in setGroupRole. */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => null)) as { role?: unknown } | null;
	const raw = String(body?.role ?? '');
	if (raw !== 'owner' && raw !== 'admin' && raw !== 'member') {
		return json({ error: 'Unknown role' }, { status: 400 });
	}

	const chatId = params.id;
	const result = setGroupRole(chatId, locals.user.id, params.uid, raw as GroupRole);
	if (result.error) return json({ error: result.error }, { status: result.status ?? 400 });

	fanoutGroupResult(chatId, result);

	return json({
		group: getGroupInfo(chatId, locals.user.id),
		members: listGroupMembers(chatId, locals.user.id)
	});
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const chatId = params.id;
	const result = removeGroupMember(chatId, locals.user.id, params.uid);
	if (result.error) return json({ error: result.error }, { status: result.status ?? 400 });

	fanoutGroupResult(chatId, result);

	return json({
		group: getGroupInfo(chatId, locals.user.id),
		members: listGroupMembers(chatId, locals.user.id)
	});
};

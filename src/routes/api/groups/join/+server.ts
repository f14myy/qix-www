import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fanoutGroupResult } from '$lib/server/groupFanout';
import { findGroupByInviteCode, getGroupInfo, joinGroupByCode } from '$lib/server/groups';

/** Previews a join link without joining, so the landing page can show a name. */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const group = findGroupByInviteCode(url.searchParams.get('code'));
	if (!group) return json({ error: 'This invite link is no longer valid' }, { status: 404 });

	return json({
		group: {
			id: group.id,
			title: group.title?.trim() || 'Group',
			description: group.description?.trim() || null,
			avatarPath: group.avatarPath ?? null
		},
		// Set when the viewer is already in — the page then offers "Open" not "Join".
		member: !!getGroupInfo(group.id, locals.user.id)
	});
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
	const result = joinGroupByCode(body?.code, locals.user.id);
	if (result.error || !result.chatId) {
		return json({ error: result.error ?? 'Failed' }, { status: result.status ?? 400 });
	}

	fanoutGroupResult(result.chatId, result);

	return json({ chatId: result.chatId, alreadyMember: !!result.alreadyMember });
};

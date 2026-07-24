import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
	import {
	acceptCall,
	assertParticipant,
	endCall,
	rejectCall,
	toCallDTO
} from '$lib/server/calls';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	try {
		const call = assertParticipant(params.id, locals.user.id);
		return json({ call: toCallDTO(call, locals.user.id) });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 404 });
	}
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = await request.json().catch(() => null);
	const action = String((body as { action?: unknown })?.action ?? '');

	try {
		let call;
		if (action === 'accept') call = acceptCall(params.id, locals.user.id);
		else if (action === 'reject') call = rejectCall(params.id, locals.user.id);
		else if (action === 'end') call = endCall(params.id, locals.user.id);
		else return json({ error: 'Invalid action' }, { status: 400 });
		return json({ call: toCallDTO(call, locals.user.id) });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed';
		const status = msg === 'Not found' || msg === 'Forbidden' ? 404 : 400;
		return json({ error: msg }, { status });
	}
};

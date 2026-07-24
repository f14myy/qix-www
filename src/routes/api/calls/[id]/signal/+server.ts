import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { relaySignal, type SignalPayload } from '$lib/server/calls';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = await request.json().catch(() => null);
	const type = String((body as { type?: unknown })?.type ?? '');
	if (type !== 'offer' && type !== 'answer' && type !== 'ice') {
		return json({ error: 'Invalid type' }, { status: 400 });
	}

	const signal: SignalPayload = {
		type,
		sdp: (body as { sdp?: SignalPayload['sdp'] })?.sdp,
		candidate: (body as { candidate?: SignalPayload['candidate'] })?.candidate ?? null
	};

	try {
		relaySignal(params.id, locals.user.id, signal);
		return json({ ok: true });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 400 });
	}
};

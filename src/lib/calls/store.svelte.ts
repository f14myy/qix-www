import { haptic } from '$lib/haptic';
import { CallSession, type CallDTO, type CallPeer, type CallPhase } from './session';

type InvitePayload = {
	callId: string;
	chatId: string;
	video: boolean;
	from: CallPeer;
};

let session: CallSession | null = null;
let tick = $state(0);
let iceServersCache: RTCIceServer[] = [
	{ urls: 'stun:stun.l.google.com:19302' },
	{ urls: 'stun:stun1.l.google.com:19302' }
];
let ringVibrate: ReturnType<typeof setInterval> | null = null;

function bump() {
	tick += 1;
}

function stopRingVibrate() {
	if (ringVibrate) {
		clearInterval(ringVibrate);
		ringVibrate = null;
	}
	try {
		navigator.vibrate?.(0);
	} catch {
		/* ignore */
	}
}

function startRingVibrate() {
	stopRingVibrate();
	haptic([180, 120, 180, 520]);
	ringVibrate = setInterval(() => {
		haptic([180, 120, 180, 520]);
	}, 1600);
}

export function getCallTick() {
	return tick;
}

export function getActiveCallSession() {
	void tick;
	return session;
}

export function getCallPhase(): CallPhase {
	void tick;
	return session?.phase ?? 'idle';
}

function setSession(next: CallSession | null) {
	if (!next) stopRingVibrate();
	session?.dispose();
	session = next;
	bump();
}

export function mapCallStartError(raw: string): 'busy' | 'already' | 'permission' | 'failed' {
	const m = raw.toLowerCase();
	if (m.includes('busy')) return 'busy';
	if (m.includes('already')) return 'already';
	if (m === 'permission' || m.includes('permission') || m.includes('denied')) return 'permission';
	return 'failed';
}

export async function startOutgoingCall(chatId: string, video: boolean) {
	if (session && session.phase !== 'ended' && session.phase !== 'idle') {
		throw new Error('Already in a call');
	}
	const res = await fetch('/api/calls', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ chatId, video })
	});
	const json = await res.json();
	if (!res.ok) throw new Error(json.error || 'Failed to start call');
	const call = json.call as CallDTO;
	iceServersCache = call.iceServers?.length ? call.iceServers : iceServersCache;
	const s = new CallSession(call, 'outgoing', bump);
	setSession(s);
	try {
		await s.prepareAsCaller();
	} catch (e) {
		await hangupCall();
		throw e instanceof Error ? e : new Error('permission');
	}
	return s;
}

export async function handleIncomingInvite(invite: InvitePayload) {
	if (session && session.phase !== 'ended' && session.phase !== 'idle') {
		// auto-busy: reject
		await fetch(`/api/calls/${invite.callId}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'reject' })
		});
		return;
	}
	const call: CallDTO = {
		id: invite.callId,
		chatId: invite.chatId,
		video: invite.video,
		status: 'ringing',
		role: 'callee',
		peer: invite.from,
		createdAt: Date.now(),
		iceServers: iceServersCache
	};
	const s = new CallSession(call, 'incoming', bump);
	setSession(s);
	startRingVibrate();

	// refresh ice servers from server
	try {
		const res = await fetch(`/api/calls/${invite.callId}`);
		const json = await res.json();
		if (res.ok && json.call?.iceServers) {
			s.call.iceServers = json.call.iceServers;
			iceServersCache = json.call.iceServers;
		}
	} catch {
		/* ignore */
	}
}

export async function acceptCall() {
	if (!session || session.phase !== 'incoming') return;
	stopRingVibrate();
	await session.acceptIncoming();
}

export async function rejectCall() {
	if (!session) return;
	stopRingVibrate();
	await session.rejectIncoming();
	setSession(null);
}

export async function hangupCall() {
	if (!session) return;
	stopRingVibrate();
	await session.hangup();
	setSession(null);
}

export async function onCallAccepted(callId: string) {
	if (!session || session.call.id !== callId) return;
	stopRingVibrate();
	await session.onAccepted();
}

export function onCallEnded(callId: string) {
	if (!session || session.call.id !== callId) return;
	stopRingVibrate();
	session.phase = 'ended';
	session.dispose();
	setSession(null);
}

export function onCallRejected(callId: string) {
	if (!session || session.call.id !== callId) return;
	stopRingVibrate();
	session.phase = 'ended';
	session.dispose();
	setSession(null);
}

export async function onCallSignal(msg: {
	callId: string;
	fromUserId: string;
	type: 'offer' | 'answer' | 'ice';
	sdp: RTCSessionDescriptionInit | null;
	candidate: RTCIceCandidateInit | null;
}) {
	if (!session || session.call.id !== msg.callId) return;
	await session.handleSignal(msg);
}

export async function resumeActiveCall() {
	try {
		const res = await fetch('/api/calls');
		const json = await res.json();
		if (!res.ok || !json.call) return;
		const call = json.call as CallDTO;
		if (call.status === 'ended') return;
		if (session?.call.id === call.id) return;
		iceServersCache = call.iceServers?.length ? call.iceServers : iceServersCache;
		const phase: CallPhase =
			call.status === 'ringing'
				? call.role === 'caller'
					? 'outgoing'
					: 'incoming'
				: 'connecting';
		const s = new CallSession(call, phase, bump);
		setSession(s);
		if (phase === 'incoming') startRingVibrate();
		if (phase === 'outgoing' || phase === 'connecting') {
			await s.startMedia();
			if (call.role === 'caller' && call.status === 'active') await s.onAccepted();
		}
	} catch {
		/* ignore */
	}
}

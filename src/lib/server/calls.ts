import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { createId } from './id';
import { db } from './db';
import { users } from './schema';
import { getPeer, isChatMember } from './chats';
import { countUserStreams, onUserStreamsClosed, publishToUser } from './events';
import { sendPushToUser } from './push';
import { isBlockedEither } from './settings';

export type CallStatus = 'ringing' | 'active' | 'ended';

export type CallRecord = {
	id: string;
	chatId: string;
	callerId: string;
	calleeId: string;
	video: boolean;
	status: CallStatus;
	createdAt: number;
	answeredAt: number | null;
};

export type SignalPayload = {
	type: 'offer' | 'answer' | 'ice';
	sdp?: { type: string; sdp?: string };
	candidate?: {
		candidate?: string;
		sdpMid?: string | null;
		sdpMLineIndex?: number | null;
		usernameFragment?: string | null;
	} | null;
};

const calls = new Map<string, CallRecord>();
const byUser = new Map<string, string>();
const RING_TIMEOUT_MS = 45_000;
const ringTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Grace period before a call is torn down after its participant's event stream
 * disappears. Long enough to survive a page navigation, a network hiccup or the
 * Android app being swapped out; short enough that the other side is not left
 * staring at a dead call.
 */
const DROP_GRACE_MS = 25_000;
const dropTimers = new Map<string, ReturnType<typeof setTimeout>>();

type IceServer = { urls: string | string[]; username?: string; credential?: string };

/**
 * Lifetime of a TURN credential.
 *
 * Longer than any plausible call, because an ICE restart halfway through one
 * (switching from Wi-Fi to mobile data) has to be able to allocate a fresh
 * relay with the credential the client already holds. Short enough that a
 * credential lifted out of devtools is not worth much.
 */
const TURN_TTL_SECONDS = 12 * 60 * 60;

function turnUrls(): string[] {
	return (env.TURN_URL ?? '')
		.split(',')
		.map((u) => u.trim())
		.filter(Boolean);
}

/**
 * Time-limited TURN credentials, per coturn's REST-API scheme
 * (`use-auth-secret` + `static-auth-secret`): the username is an expiry
 * timestamp and the password is its HMAC, which the TURN server verifies with
 * the same secret. Nothing long-lived leaves the server.
 *
 * `TURN_USERNAME`/`TURN_CREDENTIAL` still work for a quick local coturn, but a
 * shared password is handed to every client that starts or receives a call and
 * stays valid until it is rotated — see docs/turn.md.
 */
function turnCredentials(userId: string): { username: string; credential: string } | null {
	const secret = env.TURN_SECRET?.trim();
	if (secret) {
		const username = `${Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS}:${userId}`;
		return {
			username,
			credential: createHmac('sha1', secret).update(username).digest('base64')
		};
	}
	const username = env.TURN_USERNAME?.trim();
	const credential = env.TURN_CREDENTIAL?.trim();
	return username && credential ? { username, credential } : null;
}

function iceServers(userId: string): IceServer[] {
	const servers: IceServer[] = [
		{ urls: 'stun:stun.l.google.com:19302' },
		{ urls: 'stun:stun1.l.google.com:19302' }
	];
	const urls = turnUrls();
	if (!urls.length) return servers;
	const creds = turnCredentials(userId);
	// An unauthenticated TURN server only wastes time failing to allocate, so a
	// misconfigured secret degrades to STUN-only rather than to broken calls.
	if (!creds) return servers;
	// One entry with every transport: the browser tries them in order and keeps
	// whichever gets through.
	servers.push({ urls, ...creds });
	return servers;
}

export function getIceServers(userId: string) {
	return iceServers(userId);
}

function clearRingTimer(callId: string) {
	const t = ringTimers.get(callId);
	if (t) clearTimeout(t);
	ringTimers.delete(callId);
}

function detachUser(userId: string, callId: string) {
	if (byUser.get(userId) === callId) byUser.delete(userId);
}

function clearDropTimer(userId: string) {
	const t = dropTimers.get(userId);
	if (t) clearTimeout(t);
	dropTimers.delete(userId);
}

/**
 * A participant's last event stream closed.
 *
 * Until this existed, a browser that was closed mid-call left the call `active`
 * forever: `byUser` still pointed at it, so both people were permanently "busy"
 * and could never start or receive another call. Only ringing calls had a
 * timeout. The check is repeated when the timer fires so a quick reconnect —
 * navigating between pages re-opens the stream — does not kill a live call.
 */
onUserStreamsClosed((userId) => {
	const call = getUserCall(userId);
	if (!call || call.status === 'ended') return;

	clearDropTimer(userId);
	const timer = setTimeout(() => {
		dropTimers.delete(userId);
		if (countUserStreams(userId) > 0) return;
		const current = getUserCall(userId);
		if (current && current.status !== 'ended') {
			endCallInternal(current, 'disconnected', userId);
		}
	}, DROP_GRACE_MS);
	timer.unref?.();
	dropTimers.set(userId, timer);
});

function endCallInternal(call: CallRecord, reason: string, byUserId?: string) {
	if (call.status === 'ended') return call;
	call.status = 'ended';
	clearRingTimer(call.id);
	clearDropTimer(call.callerId);
	clearDropTimer(call.calleeId);
	detachUser(call.callerId, call.id);
	detachUser(call.calleeId, call.id);
	const payload = { callId: call.id, chatId: call.chatId, reason, byUserId: byUserId ?? null };
	publishToUser(call.callerId, 'call_ended', payload);
	publishToUser(call.calleeId, 'call_ended', payload);
	setTimeout(() => calls.delete(call.id), 60_000);
	return call;
}

export function getCall(callId: string): CallRecord | null {
	return calls.get(callId) ?? null;
}

export function getUserCall(userId: string): CallRecord | null {
	const id = byUser.get(userId);
	return id ? (calls.get(id) ?? null) : null;
}

function publicUser(userId: string) {
	const u = db.select().from(users).where(eq(users.id, userId)).get();
	if (!u) return { id: userId, username: '?', displayName: null as string | null, avatarPath: null as string | null };
	return {
		id: u.id,
		username: u.username,
		displayName: u.displayName,
		avatarPath: u.avatarPath
	};
}

export function startCall(chatId: string, callerId: string, video: boolean): CallRecord {
	if (!isChatMember(chatId, callerId)) throw new Error('Not found');
	const peer = getPeer(chatId, callerId);
	if (!peer) throw new Error('Not found');
	if (isBlockedEither(callerId, peer.id)) throw new Error('Unable to call this user');

	if (getUserCall(callerId)) throw new Error('Already in a call');
	if (getUserCall(peer.id)) throw new Error('User is busy');

	const call: CallRecord = {
		id: createId(),
		chatId,
		callerId,
		calleeId: peer.id,
		video,
		status: 'ringing',
		createdAt: Date.now(),
		answeredAt: null
	};
	calls.set(call.id, call);
	byUser.set(callerId, call.id);
	byUser.set(peer.id, call.id);
	// Both are demonstrably reachable right now; drop any stale teardown timer.
	clearDropTimer(callerId);
	clearDropTimer(peer.id);

	publishToUser(peer.id, 'call_invite', {
		callId: call.id,
		chatId,
		video,
		from: publicUser(callerId)
	});

	ringTimers.set(
		call.id,
		setTimeout(() => {
			const c = calls.get(call.id);
			if (c && c.status === 'ringing') endCallInternal(c, 'timeout');
		}, RING_TIMEOUT_MS)
	);

	void sendPushToUser(
		peer.id,
		{
			title: publicUser(callerId).displayName || publicUser(callerId).username,
			body: video ? 'Incoming video call' : 'Incoming call',
			href: `/chat/${chatId}?call=${call.id}`,
			tag: `qix-call-${call.id}`
		},
		{ chatId, kind: 'call' }
	);

	return call;
}

export function acceptCall(callId: string, userId: string): CallRecord {
	const call = calls.get(callId);
	if (!call || call.calleeId !== userId) throw new Error('Not found');
	if (call.status !== 'ringing') throw new Error('Call is not ringing');
	call.status = 'active';
	call.answeredAt = Date.now();
	clearRingTimer(callId);
	publishToUser(call.callerId, 'call_accepted', { callId, chatId: call.chatId, video: call.video });
	publishToUser(call.calleeId, 'call_accepted', { callId, chatId: call.chatId, video: call.video });
	return call;
}

export function rejectCall(callId: string, userId: string): CallRecord {
	const call = calls.get(callId);
	if (!call || call.calleeId !== userId) throw new Error('Not found');
	if (call.status !== 'ringing') throw new Error('Call is not ringing');
	publishToUser(call.callerId, 'call_rejected', { callId, chatId: call.chatId });
	return endCallInternal(call, 'rejected', userId);
}

export function endCall(callId: string, userId: string): CallRecord {
	const call = calls.get(callId);
	if (!call) throw new Error('Not found');
	if (call.callerId !== userId && call.calleeId !== userId) throw new Error('Forbidden');
	return endCallInternal(call, 'ended', userId);
}

export function relaySignal(callId: string, fromUserId: string, signal: SignalPayload): void {
	const call = calls.get(callId);
	if (!call) throw new Error('Not found');
	if (call.callerId !== fromUserId && call.calleeId !== fromUserId) throw new Error('Forbidden');
	if (call.status === 'ended') throw new Error('Call ended');
	const to = call.callerId === fromUserId ? call.calleeId : call.callerId;
	publishToUser(to, 'call_signal', {
		callId,
		fromUserId,
		type: signal.type,
		sdp: signal.sdp ?? null,
		candidate: signal.candidate ?? null
	});
}

export function assertParticipant(callId: string, userId: string): CallRecord {
	const call = calls.get(callId);
	if (!call) throw new Error('Not found');
	if (call.callerId !== userId && call.calleeId !== userId) throw new Error('Forbidden');
	return call;
}

export function toCallDTO(call: CallRecord, viewerId: string) {
	const peerId = call.callerId === viewerId ? call.calleeId : call.callerId;
	return {
		id: call.id,
		chatId: call.chatId,
		video: call.video,
		status: call.status,
		role: call.callerId === viewerId ? ('caller' as const) : ('callee' as const),
		peer: publicUser(peerId),
		createdAt: call.createdAt,
		iceServers: getIceServers(viewerId)
	};
}

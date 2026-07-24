export type CallPeer = {
	id: string;
	username: string;
	displayName: string | null;
	avatarPath: string | null;
};

export type CallDTO = {
	id: string;
	chatId: string;
	video: boolean;
	status: 'ringing' | 'active' | 'ended';
	role: 'caller' | 'callee';
	peer: CallPeer;
	createdAt: number;
	iceServers: RTCIceServer[];
};

export type CallPhase =
	| 'idle'
	| 'outgoing'
	| 'incoming'
	| 'connecting'
	| 'active'
	| 'ended';

/** Stable keys mapped in the UI via i18n (`call.*`). */
export type CallErrorCode = 'permission' | 'connectionLost' | 'acceptFailed' | 'failed';

type SignalMsg = {
	callId: string;
	fromUserId: string;
	type: 'offer' | 'answer' | 'ice';
	sdp: RTCSessionDescriptionInit | null;
	candidate: RTCIceCandidateInit | null;
};

async function postSignal(callId: string, body: Record<string, unknown>) {
	await fetch(`/api/calls/${callId}/signal`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

function isPermissionError(e: unknown) {
	if (!(e instanceof Error)) return false;
	const name = e.name || '';
	const msg = e.message.toLowerCase();
	return (
		name === 'NotAllowedError' ||
		name === 'PermissionDeniedError' ||
		msg.includes('permission') ||
		msg.includes('denied') ||
		msg.includes('not allowed')
	);
}

export class CallSession {
	call: CallDTO;
	phase: CallPhase;
	localStream: MediaStream | null = null;
	remoteStream: MediaStream | null = null;
	muted = false;
	cameraOff = false;
	error: CallErrorCode | '' = '';
	reconnecting = false;
	connectedAt: number | null = null;
	private pc: RTCPeerConnection | null = null;
	private pendingIce: RTCIceCandidateInit[] = [];
	private makingOffer = false;
	private disposed = false;
	private onChange: () => void;
	private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private iceRestarted = false;

	constructor(call: CallDTO, phase: CallPhase, onChange: () => void) {
		this.call = call;
		this.phase = phase;
		this.onChange = onChange;
	}

	private notify() {
		if (!this.disposed) this.onChange();
	}

	private markActive() {
		if (this.phase === 'active' && this.connectedAt) {
			this.reconnecting = false;
			this.error = '';
			this.clearDisconnectTimer();
			this.notify();
			return;
		}
		this.phase = 'active';
		this.reconnecting = false;
		this.error = '';
		this.connectedAt ??= Date.now();
		this.clearDisconnectTimer();
		this.notify();
	}

	private clearDisconnectTimer() {
		if (this.disconnectTimer) {
			clearTimeout(this.disconnectTimer);
			this.disconnectTimer = null;
		}
	}

	async startMedia() {
		const constraints: MediaStreamConstraints = {
			audio: true,
			video: this.call.video
				? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
				: false
		};
		try {
			this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
		} catch (e) {
			if (isPermissionError(e)) {
				this.error = 'permission';
				this.notify();
				throw Object.assign(new Error('permission'), { code: 'permission' as const });
			}
			this.error = 'failed';
			this.notify();
			throw e;
		}
		this.notify();
	}

	private ensurePc() {
		if (this.pc) return this.pc;
		this.pc = new RTCPeerConnection({ iceServers: this.call.iceServers });
		this.pc.onicecandidate = (ev) => {
			if (!ev.candidate || this.disposed) return;
			void postSignal(this.call.id, {
				type: 'ice',
				candidate: ev.candidate.toJSON()
			});
		};
		this.pc.ontrack = (ev) => {
			if (!this.remoteStream) this.remoteStream = new MediaStream();
			for (const track of ev.streams[0]?.getTracks() ?? [ev.track]) {
				this.remoteStream.addTrack(track);
			}
			this.markActive();
		};
		this.pc.onconnectionstatechange = () => {
			const s = this.pc?.connectionState;
			if (s === 'connected') {
				this.markActive();
				return;
			}
			if (s === 'disconnected') {
				this.reconnecting = true;
				this.notify();
				this.clearDisconnectTimer();
				this.disconnectTimer = setTimeout(() => {
					if (this.disposed || this.pc?.connectionState === 'connected') return;
					this.error = 'connectionLost';
					this.reconnecting = false;
					this.notify();
				}, 4000);
				return;
			}
			if (s === 'failed') {
				this.clearDisconnectTimer();
				if (!this.iceRestarted && this.call.role === 'caller') {
					this.iceRestarted = true;
					this.reconnecting = true;
					this.notify();
					void this.tryIceRestart();
					return;
				}
				this.error = 'connectionLost';
				this.reconnecting = false;
				this.notify();
			}
		};
		if (this.localStream) {
			for (const track of this.localStream.getTracks()) {
				this.pc.addTrack(track, this.localStream);
			}
		}
		return this.pc;
	}

	private async tryIceRestart() {
		try {
			const pc = this.ensurePc();
			pc.restartIce();
			const offer = await pc.createOffer({ iceRestart: true });
			await pc.setLocalDescription(offer);
			await postSignal(this.call.id, { type: 'offer', sdp: pc.localDescription });
		} catch {
			this.error = 'connectionLost';
			this.reconnecting = false;
			this.notify();
		}
	}

	async prepareAsCaller() {
		await this.startMedia();
		this.ensurePc();
		this.phase = 'outgoing';
		this.notify();
	}

	async onAccepted() {
		this.phase = 'connecting';
		this.notify();
		if (this.call.role === 'caller') {
			await this.createOffer();
		}
	}

	async acceptIncoming() {
		await this.startMedia();
		this.ensurePc();
		this.phase = 'connecting';
		const res = await fetch(`/api/calls/${this.call.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'accept' })
		});
		const json = await res.json().catch(() => ({}));
		if (!res.ok) {
			this.error = 'acceptFailed';
			this.notify();
			throw new Error((json as { error?: string }).error || 'Accept failed');
		}
		this.notify();
	}

	async rejectIncoming() {
		await fetch(`/api/calls/${this.call.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'reject' })
		});
		this.phase = 'ended';
		this.dispose();
	}

	async hangup() {
		try {
			await fetch(`/api/calls/${this.call.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'end' })
			});
		} catch {
			/* ignore */
		}
		this.phase = 'ended';
		this.dispose();
	}

	private async createOffer() {
		const pc = this.ensurePc();
		this.makingOffer = true;
		try {
			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);
			await postSignal(this.call.id, { type: 'offer', sdp: pc.localDescription });
		} finally {
			this.makingOffer = false;
		}
	}

	async handleSignal(msg: SignalMsg) {
		if (msg.callId !== this.call.id || this.disposed) return;
		const pc = this.ensurePc();

		if (msg.type === 'offer' && msg.sdp) {
			await pc.setRemoteDescription(msg.sdp);
			for (const c of this.pendingIce) {
				try {
					await pc.addIceCandidate(c);
				} catch {
					/* ignore */
				}
			}
			this.pendingIce = [];
			const answer = await pc.createAnswer();
			await pc.setLocalDescription(answer);
			await postSignal(this.call.id, { type: 'answer', sdp: pc.localDescription });
			this.phase = 'connecting';
			this.notify();
			return;
		}

		if (msg.type === 'answer' && msg.sdp) {
			await pc.setRemoteDescription(msg.sdp);
			for (const c of this.pendingIce) {
				try {
					await pc.addIceCandidate(c);
				} catch {
					/* ignore */
				}
			}
			this.pendingIce = [];
			this.markActive();
			return;
		}

		if (msg.type === 'ice' && msg.candidate) {
			if (!pc.remoteDescription) {
				this.pendingIce.push(msg.candidate);
				return;
			}
			try {
				await pc.addIceCandidate(msg.candidate);
			} catch {
				/* ignore */
			}
		}
	}

	toggleMute() {
		this.muted = !this.muted;
		this.localStream?.getAudioTracks().forEach((t) => {
			t.enabled = !this.muted;
		});
		this.notify();
	}

	toggleCamera() {
		if (!this.call.video) return;
		this.cameraOff = !this.cameraOff;
		this.localStream?.getVideoTracks().forEach((t) => {
			t.enabled = !this.cameraOff;
		});
		this.notify();
	}

	dispose() {
		this.disposed = true;
		this.clearDisconnectTimer();
		this.pc?.close();
		this.pc = null;
		this.localStream?.getTracks().forEach((t) => t.stop());
		this.localStream = null;
		this.remoteStream = null;
		this.notify();
	}
}

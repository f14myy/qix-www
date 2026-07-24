<script lang="ts">
	import Mic from '@lucide/svelte/icons/mic';
	import MicOff from '@lucide/svelte/icons/mic-off';
	import Phone from '@lucide/svelte/icons/phone';
	import PhoneOff from '@lucide/svelte/icons/phone-off';
	import Video from '@lucide/svelte/icons/video';
	import VideoOff from '@lucide/svelte/icons/video-off';
	import Avatar from '$lib/components/Avatar.svelte';
	import {
		acceptCall,
		getActiveCallSession,
		getCallTick,
		hangupCall,
		rejectCall
	} from '$lib/calls/store.svelte';
	import { haptic } from '$lib/haptic';
	import { useI18n } from '$lib/i18n/useI18n.svelte';

	const i18n = useI18n();
	let localEl: HTMLVideoElement | undefined = $state();
	let remoteEl: HTMLVideoElement | undefined = $state();
	let remoteAudio: HTMLAudioElement | undefined = $state();
	let busy = $state(false);

	const session = $derived.by(() => {
		getCallTick();
		return getActiveCallSession();
	});

	const peerTitle = $derived(
		session ? session.call.peer.displayName || session.call.peer.username : ''
	);

	const statusLabel = $derived.by(() => {
		if (!session) return '';
		if (session.error) return session.error;
		switch (session.phase) {
			case 'outgoing':
				return i18n.t('call.calling');
			case 'incoming':
				return i18n.t('call.incoming');
			case 'connecting':
				return i18n.t('call.connecting');
			case 'active':
				return i18n.t('call.connected');
			default:
				return '';
		}
	});

	$effect(() => {
		const s = session;
		if (!s) return;
		if (localEl && s.localStream) {
			localEl.srcObject = s.localStream;
		}
		if (remoteEl && s.remoteStream) {
			remoteEl.srcObject = s.remoteStream;
		}
		if (remoteAudio && s.remoteStream) {
			remoteAudio.srcObject = s.remoteStream;
		}
	});

	async function onAccept() {
		busy = true;
		haptic(12);
		try {
			await acceptCall();
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Error');
		} finally {
			busy = false;
		}
	}

	async function onReject() {
		busy = true;
		haptic(8);
		try {
			await rejectCall();
		} finally {
			busy = false;
		}
	}

	async function onHangup() {
		busy = true;
		haptic(10);
		try {
			await hangupCall();
		} finally {
			busy = false;
		}
	}
</script>

{#if session && session.phase !== 'ended' && session.phase !== 'idle'}
	<div class="call-overlay" class:video={session.call.video} class:active={session.phase === 'active'}>
		{#if session.call.video}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video class="call-remote-video" bind:this={remoteEl} autoplay playsinline></video>
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				class="call-local-video"
				bind:this={localEl}
				autoplay
				playsinline
				muted
				class:hidden={session.cameraOff || session.phase === 'incoming'}
			></video>
		{:else}
			<audio bind:this={remoteAudio} autoplay></audio>
		{/if}

		<div class="call-stage">
			{#if !session.call.video || session.phase !== 'active' || !session.remoteStream}
				<Avatar
					name={peerTitle}
					size={96}
					avatarPath={session.call.peer.avatarPath}
					userId={session.call.peer.id}
				/>
			{/if}
			<h2 class="call-name">{peerTitle}</h2>
			<p class="call-status">{statusLabel}</p>
			{#if session.call.video}
				<span class="call-kind">{i18n.t('call.video')}</span>
			{:else}
				<span class="call-kind">{i18n.t('call.voice')}</span>
			{/if}
		</div>

		<div class="call-actions">
			{#if session.phase === 'incoming'}
				<button
					type="button"
					class="call-btn reject"
					aria-label={i18n.t('call.reject')}
					disabled={busy}
					onclick={onReject}
				>
					<PhoneOff size={26} />
				</button>
				<button
					type="button"
					class="call-btn accept"
					aria-label={i18n.t('call.accept')}
					disabled={busy}
					onclick={onAccept}
				>
					<Phone size={26} />
				</button>
			{:else}
				<button
					type="button"
					class="call-btn mute"
					class:on={session.muted}
					aria-label={i18n.t('call.mute')}
					onclick={() => session?.toggleMute()}
				>
					{#if session.muted}
						<MicOff size={22} />
					{:else}
						<Mic size={22} />
					{/if}
				</button>
				{#if session.call.video}
					<button
						type="button"
						class="call-btn cam"
						class:on={session.cameraOff}
						aria-label={i18n.t('call.camera')}
						onclick={() => session?.toggleCamera()}
					>
						{#if session.cameraOff}
							<VideoOff size={22} />
						{:else}
							<Video size={22} />
						{/if}
					</button>
				{/if}
				<button
					type="button"
					class="call-btn reject"
					aria-label={i18n.t('call.hangup')}
					disabled={busy}
					onclick={onHangup}
				>
					<PhoneOff size={26} />
				</button>
			{/if}
		</div>
	</div>
{/if}

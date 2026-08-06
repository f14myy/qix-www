<script lang="ts">
	import Play from '@lucide/svelte/icons/play';
	import Pause from '@lucide/svelte/icons/pause';
	import { onMount } from 'svelte';
	import { registerVoicePlayer, voiceEnded, voiceStarted } from '$lib/voiceChain';

	let { src, id, chatId, encrypted = false }: { src: string; id: string; chatId: string; encrypted?: boolean } = $props();

	let audio: HTMLAudioElement | undefined = $state();
	let playing = $state(false);
	let progress = $state(0);
	let duration = $state(0);
	let current = $state(0);
	let waveEl: HTMLDivElement | undefined = $state();
	let speed = $state<1 | 1.5 | 2>(1);
	let transcript = $state<string | null>(null);
	let transcriptError = $state('');
	let transcribing = $state(false);

	function play() {
		audio?.play().catch(() => {});
	}

	function pause() {
		audio?.pause();
	}

	function toggle() {
		if (!audio) return;
		if (playing) pause();
		else play();
	}

	function cycleSpeed() {
		speed = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
		if (audio) audio.playbackRate = speed;
	}

	async function transcribe() {
		if (encrypted || transcribing) return;
		transcribing = true;
		transcriptError = '';
		try {
			const response = await fetch(`/api/chats/${chatId}/messages/${id}/transcription`, { method: 'POST' });
			const result = (await response.json().catch(() => null)) as { text?: string; error?: string } | null;
			if (!response.ok || !result?.text) {
				transcriptError = result?.error || 'Could not transcribe';
				return;
			}
			transcript = result.text;
		} finally {
			transcribing = false;
		}
	}

	function onTime() {
		if (!audio) return;
		duration = Number.isFinite(audio.duration) ? audio.duration : duration;
		current = audio.currentTime;
		progress = duration ? current / duration : 0;
	}

	function onMeta() {
		if (!audio) return;
		duration = Number.isFinite(audio.duration) ? audio.duration : 0;
	}

	function fmt(s: number) {
		if (!s || !Number.isFinite(s)) return '0:00';
		const m = Math.floor(s);
		const min = Math.floor(m / 60);
		const sec = m % 60;
		return `${min}:${sec.toString().padStart(2, '0')}`;
	}

	function seek(e: PointerEvent) {
		if (!audio || !waveEl || !duration) return;
		const rect = waveEl.getBoundingClientRect();
		const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
		audio.currentTime = ratio * duration;
		progress = ratio;
		current = audio.currentTime;
	}

	onMount(() =>
		registerVoicePlayer({
			id,
			play,
			pause
		})
	);

	const displayTime = $derived(playing || progress > 0 ? fmt(current) : fmt(duration));
	const heights = [34, 58, 42, 72, 48, 88, 55, 70, 40, 78, 52, 65];
</script>

<div class="voice-player" class:playing>
	<audio
		bind:this={audio}
		{src}
		preload="metadata"
		ontimeupdate={onTime}
		onloadedmetadata={onMeta}
		onplay={() => {
			playing = true;
			voiceStarted(id);
		}}
		onpause={() => (playing = false)}
		onended={() => {
			playing = false;
			progress = 0;
			current = 0;
			voiceEnded(id);
		}}
	></audio>
	<button type="button" class="voice-btn" onclick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
		{#if playing}
			<Pause size={16} />
		{:else}
			<Play size={16} />
		{/if}
	</button>
	<button type="button" class="voice-speed" onclick={cycleSpeed} aria-label="Playback speed">{speed}×</button>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="voice-wave"
		bind:this={waveEl}
		role="slider"
		aria-valuemin={0}
		aria-valuemax={100}
		aria-valuenow={Math.round(progress * 100)}
		tabindex="0"
		onpointerdown={seek}
	>
		<div class="voice-bars" aria-hidden="true">
			{#each heights as h, i}
				<span style="height:{h}%; --wave-delay:{i * -92}ms" class:active={progress > i / heights.length}></span>
			{/each}
		</div>
		<span class="voice-time">{displayTime}</span>
	</div>
	{#if !encrypted}
		<button type="button" class="voice-transcript-toggle" onclick={transcribe} disabled={transcribing}>
			{transcribing ? '…' : transcript ? 'Text' : 'Aa'}
		</button>
	{/if}
</div>
{#if transcript}
	<p class="voice-transcript">{transcript}</p>
{:else if transcriptError}
	<p class="voice-transcript error">{transcriptError}</p>
{/if}

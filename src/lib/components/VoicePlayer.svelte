<script lang="ts">
	import Play from '@lucide/svelte/icons/play';
	import Pause from '@lucide/svelte/icons/pause';

	let { src }: { src: string } = $props();

	let audio: HTMLAudioElement | undefined = $state();
	let playing = $state(false);
	let progress = $state(0);
	let duration = $state(0);

	function toggle() {
		if (!audio) return;
		if (playing) {
			audio.pause();
		} else {
			audio.play();
		}
	}

	function onTime() {
		if (!audio) return;
		progress = audio.duration ? audio.currentTime / audio.duration : 0;
		duration = audio.duration || 0;
	}

	function fmt(s: number) {
		if (!s || !Number.isFinite(s)) return '0:00';
		const m = Math.floor(s / 60);
		const sec = Math.floor(s % 60);
		return `${m}:${sec.toString().padStart(2, '0')}`;
	}
</script>

<div class="voice-player">
	<audio
		bind:this={audio}
		{src}
		preload="metadata"
		ontimeupdate={onTime}
		onplay={() => (playing = true)}
		onpause={() => (playing = false)}
		onended={() => {
			playing = false;
			progress = 0;
		}}
	></audio>
	<button type="button" class="voice-btn" onclick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
		{#if playing}
			<Pause size={16} />
		{:else}
			<Play size={16} />
		{/if}
	</button>
	<div class="voice-wave">
		<div class="voice-bars" aria-hidden="true">
			{#each Array(12) as _, i}
				<span style="height:{30 + ((i * 37) % 70)}%" class:active={progress > i / 12}></span>
			{/each}
		</div>
		<span class="voice-time">{fmt(duration * (playing || progress ? progress : 1))}</span>
	</div>
</div>

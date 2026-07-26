<script lang="ts">
	import { onMount } from 'svelte';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import { APP_VERSION } from '$lib/version';

	const STORAGE_KEY = 'qix-seen-version';

	let visible = $state(false);

	onMount(() => {
		try {
			const seen = localStorage.getItem(STORAGE_KEY);
			if (seen !== APP_VERSION) visible = true;
		} catch { /* SSR / incognito */ }
	});

	function dismiss() {
		visible = false;
		try { localStorage.setItem(STORAGE_KEY, APP_VERSION); } catch { /* ignore */ }
	}

	/** Changelog entries grouped by emoji category */
	const entries = [
		{ icon: '🎨', text: 'New default theme: Citrus Light — a fresh lemon palette' },
		{ icon: '📞', text: 'Redesigned call UI with ambient glow & live status pulse' },
		{ icon: '📱', text: 'Edge swipe-back gesture in chats' },
		{ icon: '📱', text: 'Smart keyboard adaptation — no more layout jumps' },
		{ icon: '📱', text: 'Pull-to-refresh in chat list' },
		{ icon: '🎉', text: 'Emoji burst particles on reactions' },
		{ icon: '🖼️', text: 'Frosted glass buttons on profile banners' },
		{ icon: '🖼️', text: 'Fixed avatar letter centering in profile editor' },
		{ icon: '🎯', text: 'Translucent glass topbar & floating composer bubble' },
		{ icon: '🎯', text: 'Full-bleed messages scrolling under glass layers' },
		{ icon: '🎯', text: 'Modern styled Block / Unblock buttons with icons' },
		{ icon: '🔧', text: 'Built-in channels can no longer be deleted' },
		{ icon: '🔧', text: 'Reaction picker z-index & search blur fixes' },
		{ icon: '🔧', text: 'Browser text-selection suppression on mobile' },
	];
</script>

{#if visible}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="wn-backdrop" onclick={dismiss}>
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="wn-card" onclick={(e) => e.stopPropagation()}>
			<div class="wn-header">
				<span class="wn-sparkle"><Sparkles size={22} /></span>
				<h2 class="wn-title">What's new in {APP_VERSION}</h2>
			</div>

			<ul class="wn-list">
				{#each entries as entry}
					<li class="wn-entry">
						<span class="wn-entry-icon">{entry.icon}</span>
						<span class="wn-entry-text">{entry.text}</span>
					</li>
				{/each}
			</ul>

			<button class="btn wn-dismiss" type="button" onclick={dismiss}>Got it!</button>
		</div>
	</div>
{/if}

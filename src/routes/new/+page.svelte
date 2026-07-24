<script lang="ts">
	import { goto } from '$app/navigation';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Avatar from '$lib/components/Avatar.svelte';
	import { useI18n } from '$lib/i18n/useI18n.svelte';

	const i18n = useI18n();
	let q = $state('');
	let results = $state<
		Array<{ id: string; username: string; displayName: string | null; avatarPath: string | null }>
	>([]);
	let error = $state('');
	let loading = $state(false);
	let searching = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	function onInput() {
		clearTimeout(timer);
		timer = setTimeout(search, 200);
	}

	async function search() {
		error = '';
		if (q.trim().length < 1) {
			results = [];
			return;
		}
		searching = true;
		try {
			const res = await fetch(`/api/users/search?q=${encodeURIComponent(q.trim())}`);
			const data = await res.json();
			if (!res.ok) {
				error = data.error || 'Search failed';
				return;
			}
			results = data.users;
		} finally {
			searching = false;
		}
	}

	async function openChat(username: string) {
		loading = true;
		error = '';
		try {
			const res = await fetch('/api/chats', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ peerUsername: username })
			});
			const data = await res.json();
			if (!res.ok) {
				error = data.error || 'Could not open chat';
				return;
			}
			await goto(`/chat/${data.chatId}`);
		} finally {
			loading = false;
		}
	}
</script>

<div class="screen">
	<header class="topbar">
		<button type="button" class="icon-btn" aria-label={i18n.t('back')} onclick={() => goto('/')}>
			<ArrowLeft size={22} />
		</button>
		<h1>{i18n.t('new.title')}</h1>
	</header>

	<div class="search-box">
		<input
			type="search"
			placeholder={i18n.t('new.search')}
			maxlength="9"
			bind:value={q}
			oninput={onInput}
		/>
	</div>

	{#if error}
		<p class="error" style="padding:12px 16px">{error}</p>
	{/if}

	<div class="list">
		{#if searching && results.length === 0}
			<div class="empty"><p>{i18n.t('new.searching')}</p></div>
		{:else if q && results.length === 0}
			<div class="empty"><p>{i18n.t('new.none')}</p></div>
		{:else}
			{#each results as user (user.id)}
				<button
					class="user-row"
					type="button"
					disabled={loading}
					onclick={() => openChat(user.username)}
				>
					<Avatar
						name={user.displayName || user.username}
						size={44}
						avatarPath={user.avatarPath}
						userId={user.id}
					/>
					<span>
						<span style="font-weight:650;display:block">{user.displayName || user.username}</span>
						{#if user.displayName}
							<span style="color:var(--text-muted);font-size:0.85rem">@{user.username}</span>
						{/if}
					</span>
				</button>
			{/each}
		{/if}
	</div>
</div>

<script lang="ts">
	import { goto } from '$app/navigation';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Avatar from '$lib/components/Avatar.svelte';
	import { useI18n } from '$lib/i18n/useI18n.svelte';
	import { formatLastSeen, isOnlineIso } from '$lib/time';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const i18n = useI18n();
	let loading = $state(false);

	const title = $derived(data.profile.displayName || data.profile.username);
	const status = $derived(
		isOnlineIso(data.profile.lastSeenAt)
			? i18n.t('chat.online')
			: data.profile.lastSeenAt
				? i18n.t('chat.lastSeen', { when: formatLastSeen(data.profile.lastSeenAt, i18n.locale) })
				: ''
	);

	async function openChat() {
		loading = true;
		try {
			const res = await fetch('/api/chats', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ peerUsername: data.profile.username })
			});
			const json = await res.json();
			if (res.ok) await goto(`/chat/${json.chatId}`);
		} finally {
			loading = false;
		}
	}
</script>

<div class="screen">
	<header class="topbar">
		<button type="button" class="icon-btn" aria-label={i18n.t('back')} onclick={() => history.back()}>
			<ArrowLeft size={22} />
		</button>
		<h1>{i18n.t('profile.title')}</h1>
	</header>

	<div class="profile-view">
		<Avatar
			name={title}
			size={96}
			avatarPath={data.profile.avatarPath}
			userId={data.profile.id}
		/>
		<h2 class="profile-name">{title}</h2>
		<p class="profile-user">@{data.profile.username}</p>
		{#if status}
			<p class="peer-status" class:online={isOnlineIso(data.profile.lastSeenAt)}>{status}</p>
		{/if}
		{#if data.profile.bio}
			<p class="profile-bio">{data.profile.bio}</p>
		{/if}

		{#if data.isSelf}
			<a class="btn" href="/settings/profile">{i18n.t('settings.profile')}</a>
		{:else}
			<button class="btn" type="button" disabled={loading} onclick={openChat}>
				{i18n.t('chats.new')}
			</button>
		{/if}
	</div>
</div>

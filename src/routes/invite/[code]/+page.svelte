<script lang="ts">
	import { goto } from '$app/navigation';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Avatar from '$lib/components/Avatar.svelte';
	import { useI18n } from '$lib/i18n/useI18n.svelte';
	import { goBack } from '$lib/nav';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const i18n = useI18n();
	let loading = $state(false);
	let msg = $state('');

	const title = $derived(data.profile.displayName || data.profile.username);

	async function add() {
		if (!data.user) {
			await goto(`/login?next=/invite/${data.code}`);
			return;
		}
		loading = true;
		msg = '';
		try {
			const res = await fetch('/api/chats', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ peerUsername: data.profile.username })
			});
			const json = await res.json();
			if (res.status === 202 || json.pending) {
				msg = i18n.t('requests.sent');
				return;
			}
			if (res.ok && json.chatId) {
				await goto(`/chat/${json.chatId}`);
				return;
			}
			msg = json.error || i18n.t('invite.failed');
		} finally {
			loading = false;
		}
	}
</script>

<div class="screen">
	<header class="topbar">
		<button type="button" class="icon-btn" aria-label={i18n.t('back')} onclick={() => goBack('/')}>
			<ArrowLeft size={22} />
		</button>
		<h1>{i18n.t('invite.title')}</h1>
		<span class="icon-btn" style="visibility:hidden" aria-hidden="true"><ArrowLeft size={22} /></span>
	</header>

	<div class="settings-body" style="display:flex;flex-direction:column;align-items:center;gap:16px;padding-top:40px">
		<Avatar name={title} size={88} avatarPath={data.profile.avatarPath} userId={data.profile.id} />
		<div style="text-align:center">
			<strong style="font-size:1.2rem">{title}</strong>
			<p class="hint">@{data.profile.username}</p>
			<p class="hint" style="margin-top:8px">{i18n.t('invite.lead')}</p>
		</div>
		<button class="btn" type="button" disabled={loading} onclick={add}>
			{loading ? '…' : i18n.t('invite.add')}
		</button>
		{#if msg}
			<p class="hint">{msg}</p>
		{/if}
	</div>
</div>

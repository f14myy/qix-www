<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Avatar from '$lib/components/Avatar.svelte';
	import { useI18n } from '$lib/i18n/useI18n.svelte';
	import { formatRelativeTime } from '$lib/time';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const i18n = useI18n();
	let busy = $state<string | null>(null);

	async function act(id: string, action: 'accept' | 'decline') {
		busy = id;
		try {
			const res = await fetch('/api/requests', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id, action })
			});
			const json = await res.json();
			if (res.ok && action === 'accept' && json.chatId) {
				await goto(`/chat/${json.chatId}`);
				return;
			}
			await invalidateAll();
		} finally {
			busy = null;
		}
	}
</script>

<div class="screen">
	<header class="topbar">
		<h1>{i18n.t('requests.title')}</h1>
	</header>

	<div class="settings-body">
		{#if data.requests.length === 0}
			<div class="empty empty-animate">
				<span class="empty-icon"><Inbox size={36} /></span>
				<p>{i18n.t('requests.empty')}</p>
			</div>
		{:else}
			{#each data.requests as req (req.id)}
				<div class="settings-card" style="margin-bottom:10px;padding:12px">
					<div style="display:flex;gap:12px;align-items:center">
						{#if req.from}
							<Avatar
								name={req.from.displayName || req.from.username}
								avatarPath={req.from.avatarPath}
								userId={req.from.id}
								size={44}
							/>
						{/if}
						<div style="flex:1;min-width:0">
							<strong>{req.from?.displayName || req.from?.username || '?'}</strong>
							{#if req.from}
								<p class="hint">@{req.from.username}</p>
							{/if}
							{#if req.note}
								<p class="hint">{req.note}</p>
							{/if}
							<p class="hint">{formatRelativeTime(req.createdAt, i18n.locale)}</p>
						</div>
					</div>
					<div style="display:flex;gap:8px;margin-top:12px">
						<button
							class="btn"
							type="button"
							disabled={busy === req.id}
							onclick={() => act(req.id, 'accept')}>{i18n.t('requests.accept')}</button
						>
						<button
							class="btn btn-ghost"
							type="button"
							disabled={busy === req.id}
							onclick={() => act(req.id, 'decline')}>{i18n.t('requests.decline')}</button
						>
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>

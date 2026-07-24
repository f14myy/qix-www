<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import Settings from '@lucide/svelte/icons/settings';
	import Pin from '@lucide/svelte/icons/pin';
	import Avatar from '$lib/components/Avatar.svelte';
	import { useI18n } from '$lib/i18n/useI18n.svelte';
	import { formatRelativeTime } from '$lib/time';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const i18n = useI18n();
	let filter = $state('');
	let openMenuId = $state<string | null>(null);

	const filtered = $derived(
		data.chats.filter((c) => {
			const q = filter.trim().toLowerCase();
			if (!q) return true;
			return (
				c.peer.username.includes(q) ||
				(c.peer.displayName?.toLowerCase().includes(q) ?? false)
			);
		})
	);

	function preview(chat: PageData['chats'][number]) {
		if (!chat.lastMessage) return i18n.t('chats.noMessages');
		if (chat.lastMessage.deleted) return i18n.t('chats.deleted');
		if (chat.lastMessage.kind === 'voice') return i18n.t('chats.voice');
		if (chat.lastMessage.hasAttachment && !chat.lastMessage.body) return i18n.t('chats.attachment');
		if (chat.lastMessage.hasAttachment) return `📎 ${chat.lastMessage.body}`;
		return chat.lastMessage.body;
	}

	function displayName(chat: PageData['chats'][number]) {
		return chat.peer.displayName || chat.peer.username;
	}

	async function refresh() {
		await invalidateAll();
	}

	async function setPref(chatId: string, patch: { pinned?: boolean; muted?: boolean }) {
		await fetch(`/api/chats/${chatId}/prefs`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(patch)
		});
		openMenuId = null;
		await invalidateAll();
	}

	onMount(() => {
		fetch('/api/presence', { method: 'POST' });
		const beat = setInterval(() => fetch('/api/presence', { method: 'POST' }), 25000);
		const es = new EventSource('/api/events');
		es.addEventListener('chat_update', () => invalidateAll());
		es.addEventListener('presence', () => invalidateAll());
		return () => {
			clearInterval(beat);
			es.close();
		};
	});
</script>

<svelte:window onfocus={refresh} />

<div class="screen">
	<header class="topbar">
		<h1 class="brand">{i18n.t('chats.title')}</h1>
		<button type="button" class="icon-btn" aria-label="New chat" onclick={() => goto('/new')}>
			<Plus size={22} />
		</button>
		<button type="button" class="icon-btn" aria-label="Settings" onclick={() => goto('/settings')}>
			<Settings size={20} />
		</button>
	</header>

	{#if data.chats.length > 0}
		<div class="list-filter">
			<input type="search" placeholder={i18n.t('chats.filter')} bind:value={filter} />
		</div>
	{/if}

	<div class="list">
		{#if data.chats.length === 0}
			<div class="empty">
				<p>{i18n.t('chats.empty')}</p>
				<button class="btn" type="button" onclick={() => goto('/new')}>{i18n.t('chats.new')}</button>
			</div>
		{:else if filtered.length === 0}
			<div class="empty">
				<p>{i18n.t('chats.emptyFilter', { q: filter })}</p>
			</div>
		{:else}
			{#each filtered as chat (chat.id)}
				<div class="chat-row-wrap" class:menu-open={openMenuId === chat.id}>
					<a class="chat-row" href="/chat/{chat.id}" class:muted={chat.muted}>
						<Avatar
							name={displayName(chat)}
							avatarPath={chat.peer.avatarPath}
							userId={chat.peer.id}
						/>
						<div class="meta">
							<div class="row-top">
								<p class="name">
									{#if chat.pinned}
										<span class="pin-icon"><Pin size={12} /></span>
									{/if}
									{displayName(chat)}
								</p>
								{#if chat.lastMessage}
									<span class="time"
										>{formatRelativeTime(chat.lastMessage.createdAt, i18n.locale)}</span
									>
								{/if}
							</div>
							<div class="row-bottom">
								<p class="preview">{preview(chat)}</p>
								{#if chat.unreadCount > 0}
									<span class="unread-badge" class:quiet={chat.muted}
										>{chat.unreadCount > 99 ? '99+' : chat.unreadCount}</span
									>
								{/if}
							</div>
						</div>
					</a>
					<button
						type="button"
						class="row-menu-btn"
						aria-label="Chat actions"
						onclick={(e) => {
							e.preventDefault();
							openMenuId = openMenuId === chat.id ? null : chat.id;
						}}
					>
						⋯
					</button>
					{#if openMenuId === chat.id}
						<div class="row-actions">
							<button type="button" onclick={() => setPref(chat.id, { pinned: !chat.pinned })}>
								{chat.pinned ? i18n.t('actions.unpin') : i18n.t('actions.pin')}
							</button>
							<button type="button" onclick={() => setPref(chat.id, { muted: !chat.muted })}>
								{chat.muted ? i18n.t('actions.unmute') : i18n.t('actions.mute')}
							</button>
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>

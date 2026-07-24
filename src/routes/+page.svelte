<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import BellOff from '@lucide/svelte/icons/bell-off';
	import Bell from '@lucide/svelte/icons/bell';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Mic from '@lucide/svelte/icons/mic';
	import ImageIcon from '@lucide/svelte/icons/image';
	import Pin from '@lucide/svelte/icons/pin';
	import PinOff from '@lucide/svelte/icons/pin-off';
	import Plus from '@lucide/svelte/icons/plus';
	import Settings from '@lucide/svelte/icons/settings';
	import Avatar from '$lib/components/Avatar.svelte';
	import { useI18n } from '$lib/i18n/useI18n.svelte';
	import { formatRelativeTime, isOnlineIso } from '$lib/time';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const i18n = useI18n();
	let filter = $state('');
	let openMenuId = $state<string | null>(null);
	let swipeId = $state<string | null>(null);
	let swipeX = $state(0);
	let swiping = $state(false);
	let startX = 0;
	let startY = 0;
	let pullY = $state(0);
	let pulling = $state(false);
	let refreshing = $state(false);
	let listEl: HTMLDivElement | undefined = $state();
	let presenceMap = $state<Record<string, string>>({});

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

	const pinned = $derived(filtered.filter((c) => c.pinned));
	const unpinned = $derived(filtered.filter((c) => !c.pinned));

	function preview(chat: PageData['chats'][number]) {
		if (!chat.lastMessage) return i18n.t('chats.noMessages');
		if (chat.lastMessage.deleted) return i18n.t('chats.deleted');
		const mine = chat.lastMessage.senderId === data.user?.id;
		const prefix = mine ? i18n.t('chat.youPrefix') : '';
		if (chat.lastMessage.kind === 'voice') return `${prefix}${i18n.t('chats.voice')}`;
		if (chat.lastMessage.hasAttachment && !chat.lastMessage.body) {
			return `${prefix}${i18n.t('chat.photo')}`;
		}
		if (chat.lastMessage.hasAttachment) {
			return `${prefix}${chat.lastMessage.body}`;
		}
		return `${prefix}${chat.lastMessage.body}`;
	}

	function previewIcon(chat: PageData['chats'][number]) {
		if (!chat.lastMessage || chat.lastMessage.deleted) return null;
		if (chat.lastMessage.kind === 'voice') return 'voice';
		if (chat.lastMessage.hasAttachment && !chat.lastMessage.body) return 'image';
		return null;
	}

	function displayName(chat: PageData['chats'][number]) {
		return chat.peer.displayName || chat.peer.username;
	}

	function peerOnline(chat: PageData['chats'][number]) {
		const seen = presenceMap[chat.peer.id] ?? chat.peer.lastSeenAt;
		return isOnlineIso(seen);
	}

	async function refresh() {
		refreshing = true;
		try {
			await invalidateAll();
		} finally {
			refreshing = false;
			pullY = 0;
		}
	}

	async function setPref(chatId: string, patch: { pinned?: boolean; muted?: boolean }) {
		await fetch(`/api/chats/${chatId}/prefs`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(patch)
		});
		openMenuId = null;
		swipeId = null;
		swipeX = 0;
		await invalidateAll();
	}

	function onRowDown(e: PointerEvent, id: string) {
		startX = e.clientX;
		startY = e.clientY;
		swiping = true;
		swipeId = id;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onRowMove(e: PointerEvent) {
		if (!swiping || !swipeId) return;
		const dx = e.clientX - startX;
		const dy = e.clientY - startY;
		if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
			swiping = false;
			swipeX = 0;
			return;
		}
		swipeX = Math.min(0, Math.max(-120, dx));
	}

	function onRowUp() {
		if (!swiping) return;
		swiping = false;
		if (swipeX < -64) {
			openMenuId = swipeId;
			swipeX = -120;
		} else {
			swipeX = 0;
			if (openMenuId !== swipeId) swipeId = null;
		}
	}

	function onListTouchStart(e: TouchEvent) {
		if (!listEl || listEl.scrollTop > 0 || refreshing) return;
		startY = e.touches[0].clientY;
		pulling = true;
	}

	function onListTouchMove(e: TouchEvent) {
		if (!pulling || refreshing) return;
		const dy = e.touches[0].clientY - startY;
		if (dy > 0 && listEl && listEl.scrollTop <= 0) {
			pullY = Math.min(72, dy * 0.45);
		} else {
			pullY = 0;
		}
	}

	async function onListTouchEnd() {
		if (!pulling) return;
		pulling = false;
		if (pullY > 52) await refresh();
		else pullY = 0;
	}

	function openChat(id: string) {
		const run = () => goto(`/chat/${id}`);
		if (typeof document !== 'undefined' && 'startViewTransition' in document) {
			(document as Document & { startViewTransition: (cb: () => void) => void }).startViewTransition(
				run
			);
		} else {
			run();
		}
	}

	onMount(() => {
		fetch('/api/presence', { method: 'POST' });
		const beat = setInterval(() => fetch('/api/presence', { method: 'POST' }), 25000);
		const es = new EventSource('/api/events');
		es.addEventListener('chat_update', () => invalidateAll());
		es.addEventListener('presence', (ev) => {
			try {
				const d = JSON.parse(ev.data) as { userId: string; lastSeenAt: string };
				presenceMap = { ...presenceMap, [d.userId]: d.lastSeenAt };
			} catch {
				/* ignore */
			}
			invalidateAll();
		});
		return () => {
			clearInterval(beat);
			es.close();
		};
	});
</script>

<svelte:window onfocus={refresh} />

<div class="screen chats-screen">
	<header class="topbar">
		<h1 class="brand brand-animate">{i18n.t('chats.title')}</h1>
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

	<div
		class="list"
		bind:this={listEl}
		role="list"
		ontouchstart={onListTouchStart}
		ontouchmove={onListTouchMove}
		ontouchend={onListTouchEnd}
	>
		{#if pullY > 8 || refreshing}
			<div class="pull-indicator" style="height:{refreshing ? 40 : pullY}px">
				<span class="pull-spinner" class:spin={refreshing || pullY > 40}></span>
				<span class:spin={refreshing}>{refreshing ? '…' : i18n.t('chats.pullRefresh')}</span>
			</div>
		{/if}

		{#if data.chats.length === 0}
			<div class="empty empty-animate">
				<span class="empty-icon"><MessageCircle size={36} /></span>
				<p>{i18n.t('chats.empty')}</p>
				<button class="btn" type="button" onclick={() => goto('/new')}>{i18n.t('chats.new')}</button>
			</div>
		{:else if filtered.length === 0}
			<div class="empty empty-animate">
				<p>{i18n.t('chats.emptyFilter', { q: filter })}</p>
			</div>
		{:else}
			{#if pinned.length}
				<div class="list-section-label">{i18n.t('chats.pinnedSection')}</div>
				{#each pinned as chat, i (chat.id)}
					{@render chatRow(chat, i)}
				{/each}
			{/if}
			{#each unpinned as chat, i (chat.id)}
				{@render chatRow(chat, pinned.length + i)}
			{/each}
		{/if}
	</div>
</div>

{#snippet chatRow(chat: PageData['chats'][number], index: number)}
	{@const open = openMenuId === chat.id || (swipeId === chat.id && swipeX < -40)}
	{@const tx = swipeId === chat.id ? swipeX : openMenuId === chat.id ? -120 : 0}
	{@const icon = previewIcon(chat)}
	<div
		class="chat-row-wrap"
		class:menu-open={open}
		class:swiping={swipeId === chat.id && swiping}
		style="animation-delay:{Math.min(index, 6) * 40}ms; --row-x:{tx}px"
		role="group"
		onpointerdown={(e) => onRowDown(e, chat.id)}
		onpointermove={onRowMove}
		onpointerup={onRowUp}
		onpointercancel={onRowUp}
	>
		<div class="row-actions-under">
			<button
				type="button"
				class="row-action pin"
				aria-label={chat.pinned ? i18n.t('actions.unpin') : i18n.t('actions.pin')}
				onclick={() => setPref(chat.id, { pinned: !chat.pinned })}
			>
				{#if chat.pinned}
					<PinOff size={18} />
				{:else}
					<Pin size={18} />
				{/if}
			</button>
			<button
				type="button"
				class="row-action mute"
				aria-label={chat.muted ? i18n.t('actions.unmute') : i18n.t('actions.mute')}
				onclick={() => setPref(chat.id, { muted: !chat.muted })}
			>
				{#if chat.muted}
					<Bell size={18} />
				{:else}
					<BellOff size={18} />
				{/if}
			</button>
		</div>
		<button
			type="button"
			class="chat-row"
			class:muted={chat.muted}
			class:unread={chat.unreadCount > 0}
			onclick={() => {
				if (Math.abs(tx) > 12) return;
				openChat(chat.id);
			}}
		>
			<Avatar
				name={displayName(chat)}
				avatarPath={chat.peer.avatarPath}
				userId={chat.peer.id}
				online={peerOnline(chat)}
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
						<span class="time">{formatRelativeTime(chat.lastMessage.createdAt, i18n.locale)}</span>
					{/if}
				</div>
				<div class="row-bottom">
					<p class="preview">
						{#if icon === 'voice'}
							<span class="preview-ico"><Mic size={14} /></span>
						{:else if icon === 'image'}
							<span class="preview-ico"><ImageIcon size={14} /></span>
						{/if}
						{preview(chat)}
					</p>
					{#if chat.unreadCount > 0}
						<span class="unread-badge pop" class:quiet={chat.muted}
							>{chat.unreadCount > 99 ? '99+' : chat.unreadCount}</span
						>
					{/if}
				</div>
			</div>
		</button>
	</div>
{/snippet}

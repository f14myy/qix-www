<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import Archive from '@lucide/svelte/icons/archive';
	import BellOff from '@lucide/svelte/icons/bell-off';
	import Bell from '@lucide/svelte/icons/bell';
	import Inbox from '@lucide/svelte/icons/inbox';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Mic from '@lucide/svelte/icons/mic';
	import ImageIcon from '@lucide/svelte/icons/image';
	import Pin from '@lucide/svelte/icons/pin';
	import PinOff from '@lucide/svelte/icons/pin-off';
	import Search from '@lucide/svelte/icons/search';
	import Settings from '@lucide/svelte/icons/settings';
	import X from '@lucide/svelte/icons/x';
	import Avatar from '$lib/components/Avatar.svelte';
	import ChannelAvatar from '$lib/components/ChannelAvatar.svelte';
	import NameWithBadges from '$lib/components/NameWithBadges.svelte';
	import { useI18n } from '$lib/i18n/useI18n.svelte';
	import { notifyMessage } from '$lib/notify';
	import { listQueued } from '$lib/sendQueue';
	import { formatRelativeTime, isOnlineIso } from '$lib/time';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const i18n = useI18n();
	let filter = $state('');
	let searching = $state(false);
	let searchChats = $state<PageData['chats']>([]);
	let searchPeople = $state<
		Array<{ id: string; username: string; displayName: string | null; avatarPath: string | null }>
	>([]);
	let searchMessages = $state<
		Array<{
			messageId: string;
			chatId: string;
			body: string;
			createdAt: string;
			peer: {
				id: string;
				username: string;
				displayName: string | null;
				avatarPath: string | null;
			} | null;
			channel: { key: string; title: string } | null;
		}>
	>([]);
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	let openId = $state<string | null>(null);
	let activeId = $state<string | null>(null);
	let offsetX = $state(0);
	let dragging = $state(false);
	let startX = 0;
	let startY = 0;
	let baseX = 0;
	let axis: 'none' | 'h' | 'v' = 'none';
	let didSwipe = false;
	let pullY = $state(0);
	let pulling = $state(false);
	let refreshing = $state(false);
	let listEl: HTMLDivElement | undefined = $state();
	let presenceMap = $state<Record<string, string>>({});
	let openingUser = $state(false);
	let searchInput: HTMLInputElement | undefined = $state();
	let drafts = $state<Record<string, string>>({});
	let failedChats = $state<Set<string>>(new Set());
	let requestCount = $state(0);

	const ACTION_W = 180;
	const OPEN_AT = 56;

	const q = $derived(filter.trim());
	const isSearch = $derived(q.length > 0);

	const pinned = $derived(data.chats.filter((c) => c.pinned));
	const unpinned = $derived(data.chats.filter((c) => !c.pinned));

	const searchHasResults = $derived(
		searchChats.length > 0 || searchPeople.length > 0 || searchMessages.length > 0
	);

	function loadLocalHints() {
		const nextDrafts: Record<string, string> = {};
		try {
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i);
				if (!key?.startsWith('qix-draft-')) continue;
				const chatId = key.slice('qix-draft-'.length);
				const val = localStorage.getItem(key)?.trim();
				if (val) nextDrafts[chatId] = val;
			}
		} catch {
			/* ignore */
		}
		drafts = nextDrafts;
		listQueued()
			.then((items) => {
				failedChats = new Set(items.map((i) => i.chatId));
			})
			.catch(() => {
				failedChats = new Set();
			});
		fetch('/api/requests')
			.then((r) => r.json())
			.then((j) => {
				requestCount = Array.isArray(j.requests) ? j.requests.length : 0;
			})
			.catch(() => {
				requestCount = 0;
			});
	}

	function preview(chat: PageData['chats'][number]) {
		const draft = drafts[chat.id];
		if (draft) return `${i18n.t('chats.draft')}: ${draft}`;
		if (failedChats.has(chat.id)) return i18n.t('chats.sendFailed');
		if (!chat.lastMessage) return i18n.t('chats.noMessages');
		if (chat.lastMessage.deleted) return '';
		if (chat.lastMessage.body?.startsWith('e2ee:1:')) {
			const mine = chat.lastMessage.senderId === data.user?.id;
			const prefix = mine ? i18n.t('chat.youPrefix') : '';
			return `${prefix}${i18n.t('e2ee.preview')}`;
		}
		const mine = chat.lastMessage.senderId === data.user?.id;
		const prefix = mine ? i18n.t('chat.youPrefix') : '';
		if (chat.lastMessage.kind === 'voice') return `${prefix}${i18n.t('chats.voice')}`;
		if (chat.lastMessage.kind === 'video') return `${prefix}${i18n.t('chat.video')}`;
		if (chat.lastMessage.hasAttachment && !chat.lastMessage.body) {
			return `${prefix}${i18n.t('chat.photo')}`;
		}
		if (chat.lastMessage.hasAttachment) {
			return `${prefix}${chat.lastMessage.body}`;
		}
		return `${prefix}${chat.lastMessage.body}`;
	}

	function previewIcon(chat: PageData['chats'][number]) {
		if (drafts[chat.id] || failedChats.has(chat.id)) return null;
		if (!chat.lastMessage || chat.lastMessage.deleted) return null;
		if (chat.lastMessage.kind === 'voice') return 'voice';
		if (chat.lastMessage.kind === 'video') return 'image';
		if (chat.lastMessage.hasAttachment && !chat.lastMessage.body) return 'image';
		return null;
	}

	function displayName(chat: PageData['chats'][number]) {
		if (chat.kind === 'channel' && chat.channel) {
			return i18n.t(`channel.${chat.channel.key}.title`);
		}
		return chat.peer?.displayName || chat.peer?.username || '';
	}

	function peerOnline(chat: PageData['chats'][number]) {
		if (!chat.peer) return false;
		const seen = presenceMap[chat.peer.id] ?? chat.peer.lastSeenAt;
		return isOnlineIso(seen);
	}

	function snippet(body: string, query: string) {
		const lower = body.toLowerCase();
		const i = lower.indexOf(query.toLowerCase());
		if (i < 0) return body.slice(0, 100);
		const start = Math.max(0, i - 24);
		const end = Math.min(body.length, i + query.length + 40);
		return `${start > 0 ? '…' : ''}${body.slice(start, end)}${end < body.length ? '…' : ''}`;
	}

	function onFilterInput() {
		clearTimeout(searchTimer);
		const next = filter.trim();
		if (!next) {
			searchChats = [];
			searchPeople = [];
			searchMessages = [];
			searching = false;
			return;
		}
		searchTimer = setTimeout(() => runSearch(next), 220);
	}

	async function runSearch(query: string) {
		searching = true;
		try {
			const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
			const json = await res.json();
			if (!res.ok) return;
			searchChats = json.chats ?? [];
			searchPeople = json.people ?? [];
			searchMessages = json.messages ?? [];
		} finally {
			searching = false;
		}
	}

	function clearSearch() {
		filter = '';
		searchChats = [];
		searchPeople = [];
		searchMessages = [];
		searching = false;
	}

	async function refresh() {
		refreshing = true;
		try {
			await invalidateAll();
			loadLocalHints();
			if (q) await runSearch(q);
		} finally {
			refreshing = false;
			pullY = 0;
		}
	}

	async function setPref(chatId: string, patch: { pinned?: boolean; muted?: boolean; archived?: boolean }) {
		await fetch(`/api/chats/${chatId}/prefs`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(patch)
		});
		closeSwipe();
		await invalidateAll();
	}

	function closeSwipe() {
		openId = null;
		activeId = null;
		offsetX = 0;
		dragging = false;
		axis = 'none';
		didSwipe = false;
	}

	function rowOffset(id: string) {
		if (activeId === id) return offsetX;
		if (openId === id) return -ACTION_W;
		return 0;
	}

	function onRowDown(e: PointerEvent, id: string) {
		if (e.button !== undefined && e.button !== 0) return;
		const t = e.target as HTMLElement | null;
		if (t?.closest('.row-action')) return;

		if (openId && openId !== id) {
			openId = null;
		}

		startX = e.clientX;
		startY = e.clientY;
		baseX = openId === id ? -ACTION_W : 0;
		offsetX = baseX;
		activeId = id;
		dragging = true;
		axis = 'none';
		didSwipe = false;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onRowMove(e: PointerEvent) {
		if (!dragging || !activeId) return;
		const dx = e.clientX - startX;
		const dy = e.clientY - startY;

		if (axis === 'none') {
			if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
			axis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
			if (axis === 'v') {
				dragging = false;
				if (openId !== activeId) {
					activeId = null;
					offsetX = 0;
				} else {
					offsetX = -ACTION_W;
				}
				try {
					(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
				} catch {
					/* already released */
				}
				return;
			}
		}

		if (axis !== 'h') return;
		didSwipe = true;
		offsetX = Math.min(0, Math.max(-ACTION_W, baseX + dx));
	}

	function onRowUp() {
		if (!activeId) return;
		const id = activeId;
		const horizontal = axis === 'h';
		dragging = false;
		axis = 'none';

		if (horizontal) {
			if (offsetX <= -OPEN_AT) {
				openId = id;
				offsetX = -ACTION_W;
			} else {
				openId = null;
				offsetX = 0;
				activeId = null;
			}
		} else if (openId !== id) {
			activeId = null;
			offsetX = 0;
		}
	}

	function onRowClick(id: string) {
		if (didSwipe) {
			didSwipe = false;
			return;
		}
		if (openId === id) {
			closeSwipe();
			return;
		}
		if (openId) {
			closeSwipe();
			return;
		}
		openChat(id);
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

	function openChat(id: string, messageId?: string) {
		const href = messageId ? `/chat/${id}?m=${encodeURIComponent(messageId)}` : `/chat/${id}`;
		const run = () => goto(href);
		if (typeof document !== 'undefined' && 'startViewTransition' in document) {
			(document as Document & { startViewTransition: (cb: () => void) => void }).startViewTransition(
				run
			);
		} else {
			run();
		}
	}

	async function openUser(username: string) {
		openingUser = true;
		try {
			const res = await fetch('/api/chats', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ peerUsername: username })
			});
			const json = await res.json();
			if (res.status === 202 || json.pending) {
				alert(i18n.t('requests.sent'));
				return;
			}
			if (res.ok && json.chatId) openChat(json.chatId);
			else alert(json.error || 'Error');
		} finally {
			openingUser = false;
		}
	}

	onMount(() => {
		loadLocalHints();
		if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('focus')) {
			queueMicrotask(() => searchInput?.focus());
			history.replaceState({}, '', '/');
		}
		fetch('/api/presence', { method: 'POST' });

		let beat: ReturnType<typeof setInterval> | undefined;
		let es: EventSource | null = null;

		function connect() {
			es?.close();
			if (beat) clearInterval(beat);
			es = new EventSource('/api/events');
			es.addEventListener('chat_update', (ev) => {
				try {
					const d = JSON.parse(ev.data) as { chatId?: string };
					const chat = data.chats.find((c) => c.id === d.chatId);
					if (chat && !chat.muted) {
						notifyMessage({
							title: displayName(chat),
							body: preview(chat),
							tag: `chat-${chat.id}`,
							href: `/chat/${chat.id}`
						});
					}
				} catch {
					/* ignore */
				}
				invalidateAll();
				loadLocalHints();
			});
			es.addEventListener('presence', (ev) => {
				try {
					const d = JSON.parse(ev.data) as { userId: string; lastSeenAt: string };
					presenceMap = { ...presenceMap, [d.userId]: d.lastSeenAt };
				} catch {
					/* ignore */
				}
				invalidateAll();
			});
			es.addEventListener('message_request', () => {
				loadLocalHints();
			});
			beat = setInterval(() => fetch('/api/presence', { method: 'POST' }), 25000);
		}

		function disconnect() {
			es?.close();
			es = null;
			if (beat) {
				clearInterval(beat);
				beat = undefined;
			}
		}

		const onVisibility = () => {
			if (document.hidden) disconnect();
			else {
				connect();
				fetch('/api/presence', { method: 'POST' });
				loadLocalHints();
			}
		};

		connect();
		document.addEventListener('visibilitychange', onVisibility);

		return () => {
			disconnect();
			document.removeEventListener('visibilitychange', onVisibility);
			clearTimeout(searchTimer);
		};
	});
</script>

<svelte:window onfocus={refresh} />

<div class="screen chats-screen">
	<header class="topbar">
		<h1 class="brand brand-animate">{i18n.t('chats.title')}</h1>
		<div class="topbar-actions">
			<a class="icon-btn" href="/requests" aria-label={i18n.t('requests.title')}>
				<Inbox size={20} />
				{#if requestCount > 0}
					<span class="top-badge">{requestCount > 9 ? '9+' : requestCount}</span>
				{/if}
			</a>
			<a class="icon-btn" href="/archive" aria-label={i18n.t('chats.archive')}>
				<Archive size={20} />
			</a>
			<button type="button" class="icon-btn" aria-label="Settings" onclick={() => goto('/settings')}>
				<Settings size={20} />
			</button>
		</div>
	</header>

	<div class="list-filter">
		<span class="list-filter-ico" aria-hidden="true"><Search size={16} /></span>
		<input
			bind:this={searchInput}
			type="search"
			placeholder={i18n.t('chats.filter')}
			bind:value={filter}
			oninput={onFilterInput}
			autocomplete="off"
			enterkeyhint="search"
		/>
		{#if filter}
			<button type="button" class="list-filter-clear" aria-label="Clear" onclick={clearSearch}>
				<X size={16} />
			</button>
		{/if}
	</div>

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

		{#if isSearch}
			{#if searching && !searchHasResults}
				<div class="empty empty-animate">
					<p>{i18n.t('chats.searching')}</p>
				</div>
			{:else if !searchHasResults}
				<div class="empty empty-animate">
					<p>{i18n.t('chats.emptyFilter', { q })}</p>
					<p class="search-hint">{i18n.t('chats.searchHint')}</p>
				</div>
			{:else}
				{#if searchChats.length}
					<div class="list-section-label">{i18n.t('chats.searchChats')}</div>
					{#each searchChats as chat, i (chat.id)}
						{@render chatRow(chat, i, false)}
					{/each}
				{/if}

				{#if searchPeople.length}
					<div class="list-section-label">{i18n.t('chats.searchPeople')}</div>
					{#each searchPeople as user (user.id)}
						<button
							class="user-row search-user-row"
							type="button"
							disabled={openingUser}
							onclick={() => openUser(user.username)}
						>
							<Avatar
								name={user.displayName || user.username}
								size={44}
								avatarPath={user.avatarPath}
								userId={user.id}
							/>
							<span class="search-user-meta">
								<span class="name">{user.displayName || user.username}</span>
								<span class="hint">@{user.username}</span>
							</span>
						</button>
					{/each}
				{/if}

				{#if searchMessages.length}
					<div class="list-section-label">{i18n.t('chats.searchMessages')}</div>
					{#each searchMessages as hit (hit.messageId)}
						<button
							class="user-row search-msg-row"
							type="button"
							onclick={() => openChat(hit.chatId, hit.messageId)}
						>
							{#if hit.channel}
								<ChannelAvatar channelKey={hit.channel.key} size={44} />
								<span class="search-user-meta">
									<span class="name">{i18n.t(`channel.${hit.channel.key}.title`)}</span>
									<span class="hint msg-snippet">{snippet(hit.body, q)}</span>
								</span>
							{:else if hit.peer}
								<Avatar
									name={hit.peer.displayName || hit.peer.username}
									size={44}
									avatarPath={hit.peer.avatarPath}
									userId={hit.peer.id}
								/>
								<span class="search-user-meta">
									<span class="name">{hit.peer.displayName || hit.peer.username}</span>
									<span class="hint msg-snippet">{snippet(hit.body, q)}</span>
								</span>
							{/if}
							<span class="time">{formatRelativeTime(hit.createdAt, i18n.locale)}</span>
						</button>
					{/each}
				{/if}
			{/if}
		{:else if data.chats.length === 0}
			<div class="empty empty-animate">
				<span class="empty-icon"><MessageCircle size={36} /></span>
				<p>{i18n.t('chats.empty')}</p>
				<p class="search-hint">{i18n.t('chats.searchHint')}</p>
			</div>
		{:else}
			{#if pinned.length}
				<div class="list-section-label">{i18n.t('chats.pinnedSection')}</div>
				{#each pinned as chat, i (chat.id)}
					{@render chatRow(chat, i, true)}
				{/each}
			{/if}
			{#each unpinned as chat, i (chat.id)}
				{@render chatRow(chat, pinned.length + i, true)}
			{/each}
		{/if}
	</div>
</div>

{#snippet chatRow(chat: PageData['chats'][number], index: number, swipeable: boolean)}
	{@const tx = swipeable ? rowOffset(chat.id) : 0}
	{@const icon = previewIcon(chat)}
	<div
		class="chat-row-wrap"
		class:menu-open={swipeable && (openId === chat.id || (activeId === chat.id && tx < -40))}
		class:swiping={swipeable && activeId === chat.id && dragging}
		style="animation-delay:{Math.min(index, 6) * 40}ms; --row-x:{tx}px"
		role="group"
		onpointerdown={swipeable ? (e) => onRowDown(e, chat.id) : undefined}
		onpointermove={swipeable ? onRowMove : undefined}
		onpointerup={swipeable ? onRowUp : undefined}
		onpointercancel={swipeable ? onRowUp : undefined}
	>
		{#if swipeable}
			<div class="row-actions-under">
				<button
					type="button"
					class="row-action pin"
					aria-label={chat.pinned ? i18n.t('actions.unpin') : i18n.t('actions.pin')}
					onclick={(e) => {
						e.stopPropagation();
						setPref(chat.id, { pinned: !chat.pinned });
					}}
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
					onclick={(e) => {
						e.stopPropagation();
						setPref(chat.id, { muted: !chat.muted });
					}}
				>
					{#if chat.muted}
						<Bell size={18} />
					{:else}
						<BellOff size={18} />
					{/if}
				</button>
				<button
					type="button"
					class="row-action archive"
					aria-label={i18n.t('chat.archive')}
					onclick={(e) => {
						e.stopPropagation();
						setPref(chat.id, { archived: true });
					}}
				>
					<Archive size={18} />
				</button>
			</div>
		{/if}
		<button
			type="button"
			class="chat-row"
			class:muted={chat.muted}
			class:unread={chat.unreadCount > 0}
			onclick={() => (swipeable ? onRowClick(chat.id) : openChat(chat.id))}
		>
			{#if chat.kind === 'channel' && chat.channel}
				<ChannelAvatar channelKey={chat.channel.key} size={48} />
			{:else if chat.peer}
				<Avatar
					name={displayName(chat)}
					avatarPath={chat.peer.avatarPath}
					userId={chat.peer.id}
					online={peerOnline(chat)}
				/>
			{/if}
			<div class="meta">
				<div class="row-top">
					<p class="name">
						{#if chat.pinned}
							<span class="pin-icon"><Pin size={12} /></span>
						{/if}
						{#if chat.kind === 'channel'}
							{displayName(chat)}
						{:else}
							<NameWithBadges
								name={displayName(chat)}
								badges={chat.peer?.badges ?? []}
								size="sm"
							/>
						{/if}
					</p>
					{#if chat.lastMessage}
						<span class="time">{formatRelativeTime(chat.lastMessage.createdAt, i18n.locale)}</span>
					{/if}
				</div>
				<div class="row-bottom">
					<p class="preview" class:draft={!!drafts[chat.id]} class:failed-send={failedChats.has(chat.id)}>
						{#if icon === 'voice'}
							<span class="preview-ico"><Mic size={14} /></span>
						{:else if icon === 'image'}
							<span class="preview-ico"><ImageIcon size={14} /></span>
						{/if}
						{preview(chat)}
					</p>
					{#if failedChats.has(chat.id)}
						<span class="unread-badge fail">!</span>
					{:else if chat.unreadCount > 0}
						<span class="unread-badge pop" class:quiet={chat.muted}
							>{chat.unreadCount > 99 ? '99+' : chat.unreadCount}</span
						>
					{/if}
				</div>
			</div>
		</button>
	</div>
{/snippet}

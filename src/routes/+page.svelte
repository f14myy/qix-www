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
	import Hand from '@lucide/svelte/icons/hand';
	import X from '@lucide/svelte/icons/x';
	import Avatar from '$lib/components/Avatar.svelte';
	import ChannelAvatar from '$lib/components/ChannelAvatar.svelte';
	import CoachTip from '$lib/components/CoachTip.svelte';
	import NameWithBadges from '$lib/components/NameWithBadges.svelte';
	import { lastMessagePreview } from '$lib/chatPreview';
	import { dismissCoach, markCoachShown, shouldShowCoach } from '$lib/coach';
	import { toast } from '$lib/flash.svelte';
	import { haptic } from '$lib/haptic';
	import { useI18n } from '$lib/i18n/useI18n.svelte';
	import { notifyMessage } from '$lib/notify';
	import { shouldForceOnboarding } from '$lib/onboarding';
	import { listQueued } from '$lib/sendQueue';
	import { formatRelativeTime, isOnlineIso } from '$lib/time';
	import { APP_VERSION } from '$lib/version';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const i18n = useI18n();
	let filter = $state('');
	let searching = $state(false);
	let showHoldHint = $state(false);
	let showSearchHint = $state(false);
	let showChannelsHint = $state(false);
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
	let menuId = $state<string | null>(null);
	let holdingId = $state<string | null>(null);
	let holdTimer: ReturnType<typeof setTimeout> | undefined;
	let holdChatId: string | null = null;
	let holdStartX = 0;
	let holdStartY = 0;
	let holdMoved = false;
	let skipClickUntil = 0;
	let detachHoldListeners: (() => void) | null = null;
	let prefBusy = $state(false);
	let pullStartY = 0;
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

	const HOLD_MS = 440;
	const HOLD_MOVE_SLOP = 40;
	const SKIP_CLICK_MS = 650;

	const menuChat = $derived(
		menuId
			? data.chats.find((c) => c.id === menuId) ??
					searchChats.find((c) => c.id === menuId) ??
					null
			: null
	);

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
		return lastMessagePreview(chat, {
			userId: data.user?.id,
			t: i18n.t,
			draft: drafts[chat.id],
			failed: failedChats.has(chat.id)
		});
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
		if (prefBusy) return;
		prefBusy = true;
		try {
			await fetch(`/api/chats/${chatId}/prefs`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(patch)
			});
			closeMenu();
			await invalidateAll();
		} finally {
			prefBusy = false;
		}
	}

	function portal(node: HTMLElement) {
		const host = document.querySelector('.app-shell') ?? document.body;
		host.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}

	function setSheetOpen(open: boolean) {
		if (typeof document === 'undefined') return;
		document.documentElement.classList.toggle('sheet-open', open);
	}

	function clearHoldTimer() {
		if (holdTimer) clearTimeout(holdTimer);
		holdTimer = undefined;
	}

	function endHoldTracking() {
		clearHoldTimer();
		detachHoldListeners?.();
		detachHoldListeners = null;
		holdChatId = null;
		holdingId = null;
		holdMoved = false;
	}

	function closeMenu() {
		menuId = null;
		prefBusy = false;
		endHoldTracking();
		setSheetOpen(false);
	}

	function openMenu(id: string) {
		clearHoldTimer();
		holdingId = null;
		holdChatId = null;
		pulling = false;
		pullY = 0;
		menuId = id;
		skipClickUntil = Date.now() + SKIP_CLICK_MS;
		setSheetOpen(true);
		haptic([8, 40, 14]);
	}

	function onRowPointerDown(e: PointerEvent, id: string) {
		if (e.button !== undefined && e.button !== 0) return;
		if (menuId) {
			closeMenu();
			skipClickUntil = Date.now() + SKIP_CLICK_MS;
			return;
		}

		endHoldTracking();
		holdMoved = false;
		holdStartX = e.clientX;
		holdStartY = e.clientY;
		holdChatId = id;
		holdingId = id;

		const pointerId = e.pointerId;
		const onMove = (ev: PointerEvent) => {
			if (ev.pointerId !== pointerId) return;
			if (!holdChatId || menuId) return;
			const dx = ev.clientX - holdStartX;
			const dy = ev.clientY - holdStartY;
			if (dx * dx + dy * dy > HOLD_MOVE_SLOP * HOLD_MOVE_SLOP) {
				holdMoved = true;
				clearHoldTimer();
				holdingId = null;
			}
		};
		const onUp = (ev: PointerEvent) => {
			if (ev.pointerId !== pointerId) return;
			clearHoldTimer();
			holdingId = null;
			holdChatId = null;
			detachHoldListeners?.();
			detachHoldListeners = null;
		};

		window.addEventListener('pointermove', onMove, { passive: true });
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
		detachHoldListeners = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
		};

		holdTimer = setTimeout(() => {
			if (holdChatId !== id || holdMoved) return;
			openMenu(id);
		}, HOLD_MS);
	}

	function onRowContextMenu(e: MouseEvent, id: string) {
		e.preventDefault();
		e.stopPropagation();
		openMenu(id);
	}

	function onRowClick(id: string) {
		if (Date.now() < skipClickUntil) return;
		if (menuId) {
			closeMenu();
			return;
		}
		openChat(id);
	}

	function onMenuKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && menuId) {
			e.preventDefault();
			closeMenu();
		}
	}

	function onListTouchStart(e: TouchEvent) {
		if (holdChatId || holdingId || menuId) return;
		if (!listEl || listEl.scrollTop > 0 || refreshing) return;
		pullStartY = e.touches[0].clientY;
		pulling = true;
	}

	function onListTouchMove(e: TouchEvent) {
		if (holdChatId || holdingId || menuId) {
			pulling = false;
			pullY = 0;
			return;
		}
		if (!pulling || refreshing) return;
		const dy = e.touches[0].clientY - pullStartY;
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
		closeMenu();
		// Never navigate into a built-in channel id by mistake from DM helpers
		const href = messageId ? `/chat/${id}?m=${encodeURIComponent(messageId)}` : `/chat/${id}`;
		void goto(href);
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
				toast(i18n.t('requests.sent'));
				return;
			}
			if (res.ok && json.chatId) openChat(json.chatId);
			else toast(json.error || i18n.t('common.error'), 'err');
		} finally {
			openingUser = false;
		}
	}

	onMount(() => {
		if (shouldForceOnboarding()) {
			void goto('/onboarding');
			return;
		}
		loadLocalHints();
		try {
			if (shouldShowCoach('qix-hint-search')) {
				showSearchHint = true;
				markCoachShown('qix-hint-search');
			} else if (shouldShowCoach('qix-hint-channels') && data.chats.some((c) => c.kind === 'channel')) {
				showChannelsHint = true;
				markCoachShown('qix-hint-channels');
			} else if (shouldShowCoach('qix-hint-hold-list') && data.chats.length > 0) {
				showHoldHint = true;
				markCoachShown('qix-hint-hold-list');
			}
		} catch {
			/* ignore */
		}
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
			endHoldTracking();
			setSheetOpen(false);
		};
	});
</script>

<svelte:window onfocus={refresh} onkeydown={onMenuKeydown} />

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
			<button
				type="button"
				class="icon-btn"
				aria-label={i18n.t('common.settings')}
				onclick={() => goto('/settings')}
			>
				<Settings size={20} />
			</button>
		</div>
	</header>

	{#if showSearchHint}
		<CoachTip
			class="list-coach"
			actionLabel={i18n.t('coach.gotIt')}
			ondismiss={() => {
				showSearchHint = false;
				dismissCoach('qix-hint-search');
			}}
		>
			{#snippet icon()}
				<Search size={20} />
			{/snippet}
			<p>{i18n.t('coach.search')}</p>
		</CoachTip>
	{:else if showChannelsHint}
		<CoachTip
			class="list-coach"
			tone="soft"
			actionLabel={i18n.t('coach.gotIt')}
			ondismiss={() => {
				showChannelsHint = false;
				dismissCoach('qix-hint-channels');
			}}
		>
			{#snippet icon()}
				<Bell size={20} />
			{/snippet}
			<p>{i18n.t('coach.channels')}</p>
		</CoachTip>
	{:else if showHoldHint}
		<CoachTip
			class="list-coach"
			actionLabel={i18n.t('chats.holdHintDismiss')}
			ondismiss={() => {
				showHoldHint = false;
				dismissCoach('qix-hint-hold-list');
			}}
		>
			{#snippet icon()}
				<Hand size={20} />
			{/snippet}
			<p>{i18n.t('chats.holdHint')}</p>
		</CoachTip>
	{/if}

	<div class="list-filter">
		<span class="list-filter-ico" aria-hidden="true"><Search size={16} /></span>
		<input
			bind:this={searchInput}
			type="search"
			placeholder={i18n.t('chats.filter')}
			aria-label={i18n.t('common.search')}
			bind:value={filter}
			oninput={onFilterInput}
			autocomplete="off"
			enterkeyhint="search"
		/>
		{#if filter}
			<button
				type="button"
				class="list-filter-clear"
				aria-label={i18n.t('common.clear')}
				onclick={clearSearch}
			>
				<X size={16} />
			</button>
		{/if}
	</div>

	<div
		class="list"
		class:is-holding={!!holdingId || !!menuId}
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
						{@render chatRow(chat, i, true)}
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
				<strong>{i18n.t('chats.emptyTitle')}</strong>
				<p>{i18n.t('chats.empty')}</p>
				<button
					type="button"
					class="btn"
					onclick={() => {
						searchInput?.focus();
						filter = '';
					}}
				>
					{i18n.t('chats.emptyCta')}
				</button>
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
	<p class="app-version" aria-hidden="true">{APP_VERSION}</p>
</div>

{#if menuChat}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="chat-menu-portal" use:portal>
		<div class="menu-backdrop" onclick={closeMenu}></div>
		<div
			class="msg-sheet"
			role="dialog"
			aria-modal="true"
			aria-label={displayName(menuChat)}
		>
			<div class="msg-menu">
				<button
					type="button"
					disabled={prefBusy}
					onclick={() => setPref(menuChat.id, { pinned: !menuChat.pinned })}
				>
					<span class="sheet-row-ico">
						{#if menuChat.pinned}
							<PinOff size={18} />
						{:else}
							<Pin size={18} />
						{/if}
					</span>
					{menuChat.pinned ? i18n.t('actions.unpin') : i18n.t('actions.pin')}
				</button>
				<button
					type="button"
					disabled={prefBusy}
					onclick={() => setPref(menuChat.id, { muted: !menuChat.muted })}
				>
					<span class="sheet-row-ico">
						{#if menuChat.muted}
							<Bell size={18} />
						{:else}
							<BellOff size={18} />
						{/if}
					</span>
					{menuChat.muted ? i18n.t('actions.unmute') : i18n.t('actions.mute')}
				</button>
				<button
					type="button"
					class="danger"
					disabled={prefBusy}
					onclick={() => setPref(menuChat.id, { archived: true })}
				>
					<span class="sheet-row-ico"><Archive size={18} /></span>
					{i18n.t('chat.archive')}
				</button>
			</div>
		</div>
	</div>
{/if}

{#snippet chatRow(chat: PageData['chats'][number], index: number, withActions: boolean)}
	{@const icon = previewIcon(chat)}
	<div
		class="chat-row-wrap"
		class:holding={holdingId === chat.id}
		class:menu-open={menuId === chat.id}
		style="animation-delay:{Math.min(index, 6) * 40}ms"
		role="group"
	>
		<button
			type="button"
			class="chat-row"
			class:muted={chat.muted}
			class:unread={chat.unreadCount > 0}
			class:holding={holdingId === chat.id}
			onclick={() => (withActions ? onRowClick(chat.id) : openChat(chat.id))}
			onpointerdown={withActions ? (e) => onRowPointerDown(e, chat.id) : undefined}
			oncontextmenu={withActions ? (e) => onRowContextMenu(e, chat.id) : undefined}
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

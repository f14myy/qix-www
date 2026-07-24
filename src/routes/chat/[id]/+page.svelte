<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Avatar from '$lib/components/Avatar.svelte';
	import ChatBubble from '$lib/components/ChatBubble.svelte';
	import Composer from '$lib/components/Composer.svelte';
	import DateSeparator from '$lib/components/DateSeparator.svelte';
	import ImageLightbox from '$lib/components/ImageLightbox.svelte';
	import NameWithBadges from '$lib/components/NameWithBadges.svelte';
	import { haptic, hapticFail, hapticSuccess } from '$lib/haptic';
	import { useI18n } from '$lib/i18n/useI18n.svelte';
	import {
		enqueueSend,
		filesFromQueued,
		listQueued,
		removeQueued,
		serializeFiles
	} from '$lib/sendQueue';
	import { dayKey, formatDayLabel, isOnlineIso, formatLastSeen } from '$lib/time';
	import type { MessageDTO } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const i18n = useI18n();

	let messages = $state<MessageDTO[]>([]);
	let peerLastReadAt = $state<string | null>(null);
	let myLastReadAt = $state<string | null>(null);
	let listEl: HTMLDivElement | undefined = $state();
	let error = $state('');
	let typing = $state(false);
	let typingTimer: ReturnType<typeof setTimeout> | undefined;
	let replyTo = $state<MessageDTO | null>(null);
	let editing = $state<MessageDTO | null>(null);
	let peerSeen = $state<string | null>(null);
	let lastTypingSent = 0;
	let highlightId = $state<string | null>(null);
	let atBottom = $state(true);
	let showJump = $state(false);
	let stickyLabel = $state('');
	let lightbox = $state<{ urls: string[]; index: number } | null>(null);
	let viewportH = $state(0);
	let viewportOffset = $state(0);
	let keyboardOpen = $state(false);
	let hasMore = $state(true);
	let loadingOlder = $state(false);
	let pendingNewCount = $state(0);
	let firstUnreadId = $state<string | null>(null);

	type TimelineItem =
		| { kind: 'sep'; key: string; label: string }
		| {
				kind: 'msg';
				key: string;
				message: MessageDTO;
				grouped: boolean;
				tail: boolean;
		  };

	const GROUP_MS = 2 * 60 * 1000;

	const timeline = $derived.by(() => {
		const items: TimelineItem[] = [];
		let lastDay = '';
		for (let i = 0; i < messages.length; i++) {
			const message = messages[i];
			const key = dayKey(message.createdAt);
			if (key !== lastDay) {
				items.push({
					kind: 'sep',
					key: `d-${key}`,
					label: formatDayLabel(message.createdAt, i18n.locale)
				});
				lastDay = key;
			}
			const prev = messages[i - 1];
			const next = messages[i + 1];
			const samePrev =
				!!prev &&
				prev.senderId === message.senderId &&
				dayKey(prev.createdAt) === key &&
				Math.abs(new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime()) <
					GROUP_MS;
			const sameNext =
				!!next &&
				next.senderId === message.senderId &&
				dayKey(next.createdAt) === key &&
				Math.abs(new Date(next.createdAt).getTime() - new Date(message.createdAt).getTime()) <
					GROUP_MS;
			items.push({
				kind: 'msg',
				key: message.id,
				message,
				grouped: samePrev,
				tail: !sameNext
			});
		}
		return items;
	});

	const peerTitle = $derived(data.peer.displayName || data.peer.username);
	const online = $derived(typing || isOnlineIso(peerSeen));
	const statusText = $derived(
		typing
			? i18n.t('chat.typing')
			: isOnlineIso(peerSeen)
				? i18n.t('chat.online')
				: peerSeen
					? i18n.t('chat.lastSeen', { when: formatLastSeen(peerSeen, i18n.locale) })
					: ''
	);

	const showJumpUnread = $derived(
		!!firstUnreadId && !atBottom && messages.some((m) => m.id === firstUnreadId)
	);

	$effect(() => {
		messages = [...data.messages];
		peerLastReadAt = data.peerLastReadAt;
		myLastReadAt = data.myLastReadAt;
		peerSeen = data.peer.lastSeenAt;
		hasMore = data.messages.length >= 100;
		computeFirstUnread(data.messages, data.myLastReadAt);
	});

	function computeFirstUnread(list: MessageDTO[], readAt: string | null) {
		if (!readAt || !data.user) {
			firstUnreadId = null;
			return;
		}
		const t = new Date(readAt).getTime();
		const found = list.find(
			(m) => m.senderId !== data.user!.id && new Date(m.createdAt).getTime() > t
		);
		firstUnreadId = found?.id ?? null;
	}

	function nearBottom(el: HTMLDivElement, threshold = 96) {
		return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
	}

	function scrollToBottom(smooth = false) {
		requestAnimationFrame(() => {
			if (!listEl) return;
			listEl.scrollTo({ top: listEl.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
			atBottom = true;
			showJump = false;
			pendingNewCount = 0;
		});
	}

	async function loadOlder() {
		if (!listEl || loadingOlder || !hasMore || messages.length === 0) return;
		const oldest = messages.find((m) => !m.id.startsWith('tmp-'));
		if (!oldest) return;
		loadingOlder = true;
		const prevHeight = listEl.scrollHeight;
		const prevTop = listEl.scrollTop;
		try {
			const res = await fetch(`/api/chats/${data.chatId}/messages?before=${oldest.id}`);
			const json = await res.json();
			if (!res.ok) return;
			const older = (json.messages as MessageDTO[]) || [];
			hasMore = older.length >= 100;
			if (!older.length) return;
			const existing = new Set(messages.map((m) => m.id));
			const unique = older.filter((m) => !existing.has(m.id));
			messages = [...unique, ...messages];
			requestAnimationFrame(() => {
				if (!listEl) return;
				listEl.scrollTop = prevTop + (listEl.scrollHeight - prevHeight);
			});
		} finally {
			loadingOlder = false;
		}
	}

	function onListScroll() {
		if (!listEl) return;
		atBottom = nearBottom(listEl);
		showJump = !atBottom;
		if (atBottom) pendingNewCount = 0;
		updateStickyDate();
		if (listEl.scrollTop < 80) loadOlder();
	}

	function updateStickyDate() {
		if (!listEl) return;
		const seps = listEl.querySelectorAll<HTMLElement>('[data-day-label]');
		const top = listEl.getBoundingClientRect().top + 8;
		let label = '';
		for (const el of seps) {
			if (el.getBoundingClientRect().top <= top) {
				label = el.dataset.dayLabel || '';
			}
		}
		stickyLabel = label;
	}

	function upsert(msg: MessageDTO, opts?: { forceScroll?: boolean }) {
		const wasNear = listEl ? nearBottom(listEl) : true;
		const idx = messages.findIndex((m) => m.id === msg.id);
		if (idx === -1) messages = [...messages, msg];
		else {
			const next = [...messages];
			next[idx] = msg;
			messages = next;
		}
		const mine = msg.senderId === data.user?.id;
		if (opts?.forceScroll || wasNear || mine) {
			scrollToBottom(true);
		} else {
			showJump = true;
			if (!mine) pendingNewCount += 1;
		}
	}

	function jumpTo(id: string) {
		highlightId = id;
		const el = document.getElementById(`msg-${id}`);
		el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		setTimeout(() => {
			if (highlightId === id) highlightId = null;
		}, 1200);
	}

	function markFailed(tmpId: string) {
		messages = messages.map((m) =>
			m.id === tmpId ? { ...m, sendStatus: 'failed' as const } : m
		);
		hapticFail();
	}

	function markPending(tmpId: string) {
		messages = messages.map((m) =>
			m.id === tmpId ? { ...m, sendStatus: 'pending' as const } : m
		);
	}

	async function postMessage(payload: {
		tmpId: string;
		body: string;
		files: File[];
		kind?: 'text' | 'voice';
		replyToId?: string | null;
	}) {
		const form = new FormData();
		form.set('body', payload.body);
		if (payload.kind) form.set('kind', payload.kind);
		if (payload.replyToId) form.set('replyToId', payload.replyToId);
		for (const file of payload.files) form.append('files', file);

		try {
			const res = await fetch(`/api/chats/${data.chatId}/messages`, {
				method: 'POST',
				body: form
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				await enqueueSend({
					tmpId: payload.tmpId,
					chatId: data.chatId,
					body: payload.body,
					kind: payload.kind || 'text',
					replyToId: payload.replyToId ?? null,
					files: await serializeFiles(payload.files),
					createdAt: Date.now()
				});
				markFailed(payload.tmpId);
				error = (json as { error?: string }).error || i18n.t('chat.sendFailed');
				return false;
			}
			await removeQueued(payload.tmpId);
			messages = messages.filter((m) => m.id !== payload.tmpId);
			upsert(json.message as MessageDTO, { forceScroll: true });
			hapticSuccess();
			replyTo = null;
			return true;
		} catch {
			await enqueueSend({
				tmpId: payload.tmpId,
				chatId: data.chatId,
				body: payload.body,
				kind: payload.kind || 'text',
				replyToId: payload.replyToId ?? null,
				files: await serializeFiles(payload.files),
				createdAt: Date.now()
			});
			markFailed(payload.tmpId);
			error = i18n.t('chat.sendFailed');
			return false;
		}
	}

	async function retrySend(message: MessageDTO) {
		if (!message.id.startsWith('tmp-')) return;
		markPending(message.id);
		error = '';
		const queued = (await listQueued(data.chatId)).find((q) => q.tmpId === message.id);
		const files = queued ? await filesFromQueued(queued.files) : [];
		await postMessage({
			tmpId: message.id,
			body: message.body,
			files,
			kind: (message.kind as 'text' | 'voice') || 'text',
			replyToId: message.replyTo?.id ?? null
		});
	}

	async function flushQueue() {
		const queued = await listQueued(data.chatId);
		for (const item of queued) {
			const existing = messages.find((m) => m.id === item.tmpId);
			if (!existing) {
				const optimistic: MessageDTO = {
					id: item.tmpId,
					chatId: item.chatId,
					senderId: data.user!.id,
					body: item.body,
					kind: item.kind,
					createdAt: new Date(item.createdAt).toISOString(),
					editedAt: null,
					deletedAt: null,
					replyTo: null,
					attachments: [],
					linkPreview: null,
					reactions: [],
					sendStatus: 'pending'
				};
				messages = [...messages, optimistic];
			} else {
				markPending(item.tmpId);
			}
			const files = await filesFromQueued(item.files);
			await postMessage({
				tmpId: item.tmpId,
				body: item.body,
				files,
				kind: item.kind,
				replyToId: item.replyToId
			});
		}
	}

	function buildOptimistic(
		tmpId: string,
		payload: {
			body: string;
			kind?: 'text' | 'voice';
			replyToId?: string | null;
		}
	): MessageDTO {
		return {
			id: tmpId,
			chatId: data.chatId,
			senderId: data.user!.id,
			body: payload.body,
			kind: payload.kind || 'text',
			createdAt: new Date().toISOString(),
			editedAt: null,
			deletedAt: null,
			replyTo: payload.replyToId
				? (() => {
						const src = messages.find((m) => m.id === payload.replyToId);
						return src
							? {
									id: src.id,
									senderId: src.senderId,
									body: src.body,
									deleted: !!src.deletedAt
								}
							: null;
					})()
				: null,
			attachments: [],
			linkPreview: null,
			reactions: [],
			sendStatus: 'pending'
		};
	}

	onMount(() => {
		scrollToBottom();
		fetch(`/api/chats/${data.chatId}/read`, { method: 'POST' });
		fetch('/api/presence', { method: 'POST' });
		flushQueue();

		const jumpId =
			typeof window !== 'undefined'
				? new URLSearchParams(window.location.search).get('m')
				: null;
		if (jumpId) {
			queueMicrotask(() => jumpTo(jumpId));
			history.replaceState({}, '', `/chat/${data.chatId}`);
		}

		let es: EventSource | null = null;
		let presenceEs: EventSource | null = null;
		let beat: ReturnType<typeof setInterval> | undefined;

		const onChatMessage = (ev: MessageEvent) => {
			try {
				const msg = JSON.parse(ev.data) as MessageDTO;
				messages = messages.filter(
					(m) =>
						!(
							m.id.startsWith('tmp-') &&
							m.senderId === msg.senderId &&
							m.body === msg.body &&
							Math.abs(new Date(m.createdAt).getTime() - new Date(msg.createdAt).getTime()) <
								30_000
						)
				);
				upsert(msg);
				if (msg.senderId !== data.user?.id) {
					fetch(`/api/chats/${data.chatId}/read`, { method: 'POST' });
				}
			} catch {
				/* ignore */
			}
		};

		function connectStreams() {
			es?.close();
			presenceEs?.close();
			if (beat) clearInterval(beat);

			es = new EventSource(`/api/chats/${data.chatId}/events`);
			es.addEventListener('message', onChatMessage);
			es.addEventListener('message_update', (ev) => {
				try {
					upsert(JSON.parse(ev.data) as MessageDTO);
				} catch {
					/* ignore */
				}
			});
			es.addEventListener('message_delete', (ev) => {
				try {
					upsert(JSON.parse(ev.data) as MessageDTO);
				} catch {
					/* ignore */
				}
			});
			es.addEventListener('reaction', (ev) => {
				try {
					upsert(JSON.parse(ev.data) as MessageDTO);
				} catch {
					/* ignore */
				}
			});
			es.addEventListener('typing', (ev) => {
				try {
					const d = JSON.parse(ev.data) as { userId: string };
					if (d.userId === data.user?.id) return;
					typing = true;
					clearTimeout(typingTimer);
					typingTimer = setTimeout(() => (typing = false), 2500);
				} catch {
					/* ignore */
				}
			});
			es.addEventListener('read', (ev) => {
				try {
					const d = JSON.parse(ev.data) as { userId: string; readAt: string };
					if (d.userId !== data.user?.id) peerLastReadAt = d.readAt;
				} catch {
					/* ignore */
				}
			});

			presenceEs = new EventSource('/api/events');
			presenceEs.addEventListener('presence', (ev) => {
				try {
					const d = JSON.parse(ev.data) as { userId: string; lastSeenAt: string };
					if (d.userId === data.peer.id) peerSeen = d.lastSeenAt;
				} catch {
					/* ignore */
				}
			});

			beat = setInterval(() => fetch('/api/presence', { method: 'POST' }), 25000);
		}

		function disconnectStreams() {
			es?.close();
			es = null;
			presenceEs?.close();
			presenceEs = null;
			if (beat) {
				clearInterval(beat);
				beat = undefined;
			}
		}

		const onVisibility = () => {
			if (document.hidden) disconnectStreams();
			else {
				connectStreams();
				fetch('/api/presence', { method: 'POST' });
			}
		};

		connectStreams();
		document.addEventListener('visibilitychange', onVisibility);
		window.addEventListener('online', flushQueue);

		const vv = window.visualViewport;
		const syncKb = () => {
			const h = vv?.height ?? window.innerHeight;
			viewportH = h;
			viewportOffset = vv?.offsetTop ?? 0;
			keyboardOpen = h < window.innerHeight - 80;
			if (atBottom) scrollToBottom(false);
		};
		vv?.addEventListener('resize', syncKb);
		vv?.addEventListener('scroll', syncKb);
		syncKb();

		return () => {
			disconnectStreams();
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('online', flushQueue);
			clearTimeout(typingTimer);
			vv?.removeEventListener('resize', syncKb);
			vv?.removeEventListener('scroll', syncKb);
		};
	});

	function emitTyping() {
		const now = Date.now();
		if (now - lastTypingSent < 1200) return;
		lastTypingSent = now;
		fetch(`/api/chats/${data.chatId}/typing`, { method: 'POST' });
	}

	async function send(payload: {
		body: string;
		files: File[];
		kind?: 'text' | 'voice';
		replyToId?: string | null;
		editId?: string | null;
	}) {
		error = '';
		if (payload.editId) {
			const res = await fetch(`/api/chats/${data.chatId}/messages/${payload.editId}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ body: payload.body })
			});
			const json = await res.json();
			if (!res.ok) {
				error = json.error || i18n.t('chat.sendFailed');
				hapticFail();
				return;
			}
			upsert(json.message, { forceScroll: true });
			editing = null;
			hapticSuccess();
			return;
		}

		const tmpId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
		const optimistic = buildOptimistic(tmpId, payload);
		upsert(optimistic, { forceScroll: true });

		await postMessage({
			tmpId,
			body: payload.body,
			files: payload.files,
			kind: payload.kind,
			replyToId: payload.replyToId
		});
	}

	async function react(message: MessageDTO, emoji: string) {
		haptic(8);
		const res = await fetch(`/api/chats/${data.chatId}/messages/${message.id}/reactions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ emoji })
		});
		const json = await res.json();
		if (res.ok) upsert(json.message);
	}

	async function remove(message: MessageDTO) {
		const res = await fetch(`/api/chats/${data.chatId}/messages/${message.id}`, {
			method: 'DELETE'
		});
		const json = await res.json();
		if (res.ok) upsert(json.message);
	}

	function goBack() {
		const run = () => goto('/');
		if (typeof document !== 'undefined' && 'startViewTransition' in document) {
			(document as Document & { startViewTransition: (cb: () => void) => void }).startViewTransition(
				run
			);
		} else {
			run();
		}
	}
</script>

<div
	class="screen chat-view"
	class:kb-open={keyboardOpen}
	style="padding-bottom:0;{viewportH
		? `height:${viewportH}px;max-height:${viewportH}px;transform:translateY(${viewportOffset}px;`
		: ''}"
>
	<header class="topbar chat-topbar">
		<button type="button" class="icon-btn back-btn" aria-label={i18n.t('back')} onclick={goBack}>
			<ArrowLeft size={22} />
		</button>
		<a class="peer-link" href="/u/{data.peer.username}">
			<Avatar
				name={peerTitle}
				size={34}
				avatarPath={data.peer.avatarPath}
				userId={data.peer.id}
			/>
			<div class="peer-meta">
				<h1 class="peer-title">
					<NameWithBadges name={peerTitle} badges={data.peer.badges} size="sm" />
				</h1>
				{#if statusText}
					<span class="peer-status" class:online>
						{#if typing}
							<span class="typing-label">{i18n.t('chat.typing')}</span>
							<span class="typing-dots" aria-hidden="true"
								><i></i><i></i><i></i></span
							>
						{:else}
							{statusText}
						{/if}
					</span>
				{/if}
			</div>
		</a>
	</header>

	<div class="messages-wrap">
		{#if stickyLabel}
			<div class="sticky-date" aria-hidden="true"><span>{stickyLabel}</span></div>
		{/if}

		{#if loadingOlder}
			<div class="load-older" aria-hidden="true"><span></span></div>
		{/if}

		<div class="messages" bind:this={listEl} onscroll={onListScroll}>
			{#if messages.length === 0}
				<div class="chat-skeleton" aria-hidden="true">
					<span class="sk sk-them"></span>
					<span class="sk sk-me"></span>
					<span class="sk sk-them short"></span>
				</div>
			{/if}
			{#each timeline as item (item.key)}
				{#if item.kind === 'sep'}
					<div data-day-label={item.label}>
						<DateSeparator label={item.label} />
					</div>
				{:else}
					<ChatBubble
						message={item.message}
						mine={item.message.senderId === data.user?.id}
						{peerLastReadAt}
						locale={i18n.locale}
						t={i18n.t}
						highlight={highlightId === item.message.id}
						grouped={item.grouped}
						tail={item.tail}
						onreply={(m) => {
							replyTo = m;
							editing = null;
						}}
						onedit={(m) => {
							editing = m;
							replyTo = null;
						}}
						ondelete={remove}
						onreact={react}
						onjump={jumpTo}
						onretry={retrySend}
						onopenImage={(urls, index) => (lightbox = { urls, index })}
					/>
				{/if}
			{/each}
		</div>

		{#if showJumpUnread && firstUnreadId}
			<button
				type="button"
				class="jump-unread"
				onclick={() => jumpTo(firstUnreadId!)}
			>
				{i18n.t('chat.jumpUnread')}
			</button>
		{:else if showJump}
			<button
				type="button"
				class="jump-latest"
				aria-label={i18n.t('chat.jumpLatest')}
				onclick={() => scrollToBottom(true)}
			>
				<ChevronDown size={20} />
				{#if pendingNewCount > 0}
					<span class="jump-badge">{pendingNewCount > 99 ? '99+' : pendingNewCount}</span>
				{/if}
			</button>
		{/if}
	</div>

	{#if error}
		<p class="error" style="padding:4px 12px;background:var(--bg-elevated)">{error}</p>
	{/if}

	<Composer
		chatId={data.chatId}
		{replyTo}
		{editing}
		placeholder={i18n.t('chat.message')}
		replyingLabel={i18n.t('chat.replying')}
		editingLabel={i18n.t('chat.editing')}
		recordingLabel={i18n.t('chat.recording')}
		slideToCancelLabel={i18n.t('chat.slideToCancel')}
		releaseToCancelLabel={i18n.t('chat.releaseToCancel')}
		cameraLabel={i18n.t('chat.camera')}
		attachLabel={i18n.t('chat.attach')}
		ontyping={emitTyping}
		onclearReply={() => (replyTo = null)}
		onclearEdit={() => (editing = null)}
		onsend={send}
	/>
</div>

{#if lightbox}
	<ImageLightbox
		urls={lightbox.urls}
		index={lightbox.index}
		onclose={() => (lightbox = null)}
	/>
{/if}

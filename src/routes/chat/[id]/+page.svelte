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
	import { haptic } from '$lib/haptic';
	import { useI18n } from '$lib/i18n/useI18n.svelte';
	import { dayKey, formatDayLabel, isOnlineIso, formatLastSeen } from '$lib/time';
	import type { MessageDTO } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const i18n = useI18n();

	let messages = $state<MessageDTO[]>([]);
	let peerLastReadAt = $state<string | null>(null);
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

	$effect(() => {
		messages = [...data.messages];
		peerLastReadAt = data.peerLastReadAt;
		peerSeen = data.peer.lastSeenAt;
	});

	function nearBottom(el: HTMLDivElement, threshold = 96) {
		return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
	}

	function scrollToBottom(smooth = false) {
		requestAnimationFrame(() => {
			if (!listEl) return;
			listEl.scrollTo({ top: listEl.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
			atBottom = true;
			showJump = false;
		});
	}

	function onListScroll() {
		if (!listEl) return;
		atBottom = nearBottom(listEl);
		showJump = !atBottom;
		updateStickyDate();
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

	onMount(() => {
		scrollToBottom();
		fetch(`/api/chats/${data.chatId}/read`, { method: 'POST' });
		fetch('/api/presence', { method: 'POST' });

		const es = new EventSource(`/api/chats/${data.chatId}/events`);
		es.addEventListener('message', (ev) => {
			try {
				const msg = JSON.parse(ev.data) as MessageDTO;
				// Drop optimistic twin if server echo arrives
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
		});
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

		const presenceEs = new EventSource('/api/events');
		presenceEs.addEventListener('presence', (ev) => {
			try {
				const d = JSON.parse(ev.data) as { userId: string; lastSeenAt: string };
				if (d.userId === data.peer.id) peerSeen = d.lastSeenAt;
			} catch {
				/* ignore */
			}
		});

		const beat = setInterval(() => fetch('/api/presence', { method: 'POST' }), 25000);

		const vv = window.visualViewport;
		const syncKb = () => {
			viewportH = vv?.height ?? window.innerHeight;
			if (atBottom) scrollToBottom(false);
		};
		vv?.addEventListener('resize', syncKb);
		vv?.addEventListener('scroll', syncKb);
		syncKb();

		return () => {
			es.close();
			presenceEs.close();
			clearInterval(beat);
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
				return;
			}
			upsert(json.message, { forceScroll: true });
			editing = null;
			return;
		}

		const tmpId = `tmp-${Date.now()}`;
		const optimistic: MessageDTO = {
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
			reactions: []
		};
		if (!payload.files.length) {
			upsert(optimistic, { forceScroll: true });
		}

		const form = new FormData();
		form.set('body', payload.body);
		if (payload.kind) form.set('kind', payload.kind);
		if (payload.replyToId) form.set('replyToId', payload.replyToId);
		for (const file of payload.files) form.append('files', file);

		const res = await fetch(`/api/chats/${data.chatId}/messages`, { method: 'POST', body: form });
		const json = await res.json();
		if (!res.ok) {
			messages = messages.filter((m) => m.id !== tmpId);
			error = json.error || i18n.t('chat.sendFailed');
			return;
		}
		messages = messages.filter((m) => m.id !== tmpId);
		upsert(json.message as MessageDTO, { forceScroll: true });
		replyTo = null;
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
	style="padding-bottom:0;{viewportH ? `height:${viewportH}px;max-height:${viewportH}px;` : ''}"
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
				online={online && !typing}
			/>
			<div class="peer-meta">
				<h1 class="peer-title">{peerTitle}</h1>
				{#if statusText}
					<span class="peer-status" class:online>
						{#if online}
							<span class="online-dot"></span>
						{/if}
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
						onopenImage={(urls, index) => (lightbox = { urls, index })}
					/>
				{/if}
			{/each}
		</div>

		{#if showJump}
			<button
				type="button"
				class="jump-latest"
				aria-label={i18n.t('chat.jumpLatest')}
				onclick={() => scrollToBottom(true)}
			>
				<ChevronDown size={20} />
			</button>
		{/if}
	</div>

	{#if error}
		<p class="error" style="padding:4px 12px;background:var(--bg-elevated)">{error}</p>
	{/if}

	<Composer
		{replyTo}
		{editing}
		placeholder={i18n.t('chat.message')}
		replyingLabel={i18n.t('chat.replying')}
		editingLabel={i18n.t('chat.editing')}
		recordingLabel={i18n.t('chat.recording')}
		slideToCancelLabel={i18n.t('chat.slideToCancel')}
		releaseToCancelLabel={i18n.t('chat.releaseToCancel')}
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

<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Avatar from '$lib/components/Avatar.svelte';
	import ChatBubble from '$lib/components/ChatBubble.svelte';
	import Composer from '$lib/components/Composer.svelte';
	import DateSeparator from '$lib/components/DateSeparator.svelte';
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

	type TimelineItem =
		| { kind: 'sep'; key: string; label: string }
		| { kind: 'msg'; key: string; message: MessageDTO };

	const timeline = $derived.by(() => {
		const items: TimelineItem[] = [];
		let lastDay = '';
		for (const message of messages) {
			const key = dayKey(message.createdAt);
			if (key !== lastDay) {
				items.push({
					kind: 'sep',
					key: `d-${key}`,
					label: formatDayLabel(message.createdAt, i18n.locale)
				});
				lastDay = key;
			}
			items.push({ kind: 'msg', key: message.id, message });
		}
		return items;
	});

	const peerTitle = $derived(data.peer.displayName || data.peer.username);
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

	function scrollToBottom(smooth = false) {
		requestAnimationFrame(() => {
			if (!listEl) return;
			listEl.scrollTo({ top: listEl.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
		});
	}

	$effect(() => {
		messages.length;
		scrollToBottom(true);
	});

	function upsert(msg: MessageDTO) {
		const idx = messages.findIndex((m) => m.id === msg.id);
		if (idx === -1) messages = [...messages, msg];
		else {
			const next = [...messages];
			next[idx] = msg;
			messages = next;
		}
	}

	onMount(() => {
		scrollToBottom();
		fetch(`/api/chats/${data.chatId}/read`, { method: 'POST' });
		fetch('/api/presence', { method: 'POST' });

		const es = new EventSource(`/api/chats/${data.chatId}/events`);
		es.addEventListener('message', (ev) => {
			try {
				const msg = JSON.parse(ev.data) as MessageDTO;
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

		return () => {
			es.close();
			presenceEs.close();
			clearInterval(beat);
			clearTimeout(typingTimer);
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
			upsert(json.message);
			editing = null;
			return;
		}

		const form = new FormData();
		form.set('body', payload.body);
		if (payload.kind) form.set('kind', payload.kind);
		if (payload.replyToId) form.set('replyToId', payload.replyToId);
		for (const file of payload.files) form.append('files', file);

		const res = await fetch(`/api/chats/${data.chatId}/messages`, { method: 'POST', body: form });
		const json = await res.json();
		if (!res.ok) {
			error = json.error || i18n.t('chat.sendFailed');
			return;
		}
		upsert(json.message as MessageDTO);
		replyTo = null;
	}

	async function react(message: MessageDTO, emoji: string) {
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
</script>

<div class="screen chat-view">
	<header class="topbar chat-topbar">
		<button type="button" class="icon-btn" aria-label={i18n.t('back')} onclick={() => goto('/')}>
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
				<h1>{peerTitle}</h1>
				{#if statusText}
					<span class="peer-status" class:online={typing || isOnlineIso(peerSeen)}>{statusText}</span>
				{/if}
			</div>
		</a>
	</header>

	<div class="messages" bind:this={listEl}>
		{#each timeline as item (item.key)}
			{#if item.kind === 'sep'}
				<DateSeparator label={item.label} />
			{:else}
				<ChatBubble
					message={item.message}
					mine={item.message.senderId === data.user?.id}
					{peerLastReadAt}
					locale={i18n.locale}
					t={i18n.t}
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
				/>
			{/if}
		{/each}
	</div>

	{#if error}
		<p class="error" style="padding:4px 12px;background:var(--bg-elevated)">{error}</p>
	{/if}

	<Composer
		{replyTo}
		{editing}
		placeholder={i18n.t('chat.message')}
		recordingLabel={i18n.t('chat.recording')}
		ontyping={emitTyping}
		onclearReply={() => (replyTo = null)}
		onclearEdit={() => (editing = null)}
		onsend={send}
	/>
</div>

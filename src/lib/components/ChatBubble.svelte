<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import FileIcon from '@lucide/svelte/icons/file';
	import LinkCard from './LinkCard.svelte';
	import VoicePlayer from './VoicePlayer.svelte';
	import { formatMessageTime } from '$lib/time';
	import { REACTION_EMOJIS, type MessageDTO } from '$lib/types';
	import type { Locale } from '$lib/i18n';

	let {
		message,
		mine,
		peerLastReadAt = null as string | null,
		locale = 'en' as Locale,
		t,
		onreply,
		onedit,
		ondelete,
		onreact
	}: {
		message: MessageDTO;
		mine: boolean;
		peerLastReadAt?: string | null;
		locale?: Locale;
		t: (key: string) => string;
		onreply: (m: MessageDTO) => void;
		onedit: (m: MessageDTO) => void;
		ondelete: (m: MessageDTO) => void;
		onreact: (m: MessageDTO, emoji: string) => void;
	} = $props();

	let menuOpen = $state(false);
	let reactOpen = $state(false);
	let swipeX = $state(0);
	let startX = 0;

	const deleted = $derived(!!message.deletedAt);
	const read = $derived(
		mine &&
			!!peerLastReadAt &&
			new Date(peerLastReadAt).getTime() >= new Date(message.createdAt).getTime()
	);

	function isImage(mime: string) {
		return mime.startsWith('image/');
	}

	function onPointerDown(e: PointerEvent) {
		if (deleted) return;
		startX = e.clientX;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!startX) return;
		const dx = e.clientX - startX;
		swipeX = Math.max(0, Math.min(72, dx));
	}

	function onPointerUp() {
		if (swipeX > 56) onreply(message);
		swipeX = 0;
		startX = 0;
	}

	let pressTimer: ReturnType<typeof setTimeout> | undefined;
	function onPressStart() {
		pressTimer = setTimeout(() => {
			menuOpen = true;
		}, 480);
	}
	function onPressEnd() {
		clearTimeout(pressTimer);
	}
</script>

<div
	class="bubble-row"
	class:me={mine}
	style="transform:translateX({swipeX}px)"
	role="group"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
>
	{#if swipeX > 8}
		<span class="swipe-reply-hint">{t('chat.reply')}</span>
	{/if}

	<div
		class="bubble"
		class:me={mine}
		class:them={!mine}
		class:deleted
		onpointerdown={onPressStart}
		onpointerup={onPressEnd}
		onpointerleave={onPressEnd}
		role="group"
	>
		{#if deleted}
			<p class="body deleted-body">{t('chat.deletedBody')}</p>
		{:else}
			{#if message.replyTo}
				<button type="button" class="reply-quote" onclick={() => {}}>
					<span class="reply-bar"></span>
					<span>
						{#if message.replyTo.deleted}
							{t('chat.deletedBody')}
						{:else}
							{message.replyTo.body || '…'}
						{/if}
					</span>
				</button>
			{/if}

			{#if message.kind === 'voice' && message.attachments[0]}
				<VoicePlayer src="/api/files/{message.attachments[0].id}" />
			{:else if message.attachments.length}
				<div class="att-list">
					{#each message.attachments as att (att.id)}
						{#if isImage(att.mime)}
							<a href="/api/files/{att.id}" target="_blank" rel="noopener">
								<img class="att-image" src="/api/files/{att.id}" alt={att.filename} />
							</a>
						{:else}
							<a class="att-file" href="/api/files/{att.id}" target="_blank" rel="noopener">
								<FileIcon size={18} />
								<span>{att.filename}</span>
							</a>
						{/if}
					{/each}
				</div>
			{/if}

			{#if message.body}
				<p class="body">{message.body}</p>
			{/if}

			{#if message.linkPreview}
				<LinkCard preview={message.linkPreview} />
			{/if}

			{#if message.reactions.length}
				<div class="reaction-chips">
					{#each message.reactions as r (r.emoji)}
						<button
							type="button"
							class="reaction-chip"
							class:me={r.me}
							onclick={() => onreact(message, r.emoji)}
						>
							{r.emoji} {r.count}
						</button>
					{/each}
				</div>
			{/if}
		{/if}

		<span class="time">
			{#if message.editedAt && !deleted}
				<span class="edited">{t('chat.edited')}</span>
			{/if}
			{formatMessageTime(message.createdAt, locale)}
			{#if mine && !deleted}
				<span class="receipt" class:read>
					{#if read}
						<CheckCheck size={14} />
					{:else}
						<Check size={14} />
					{/if}
				</span>
			{/if}
		</span>

		{#if !deleted}
			<button
				type="button"
				class="bubble-more"
				onclick={() => (menuOpen = !menuOpen)}
				aria-label="Menu"
			>
				⋯
			</button>
		{/if}
	</div>
</div>

{#if menuOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="menu-backdrop" onclick={() => { menuOpen = false; reactOpen = false; }}></div>
	<div class="msg-menu">
		<button
			type="button"
			onclick={() => {
				menuOpen = false;
				onreply(message);
			}}>{t('chat.reply')}</button
		>
		<button
			type="button"
			onclick={() => {
				reactOpen = !reactOpen;
			}}>{t('chat.react')}</button
		>
		{#if mine && message.kind !== 'voice'}
			<button
				type="button"
				onclick={() => {
					menuOpen = false;
					onedit(message);
				}}>{t('chat.edit')}</button
			>
			<button
				type="button"
				class="danger"
				onclick={() => {
					menuOpen = false;
					ondelete(message);
				}}>{t('chat.delete')}</button
			>
		{/if}
		{#if reactOpen}
			<div class="react-row">
				{#each REACTION_EMOJIS as emoji}
					<button
						type="button"
						onclick={() => {
							menuOpen = false;
							reactOpen = false;
							onreact(message, emoji);
						}}>{emoji}</button
					>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import FileIcon from '@lucide/svelte/icons/file';
	import Reply from '@lucide/svelte/icons/reply';
	import LinkCard from './LinkCard.svelte';
	import VoicePlayer from './VoicePlayer.svelte';
	import { haptic } from '$lib/haptic';
	import { getCachedSettings } from '$lib/settings';
	import { formatMessageTime } from '$lib/time';
	import { REACTION_EMOJIS, type MessageDTO } from '$lib/types';
	import type { Locale } from '$lib/i18n';

	let {
		message,
		mine,
		peerLastReadAt = null as string | null,
		locale = 'en' as Locale,
		t,
		highlight = false,
		grouped = false,
		tail = true,
		onreply,
		onedit,
		ondelete,
		onreact,
		onjump,
		onretry,
		onopenImage
	}: {
		message: MessageDTO;
		mine: boolean;
		peerLastReadAt?: string | null;
		locale?: Locale;
		t: (key: string, vars?: Record<string, string | number>) => string;
		highlight?: boolean;
		grouped?: boolean;
		tail?: boolean;
		onreply: (m: MessageDTO) => void;
		onedit: (m: MessageDTO) => void;
		ondelete: (m: MessageDTO) => void;
		onreact: (m: MessageDTO, emoji: string) => void;
		onjump?: (id: string) => void;
		onretry?: (m: MessageDTO) => void;
		onopenImage?: (urls: string[], index: number) => void;
	} = $props();

	let menuOpen = $state(false);
	let confirmDelete = $state(false);
	let swipeX = $state(0);
	let swiping = $state(false);
	let startX = 0;
	let startY = 0;
	let pressMoved = false;
	let longPressed = false;
	let lastTapAt = 0;
	let canShare = $state(false);
	let moveGuard = 0;

	const deleted = $derived(!!message.deletedAt);
	const failed = $derived(message.sendStatus === 'failed');
	const read = $derived(
		mine &&
			!!peerLastReadAt &&
			new Date(peerLastReadAt).getTime() >= new Date(message.createdAt).getTime()
	);
	const imageUrls = $derived(
		message.attachments.filter((a) => a.mime.startsWith('image/')).map((a) => `/api/files/${a.id}`)
	);

	$effect(() => {
		canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
	});

	function isImage(mime: string) {
		return mime.startsWith('image/');
	}

	function shareText() {
		if (message.kind === 'voice') return t('chats.voice');
		return message.body?.trim() || '';
	}

	function onPointerDown(e: PointerEvent) {
		if (deleted) return;
		startX = e.clientX;
		startY = e.clientY;
		swiping = true;
		pressMoved = false;
		longPressed = false;
		moveGuard = 0;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!swiping) return;
		const dx = e.clientX - startX;
		const dy = e.clientY - startY;
		moveGuard = Math.max(moveGuard, Math.abs(dx), Math.abs(dy));
		if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
			swiping = false;
			swipeX = 0;
			pressMoved = true;
			clearTimeout(pressTimer);
			return;
		}
		if (Math.abs(dx) > 8) {
			pressMoved = true;
			clearTimeout(pressTimer);
		}
		swipeX = Math.max(0, Math.min(72, dx));
	}

	function onPointerUp() {
		const shouldReply = swipeX > 56;
		const releaseX = swipeX;
		const moved = pressMoved || moveGuard > 8;
		const wasLong = longPressed;
		swiping = false;
		requestAnimationFrame(() => {
			swipeX = 0;
		});
		startX = 0;

		if (shouldReply && releaseX > 56) {
			haptic(10);
			onreply(message);
			return;
		}

		if (!moved && !wasLong && !deleted && !message.id.startsWith('tmp-')) {
			const now = Date.now();
			if (now - lastTapAt < 300) {
				lastTapAt = 0;
				onreact(message, '👍');
				haptic(10);
			} else {
				lastTapAt = now;
			}
		}
	}

	let pressTimer: ReturnType<typeof setTimeout> | undefined;
	function onPressStart() {
		pressMoved = false;
		longPressed = false;
		pressTimer = setTimeout(() => {
			if (!pressMoved) {
				longPressed = true;
				menuOpen = true;
				confirmDelete = false;
				haptic(18);
			}
		}, 420);
	}
	function onPressEnd() {
		clearTimeout(pressTimer);
	}

	function closeMenu() {
		menuOpen = false;
		confirmDelete = false;
	}

	async function copyMessage() {
		const text = shareText();
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			haptic(8);
		} catch {
			/* ignore */
		}
		closeMenu();
	}

	async function shareMessage() {
		const text = shareText();
		if (!text || !navigator.share) return;
		try {
			await navigator.share({ text });
		} catch {
			/* cancelled */
		}
		closeMenu();
	}

	function openImage(urls: string[], index: number) {
		if (moveGuard > 8) return;
		onopenImage?.(urls, index);
	}
</script>

<div
	class="bubble-row"
	class:me={mine}
	class:swiping
	class:highlight
	class:grouped
	class:tail
	class:failed
	id="msg-{message.id}"
	role="group"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
>
	<span
		class="swipe-reply-hint"
		class:visible={swipeX > 8}
		style="opacity:{Math.min(1, swipeX / 56)}; transform:translateY(-50%) scale({0.7 + Math.min(0.3, (swipeX / 56) * 0.3)})"
	>
		<Reply size={18} />
	</span>

	<div
		class="bubble"
		class:me={mine}
		class:them={!mine}
		class:deleted
		class:grouped
		class:tail
		class:failed
		class:selecting={menuOpen}
		style="transform:translateX({swipeX}px)"
		onpointerdown={onPressStart}
		onpointerup={onPressEnd}
		onpointerleave={onPressEnd}
		role="group"
	>
		{#if deleted}
			<p class="body deleted-body">{t('chat.deletedBody')}</p>
		{:else}
			{#if message.replyTo}
				<button
					type="button"
					class="reply-quote"
					onclick={() => {
						if (moveGuard > 8) return;
						onjump?.(message.replyTo!.id);
					}}
				>
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
				<VoicePlayer id={message.id} src="/api/files/{message.attachments[0].id}" />
			{:else if message.kind === 'voice' && message.id.startsWith('tmp-')}
				<p class="body">{t('chats.voice')}</p>
			{:else if message.attachments.length}
				<div class="att-list">
					{#each message.attachments as att, ai (att.id)}
						{#if isImage(att.mime)}
							<button
								type="button"
								class="att-image-btn"
								onclick={() => {
									const idx = imageUrls.indexOf(`/api/files/${att.id}`);
									openImage(imageUrls, idx >= 0 ? idx : ai);
								}}
							>
								<img class="att-image" src="/api/files/{att.id}" alt={att.filename} />
							</button>
						{:else}
							<a
								class="att-file"
								href="/api/files/{att.id}"
								target="_blank"
								rel="noopener"
								onclick={(e) => {
									if (moveGuard > 8) e.preventDefault();
								}}
							>
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

			{#if message.linkPreview && getCachedSettings().linkPreviews}
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

			{#if failed}
				<button type="button" class="retry-chip" onclick={() => onretry?.(message)}>
					{t('chat.retrySend')}
				</button>
			{/if}
		{/if}

		<span class="time">
			{#if message.editedAt && !deleted}
				<span class="edited">{t('chat.edited')}</span>
			{/if}
			{formatMessageTime(message.createdAt, locale)}
			{#if mine && !deleted}
				<span
					class="receipt"
					class:read
					class:pending={message.id.startsWith('tmp-') && !failed}
					class:failed
				>
					{#if failed}
						!
					{:else if message.id.startsWith('tmp-')}
						<Check size={14} />
					{:else if read}
						<CheckCheck size={14} />
					{:else}
						<Check size={14} />
					{/if}
				</span>
			{/if}
		</span>
	</div>
</div>

{#if menuOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="menu-backdrop" onclick={closeMenu}></div>
	<div class="msg-sheet">
		{#if !deleted && !confirmDelete}
			<div class="react-bar">
				{#each REACTION_EMOJIS as emoji}
					<button
						type="button"
						onclick={() => {
							closeMenu();
							onreact(message, emoji);
						}}>{emoji}</button
					>
				{/each}
			</div>
		{/if}
		<div class="msg-menu">
			{#if confirmDelete}
				<p class="msg-confirm-text">{t('chat.deleteConfirm')}</p>
				<button
					type="button"
					class="danger"
					onclick={() => {
						closeMenu();
						ondelete(message);
					}}>{t('chat.deleteConfirmAction')}</button
				>
				<button type="button" onclick={() => (confirmDelete = false)}>{t('chat.keep')}</button>
			{:else}
				<button
					type="button"
					onclick={() => {
						closeMenu();
						onreply(message);
					}}>{t('chat.reply')}</button
				>
				{#if shareText()}
					<button type="button" onclick={copyMessage}>{t('chat.copy')}</button>
					{#if canShare}
						<button type="button" onclick={shareMessage}>{t('chat.share')}</button>
					{/if}
				{/if}
				{#if mine && message.kind !== 'voice' && !message.id.startsWith('tmp-')}
					<button
						type="button"
						onclick={() => {
							closeMenu();
							onedit(message);
						}}>{t('chat.edit')}</button
					>
					<button
						type="button"
						class="danger"
						onclick={() => {
							if (getCachedSettings().confirmMessageDelete) {
								confirmDelete = true;
							} else {
								closeMenu();
								ondelete(message);
							}
						}}>{t('chat.delete')}</button
					>
				{/if}
			{/if}
		</div>
	</div>
{/if}

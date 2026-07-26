<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import FileIcon from '@lucide/svelte/icons/file';
	import Lock from '@lucide/svelte/icons/lock';
	import Reply from '@lucide/svelte/icons/reply';
	import Smile from '@lucide/svelte/icons/smile';
	import LinkCard from './LinkCard.svelte';
	import VoicePlayer from './VoicePlayer.svelte';
	import { decryptAttachmentUrl } from '$lib/e2ee/messages';
	import { haptic } from '$lib/haptic';
	import { getCachedSettings } from '$lib/settings';
	import { formatMessageTime } from '$lib/time';
	import { formatMessageHtml } from '$lib/formatMessage';
	import { REACTION_EMOJIS, type AttachmentDTO, type MessageDTO } from '$lib/types';
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
		selected = false,
		selectMode = false,
		e2ee = null as null | { myUserId: string; peerUserId: string; peerPublicKey: string },
		onreply,
		onedit,
		ondelete,
		onreact,
		onjump,
		onretry,
		onopenImage,
		onforward,
		onpin,
		ontoggleSelect,
		onenterSelect
	}: {
		message: MessageDTO;
		mine: boolean;
		peerLastReadAt?: string | null;
		locale?: Locale;
		t: (key: string, vars?: Record<string, string | number>) => string;
		highlight?: boolean;
		grouped?: boolean;
		tail?: boolean;
		selected?: boolean;
		selectMode?: boolean;
		e2ee?: null | { myUserId: string; peerUserId: string; peerPublicKey: string };
		onreply: (m: MessageDTO) => void;
		onedit: (m: MessageDTO) => void;
		ondelete: (m: MessageDTO) => void;
		onreact: (m: MessageDTO, emoji: string) => void;
		onjump?: (id: string) => void;
		onretry?: (m: MessageDTO) => void;
		onopenImage?: (urls: string[], index: number) => void;
		onforward?: (m: MessageDTO) => void;
		onpin?: (m: MessageDTO) => void;
		ontoggleSelect?: (m: MessageDTO) => void;
		onenterSelect?: (m: MessageDTO) => void;
	} = $props();

	let menuOpen = $state(false);
	/** 'react' shows only the emoji tray — used by the swipe-right shortcut. */
	let menuMode = $state<'full' | 'react'>('full');
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
	let attUrls = $state<Record<string, { url: string; mime: string }>>({});

	const deleted = $derived(!!message.deletedAt);
	const failed = $derived(message.sendStatus === 'failed');
	const encrypted = $derived(message.attachments.some((a) => !!a.e2eeMeta));
	const read = $derived(
		mine &&
			!!peerLastReadAt &&
			new Date(peerLastReadAt).getTime() >= new Date(message.createdAt).getTime()
	);
	const imageUrls = $derived(
		message.attachments
			.map((a) => {
				const resolved = attUrls[a.id];
				const mime = resolved?.mime || a.mime;
				if (!mime.startsWith('image/')) return null;
				return resolved?.url || (!a.e2eeMeta ? `/api/files/${a.id}` : null);
			})
			.filter((u): u is string => !!u)
	);

	$effect(() => {
		canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
	});

	$effect(() => {
		const atts = message.attachments;
		const ctx = e2ee;
		let cancelled = false;
		(async () => {
			const next: Record<string, { url: string; mime: string }> = {};
			for (const att of atts) {
				if (!att.e2eeMeta) {
					next[att.id] = { url: `/api/files/${att.id}`, mime: att.mime };
					continue;
				}
				if (!ctx) continue;
				const resolved = await decryptAttachmentUrl(
					ctx.myUserId,
					ctx.peerUserId,
					ctx.peerPublicKey,
					att
				);
				if (resolved && !cancelled) next[att.id] = resolved;
			}
			if (!cancelled) attUrls = next;
		})();
		return () => {
			cancelled = true;
		};
	});

	function attSrc(att: AttachmentDTO) {
		return attUrls[att.id]?.url ?? (!att.e2eeMeta ? `/api/files/${att.id}` : '');
	}
	function attMime(att: AttachmentDTO) {
		return attUrls[att.id]?.mime ?? att.mime;
	}
	function isImage(mime: string) {
		return mime.startsWith('image/');
	}
	function isVideo(mime: string) {
		return mime.startsWith('video/');
	}

	function shareText() {
		if (message.kind === 'voice') return t('chats.voice');
		if (message.kind === 'video') return t('chat.video');
		return message.body?.trim() || '';
	}

	function replyLabel() {
		if (!message.replyTo) return '';
		if (message.replyTo.deleted) return '…';
		if (message.replyTo.kind === 'voice') return t('chats.voice');
		if (message.replyTo.kind === 'video') return t('chat.video');
		if (message.replyTo.thumbUrl && !message.replyTo.body) return t('chat.photo');
		return message.replyTo.body || '…';
	}

	function onPointerDown(e: PointerEvent) {
		if (deleted || selectMode) return;
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
		// left = reply (negative), right = react (positive)
		swipeX = Math.max(-72, Math.min(72, dx));
	}

	function onPointerUp() {
		const shouldReply = swipeX < -56;
		const shouldReact = swipeX > 56;
		const releaseX = swipeX;
		const moved = pressMoved || moveGuard > 8;
		const wasLong = longPressed;
		swiping = false;
		requestAnimationFrame(() => {
			swipeX = 0;
		});
		startX = 0;

		if (shouldReply && releaseX < -56) {
			haptic(10);
			onreply(message);
			return;
		}
		if (shouldReact && releaseX > 56) {
			haptic(10);
			menuMode = 'react';
			confirmDelete = false;
			menuOpen = true;
			return;
		}

		if (selectMode) {
			ontoggleSelect?.(message);
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
		if (selectMode) return;
		pressMoved = false;
		longPressed = false;
		pressTimer = setTimeout(() => {
			if (!pressMoved) {
				longPressed = true;
				haptic(18);
				menuMode = 'full';
				menuOpen = true;
				confirmDelete = false;
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

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="bubble-row"
	class:me={mine}
	class:swiping
	class:highlight
	class:grouped
	class:tail
	class:failed
	class:selected
	class:select-mode={selectMode}
	id="msg-{message.id}"
	role="group"
	oncontextmenu={(e) => e.preventDefault()}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	onclick={() => {
		if (selectMode) ontoggleSelect?.(message);
	}}
>
	<span
		class="swipe-reply-hint"
		class:visible={swipeX < -8}
		style="opacity:{Math.min(1, Math.abs(swipeX) / 56)}; transform:translateY(-50%) scale({0.7 + Math.min(0.3, (Math.abs(swipeX) / 56) * 0.3)})"
	>
		<Reply size={18} />
	</span>
	<span
		class="swipe-react-hint"
		class:visible={swipeX > 8}
		style="opacity:{Math.min(1, swipeX / 56)}; transform:translateY(-50%) scale({0.7 + Math.min(0.3, (swipeX / 56) * 0.3)})"
	>
		<Smile size={18} />
	</span>

	{#if selectMode}
		<span class="select-check" class:on={selected} aria-hidden="true">
			{#if selected}<Check size={14} />{/if}
		</span>
	{/if}

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
		oncontextmenu={(e) => e.preventDefault()}
		role="group"
	>
		{#if message.forwardedFromId}
			<p class="fwd-label">{t('chat.forwarded')}</p>
		{/if}
		{#if message.replyTo}
			<button
				type="button"
				class="reply-quote"
				onclick={() => {
					if (moveGuard > 8 || selectMode) return;
					onjump?.(message.replyTo!.id);
				}}
			>
				<span class="reply-bar"></span>
				{#if message.replyTo.thumbUrl && message.replyTo.kind !== 'voice'}
					{#if message.replyTo.kind === 'video' || message.replyTo.thumbUrl.includes('video')}
						<video class="reply-thumb" src={message.replyTo.thumbUrl} muted playsinline></video>
					{:else}
						<img class="reply-thumb" src={message.replyTo.thumbUrl} alt="" />
					{/if}
				{/if}
				<span>{replyLabel()}</span>
			</button>
		{/if}

		{#if message.kind === 'voice' && message.attachments[0]}
			<VoicePlayer id={message.id} src={attSrc(message.attachments[0]) || `/api/files/${message.attachments[0].id}`} />
		{:else if message.kind === 'voice' && message.id.startsWith('tmp-')}
			<p class="body">{t('chats.voice')}</p>
		{:else if message.attachments.length}
			<div class="att-list">
				{#each message.attachments as att, ai (att.id)}
					{#if isImage(attMime(att))}
						<button
							type="button"
							class="att-image-btn"
							onclick={() => {
								const src = attSrc(att);
								const idx = imageUrls.indexOf(src);
								openImage(imageUrls, idx >= 0 ? idx : ai);
							}}
						>
							{#if attSrc(att)}
								<img class="att-image" src={attSrc(att)} alt={att.filename} />
							{:else}
								<span class="att-file"><Lock size={16} /> …</span>
							{/if}
						</button>
					{:else if isVideo(attMime(att)) || message.kind === 'video'}
						{#if attSrc(att)}
							<!-- svelte-ignore a11y_media_has_caption -->
							<video class="att-video" src={attSrc(att)} controls playsinline preload="metadata"></video>
						{:else}
							<span class="att-file"><Lock size={16} /> …</span>
						{/if}
					{:else}
						<a
							class="att-file"
							href={attSrc(att) || `/api/files/${att.id}`}
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

		{#if encrypted}
			<span class="e2ee-badge" title={t('e2ee.locked')}><Lock size={10} /></span>
		{/if}

		{#if message.body}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<p
				class="body msg-formatted"
				onclick={(e) => {
					const el = e.target as HTMLElement | null;
					if (el?.classList.contains('msg-spoiler')) el.classList.toggle('revealed');
				}}
			>
				{@html formatMessageHtml(message.body)}
			</p>
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

		<!-- Only the last message of a group carries the time, so runs stay quiet -->
		{#if tail || message.editedAt || failed}
			<span class="time">
				{#if message.editedAt}
					<span class="edited">{t('chat.edited')}</span>
				{/if}
				{formatMessageTime(message.createdAt, locale)}
				{#if mine}
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
		{/if}
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
		{#if menuMode === 'full'}
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
				{#if onforward}
					<button
						type="button"
						onclick={() => {
							closeMenu();
							onforward(message);
						}}>{t('chat.forward')}</button
					>
				{/if}
				{#if onpin && !message.id.startsWith('tmp-')}
					<button
						type="button"
						onclick={() => {
							closeMenu();
							onpin(message);
						}}>{t('chat.pin')}</button
					>
				{/if}
				{#if onenterSelect}
					<button
						type="button"
						onclick={() => {
							closeMenu();
							onenterSelect(message);
						}}>{t('chat.select')}</button
					>
				{/if}
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
		{/if}
	</div>
{/if}

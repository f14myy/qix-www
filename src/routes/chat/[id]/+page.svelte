<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Archive from '@lucide/svelte/icons/archive';
	import Clock from '@lucide/svelte/icons/clock';
	import Flag from '@lucide/svelte/icons/flag';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Copy from '@lucide/svelte/icons/copy';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Forward from '@lucide/svelte/icons/forward';
	import ImageIcon from '@lucide/svelte/icons/image';
	import Info from '@lucide/svelte/icons/info';
	import Lock from '@lucide/svelte/icons/lock';
	import LogOut from '@lucide/svelte/icons/log-out';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Phone from '@lucide/svelte/icons/phone';
	import Pin from '@lucide/svelte/icons/pin';
	import Search from '@lucide/svelte/icons/search';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Video from '@lucide/svelte/icons/video';
	import Pointer from '@lucide/svelte/icons/pointer';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import X from '@lucide/svelte/icons/x';
	import Avatar from '$lib/components/Avatar.svelte';
	import ChannelAvatar from '$lib/components/ChannelAvatar.svelte';
	import ChatBubble from '$lib/components/ChatBubble.svelte';
	import CoachTip from '$lib/components/CoachTip.svelte';
	import Composer from '$lib/components/Composer.svelte';
	import DateSeparator from '$lib/components/DateSeparator.svelte';
	import GroupAvatar from '$lib/components/GroupAvatar.svelte';
	import ImageLightbox from '$lib/components/ImageLightbox.svelte';
	import NameWithBadges from '$lib/components/NameWithBadges.svelte';
	import { mapCallStartError, startOutgoingCall } from '$lib/calls/store.svelte';
	import { dismissCoach, markCoachShown, shouldShowCoach } from '$lib/coach';
	import { ENABLE_E2EE } from '$lib/e2ee/config';
	import {
		decryptMessages,
		encryptOutgoing
	} from '$lib/e2ee/messages';
	import { toast, promptDialog } from '$lib/flash.svelte';
	import { haptic, hapticFail, hapticSuccess } from '$lib/haptic';
	import { useI18n } from '$lib/i18n/useI18n.svelte';
	import { goBack as navigateBack } from '$lib/nav';
	import {
		enqueueSend,
		filesFromQueued,
		listQueued,
		removeQueued,
		serializeFiles
	} from '$lib/sendQueue';
	import { formatSystemLine, SYSTEM_EVENT_KEYS } from '$lib/systemMessage';
	import { dayKey, formatDayLabel, isOnlineIso, formatLastSeen } from '$lib/time';
	import type {
		ChatListItem,
		GroupInfoDTO,
		GroupMemberDTO,
		MediaItemDTO,
		MessageDTO
	} from '$lib/types';
	import { startViewTransition } from '$lib/viewTransition';
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
	let viewportH = $state<number | null>(null);
	let viewportOffset = $state(0);
	let keyboardOpen = $state(false);
	let hasMore = $state(true);
	let loadingOlder = $state(false);
	let pendingNewCount = $state(0);
	let firstUnreadId = $state<string | null>(null);
	let e2eeOn = $state(false);
	let peerE2eeKey = $state<string | null>(null);
	let pinnedMessage = $state<MessageDTO | null>(null);
	let disappearAfterSec = $state(0);
	let selectMode = $state(false);
	let selectedIds = $state<Set<string>>(new Set());
	let showMenu = $state(false);
	let showDeleteModal = $state(false);
	let showSearch = $state(false);
	let showGallery = $state(false);
	let showForward = $state(false);
	let forwardIds = $state<string[]>([]);
	let searchQ = $state('');
	let searchHits = $state<MessageDTO[]>([]);
	let gallery = $state<MediaItemDTO[]>([]);
	let forwardChats = $state<ChatListItem[]>([]);
	let searchingInChat = $state(false);
	let messagesReady = $state(false);
	let showGestureCoach = $state(false);
	let showFormatCoach = $state(false);
	/**
	 * Group identity, live.
	 *
	 * Seeded from the server load but replaced wholesale whenever `group_update`
	 * lands, which is why it is an override rather than a copy — an override keeps
	 * the first render server-accurate instead of blank for one frame.
	 */
	let groupOverride = $state<{ group: GroupInfoDTO; members: GroupMemberDTO[] } | null>(null);
	let typingUserId = $state<string | null>(null);
	let showLeaveModal = $state(false);
	let showDeleteGroupModal = $state(false);

	type TimelineItem =
		| { kind: 'sep'; key: string; label: string }
		| { kind: 'unread'; key: string }
		| { kind: 'sys'; key: string; text: string }
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
		const visible = messages.filter((m) => !m.deletedAt);
		for (let i = 0; i < visible.length; i++) {
			const message = visible[i]!;
			const key = dayKey(message.createdAt);
			if (key !== lastDay) {
				items.push({
					kind: 'sep',
					key: `d-${key}`,
					label: formatDayLabel(message.createdAt, i18n.locale)
				});
				lastDay = key;
			}

			/*
			 * A system line is a caption, not a bubble: it gets no avatar, no author
			 * and no grouping, and it breaks any run around it so "Alice added Bob"
			 * never ends up tucked inside Alice's own messages.
			 */
			if (message.kind === 'system' && message.system) {
				const template = i18n.t(SYSTEM_EVENT_KEYS[message.system.event]);
				items.push({
					kind: 'sys',
					key: message.id,
					text: formatSystemLine(template, message.system)
				});
				continue;
			}

			const prev = visible[i - 1];
			const next = visible[i + 1];
			const samePrev =
				!!prev &&
				prev.kind !== 'system' &&
				prev.senderId === message.senderId &&
				dayKey(prev.createdAt) === key &&
				Math.abs(new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime()) <
					GROUP_MS;
			const sameNext =
				!!next &&
				next.kind !== 'system' &&
				next.senderId === message.senderId &&
				dayKey(next.createdAt) === key &&
				Math.abs(new Date(next.createdAt).getTime() - new Date(message.createdAt).getTime()) <
					GROUP_MS;
			const startsUnread = !!prev && message.id === firstUnreadId;
			if (startsUnread) items.push({ kind: 'unread', key: `u-${message.id}` });
			items.push({
				kind: 'msg',
				key: message.id,
				message,
				grouped: samePrev && !startsUnread,
				tail: !sameNext
			});
		}
		return items;
	});

	const isChannel = $derived(data.kind === 'channel' && !!data.channel);
	const group = $derived(groupOverride?.group ?? data.group);
	const members = $derived(groupOverride?.members ?? data.members);
	const isGroup = $derived(data.kind === 'group' && !!group);
	const canPost = $derived(
		isChannel ? !!data.channel?.canPost : isGroup ? !!group?.canPost : true
	);
	const memberCountText = $derived(
		group
			? group.memberCount === 1
				? i18n.t('group.membersOne')
				: i18n.t('group.members', { n: group.memberCount })
			: ''
	);
	const typingName = $derived.by(() => {
		if (!typingUserId) return '';
		const who = members.find((m) => m.id === typingUserId);
		return who ? who.displayName || who.username : '';
	});
	const peerTitle = $derived(
		isChannel
			? i18n.t(`channel.${data.channel!.key}.title`)
			: isGroup
				? group!.title
				: data.peer
					? data.peer.displayName || data.peer.username
					: ''
	);
	const online = $derived(!isChannel && !isGroup && (typing || isOnlineIso(peerSeen)));
	const statusText = $derived(
		isChannel
			? i18n.t(`channel.${data.channel!.key}.subtitle`)
			: isGroup
				? typing && typingName
					? i18n.t('chat.typingName', { name: typingName })
					: memberCountText
				: typing
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

	const e2eePeerKey = $derived(peerE2eeKey || (!isChannel && data.peer?.e2eePublicKey ? data.peer.e2eePublicKey : null));
	// Pairwise keys only — a group has no single peer to agree a key with.
	const canE2ee = $derived(
		ENABLE_E2EE && !!e2eePeerKey && !!data.user && !isChannel && !isGroup
	);

	$effect(() => {
		peerE2eeKey = data.peer?.e2eePublicKey ?? null;
	});

	$effect(() => {
		if (isChannel || !data.peer?.id) return;
		let cancelled = false;
		fetch(`/api/users/${data.peer.id}/e2ee`)
			.then((r) => r.json())
			.then((j) => {
				if (cancelled || !j.publicKey) return;
				peerE2eeKey = JSON.stringify(j.publicKey);
			})
			.catch(() => {
				/* ignore */
			});
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const list = data.messages;
		peerLastReadAt = data.peerLastReadAt;
		myLastReadAt = data.myLastReadAt;
		peerSeen = data.peer?.lastSeenAt ?? null;
		hasMore = list.length >= 100;
		disappearAfterSec = data.disappearAfterSec;
		e2eeOn = canE2ee;
		computeFirstUnread(list, data.myLastReadAt);
		messagesReady = false;

		let cancelled = false;
		(async () => {
			if (data.user && canE2ee && e2eePeerKey) {
				const dec = await decryptMessages(data.user.id, data.peer!.id, e2eePeerKey, list);
				if (!cancelled) messages = dec;
				if (data.pinnedMessage && !cancelled) {
					const [pin] = await decryptMessages(
						data.user.id,
						data.peer!.id,
						e2eePeerKey,
						[data.pinnedMessage]
					);
					pinnedMessage = pin ?? null;
				} else if (!cancelled) {
					pinnedMessage = data.pinnedMessage;
				}
			} else if (!cancelled) {
				messages = [...list];
				pinnedMessage = data.pinnedMessage;
			}
			if (!cancelled) messagesReady = true;
		})();
		return () => {
			cancelled = true;
		};
	});

	async function decryptIncoming(msg: MessageDTO): Promise<MessageDTO> {
		if (!data.user || !canE2ee || !e2eePeerKey || !data.peer) return msg;
		const [dec] = await decryptMessages(data.user.id, data.peer.id, e2eePeerKey, [msg]);
		return dec ?? msg;
	}

	const selectedCount = $derived(selectedIds.size);
	const pinnedPreview = $derived(
		pinnedMessage
			? pinnedMessage.kind === 'voice'
				? i18n.t('chats.voice')
				: pinnedMessage.kind === 'video'
					? i18n.t('chat.video')
					: pinnedMessage.body || i18n.t('chat.photo')
			: ''
	);

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
			const revealed =
				data.user && canE2ee && e2eePeerKey && data.peer
					? await decryptMessages(data.user.id, data.peer.id, e2eePeerKey, unique)
					: unique;
			messages = [...revealed, ...messages];
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

	async function upsert(msg: MessageDTO, opts?: { forceScroll?: boolean }) {
		const revealed = await decryptIncoming(msg);
		const wasNear = listEl ? nearBottom(listEl) : true;
		const idx = messages.findIndex((m) => m.id === revealed.id);
		if (idx === -1) messages = [...messages, revealed];
		else {
			const next = [...messages];
			next[idx] = revealed;
			messages = next;
		}
		const mine = revealed.senderId === data.user?.id;
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
		kind?: 'text' | 'voice' | 'video';
		replyToId?: string | null;
	}) {
		let body = payload.body;
		let files = payload.files;
		let e2eeFileMetas: string[] | null = null;

		if (canE2ee && e2eePeerKey && data.user && data.peer) {
			try {
				const enc = await encryptOutgoing({
					myUserId: data.user.id,
					peerUserId: data.peer.id,
					peerPublicKeyJson: e2eePeerKey,
					body: payload.body,
					files: payload.files
				});
				body = enc.body;
				files = enc.files;
				e2eeFileMetas = enc.e2eeFileMetas;
			} catch {
				error = i18n.t('e2ee.encryptFailed');
				markFailed(payload.tmpId);
				return false;
			}
		}

		const form = new FormData();
		form.set('body', body);
		if (payload.kind) form.set('kind', payload.kind);
		if (payload.replyToId) form.set('replyToId', payload.replyToId);
		if (e2eeFileMetas) form.set('e2eeFileMetas', JSON.stringify(e2eeFileMetas));
		for (const file of files) form.append('files', file);

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
			await upsert(json.message as MessageDTO, { forceScroll: true });
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
			kind: (message.kind as 'text' | 'voice' | 'video') || 'text',
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
					expiresAt: null,
					forwardedFromId: null,
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
				kind: item.kind as 'text' | 'voice' | 'video',
				replyToId: item.replyToId
			});
		}
	}

	function buildOptimistic(
		tmpId: string,
		payload: {
			body: string;
			kind?: 'text' | 'voice' | 'video';
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
			expiresAt: null,
			forwardedFromId: null,
			replyTo: payload.replyToId
				? (() => {
						const src = messages.find((m) => m.id === payload.replyToId);
						return src
							? {
									id: src.id,
									senderId: src.senderId,
									body: src.body,
									deleted: !!src.deletedAt,
									kind: src.kind,
									thumbUrl:
										src.attachments.find((a) => a.mime.startsWith('image/')) != null
											? `/api/files/${src.attachments.find((a) => a.mime.startsWith('image/'))!.id}`
											: null
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
		fetch('/api/presence', { method: 'POST' });
		flushQueue();

		try {
			if (shouldShowCoach('qix-hint-msg-gestures')) {
				showGestureCoach = true;
				markCoachShown('qix-hint-msg-gestures');
			} else if (canPost && shouldShowCoach('qix-hint-format')) {
				showFormatCoach = true;
				markCoachShown('qix-hint-format');
			}
		} catch {
			/* ignore */
		}

		const jumpId =
			typeof window !== 'undefined'
				? new URLSearchParams(window.location.search).get('m')
				: null;
		if (jumpId) {
			queueMicrotask(() => jumpTo(jumpId));
			history.replaceState({}, '', `/chat/${data.chatId}`);
		}

		window.addEventListener('online', flushQueue);

		const vv = window.visualViewport;
		const syncKb = () => {
			const full = window.innerHeight;
			const h = vv?.height ?? full;
			// Only lock to visualViewport while the software keyboard is open.
			// On iOS home-screen PWAs, using it while closed leaves a gap above the home indicator.
			keyboardOpen = h < full - 80;
			if (keyboardOpen) {
				viewportH = Math.round(h);
				viewportOffset = Math.round(vv?.offsetTop ?? 0);
			} else {
				viewportH = 0;
				viewportOffset = 0;
			}
			if (atBottom) scrollToBottom(false);
		};
		vv?.addEventListener('resize', syncKb);
		vv?.addEventListener('scroll', syncKb);
		syncKb();

		return () => {
			window.removeEventListener('online', flushQueue);
			clearTimeout(typingTimer);
			vv?.removeEventListener('resize', syncKb);
			vv?.removeEventListener('scroll', syncKb);
		};
	});

	// Reconnect realtime when navigating between /chat/[id] (same component instance)
	$effect(() => {
		const chatId = data.chatId;
		replyTo = null;
		editing = null;
		selectMode = false;
		selectedIds = new Set();
		showMenu = false;
		typing = false;
		typingUserId = null;
		groupOverride = null;
		showLeaveModal = false;
		showDeleteGroupModal = false;
		pendingNewCount = 0;
		highlightId = null;

		fetch(`/api/chats/${chatId}/read`, { method: 'POST' });
		flushQueue();
		queueMicrotask(() => scrollToBottom(false));

		let es: EventSource | null = null;
		let presenceEs: EventSource | null = null;
		let beat: ReturnType<typeof setInterval> | undefined;
		let cancelled = false;

		const onChatMessage = (ev: MessageEvent) => {
			if (cancelled) return;
			try {
				const msg = JSON.parse(ev.data) as MessageDTO;
				if (msg.chatId && msg.chatId !== chatId) return;
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
				void upsert(msg);
				if (msg.senderId !== data.user?.id) {
					fetch(`/api/chats/${chatId}/read`, { method: 'POST' });
				}
			} catch {
				/* ignore */
			}
		};

		function connectStreams() {
			if (cancelled) return;
			es?.close();
			presenceEs?.close();
			if (beat) clearInterval(beat);

			es = new EventSource(`/api/chats/${chatId}/events`);
			es.addEventListener('message', onChatMessage);
			es.addEventListener('message_update', (ev) => {
				try {
					const msg = JSON.parse(ev.data) as MessageDTO;
					if (msg.chatId && msg.chatId !== chatId) return;
					void upsert(msg);
				} catch {
					/* ignore */
				}
			});
			es.addEventListener('message_delete', (ev) => {
				try {
					const msg = JSON.parse(ev.data) as MessageDTO;
					if (msg.chatId && msg.chatId !== chatId) return;
					void upsert(msg);
				} catch {
					/* ignore */
				}
			});
			es.addEventListener('reaction', (ev) => {
				try {
					const msg = JSON.parse(ev.data) as MessageDTO;
					if (msg.chatId && msg.chatId !== chatId) return;
					void upsert(msg);
				} catch {
					/* ignore */
				}
			});
			es.addEventListener('typing', (ev) => {
				try {
					const d = JSON.parse(ev.data) as { userId: string };
					if (d.userId === data.user?.id) return;
					typing = true;
					typingUserId = d.userId;
					clearTimeout(typingTimer);
					typingTimer = setTimeout(() => {
						typing = false;
						typingUserId = null;
					}, 2500);
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
			es.addEventListener('chat_meta', (ev) => {
				try {
					const d = JSON.parse(ev.data) as {
						pinnedMessageId?: string | null;
						disappearAfterSec?: number;
					};
					if (typeof d.disappearAfterSec === 'number') disappearAfterSec = d.disappearAfterSec;
					if ('pinnedMessageId' in d) {
						if (!d.pinnedMessageId) pinnedMessage = null;
						else {
							const found = messages.find((m) => m.id === d.pinnedMessageId);
							if (found) pinnedMessage = found;
						}
					}
				} catch {
					/* ignore */
				}
			});
			/*
			 * The title, photo, roles or permissions moved. The event carries only the
			 * chat id on purpose — a payload would have to be tailored per recipient,
			 * since `canPost` and `inviteCode` differ by role. Everyone re-reads their
			 * own view instead.
			 */
			es.addEventListener('group_update', () => {
				void refreshGroup(chatId);
			});
			es.addEventListener('chat_deleted', () => {
				if (cancelled) return;
				toast(i18n.t('group.deletedForYou'), 'err');
				void goto('/');
			});

			presenceEs = new EventSource('/api/events');
			presenceEs.addEventListener('presence', (ev) => {
				try {
					const d = JSON.parse(ev.data) as { userId: string; lastSeenAt: string };
					if (data.peer && d.userId === data.peer.id) peerSeen = d.lastSeenAt;
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

		return () => {
			cancelled = true;
			disconnectStreams();
			document.removeEventListener('visibilitychange', onVisibility);
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
		kind?: 'text' | 'voice' | 'video';
		replyToId?: string | null;
		editId?: string | null;
	}) {
		error = '';
		if (payload.editId) {
			let text = payload.body;
			if (canE2ee && e2eePeerKey && data.user && data.peer) {
				try {
					const enc = await encryptOutgoing({
						myUserId: data.user.id,
						peerUserId: data.peer.id,
						peerPublicKeyJson: e2eePeerKey,
						body: payload.body,
						files: []
					});
					text = enc.body;
				} catch {
					error = i18n.t('e2ee.encryptFailed');
					hapticFail();
					return;
				}
			}
			const res = await fetch(`/api/chats/${data.chatId}/messages/${payload.editId}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ body: text })
			});
			const json = await res.json();
			if (!res.ok) {
				error = json.error || i18n.t('chat.sendFailed');
				hapticFail();
				return;
			}
			await upsert(json.message, { forceScroll: true });
			editing = null;
			hapticSuccess();
			return;
		}

		const tmpId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
		const optimistic = buildOptimistic(tmpId, payload);
		await upsert(optimistic, { forceScroll: true });

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
		if (res.ok) void upsert(json.message);
	}

	async function remove(message: MessageDTO) {
		const res = await fetch(`/api/chats/${data.chatId}/messages/${message.id}`, {
			method: 'DELETE'
		});
		const json = await res.json();
		if (res.ok) void upsert(json.message);
	}

	function enterSelect(m: MessageDTO) {
		selectMode = true;
		selectedIds = new Set([m.id]);
		showMenu = false;
	}

	function toggleSelect(m: MessageDTO) {
		const next = new Set(selectedIds);
		if (next.has(m.id)) next.delete(m.id);
		else next.add(m.id);
		selectedIds = next;
		if (next.size === 0) selectMode = false;
	}

	function exitSelect() {
		selectMode = false;
		selectedIds = new Set();
	}

	async function pinMessage(m: MessageDTO | null) {
		const id = m?.id ?? null;
		await fetch(`/api/chats/${data.chatId}/meta`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ pinnedMessageId: id })
		});
		pinnedMessage = m;
		showMenu = false;
	}

	async function setDisappear(sec: number) {
		await fetch(`/api/chats/${data.chatId}/meta`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ disappearAfterSec: sec })
		});
		disappearAfterSec = sec;
		showMenu = false;
	}

	/**
	 * Re-reads the group after a `group_update`.
	 *
	 * A 404 here is not an error condition — it is how the viewer finds out they
	 * were removed, or that the room is gone. Either way there is nothing left on
	 * this screen for them, so they go back to the list.
	 */
	async function refreshGroup(chatId: string) {
		if (data.kind !== 'group') return;
		try {
			const res = await fetch(`/api/chats/${chatId}/group`);
			if (res.status === 404) {
				toast(i18n.t('group.deletedForYou'), 'err');
				await goto('/');
				return;
			}
			const json = await res.json();
			if (res.ok && json.group) {
				groupOverride = { group: json.group, members: json.members ?? [] };
			}
		} catch {
			/* offline — the next reconnect re-reads it */
		}
	}

	async function leaveCurrentGroup() {
		showLeaveModal = false;
		showMenu = false;
		try {
			const res = await fetch(`/api/chats/${data.chatId}/leave`, { method: 'POST' });
			if (!res.ok) {
				const json = await res.json().catch(() => ({}));
				hapticFail();
				toast((json as { error?: string }).error || i18n.t('common.error'), 'err');
				return;
			}
			hapticSuccess();
			await goto('/');
			toast(i18n.t('group.leaveDone'));
		} catch {
			hapticFail();
			toast(i18n.t('common.error'), 'err');
		}
	}

	async function deleteCurrentGroup() {
		showDeleteGroupModal = false;
		showMenu = false;
		try {
			const res = await fetch(`/api/chats/${data.chatId}/group`, { method: 'DELETE' });
			if (!res.ok) {
				const json = await res.json().catch(() => ({}));
				hapticFail();
				toast((json as { error?: string }).error || i18n.t('common.error'), 'err');
				return;
			}
			hapticSuccess();
			await goto('/');
			toast(i18n.t('group.deleteDone'));
		} catch {
			hapticFail();
			toast(i18n.t('common.error'), 'err');
		}
	}

	async function archiveChat() {
		await fetch(`/api/chats/${data.chatId}/prefs`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ archived: true })
		});
		goto('/');
	}

	async function confirmDeleteCurrentChat(mode: 'self' | 'everyone') {
		try {
			await fetch(`/api/chats/${data.chatId}`, {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ mode })
			});
			showDeleteModal = false;
			showMenu = false;
			await goto('/');
			toast(mode === 'everyone' ? i18n.t('chat.deletedBody') : i18n.t('chats.archive'));
		} catch {
			/* ignore */
		}
	}

	async function reportPeer() {
		if (!data.peer) return;
		const reason = (await promptDialog(i18n.t('chat.reportPrompt'))) ?? '';
		if (!reason.trim()) return;
		await fetch('/api/reports', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ userId: data.peer.id, reason })
		});
		showMenu = false;
		toast(i18n.t('chat.reportSent'));
	}

	async function openGallery() {
		showGallery = true;
		showMenu = false;
		const res = await fetch(`/api/chats/${data.chatId}/media`);
		const json = await res.json();
		if (res.ok) gallery = json.media ?? [];
	}

	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	async function runInChatSearch() {
		const q = searchQ.trim();
		if (q.length < 2) {
			searchHits = [];
			return;
		}
		searchingInChat = true;
		try {
			const res = await fetch(`/api/chats/${data.chatId}/media?q=${encodeURIComponent(q)}`);
			const json = await res.json();
			if (res.ok) searchHits = json.messages ?? [];
		} finally {
			searchingInChat = false;
		}
	}

	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(runInChatSearch, 220);
	}

	async function openForward(ids: string[]) {
		forwardIds = ids;
		showForward = true;
		exitSelect();
		const res = await fetch('/api/chats');
		const json = await res.json();
		if (res.ok)
			forwardChats = (json.chats as ChatListItem[]).filter((c) => {
				if (c.id === data.chatId) return false;
				if (c.kind === 'channel' && c.channel?.posting === 'admin' && !data.isAdmin) return false;
				return true;
			});
	}

	async function doForward(targetChatId: string) {
		const res = await fetch(`/api/chats/${data.chatId}/forward`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ targetChatId, messageIds: forwardIds })
		});
		showForward = false;
		forwardIds = [];
		if (res.ok) {
			hapticSuccess();
			goto(`/chat/${targetChatId}`);
		} else {
			hapticFail();
		}
	}

	async function bulkDelete() {
		const ids = [...selectedIds];
		const res = await fetch(`/api/chats/${data.chatId}/messages/bulk`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ messageIds: ids })
		});
		const json = await res.json();
		if (res.ok) {
			for (const m of json.messages as MessageDTO[]) void upsert(m);
		}
		exitSelect();
	}

	async function bulkCopy() {
		const texts = messages
			.filter((m) => selectedIds.has(m.id) && m.body)
			.map((m) => m.body)
			.join('\n');
		if (!texts) return;
		try {
			await navigator.clipboard.writeText(texts);
			haptic(8);
		} catch {
			/* ignore */
		}
		exitSelect();
	}

	// Edge Swipe Back Gesture
	let edgeSwipeX = $state(0);
	let edgeSwiping = $state(false);
	let edgeTouchStartX = 0;
	let edgeTouchStartY = 0;

	function onEdgeTouchStart(e: TouchEvent) {
		const touch = e.touches[0];
		if (!touch || touch.clientX > 32) return;
		edgeTouchStartX = touch.clientX;
		edgeTouchStartY = touch.clientY;
		edgeSwiping = true;
	}

	function onEdgeTouchMove(e: TouchEvent) {
		if (!edgeSwiping) return;
		const touch = e.touches[0];
		if (!touch) return;
		const dx = touch.clientX - edgeTouchStartX;
		const dy = Math.abs(touch.clientY - edgeTouchStartY);
		if (dy > Math.abs(dx) && edgeSwipeX === 0) {
			edgeSwiping = false;
			return;
		}
		if (dx > 0) {
			edgeSwipeX = dx;
		}
	}

	function onEdgeTouchEnd() {
		if (!edgeSwiping) return;
		edgeSwiping = false;
		if (edgeSwipeX > 90) {
			haptic(12);
			goBack();
		}
		edgeSwipeX = 0;
	}

	$effect(() => {
		if (typeof window === 'undefined' || !window.visualViewport) return;
		const vv = window.visualViewport;
		const updateViewport = () => {
			const kh = window.innerHeight - vv.height;
			if (kh > 100) {
				keyboardOpen = true;
				viewportH = vv.height;
				viewportOffset = vv.offsetTop;
			} else {
				keyboardOpen = false;
				viewportH = null;
				viewportOffset = 0;
			}
		};
		vv.addEventListener('resize', updateViewport);
		vv.addEventListener('scroll', updateViewport);
		return () => {
			vv.removeEventListener('resize', updateViewport);
			vv.removeEventListener('scroll', updateViewport);
		};
	});

	function goBack() {
		if (selectMode) {
			exitSelect();
			return;
		}
		startViewTransition(() => {
			navigateBack('/');
		});
	}

	async function startCall(video: boolean) {
		showMenu = false;
		try {
			haptic(10);
			await startOutgoingCall(data.chatId, video);
		} catch (e) {
			hapticFail();
			const raw = e instanceof Error ? e.message : '';
			const kind = mapCallStartError(raw);
			const key =
				kind === 'busy'
					? 'call.busy'
					: kind === 'already'
						? 'call.already'
						: kind === 'permission'
							? 'call.permission'
							: 'call.failed';
			const msg = i18n.t(key);
			error = msg;
			toast(msg, 'err');
		}
	}
</script>

<div
	class="screen chat-view"
	class:kb-open={keyboardOpen}
	ontouchstart={onEdgeTouchStart}
	ontouchmove={onEdgeTouchMove}
	ontouchend={onEdgeTouchEnd}
	style={edgeSwipeX
		? `transform: translateX(${edgeSwipeX}px); transition: none;`
		: viewportH
			? `padding-bottom:0;height:${viewportH}px;max-height:${viewportH}px;transform:translateY(${viewportOffset}px)`
			: 'padding-bottom:0'}
>
	<header class="topbar chat-topbar">
		<button type="button" class="icon-btn back-btn" aria-label={i18n.t('back')} onclick={goBack}>
			<ArrowLeft size={22} />
		</button>
		{#if selectMode}
			<div class="peer-meta select-meta">
				<h1 class="peer-title">{i18n.t('chat.selected', { n: selectedCount })}</h1>
			</div>
			<button type="button" class="icon-btn" aria-label={i18n.t('back')} onclick={exitSelect}>
				<X size={20} />
			</button>
		{:else if isChannel}
			<div class="peer-link channel-head">
				<ChannelAvatar channelKey={data.channel!.key} size={36} />
				<div class="peer-meta">
					<h1 class="peer-title">{peerTitle}</h1>
					{#if statusText}
						<span class="peer-status">{statusText}</span>
					{/if}
				</div>
			</div>
			<div class="topbar-actions">
				<button
					type="button"
					class="icon-btn"
					aria-label={i18n.t('chats.searchMessages')}
					onclick={() => (showSearch = true)}
				>
					<Search size={20} />
				</button>
				<button
					type="button"
					class="icon-btn"
					aria-label={i18n.t('chat.more')}
					onclick={() => (showMenu = true)}
				>
					<Ellipsis size={20} />
				</button>
			</div>
		{:else if isGroup}
			<a class="peer-link" href="/chat/{data.chatId}/group">
				<GroupAvatar
					title={group!.title}
					chatId={data.chatId}
					avatarPath={group!.avatarPath}
					size={36}
				/>
				<div class="peer-meta">
					<h1 class="peer-title">{peerTitle}</h1>
					{#if statusText}
						<span class="peer-status" class:online={typing}>
							{#if typing}
								<span class="typing-label">{statusText}</span>
								<span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
							{:else}
								{statusText}
							{/if}
						</span>
					{/if}
				</div>
			</a>
			<div class="topbar-actions">
				<button
					type="button"
					class="icon-btn"
					aria-label={i18n.t('chats.searchMessages')}
					onclick={() => (showSearch = true)}
				>
					<Search size={20} />
				</button>
				<button
					type="button"
					class="icon-btn"
					aria-label={i18n.t('chat.more')}
					onclick={() => (showMenu = true)}
				>
					<Ellipsis size={20} />
				</button>
			</div>
		{:else}
			<a class="peer-link" href="/u/{data.peer!.username}">
				<Avatar
					name={peerTitle}
					size={36}
					avatarPath={data.peer!.avatarPath}
					userId={data.peer!.id}
				/>
				<div class="peer-meta">
					<h1 class="peer-title">
						<NameWithBadges name={peerTitle} badges={data.peer!.badges} size="sm" />
					</h1>
					{#if statusText}
						<span class="peer-status" class:online>
							{#if canE2ee}
								<span class="e2ee-status" title={i18n.t('e2ee.active')}
									><Lock size={11} /></span
								>
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
					{:else if canE2ee}
						<span class="peer-status e2ee-only">
							<span class="e2ee-status" title={i18n.t('e2ee.active')}><Lock size={11} /></span>
							{i18n.t('e2ee.active')}
						</span>
					{/if}
				</div>
			</a>
			<div class="topbar-actions">
				{#if !isChannel}
					<button
						type="button"
						class="icon-btn call-head-btn"
						aria-label={i18n.t('call.voice')}
						title={i18n.t('call.voice')}
						onclick={() => startCall(false)}
					>
						<Phone size={19} />
					</button>
					<button
						type="button"
						class="icon-btn call-head-btn"
						aria-label={i18n.t('call.video')}
						title={i18n.t('call.video')}
						onclick={() => startCall(true)}
					>
						<Video size={19} />
					</button>
				{/if}
				<button
					type="button"
					class="icon-btn"
					aria-label={i18n.t('chat.more')}
					onclick={() => (showMenu = true)}
				>
					<Ellipsis size={20} />
				</button>
			</div>
		{/if}
	</header>

	{#if showGestureCoach}
		<CoachTip
			actionLabel={i18n.t('chat.coachDismiss')}
			ondismiss={() => {
				showGestureCoach = false;
				dismissCoach('qix-hint-msg-gestures');
			}}
		>
			{#snippet icon()}
				<Pointer size={20} />
			{/snippet}
			<p>{i18n.t('chat.coachGestures')}</p>
		</CoachTip>
	{:else if showFormatCoach}
		<CoachTip
			tone="soft"
			actionLabel={i18n.t('coach.gotIt')}
			ondismiss={() => {
				showFormatCoach = false;
				dismissCoach('qix-hint-format');
			}}
		>
			{#snippet icon()}
				<Sparkles size={20} />
			{/snippet}
			<p>{i18n.t('coach.format')}</p>
		</CoachTip>
	{/if}

	{#if pinnedMessage && !selectMode}
		<button type="button" class="pin-banner" onclick={() => jumpTo(pinnedMessage!.id)}>
			<span class="pin-banner-ico"><Pin size={14} /></span>
			<span class="pin-banner-text">{pinnedPreview}</span>
			<span
				class="pin-banner-clear"
				role="button"
				tabindex="0"
				onclick={(e) => {
					e.stopPropagation();
					pinMessage(null);
				}}
				onkeydown={(e) => e.key === 'Enter' && pinMessage(null)}
			>
				<X size={14} />
			</span>
		</button>
	{/if}

	<div class="messages-wrap">
		{#if stickyLabel}
			<div class="sticky-date" aria-hidden="true"><span>{stickyLabel}</span></div>
		{/if}

		{#if loadingOlder}
			<div class="load-older" aria-hidden="true"><span></span></div>
		{/if}

		<div class="messages" bind:this={listEl} onscroll={onListScroll}>
			{#if !messagesReady}
				<div class="chat-skeleton" aria-hidden="true">
					<span class="sk sk-them"></span>
					<span class="sk sk-me"></span>
					<span class="sk sk-them short"></span>
				</div>
			{:else if messages.length === 0}
				<div class="empty empty-animate chat-empty">
					<span class="empty-icon"><MessageCircle size={28} /></span>
					<strong>{i18n.t('chat.emptyTitle')}</strong>
					<p>{isChannel ? i18n.t('chat.emptyChannel') : isGroup ? i18n.t('group.empty') : i18n.t('chat.empty')}</p>
				</div>
			{/if}
			{#each timeline as item (item.key)}
				{#if item.kind === 'sep'}
					<div data-day-label={item.label}>
						<DateSeparator label={item.label} />
					</div>
				{:else if item.kind === 'unread'}
					<div class="unread-divider"><span>{i18n.t('chat.unreadSince')}</span></div>
				{:else if item.kind === 'sys'}
					<div class="sys-line"><span>{item.text}</span></div>
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
						{selectMode}
						showSender={isGroup}
						canModerate={isGroup && !!group?.canManage}
						selected={selectedIds.has(item.message.id)}
						e2ee={canE2ee && data.user && data.peer && e2eePeerKey
							? {
									myUserId: data.user.id,
									peerUserId: data.peer.id,
									peerPublicKey: e2eePeerKey
								}
							: null}
						onreply={(m: MessageDTO) => {
							replyTo = m;
							editing = null;
						}}
						onedit={(m: MessageDTO) => {
							editing = m;
							replyTo = null;
						}}
						ondelete={remove}
						onreact={react}
						onjump={jumpTo}
						onretry={retrySend}
						onopenImage={(urls: string[], index: number) => (lightbox = { urls, index })}
						onforward={(m: MessageDTO) => openForward([m.id])}
						onpin={pinMessage}
						ontoggleSelect={toggleSelect}
						onenterSelect={enterSelect}
						onopenSender={(m: MessageDTO) => {
							if (m.sender) goto(`/u/${m.sender.username}`);
						}}
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

	{#if selectMode}
		<div class="select-bar">
			<button type="button" class="icon-btn" onclick={bulkCopy} aria-label={i18n.t('chat.copy')}>
				<Copy size={20} />
			</button>
			<button
				type="button"
				class="icon-btn"
				onclick={() => openForward([...selectedIds])}
				aria-label={i18n.t('chat.forward')}
			>
				<Forward size={20} />
			</button>
			<button type="button" class="icon-btn danger" onclick={bulkDelete} aria-label={i18n.t('chat.delete')}>
				<Trash2 size={20} />
			</button>
		</div>
	{:else if canPost}
		<Composer
			chatId={data.chatId}
			{replyTo}
			{editing}
			placeholder={isChannel ? i18n.t('channel.postPlaceholder') : i18n.t('chat.message')}
			replyingLabel={i18n.t('chat.replying')}
			editingLabel={i18n.t('chat.editing')}
			recordingLabel={i18n.t('chat.recording')}
			slideToCancelLabel={i18n.t('chat.slideToCancel')}
			releaseToCancelLabel={i18n.t('chat.releaseToCancel')}
			cameraLabel={i18n.t('chat.camera')}
			attachLabel={i18n.t('chat.attach')}
			sendLabel={i18n.t('common.send')}
			voiceLabel={i18n.t('common.voice')}
			removeLabel={i18n.t('common.remove')}
			micDeniedLabel={i18n.t('chat.micDenied')}
			ontyping={isChannel ? undefined : emitTyping}
			onclearReply={() => (replyTo = null)}
			onclearEdit={() => (editing = null)}
			onsend={send}
		/>
		{#if isChannel}
			<p class="channel-format-hint">{i18n.t('channel.formatHint')}</p>
		{/if}
	{:else}
		<p class="channel-readonly">
			{isGroup ? i18n.t('group.readonly') : i18n.t('channel.readonly')}
		</p>
	{/if}
</div>

{#if lightbox}
	<ImageLightbox
		urls={lightbox.urls}
		index={lightbox.index}
		onclose={() => (lightbox = null)}
	/>
{/if}

{#if showMenu}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="menu-backdrop" onclick={() => (showMenu = false)}></div>
	<div class="msg-sheet">
		<div class="msg-menu">
			<button type="button" onclick={() => { showSearch = true; showMenu = false; }}>
				<span class="sheet-row-ico"><Search size={18} /></span>
				{i18n.t('chat.searchIn')}
			</button>
			<button type="button" onclick={openGallery}>
				<span class="sheet-row-ico"><ImageIcon size={18} /></span>
				{i18n.t('chat.gallery')}
			</button>
			<button type="button" onclick={archiveChat}>
				<span class="sheet-row-ico"><Archive size={18} /></span>
				{i18n.t('chat.archive')}
			</button>
			{#if isGroup}
				<button
					type="button"
					onclick={() => {
						showMenu = false;
						goto(`/chat/${data.chatId}/group`);
					}}
				>
					<span class="sheet-row-ico"><Info size={18} /></span>
					{i18n.t('group.info')}
				</button>
				{#if group!.canInvite}
					<button
						type="button"
						onclick={() => {
							showMenu = false;
							goto(`/chat/${data.chatId}/group?add=1`);
						}}
					>
						<span class="sheet-row-ico"><UserPlus size={18} /></span>
						{i18n.t('group.addMembers')}
					</button>
				{/if}
				{#if group!.canManage}
					<p class="sheet-section"><Clock size={14} /> {i18n.t('chat.disappear')}</p>
					<button type="button" class:active={disappearAfterSec === 0} onclick={() => setDisappear(0)}>
						{i18n.t('chat.disappearOff')}
					</button>
					<button type="button" class:active={disappearAfterSec === 86400} onclick={() => setDisappear(86400)}>
						{i18n.t('chat.disappear24h')}
					</button>
					<button type="button" class:active={disappearAfterSec === 604800} onclick={() => setDisappear(604800)}>
						{i18n.t('chat.disappear7d')}
					</button>
				{/if}
				<button
					type="button"
					class="danger"
					onclick={() => {
						showMenu = false;
						showLeaveModal = true;
					}}
				>
					<span class="sheet-row-ico"><LogOut size={18} /></span>
					{i18n.t('group.leave')}
				</button>
				{#if group!.myRole === 'owner'}
					<button
						type="button"
						class="danger"
						onclick={() => {
							showMenu = false;
							showDeleteGroupModal = true;
						}}
					>
						<span class="sheet-row-ico"><Trash2 size={18} /></span>
						{i18n.t('group.delete')}
					</button>
				{/if}
			{:else if !isChannel}
				<p class="sheet-section"><Clock size={14} /> {i18n.t('chat.disappear')}</p>
				<button type="button" class:active={disappearAfterSec === 0} onclick={() => setDisappear(0)}>
					{i18n.t('chat.disappearOff')}
				</button>
				<button type="button" class:active={disappearAfterSec === 86400} onclick={() => setDisappear(86400)}>
					{i18n.t('chat.disappear24h')}
				</button>
				<button type="button" class:active={disappearAfterSec === 604800} onclick={() => setDisappear(604800)}>
					{i18n.t('chat.disappear7d')}
				</button>
				<button type="button" class="danger" onclick={() => { showMenu = false; showDeleteModal = true; }}>
					<span class="sheet-row-ico"><Trash2 size={18} /></span>
					{i18n.t('chat.delete')}
				</button>
				<button type="button" class="danger" onclick={reportPeer}>
					<span class="sheet-row-ico"><Flag size={18} /></span>
					{i18n.t('chat.report')}
				</button>
			{/if}
		</div>
	</div>
{/if}

{#if showDeleteModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="menu-backdrop" onclick={() => (showDeleteModal = false)}></div>
	<div class="msg-sheet delete-dialog-sheet">
		<div class="msg-menu pad-sheet">
			<h3 class="sheet-title">{i18n.t('chat.deleteChatTitle')}</h3>
			<p class="sheet-desc">{i18n.t('chat.deleteChatPrompt')}</p>
			<button
				type="button"
				class="btn btn-block"
				onclick={() => confirmDeleteCurrentChat('self')}
			>
				{i18n.t('chat.deleteForMe')}
			</button>
			<button
				type="button"
				class="btn btn-block btn-danger-outline"
				onclick={() => confirmDeleteCurrentChat('everyone')}
			>
				{i18n.t('chat.deleteForEveryone')}
			</button>
			<button
				type="button"
				class="btn btn-ghost btn-block"
				onclick={() => (showDeleteModal = false)}
			>
				{i18n.t('chat.keep')}
			</button>
		</div>
	</div>
{/if}

{#if showLeaveModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="menu-backdrop" onclick={() => (showLeaveModal = false)}></div>
	<div class="msg-sheet delete-dialog-sheet">
		<div class="msg-menu pad-sheet">
			<h3 class="sheet-title">{i18n.t('group.leaveTitle')}</h3>
			<p class="sheet-desc">
				{group?.myRole === 'owner'
					? i18n.t('group.leaveOwnerPrompt')
					: i18n.t('group.leavePrompt')}
			</p>
			<button type="button" class="btn btn-block btn-danger-outline" onclick={leaveCurrentGroup}>
				{i18n.t('group.leave')}
			</button>
			<button
				type="button"
				class="btn btn-ghost btn-block"
				onclick={() => (showLeaveModal = false)}
			>
				{i18n.t('dialog.cancel')}
			</button>
		</div>
	</div>
{/if}

{#if showDeleteGroupModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="menu-backdrop" onclick={() => (showDeleteGroupModal = false)}></div>
	<div class="msg-sheet delete-dialog-sheet">
		<div class="msg-menu pad-sheet">
			<h3 class="sheet-title">{i18n.t('group.deleteTitle')}</h3>
			<p class="sheet-desc">{i18n.t('group.deletePrompt')}</p>
			<button type="button" class="btn btn-block btn-danger-outline" onclick={deleteCurrentGroup}>
				{i18n.t('group.delete')}
			</button>
			<button
				type="button"
				class="btn btn-ghost btn-block"
				onclick={() => (showDeleteGroupModal = false)}
			>
				{i18n.t('dialog.cancel')}
			</button>
		</div>
	</div>
{/if}

{#if showSearch}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="menu-backdrop" onclick={() => (showSearch = false)}></div>
	<div class="chat-overlay-sheet">
		<div class="overlay-head">
			<input
				type="search"
				placeholder={i18n.t('chat.searchIn')}
				bind:value={searchQ}
				oninput={onSearchInput}
			/>
			<button type="button" class="icon-btn" onclick={() => (showSearch = false)}><X size={18} /></button>
		</div>
		<div class="overlay-body">
			{#if searchingInChat}
				<p class="overlay-empty">{i18n.t('chats.searching')}</p>
			{:else if searchQ.trim().length >= 2 && !searchHits.length}
				<p class="overlay-empty">{i18n.t('chats.emptyFilter', { q: searchQ })}</p>
			{:else}
				{#each searchHits as hit (hit.id)}
					<button
						type="button"
						class="overlay-hit"
						onclick={() => {
							showSearch = false;
							jumpTo(hit.id);
						}}
					>
						<span>{hit.body.slice(0, 120)}</span>
					</button>
				{/each}
			{/if}
		</div>
	</div>
{/if}

{#if showGallery}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="menu-backdrop" onclick={() => (showGallery = false)}></div>
	<div class="chat-overlay-sheet gallery-sheet">
		<div class="overlay-head">
			<strong>{i18n.t('chat.gallery')}</strong>
			<button type="button" class="icon-btn" onclick={() => (showGallery = false)}><X size={18} /></button>
		</div>
		<div class="gallery-grid">
			{#each gallery as item (item.attachmentId)}
				{#if item.kind === 'image'}
					<button
						type="button"
						class="gallery-cell"
						onclick={() => {
							showGallery = false;
							jumpTo(item.messageId);
						}}
					>
						<img src="/api/files/{item.attachmentId}" alt={item.filename} />
					</button>
				{:else if item.kind === 'video'}
					<button
						type="button"
						class="gallery-cell"
						aria-label={item.filename}
						onclick={() => {
							showGallery = false;
							jumpTo(item.messageId);
						}}
					>
						<video src="/api/files/{item.attachmentId}" muted playsinline></video>
					</button>
				{:else}
					<a class="gallery-file" href="/api/files/{item.attachmentId}" target="_blank" rel="noopener">
						{item.filename}
					</a>
				{/if}
			{:else}
				<p class="overlay-empty">{i18n.t('chat.galleryEmpty')}</p>
			{/each}
		</div>
	</div>
{/if}

{#if showForward}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="menu-backdrop" onclick={() => (showForward = false)}></div>
	<div class="chat-overlay-sheet">
		<div class="overlay-head">
			<strong>{i18n.t('chat.forwardTo')}</strong>
			<button type="button" class="icon-btn" onclick={() => (showForward = false)}><X size={18} /></button>
		</div>
		<div class="overlay-body">
			{#each forwardChats as chat (chat.id)}
				<button type="button" class="overlay-hit forward-row" onclick={() => doForward(chat.id)}>
					{#if chat.kind === 'channel' && chat.channel}
						<ChannelAvatar channelKey={chat.channel.key} size={36} />
						<span>{i18n.t(`channel.${chat.channel.key}.title`)}</span>
					{:else if chat.kind === 'group' && chat.group}
						<GroupAvatar
							title={chat.group.title}
							chatId={chat.id}
							avatarPath={chat.group.avatarPath}
							size={36}
						/>
						<span>{chat.group.title}</span>
					{:else if chat.peer}
						<Avatar
							name={chat.peer.displayName || chat.peer.username}
							size={36}
							avatarPath={chat.peer.avatarPath}
							userId={chat.peer.id}
						/>
						<span>{chat.peer.displayName || chat.peer.username}</span>
					{/if}
				</button>
			{:else}
				<p class="overlay-empty">{i18n.t('chat.forwardEmpty')}</p>
			{/each}
		</div>
	</div>
{/if}

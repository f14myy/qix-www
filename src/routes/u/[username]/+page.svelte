<script lang="ts">
	import { goto } from '$app/navigation';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Ban from '@lucide/svelte/icons/ban';
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Avatar from '$lib/components/Avatar.svelte';
	import NameWithBadges from '$lib/components/NameWithBadges.svelte';
	import { confirmDialog, toast } from '$lib/flash.svelte';
	import { useI18n } from '$lib/i18n/useI18n.svelte';
	import { formatLastSeen, isOnlineIso } from '$lib/time';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const i18n = useI18n();
	let loading = $state(false);
	let blocking = $state(false);
	let blockedByMe = $state(false);
	let copied = $state(false);

	$effect(() => {
		blockedByMe = data.blockedByMe;
	});

	const title = $derived(data.profile.displayName || data.profile.username);
	const online = $derived(isOnlineIso(data.profile.lastSeenAt));
	const status = $derived(
		online
			? i18n.t('chat.online')
			: data.profile.lastSeenAt
				? i18n.t('chat.lastSeen', { when: formatLastSeen(data.profile.lastSeenAt, i18n.locale) })
				: ''
	);

	const joined = $derived(
		new Date(data.profile.createdAt).toLocaleDateString(i18n.locale === 'ru' ? 'ru-RU' : 'en-US', {
			month: 'long',
			year: 'numeric'
		})
	);

	async function openChat() {
		if (data.existingChatId) {
			await goto(`/chat/${data.existingChatId}`);
			return;
		}
		loading = true;
		try {
			const res = await fetch('/api/chats', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ peerUsername: data.profile.username })
			});
			const json = await res.json();
			if (res.status === 202 || json.pending) {
				toast(i18n.t('requests.sent'));
				return;
			}
			if (res.ok) await goto(`/chat/${json.chatId}`);
			else toast(json.error || i18n.t('common.error'), 'err');
		} finally {
			loading = false;
		}
	}

	async function toggleBlock() {
		const name = data.profile.username;
		if (blockedByMe) {
			if (!(await confirmDialog(i18n.t('settings.unblockConfirm', { user: name })))) return;
			blocking = true;
			try {
				const res = await fetch(`/api/me/blocked/${data.profile.id}`, { method: 'DELETE' });
				if (res.ok) blockedByMe = false;
			} finally {
				blocking = false;
			}
		} else {
			if (!(await confirmDialog(i18n.t('settings.blockConfirm', { user: name })))) return;
			blocking = true;
			try {
				const res = await fetch('/api/me/blocked', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ userId: data.profile.id })
				});
				if (res.ok) blockedByMe = true;
			} finally {
				blocking = false;
			}
		}
	}

	async function copyUsername() {
		try {
			await navigator.clipboard.writeText(`@${data.profile.username}`);
			copied = true;
			setTimeout(() => (copied = false), 1600);
		} catch {
			/* ignore */
		}
	}
</script>

<div class="screen">
	<header class="topbar topbar-transparent">
		<button type="button" class="icon-btn" aria-label={i18n.t('back')} onclick={() => history.back()}>
			<ArrowLeft size={22} />
		</button>
		<h1>{i18n.t('profile.title')}</h1>
		{#if data.isSelf}
			<a class="icon-btn" href="/settings/profile" aria-label={i18n.t('settings.profile')}>
				<Pencil size={20} />
			</a>
		{:else}
			<span class="icon-btn" style="visibility:hidden" aria-hidden="true"><Pencil size={20} /></span>
		{/if}
	</header>

	<div class="profile-page">
		<div class="profile-banner" data-banner={data.profile.bannerKey} aria-hidden="true">
			{#if data.profile.bannerPath}
				<img
					class="profile-banner-img"
					src={`/api/banners/${data.profile.id}?v=${data.profile.bannerPath}`}
					alt=""
				/>
			{/if}
		</div>

		<div class="profile-view">
			<div class="profile-avatar-stage">
				<Avatar
					name={title}
					size={104}
					avatarPath={data.profile.avatarPath}
					userId={data.profile.id}
					{online}
				/>
			</div>

			<h2 class="profile-name">
				<NameWithBadges name={title} badges={data.profile.badges} size="lg" />
			</h2>

			<button type="button" class="profile-user-btn" onclick={copyUsername}>
				<span>@{data.profile.username}</span>
				{#if copied}
					<Check size={14} />
				{:else}
					<Copy size={14} />
				{/if}
			</button>

			{#if data.profile.badges.length}
				<NameWithBadges name="" badges={data.profile.badges} showLabels />
			{/if}

			{#if status}
				<p class="peer-status profile-status" class:online>{status}</p>
			{/if}

			{#if data.profile.bio}
				<p class="profile-bio">{data.profile.bio}</p>
			{:else if data.isSelf}
				<p class="profile-bio profile-bio-empty">{i18n.t('profile.bioEmpty')}</p>
			{/if}

			<div class="profile-meta">
				<div class="profile-meta-row">
					<span class="profile-meta-label">{i18n.t('profile.joined')}</span>
					<span class="profile-meta-value">{joined}</span>
				</div>
			</div>

			{#if blockedByMe}
				<p class="blocked-banner">{i18n.t('settings.blockedBanner')}</p>
			{/if}

			{#if !data.isSelf}
				<div class="profile-actions">
					{#if !blockedByMe && !data.blocked}
						<button class="btn btn-block" type="button" disabled={loading} onclick={openChat}>
							<MessageCircle size={18} />
							{data.existingChatId ? i18n.t('profile.openChat') : i18n.t('profile.message')}
						</button>
					{/if}
					<button
						class="btn btn-ghost btn-block"
						type="button"
						disabled={blocking}
						onclick={toggleBlock}
					>
						<Ban size={18} />
						{blockedByMe ? i18n.t('settings.unblock') : i18n.t('settings.block')}
					</button>
				</div>
			{/if}
		</div>
	</div>
</div>

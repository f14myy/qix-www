<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import ArchiveRestore from '@lucide/svelte/icons/archive-restore';
	import Avatar from '$lib/components/Avatar.svelte';
	import ChannelAvatar from '$lib/components/ChannelAvatar.svelte';
	import NameWithBadges from '$lib/components/NameWithBadges.svelte';
	import { lastMessagePreview } from '$lib/chatPreview';
	import { useI18n } from '$lib/i18n/useI18n.svelte';
	import { formatRelativeTime } from '$lib/time';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const i18n = useI18n();

	function title(chat: PageData['chats'][number]) {
		if (chat.kind === 'channel' && chat.channel) {
			return i18n.t(`channel.${chat.channel.key}.title`);
		}
		return chat.peer?.displayName || chat.peer?.username || '';
	}

	async function unarchive(chatId: string) {
		await fetch(`/api/chats/${chatId}/prefs`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ archived: false })
		});
		await invalidateAll();
	}
</script>

<div class="screen">
	<header class="topbar">
		<h1>{i18n.t('chats.archive')}</h1>
	</header>

	<div class="list">
		{#if data.chats.length === 0}
			<div class="empty empty-animate">
				<span class="empty-icon"><ArchiveRestore size={36} /></span>
				<p>{i18n.t('chats.archiveEmpty')}</p>
			</div>
		{:else}
			{#each data.chats as chat (chat.id)}
				<div class="chat-row-wrap" style="display:flex;align-items:stretch">
					<button type="button" class="chat-row" style="flex:1" onclick={() => goto(`/chat/${chat.id}`)}>
						{#if chat.kind === 'channel' && chat.channel}
							<ChannelAvatar channelKey={chat.channel.key} size={48} />
						{:else if chat.peer}
							<Avatar
								name={title(chat)}
								avatarPath={chat.peer.avatarPath}
								userId={chat.peer.id}
							/>
						{/if}
						<div class="meta">
							<div class="row-top">
								<p class="name">
									{#if chat.kind === 'channel'}
										{title(chat)}
									{:else}
										<NameWithBadges
											name={title(chat)}
											badges={chat.peer?.badges ?? []}
											size="sm"
										/>
									{/if}
								</p>
								{#if chat.lastMessage}
									<span class="time"
										>{formatRelativeTime(chat.lastMessage.createdAt, i18n.locale)}</span
									>
								{/if}
							</div>
							<div class="row-bottom">
								<p class="preview">
									{lastMessagePreview(chat, { userId: data.user?.id, t: i18n.t })}
								</p>
							</div>
						</div>
					</button>
					<button
						type="button"
						class="icon-btn"
						style="align-self:center;margin-right:8px"
						aria-label={i18n.t('chats.unarchive')}
						onclick={() => unarchive(chat.id)}
					>
						<ArchiveRestore size={16} />
					</button>
				</div>
			{/each}
		{/if}
	</div>
</div>

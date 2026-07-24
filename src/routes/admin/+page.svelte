<script lang="ts">
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import Users from '@lucide/svelte/icons/users';
	import Ban from '@lucide/svelte/icons/ban';
	import Activity from '@lucide/svelte/icons/activity';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import ShieldOff from '@lucide/svelte/icons/shield-off';
	import { useI18n } from '$lib/i18n/useI18n.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const i18n = useI18n();
	const s = $derived(data.stats);
	const maxDay = $derived(Math.max(1, ...s.messagesByDay.map((d) => d.count)));

	const tiles = $derived([
		{ key: 'users', value: s.usersTotal, hint: i18n.t('admin.statOnline', { n: String(s.usersOnline) }), icon: Users },
		{ key: 'banned', value: s.usersBanned, hint: i18n.t('admin.statNew7d', { n: String(s.usersNew7d) }), icon: Ban },
		{ key: 'messages', value: s.messagesTotal, hint: i18n.t('admin.statMsg24h', { n: String(s.messages24h) }), icon: MessageSquare },
		{ key: 'chats', value: s.chats, hint: i18n.t('admin.statSessions', { n: String(s.sessions) }), icon: Activity },
		{ key: 'attachments', value: s.attachments, hint: i18n.t('admin.statReactions', { n: String(s.reactions) }), icon: Paperclip },
		{ key: 'blocks', value: s.blocks, hint: i18n.t('admin.statNew24h', { n: String(s.usersNew24h) }), icon: ShieldOff }
	] as const);
</script>

<section class="admin-section">
	<h2>{i18n.t('admin.overview')}</h2>
	<p class="admin-lead">{i18n.t('admin.overviewLead')}</p>

	<div class="admin-stat-grid">
		{#each tiles as tile}
			{@const Icon = tile.icon}
			<div class="admin-stat-tile">
				<span class="admin-stat-ico"><Icon size={18} /></span>
				<strong>{tile.value}</strong>
				<span class="admin-stat-label">{i18n.t(`admin.stat.${tile.key}`)}</span>
				<span class="admin-stat-hint">{tile.hint}</span>
			</div>
		{/each}
	</div>
</section>

<section class="admin-section">
	<h2>{i18n.t('admin.messagesChart')}</h2>
	<div class="admin-chart">
		{#each s.messagesByDay as day}
			<div class="admin-chart-col" title="{day.day}: {day.count}">
				<div class="admin-chart-bar" style="height:{Math.round((day.count / maxDay) * 100)}%"></div>
				<span class="admin-chart-label">{day.day.slice(5)}</span>
			</div>
		{/each}
	</div>
</section>

<section class="admin-section">
	<h2>{i18n.t('admin.quick')}</h2>
	<div class="admin-quick">
		<a class="btn" href="/admin/users">{i18n.t('admin.navUsers')}</a>
		<a class="btn btn-ghost" href="/admin/bans">{i18n.t('admin.navBans')}</a>
		<a class="btn btn-ghost" href="/admin/messages">{i18n.t('admin.navMessages')}</a>
	</div>
</section>

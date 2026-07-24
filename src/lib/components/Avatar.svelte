<script lang="ts">
	let {
		name,
		size = 48,
		avatarPath = null as string | null,
		userId = null as string | null
	}: {
		name: string;
		size?: number;
		avatarPath?: string | null;
		userId?: string | null;
	} = $props();

	const colors = ['#1a7a6d', '#2b6cb0', '#c05621', '#5b4bb7', '#2f855a', '#b83232', '#2c7a7b'];
	const letter = $derived((name?.[0] || '?').toUpperCase());
	const bg = $derived(colors[(name?.charCodeAt(0) || 0) % colors.length]);
	const src = $derived(userId && avatarPath ? `/api/avatars/${userId}` : null);
</script>

{#if src}
	<img
		class="avatar"
		src={src}
		alt={name}
		width={size}
		height={size}
		style="width:{size}px;height:{size}px;object-fit:cover"
	/>
{:else}
	<div
		class="avatar"
		style="width:{size}px;height:{size}px;background:{bg};font-size:{size * 0.38}px;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.12)"
	>
		{letter}
	</div>
{/if}

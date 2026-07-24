<script lang="ts">
	import { goto } from '$app/navigation';
	import { useI18n } from '$lib/i18n/useI18n.svelte';

	const i18n = useI18n();
	let username = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	async function submit(e: Event) {
		e.preventDefault();
		error = '';
		loading = true;
		try {
			const res = await fetch('/api/auth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ username, password })
			});
			const data = await res.json();
			if (!res.ok) {
				error = data.error || i18n.t('auth.registerFailed');
				return;
			}
			if (Array.isArray(data.recoveryCodes)) {
				try {
					sessionStorage.setItem('qix-recovery-codes', JSON.stringify(data.recoveryCodes));
				} catch {
					/* ignore */
				}
			}
			await goto('/');
		} finally {
			loading = false;
		}
	}
</script>

<div class="screen auth-screen">
	<div class="auth-card">
		<h1 class="brand-title">Qix</h1>
		<p class="subtitle">{i18n.t('auth.registerSubtitle')}</p>

		<form onsubmit={submit}>
			<div class="field">
				<label for="username">{i18n.t('auth.username')}</label>
				<input
					id="username"
					autocomplete="username"
					placeholder={i18n.t('auth.usernameHint')}
					maxlength="9"
					pattern={'[A-Za-z0-9]{3,9}'}
					bind:value={username}
					required
				/>
			</div>
			<div class="field">
				<label for="password">{i18n.t('auth.password')}</label>
				<input
					id="password"
					type="password"
					autocomplete="new-password"
					minlength="8"
					bind:value={password}
					required
				/>
				<p class="field-hint">{i18n.t('auth.passwordHint')}</p>
			</div>
			{#if error}
				<p class="error">{error}</p>
			{/if}
			<button class="btn btn-block" type="submit" disabled={loading}>
				{loading ? i18n.t('auth.creating') : i18n.t('auth.create')}
			</button>
		</form>

		<p class="auth-footer">
			{i18n.t('auth.haveAccount')} <a href="/login">{i18n.t('auth.signInLink')}</a>
		</p>
	</div>
</div>

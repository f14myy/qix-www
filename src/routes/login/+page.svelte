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
			const res = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ username, password })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				error =
					typeof data.error === 'string' && data.error
						? data.error
						: i18n.t('auth.loginFailed');
				return;
			}
			await goto('/');
		} catch {
			error = i18n.t('auth.loginFailed');
		} finally {
			loading = false;
		}
	}
</script>

<div class="screen auth-screen">
	<div class="auth-card">
		<h1 class="brand-title">Qix</h1>
		<p class="subtitle">{i18n.t('brand.subtitle')}</p>

		<form onsubmit={submit}>
			<div class="field">
				<label for="username">{i18n.t('auth.username')}</label>
				<input
					id="username"
					autocomplete="username"
					placeholder={i18n.t('auth.usernameHint')}
					maxlength="9"
					bind:value={username}
					required
				/>
			</div>
			<div class="field">
				<label for="password">{i18n.t('auth.password')}</label>
				<input
					id="password"
					type="password"
					autocomplete="current-password"
					bind:value={password}
					required
				/>
			</div>
			{#if error}
				<p class="error">{error}</p>
			{/if}
			<button class="btn btn-block" type="submit" disabled={loading}>
				{loading ? i18n.t('auth.signingIn') : i18n.t('auth.signIn')}
			</button>
		</form>

		<p class="auth-footer">
			<a href="/recover">{i18n.t('auth.forgotPassword')}</a>
		</p>
		<p class="auth-footer">
			{i18n.t('auth.noAccount')} <a href="/register">{i18n.t('auth.createOne')}</a>
		</p>
	</div>
</div>

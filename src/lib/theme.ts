export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'qix-theme';

export function getStoredTheme(): ThemePreference {
	if (typeof localStorage === 'undefined') return 'system';
	const v = localStorage.getItem(STORAGE_KEY);
	if (v === 'light' || v === 'dark' || v === 'system') return v;
	return 'system';
}

export function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
	if (pref === 'light' || pref === 'dark') return pref;
	if (typeof window === 'undefined') return 'light';
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(pref: ThemePreference): 'light' | 'dark' {
	const resolved = resolveTheme(pref);
	document.documentElement.dataset.theme = resolved;
	document.documentElement.style.colorScheme = resolved;
	const meta = document.querySelector('meta[name="theme-color"]');
	if (meta) {
		meta.setAttribute('content', resolved === 'dark' ? '#0c1116' : '#1a7a6d');
	}
	return resolved;
}

export function setThemePreference(pref: ThemePreference): 'light' | 'dark' {
	localStorage.setItem(STORAGE_KEY, pref);
	return applyTheme(pref);
}

export function initTheme(): ThemePreference {
	const pref = getStoredTheme();
	applyTheme(pref);
	return pref;
}

export type ThemePreference = 'light' | 'dark' | 'system';

/** Full visual look — colors, bubbles, chat base tone. */
export type LookId =
	| 'qix'
	| 'lagoon'
	| 'meadow'
	| 'ember'
	| 'graphite'
	| 'ink'
	| 'dusk'
	| 'coral'
	| 'frost'
	| 'sand';

/** Chat wallpaper pattern layered on top of look’s --bg-chat. */
export type WallpaperId =
	| 'dots'
	| 'crosses'
	| 'diagonals'
	| 'diamonds'
	| 'ripples'
	| 'grid'
	| 'bloom'
	| 'chevrons'
	| 'stars'
	| 'weave'
	| 'mist'
	| 'none';

export type WallpaperIntensity = 'soft' | 'normal' | 'bold';

const MODE_KEY = 'qix-theme';
const LOOK_KEY = 'qix-look';
const WALLPAPER_KEY = 'qix-wallpaper';
const INTENSITY_KEY = 'qix-wallpaper-intensity';
const REDUCE_MOTION_KEY = 'qix-reduce-motion';
const LEGACY_ACCENT_KEY = 'qix-accent';

const LOOK_IDS: LookId[] = [
	'qix',
	'lagoon',
	'meadow',
	'ember',
	'graphite',
	'ink',
	'dusk',
	'coral',
	'frost',
	'sand'
];

const WALLPAPER_IDS: WallpaperId[] = [
	'dots',
	'crosses',
	'diagonals',
	'diamonds',
	'ripples',
	'grid',
	'bloom',
	'chevrons',
	'stars',
	'weave',
	'mist',
	'none'
];

const INTENSITY_IDS: WallpaperIntensity[] = ['soft', 'normal', 'bold'];

/** Map old accent ids → new looks. */
const LEGACY_ACCENT_MAP: Record<string, LookId> = {
	teal: 'qix',
	ocean: 'lagoon',
	forest: 'meadow',
	slate: 'graphite',
	amber: 'ember'
};

export const LOOKS: { id: LookId; labelKey: string; swatch: string }[] = [
	{ id: 'qix', labelKey: 'look.qix', swatch: '#1a7a6d' },
	{ id: 'lagoon', labelKey: 'look.lagoon', swatch: '#1a6f9a' },
	{ id: 'meadow', labelKey: 'look.meadow', swatch: '#3d6b3a' },
	{ id: 'ember', labelKey: 'look.ember', swatch: '#b86a1a' },
	{ id: 'coral', labelKey: 'look.coral', swatch: '#c45c4a' },
	{ id: 'frost', labelKey: 'look.frost', swatch: '#5a8aa8' },
	{ id: 'sand', labelKey: 'look.sand', swatch: '#9a7b56' },
	{ id: 'graphite', labelKey: 'look.graphite', swatch: '#4a5d6e' },
	{ id: 'ink', labelKey: 'look.ink', swatch: '#1c1c22' },
	{ id: 'dusk', labelKey: 'look.dusk', swatch: '#5b4a7a' }
];

export const WALLPAPERS: { id: WallpaperId; labelKey: string }[] = [
	{ id: 'dots', labelKey: 'wallpaper.dots' },
	{ id: 'crosses', labelKey: 'wallpaper.crosses' },
	{ id: 'diagonals', labelKey: 'wallpaper.diagonals' },
	{ id: 'diamonds', labelKey: 'wallpaper.diamonds' },
	{ id: 'ripples', labelKey: 'wallpaper.ripples' },
	{ id: 'grid', labelKey: 'wallpaper.grid' },
	{ id: 'bloom', labelKey: 'wallpaper.bloom' },
	{ id: 'chevrons', labelKey: 'wallpaper.chevrons' },
	{ id: 'stars', labelKey: 'wallpaper.stars' },
	{ id: 'weave', labelKey: 'wallpaper.weave' },
	{ id: 'mist', labelKey: 'wallpaper.mist' },
	{ id: 'none', labelKey: 'wallpaper.none' }
];

const STATUS_BAR: Record<LookId, { light: string; dark: string }> = {
	qix: { light: '#1a7a6d', dark: '#0c1116' },
	lagoon: { light: '#1a6f9a', dark: '#0a1016' },
	meadow: { light: '#3d6b3a', dark: '#0c120c' },
	ember: { light: '#b86a1a', dark: '#120e0a' },
	coral: { light: '#c45c4a', dark: '#140c0c' },
	frost: { light: '#5a8aa8', dark: '#0a1014' },
	sand: { light: '#9a7b56', dark: '#12100c' },
	graphite: { light: '#4a5d6e', dark: '#0c1014' },
	ink: { light: '#2a2a32', dark: '#0a0a0c' },
	dusk: { light: '#5b4a7a', dark: '#100e16' }
};

function isLook(v: string | null): v is LookId {
	return !!v && (LOOK_IDS as string[]).includes(v);
}

function isWallpaper(v: string | null): v is WallpaperId {
	return !!v && (WALLPAPER_IDS as string[]).includes(v);
}

function isIntensity(v: string | null): v is WallpaperIntensity {
	return !!v && (INTENSITY_IDS as string[]).includes(v);
}

export function getStoredTheme(): ThemePreference {
	if (typeof localStorage === 'undefined') return 'system';
	const v = localStorage.getItem(MODE_KEY);
	if (v === 'light' || v === 'dark' || v === 'system') return v;
	return 'system';
}

export function getStoredLook(): LookId {
	if (typeof localStorage === 'undefined') return 'qix';
	const look = localStorage.getItem(LOOK_KEY);
	if (isLook(look)) return look;
	const legacy = localStorage.getItem(LEGACY_ACCENT_KEY);
	if (legacy && LEGACY_ACCENT_MAP[legacy]) return LEGACY_ACCENT_MAP[legacy];
	return 'qix';
}

export function getStoredWallpaper(): WallpaperId {
	if (typeof localStorage === 'undefined') return 'dots';
	const v = localStorage.getItem(WALLPAPER_KEY);
	if (isWallpaper(v)) return v;
	return 'dots';
}

export function getStoredIntensity(): WallpaperIntensity {
	if (typeof localStorage === 'undefined') return 'normal';
	const v = localStorage.getItem(INTENSITY_KEY);
	if (isIntensity(v)) return v;
	return 'normal';
}

export function getStoredReduceMotion(): boolean {
	if (typeof localStorage === 'undefined') return false;
	return localStorage.getItem(REDUCE_MOTION_KEY) === '1';
}

export function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
	if (pref === 'light' || pref === 'dark') return pref;
	if (typeof window === 'undefined') return 'light';
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyLook(look: LookId, resolved?: 'light' | 'dark') {
	document.documentElement.dataset.look = look;
	document.documentElement.removeAttribute('data-accent');
	const mode = resolved ?? resolveTheme(getStoredTheme());
	const meta = document.querySelector('meta[name="theme-color"]');
	if (meta) {
		meta.setAttribute('content', mode === 'dark' ? STATUS_BAR[look].dark : STATUS_BAR[look].light);
	}
}

export function applyWallpaper(wallpaper: WallpaperId) {
	document.documentElement.dataset.wallpaper = wallpaper;
}

export function applyIntensity(intensity: WallpaperIntensity) {
	document.documentElement.dataset.wpIntensity = intensity;
}

export function applyReduceMotion(on: boolean) {
	if (on) document.documentElement.dataset.reduceMotion = '1';
	else document.documentElement.removeAttribute('data-reduce-motion');
}

export function applyTheme(pref: ThemePreference): 'light' | 'dark' {
	const resolved = resolveTheme(pref);
	document.documentElement.dataset.theme = resolved;
	document.documentElement.style.colorScheme = resolved;
	applyLook(getStoredLook(), resolved);
	applyWallpaper(getStoredWallpaper());
	applyIntensity(getStoredIntensity());
	applyReduceMotion(getStoredReduceMotion());
	return resolved;
}

export function setThemePreference(pref: ThemePreference): 'light' | 'dark' {
	localStorage.setItem(MODE_KEY, pref);
	return applyTheme(pref);
}

export function setLookPreference(look: LookId) {
	localStorage.setItem(LOOK_KEY, look);
	applyLook(look);
}

export function setWallpaperPreference(wallpaper: WallpaperId) {
	localStorage.setItem(WALLPAPER_KEY, wallpaper);
	applyWallpaper(wallpaper);
}

export function setIntensityPreference(intensity: WallpaperIntensity) {
	localStorage.setItem(INTENSITY_KEY, intensity);
	applyIntensity(intensity);
}

export function setReduceMotionPreference(on: boolean) {
	localStorage.setItem(REDUCE_MOTION_KEY, on ? '1' : '0');
	applyReduceMotion(on);
}

export function initTheme(): ThemePreference {
	const pref = getStoredTheme();
	applyTheme(pref);
	return pref;
}

/** @deprecated use LookId / setLookPreference */
export type AccentId = LookId;
/** @deprecated */
export const ACCENTS = LOOKS.map((l) => ({ id: l.id as AccentId, label: l.id }));
/** @deprecated */
export const getStoredAccent = getStoredLook;
/** @deprecated */
export const setAccentPreference = setLookPreference;
/** @deprecated */
export const applyAccent = applyLook;

/** Light haptic feedback when available (Android Chrome, some PWAs). */
export function haptic(ms: number | number[] = 10) {
	try {
		if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
			navigator.vibrate(ms);
		}
	} catch {
		/* ignore */
	}
}

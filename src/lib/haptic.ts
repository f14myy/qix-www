/** Light haptic feedback when available (Android Chrome, some PWAs). */
import { getCachedSettings } from './settings';

export function haptic(ms: number | number[] = 10) {
	try {
		if (!getCachedSettings().haptics) return;
		if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
			navigator.vibrate(ms);
		}
	} catch {
		/* ignore */
	}
}

export function hapticSuccess() {
	haptic([10, 40, 12]);
}

export function hapticFail() {
	haptic([30, 40, 30]);
}

export function hapticPop() {
	haptic([6, 20, 8]);
}

export function hapticSwipe() {
	haptic(12);
}

export function hapticBurst() {
	haptic([8, 15, 8, 15, 12]);
}

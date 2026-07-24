/** Simple in-memory sliding-window rate limiter (per process). */
const buckets = new Map<string, number[]>();

export function rateLimit(
	key: string,
	limit = 10,
	windowMs = 15 * 60 * 1000
): { ok: true } | { ok: false; retryAfterSec: number } {
	const now = Date.now();
	const cutoff = now - windowMs;
	const prev = (buckets.get(key) ?? []).filter((t) => t > cutoff);
	if (prev.length >= limit) {
		const retryAfterSec = Math.max(1, Math.ceil((prev[0]! + windowMs - now) / 1000));
		buckets.set(key, prev);
		return { ok: false, retryAfterSec };
	}
	prev.push(now);
	buckets.set(key, prev);
	return { ok: true };
}

export function clientIp(request: Request, getClientAddress?: () => string): string {
	try {
		if (getClientAddress) return getClientAddress();
	} catch {
		/* ignore */
	}
	const xf = request.headers.get('x-forwarded-for');
	if (xf) return xf.split(',')[0]!.trim();
	return 'unknown';
}

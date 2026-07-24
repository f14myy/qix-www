const URL_RE = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

export function extractFirstUrl(text: string): string | null {
	const m = text.match(URL_RE);
	return m?.[0] ?? null;
}

function metaContent(html: string, key: string): string | null {
	const prop = new RegExp(
		`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`,
		'i'
	);
	const prop2 = new RegExp(
		`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`,
		'i'
	);
	return html.match(prop)?.[1] ?? html.match(prop2)?.[1] ?? null;
}

export async function fetchLinkPreview(url: string): Promise<{
	url: string;
	title: string | null;
	description: string | null;
	imageUrl: string | null;
} | null> {
	try {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), 3000);
		const res = await fetch(url, {
			signal: ctrl.signal,
			headers: { 'user-agent': 'QixBot/1.0', accept: 'text/html' },
			redirect: 'follow'
		});
		clearTimeout(timer);
		if (!res.ok) return null;
		const ctype = res.headers.get('content-type') ?? '';
		if (!ctype.includes('text/html')) return { url, title: url, description: null, imageUrl: null };
		const buf = await res.arrayBuffer();
		if (buf.byteLength > 500_000) return null;
		const html = new TextDecoder('utf-8').decode(buf);
		const title =
			metaContent(html, 'og:title') ??
			html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ??
			null;
		const description =
			metaContent(html, 'og:description') ?? metaContent(html, 'description');
		let imageUrl = metaContent(html, 'og:image');
		if (imageUrl && imageUrl.startsWith('/')) {
			try {
				imageUrl = new URL(imageUrl, url).href;
			} catch {
				imageUrl = null;
			}
		}
		return { url, title, description, imageUrl };
	} catch {
		return null;
	}
}

import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { isNull } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url }) => {
	const origin = process.env.ORIGIN || url.origin || 'https://qix.chat';

	const staticPages = [
		{ path: '', priority: '1.0', changefreq: 'daily' },
		{ path: '/login', priority: '0.8', changefreq: 'monthly' },
		{ path: '/register', priority: '0.8', changefreq: 'monthly' },
		{ path: '/recover', priority: '0.5', changefreq: 'monthly' }
	];

	// Fetch unbanned users for public profiles
	let userProfiles: { username: string }[] = [];
	try {
		userProfiles = db
			.select({ username: users.username })
			.from(users)
			.where(isNull(users.bannedAt))
			.all();
	} catch {
		// Fallback if DB is unavailable during SSG build
		userProfiles = [];
	}

	const staticUrls = staticPages
		.map(
			(page) => `
	<url>
		<loc>${origin}${page.path}</loc>
		<changefreq>${page.changefreq}</changefreq>
		<priority>${page.priority}</priority>
	</url>`
		)
		.join('');

	const profileUrls = userProfiles
		.map(
			(user) => `
	<url>
		<loc>${origin}/u/${encodeURIComponent(user.username)}</loc>
		<changefreq>weekly</changefreq>
		<priority>0.7</priority>
	</url>`
		)
		.join('');

	const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticUrls}
${profileUrls}
</urlset>`.trim();

	return new Response(body, {
		headers: {
			'Content-Type': 'application/xml; charset=utf-8',
			'Cache-Control': 'max-age=0, s-maxage=3600'
		}
	});
};

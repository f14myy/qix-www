import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

/** Origins allowed for form/multipart API calls (build-time). Comma-separated. */
const csrfTrusted = [
	...(process.env.ORIGIN ? [process.env.ORIGIN.replace(/\/$/, '')] : []),
	...(process.env.CSRF_TRUSTED_ORIGINS ?? '')
		.split(',')
		.map((s) => s.trim().replace(/\/$/, ''))
		.filter(Boolean)
];

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			// If runtime ORIGIN is missing/wrong, adapter-node defaults to https://host and
			// multipart PATCH/POST (profile photo) gets CSRF 403. Trust explicit http origins too.
			csrf: {
				trustedOrigins: csrfTrusted
			}
		})
	],
	server: {
		// Allow Cloudflare / ngrok / localtunnel hosts in `pnpm dev`
		allowedHosts: true,
		host: true,
		fs: {
			allow: ['data']
		}
	}
});

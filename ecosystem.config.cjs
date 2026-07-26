/**
 * PM2 config for VPS. Copy/adjust ORIGIN to the exact URL from the browser address bar
 * (scheme + host, no trailing slash). Example: http://217.60.240.76
 *
 * Usage:
 *   pnpm build
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * After editing env:
 *   pm2 reload ecosystem.config.cjs --update-env
 */
module.exports = {
	apps: [
		{
			name: 'qix',
			script: 'build/index.js',
			instances: 1,
			exec_mode: 'fork',
			env: {
				NODE_ENV: 'production',
				// MUST match the URL users open (http vs https, with :port if not 80/443)
				ORIGIN: process.env.ORIGIN || 'https://qqqix.ru',
				HOST: '0.0.0.0',
				PORT: process.env.PORT || '3000',
				// Avatar/banner uploads (default adapter limit is 512K)
				BODY_SIZE_LIMIT: process.env.BODY_SIZE_LIMIT || '8M'
			}
		}
	]
};

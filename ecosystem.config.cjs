const fs = require('node:fs');
const path = require('node:path');

/** Load `.env` into an object (pm2 does not read it by itself). */
function loadEnvFile() {
	const file = path.join(__dirname, '.env');
	const out = {};
	if (!fs.existsSync(file)) return out;
	for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith('#')) continue;
		const eq = line.indexOf('=');
		if (eq <= 0) continue;
		const key = line.slice(0, eq).trim();
		let val = line.slice(eq + 1).trim();
		if (
			(val.startsWith('"') && val.endsWith('"')) ||
			(val.startsWith("'") && val.endsWith("'"))
		) {
			val = val.slice(1, -1);
		}
		out[key] = val;
	}
	return out;
}

const fileEnv = loadEnvFile();

module.exports = {
	apps: [
		{
			name: 'qix',
			cwd: __dirname,
			script: 'build/index.js',
			instances: 1,
			exec_mode: 'fork',
			autorestart: true,
			max_restarts: 20,
			env: {
				NODE_ENV: 'production',
				...fileEnv
			}
		}
	]
};

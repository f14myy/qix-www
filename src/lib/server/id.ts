import { randomBytes } from 'node:crypto';

export function createId(bytes = 16): string {
	return randomBytes(bytes).toString('hex');
}

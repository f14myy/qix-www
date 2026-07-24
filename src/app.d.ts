// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Locals {
			user: {
				id: string;
				username: string;
				displayName: string | null;
				avatarPath: string | null;
			} | null;
			sessionId: string | null;
		}
	}
}

export {};

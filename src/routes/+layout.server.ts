import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	const path = url.pathname;
	const isAuthPage = path === '/login' || path === '/register' || path === '/recover';
	const isPublicInvite = path.startsWith('/invite/');

	if (!locals.user && !isAuthPage && !isPublicInvite) {
		redirect(303, '/login');
	}

	if (locals.user && isAuthPage) {
		redirect(303, '/');
	}

	return { user: locals.user };
};

export type LastSeenVisibility = 'everyone' | 'chats' | 'nobody';
export type WhoCanMessage = 'everyone' | 'chats';

export type UserSettingsDTO = {
	notifyMessages: boolean;
	notifyReactions: boolean;
	haptics: boolean;
	sendWithEnter: boolean;
	linkPreviews: boolean;
	lastSeenVisibility: LastSeenVisibility;
	readReceipts: boolean;
	showTyping: boolean;
	whoCanMessage: WhoCanMessage;
};

export const DEFAULT_SETTINGS: UserSettingsDTO = {
	notifyMessages: true,
	notifyReactions: true,
	haptics: true,
	sendWithEnter: true,
	linkPreviews: true,
	lastSeenVisibility: 'everyone',
	readReceipts: true,
	showTyping: true,
	whoCanMessage: 'everyone'
};

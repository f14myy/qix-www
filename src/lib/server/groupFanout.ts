import { getMessageById, toMessageDTO } from './chats';
import { publishToChat, publishToChatMembers } from './events';
import type { GroupResult } from './groups';

/**
 * Broadcasts the effects of a group mutation.
 *
 * Split out of `groups.ts` on purpose: that module must not import `chats.ts`
 * (which imports it back), and it should not be writing to sockets from inside a
 * transaction either. Every route calls this once, after the mutation returned.
 */
export function fanoutGroupResult(chatId: string, result: GroupResult): void {
	for (const id of result.messageIds) {
		const row = getMessageById(id);
		if (row) publishToChat(chatId, 'message', toMessageDTO(row));
	}
	/*
	 * `notify` deliberately includes anyone who just lost access — their chat list
	 * needs to drop the row, which it only learns by being told.
	 */
	if (result.notify.length) {
		publishToChatMembers(result.notify, 'chat_update', { chatId });
	}
	// Title, photo, roles or the member list may have moved under an open chat.
	publishToChat(chatId, 'group_update', { chatId });
}

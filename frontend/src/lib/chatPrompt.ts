export const SEND_CHAT_PROMPT_EVENT = 'goldilocks:send-chat-prompt';

export interface SendChatPromptDetail {
  text: string;
}

export function dispatchChatPrompt(text: string) {
  window.dispatchEvent(
    new CustomEvent<SendChatPromptDetail>(SEND_CHAT_PROMPT_EVENT, {
      detail: { text },
    })
  );
}

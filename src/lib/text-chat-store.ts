import { create } from 'zustand'

import {
  GatewayError,
  streamHermesChat,
  type ChatMessageInput,
  type ToolProgressEvent,
} from '#/lib/hermes-chat'

export interface ToolProgressBlock extends ToolProgressEvent {
  id: string
}

export interface TextChatMessage {
  id: string
  role: 'user' | 'assistant'
  /** Assistant text accumulated so far (streamed incrementally). */
  text: string
  /** Inline tool-status blocks surfaced from hermes.tool.progress SSE frames. */
  toolBlocks: ToolProgressBlock[]
}

export type ChatStatus = 'idle' | 'running' | 'error'

let nextId = 0
const genId = () => `msg-${Date.now()}-${(nextId++).toString(36)}`

interface TextChatState {
  messages: TextChatMessage[]
  status: ChatStatus
  error: string | null
  abort: AbortController | null

  send: (input: string) => Promise<void>
  cancel: () => void
  clear: () => void
  retry: () => void
  dismissError: () => void
}

/** Strip tool-progress blocks out of the message history sent to the gateway. */
function toGatewayMessages(messages: TextChatMessage[]): ChatMessageInput[] {
  return messages.map((m) => ({ role: m.role, content: m.text }))
}

async function runStream(get: () => TextChatState, set: (partial: Partial<TextChatState>) => void, history: TextChatMessage[]) {
  const controller = new AbortController()
  set({ status: 'running', error: null, abort: controller })

  const assistantId = genId()
  set({
    messages: [
      ...get().messages,
      { id: assistantId, role: 'assistant', text: '', toolBlocks: [] },
    ],
  })

  const patchAssistant = (fn: (m: TextChatMessage) => TextChatMessage) => {
    set({
      messages: get()
        .messages.map((m) => (m.id === assistantId ? fn(m) : m)),
    })
  }

  try {
    await streamHermesChat(
      toGatewayMessages(history),
      {
        onDelta: (delta) =>
          patchAssistant((m) => ({ ...m, text: m.text + delta })),
        onToolProgress: (event) =>
          patchAssistant((m) => {
            // Upsert by toolCallId so repeated progress frames update in place.
            const existing = m.toolBlocks.findIndex((b) => b.toolCallId === event.toolCallId)
            const blocks = [...m.toolBlocks]
            if (existing >= 0) blocks[existing] = { ...blocks[existing], ...event }
            else blocks.push({ id: `${assistantId}-tool-${blocks.length}`, ...event })
            return { ...m, toolBlocks: blocks }
          }),
      },
      { signal: controller.signal },
    )
    set({ status: 'idle', abort: null })
  } catch (cause) {
    if ((cause as Error)?.name === 'AbortError') {
      // User cancelled — keep partial output, drop empty assistant bubble.
      set({
        status: 'idle',
        abort: null,
        messages: get().messages.filter((m) => !(m.id === assistantId && !m.text && m.toolBlocks.length === 0)),
      })
      return
    }
    const message =
      cause instanceof GatewayError
        ? cause.message
        : 'Something went wrong while streaming the response.'
    set({ status: 'error', error: message, abort: null })
  }
}

export const useTextChatStore = create<TextChatState>((set, get) => ({
  messages: [],
  status: 'idle',
  error: null,
  abort: null,

  send: async (input) => {
    const trimmed = input.trim()
    if (!trimmed || get().status === 'running') return
    const history: TextChatMessage[] = [
      ...get().messages,
      { id: genId(), role: 'user', text: trimmed, toolBlocks: [] },
    ]
    set({ messages: history })
    await runStream(get, set, history)
  },

  cancel: () => get().abort?.abort(),

  clear: () => {
    get().abort?.abort()
    set({ messages: [], status: 'idle', error: null, abort: null })
  },

  retry: async () => {
    if (get().status === 'running') return
    const messages = [...get().messages]
    // Drop trailing failed/partial assistant bubble(s), then resend.
    while (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
      messages.pop()
    }
    const lastUser = messages[messages.length - 1]
    if (!lastUser || lastUser.role !== 'user') return
    set({ messages })
    await runStream(get, set, messages)
  },

  dismissError: () => set({ error: null, status: get().status === 'error' ? 'idle' : get().status }),
}))

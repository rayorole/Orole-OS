import { useMemo } from 'react'
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react'

import { useTextChatStore, type TextChatMessage } from '#/lib/text-chat-store'

function convertMessage(message: TextChatMessage): ThreadMessageLike {
  return {
    role: message.role,
    id: message.id,
    content: [{ type: 'text', text: message.text }],
  }
}

/**
 * Bridges the zustand-backed text chat store into an assistant-ui
 * ExternalStoreRuntime so <Thread /> can render it.
 */
export function TextChatRuntimeProvider({ children }: { children: React.ReactNode }) {
  const messages = useTextChatStore((s) => s.messages)
  const status = useTextChatStore((s) => s.status)
  const send = useTextChatStore((s) => s.send)
  const cancel = useTextChatStore((s) => s.cancel)

  const onNew = async (message: AppendMessage) => {
    if (message.content[0]?.type !== 'text') {
      throw new Error('Only text messages are supported in backup chat')
    }
    await send(message.content[0].text)
  }

  const onCancel = async () => cancel()

  const runtime = useExternalStoreRuntime({
    isRunning: status === 'running',
    messages,
    convertMessage,
    onNew,
    onCancel,
  })

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
}

export function useTextChat() {
  const store = useTextChatStore()
  return useMemo(
    () => ({
      ...store,
      hasError: store.status === 'error',
      isRunning: store.status === 'running',
    }),
    [store],
  )
}

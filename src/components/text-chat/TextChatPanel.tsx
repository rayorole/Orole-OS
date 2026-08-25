import { X } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Thread } from './Thread'
import { useChatMode } from '#/lib/chat-mode'
import { TextChatRuntimeProvider } from '#/lib/text-chat-runtime'

/**
 * Full-screen overlay hosting the backup text chat. Voice (Jarvis) remains the
 * primary interface; this panel is a typed fallback reachable from any route.
 */
export function TextChatPanel() {
  const { setMode } = useChatMode()

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden border-x border-[var(--line)] bg-[var(--panel-bg,transparent)] shadow-[0_0_60px_rgba(0,255,240,0.08)]">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <div>
            <h1 className="text-sm font-semibold tracking-tight">Text Chat</h1>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              backup channel · voice jarvis stays primary
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close text chat and return to voice"
            onClick={() => setMode('voice')}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1">
          <TextChatRuntimeProvider>
            <Thread />
          </TextChatRuntimeProvider>
        </div>
      </div>
    </div>
  )
}

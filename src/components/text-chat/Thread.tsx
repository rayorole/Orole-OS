import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type ThreadMessage,
} from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowDown,
  CircleStop,
  Mic,
  MicOff,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react'

import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import {
  useTextChatStore,
  type TextChatMessage,
  type ToolProgressBlock,
} from '#/lib/text-chat-store'
import { useDictation } from '#/lib/use-dictation'

function ToolProgressRow({ block }: { block: ToolProgressBlock }) {
  const statusIcon =
    block.status === 'complete' ? '✓' : block.status === 'error' ? '✗' : '▸'
  return (
    <div
      className={cn(
        'my-1 flex items-center gap-2 rounded-md border px-3 py-1.5 font-mono text-xs',
        block.status === 'error'
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : block.status === 'complete'
            ? 'border-primary/30 bg-primary/10 text-foreground/90'
            : 'border-neon-cyan/25 bg-neon-cyan/5 text-neon-cyan',
      )}
    >
      <span className={cn('shrink-0', block.status === 'running' && 'animate-pulse')}>
        {statusIcon}
      </span>
      <span className="shrink-0 uppercase tracking-wider">{block.toolName}</span>
      {block.message && (
        <span className="truncate text-muted-foreground">— {block.message}</span>
      )}
    </div>
  )
}

const markdownComponents = {
  Text: () => (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      smooth={false}
      className="prose prose-invert prose-sm max-w-none break-words [word-break:break-word] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
    />
  ),
}

const UserMessage = () => (
  <MessagePrimitive.Root className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm border border-neon-violet/30 bg-neon-violet/15 px-4 py-2.5 text-sm">
    <MessagePrimitive.Content components={{ Text: undefined }} />
  </MessagePrimitive.Root>
)

function AssistantToolBlocks({ messageId }: { messageId: string }) {
  const toolBlocks = useTextChatStore(
    (s) => s.messages.find((m) => m.id === messageId)?.toolBlocks ?? [],
  )
  if (toolBlocks.length === 0) return null
  return (
    <>
      {toolBlocks.map((block) => (
        <ToolProgressRow key={block.id} block={block} />
      ))}
    </>
  )
}

function ThinkingDots() {
  return (
    <span className="inline-flex gap-1 py-1" aria-label="assistant is thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-bounce rounded-full bg-neon-cyan/70"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  )
}

/**
 * Assistant bubble: tool-progress blocks come from our store (keyed by message
 * id), streamed markdown text renders through MessagePrimitive.Content.
 */
const AssistantMessage = ({ message }: { message: ThreadMessage }) => {
  const id = message.id
  const storeText = useTextChatStore(
    (s) => s.messages.find((m) => m.id === id)?.text,
  )

  return (
    <div className="mr-auto max-w-[90%] space-y-1">
      <AssistantToolBlocks messageId={id} />
      <div className="rounded-2xl rounded-bl-sm border border-[var(--line)] bg-[var(--chip-bg)] px-4 py-2.5 text-sm shadow-[0_0_24px_rgba(0,255,240,0.04)]">
        {storeText ? (
          <MessagePrimitive.Content components={markdownComponents} />
        ) : (
          <ThinkingDots />
        )}
      </div>
    </div>
  )
}

function ScrollToBottom() {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <Button
        variant="outline"
        size="icon"
        aria-label="Scroll to bottom"
        className="absolute -top-12 left-1/2 z-10 size-8 -translate-x-1/2 rounded-full border-[var(--line)] bg-background/80 backdrop-blur"
      >
        <ArrowDown className="size-4" />
      </Button>
    </ThreadPrimitive.ScrollToBottom>
  )
}

function Composer() {
  const status = useTextChatStore((s) => s.status)
  const cancel = useTextChatStore((s) => s.cancel)
  const retry = useTextChatStore((s) => s.retry)
  const error = useTextChatStore((s) => s.error)

  return (
    <div className="space-y-2">
      {error && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void retry()}
            className="flex items-center gap-1 font-mono uppercase tracking-wider hover:underline"
          >
            <RefreshCw className="size-3" /> retry
          </button>
        </div>
      )}
      <ComposerPrimitive.Root className="flex items-end gap-2 rounded-xl border border-[var(--line)] bg-background/60 p-2 backdrop-blur focus-within:border-neon-cyan/50">
        <DictationButton />
        <ComposerPrimitive.Input
          rows={1}
          autoFocus
          placeholder="Type a message to Jarvis…"
          className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground/70"
        />
        {status === 'running' ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Stop generating"
            onClick={cancel}
          >
            <CircleStop className="size-4" />
          </Button>
        ) : (
          <ComposerPrimitive.Send asChild>
            <Button size="icon" aria-label="Send message">
              <Send className="size-4" />
            </Button>
          </ComposerPrimitive.Send>
        )}
      </ComposerPrimitive.Root>
    </div>
  )
}

/** Optional dictation hook: mic → composer via the Web Speech API. */
function DictationButton() {
  const send = useTextChatStore((s) => s.send)
  const { supported, listening, startListening, stopListening, error } = useDictation({
    onFinalTranscript: (text) => void send(text),
  })
  if (!supported) return null
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={listening ? 'Stop dictation' : 'Start dictation'}
      title={error ?? (listening ? 'Stop dictation' : 'Dictate a message')}
      onClick={listening ? stopListening : startListening}
      className={cn(listening && 'text-neon-cyan shadow-[0_0_12px_var(--neon-cyan)]')}
    >
      {listening ? <MicOff className="size-4 animate-pulse" /> : <Mic className="size-4" />}
    </Button>
  )
}

function ClearThread() {
  const clear = useTextChatStore((s) => s.clear)
  const hasMessages = useTextChatStore((s) => s.messages.length > 0)
  if (!hasMessages) return null
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={clear}
      className="font-mono text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
    >
      <Trash2 className="size-3.5" /> clear
    </Button>
  )
}

function renderMessage({ message }: { message: ThreadMessage }) {
  if (message.role === 'user') return <UserMessage key={message.id} />
  if (message.role === 'assistant') return <AssistantMessage message={message} key={message.id + (message as unknown as TextChatMessage).text} />
  return null
}

/**
 * shadcn-styled chat thread on the Orole-OS dark HUD theme:
 * glassy panels, neon accents, monospace details.
 */
export function Thread() {
  const isEmpty = useTextChatStore((s) => s.messages.length === 0)
  void isEmpty
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-neon-cyan/80">
          backup text link · hermes gateway
        </p>
        <ClearThread />
      </div>

      <ThreadPrimitive.Root className="relative min-h-0 flex-1">
        <ScrollToBottom />
        <ThreadPrimitive.Viewport
          autoScroll
          className="h-full space-y-4 overflow-y-auto px-4 py-4"
        >
          <ThreadPrimitive.Empty>
            <div className="mx-auto mt-10 max-w-sm space-y-2 text-center">
              <p className="font-mono text-xs uppercase tracking-[0.35em] text-neon-violet">
                text uplink ready
              </p>
              <h2 className="text-lg font-semibold">Backup text channel</h2>
              <p className="text-muted-foreground text-sm">
                Voice stays primary — this typed channel talks to the same Hermes gateway.
              </p>
            </div>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages>
            {renderMessage}
          </ThreadPrimitive.Messages>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>

      <div className="border-t border-[var(--line)] p-3">
        <Composer />
      </div>
    </div>
  )
}

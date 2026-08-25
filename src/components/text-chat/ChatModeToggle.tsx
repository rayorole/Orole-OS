import { useChatMode } from '#/lib/chat-mode'
import { cn } from '#/lib/utils'

/**
 * Global Voice ↔ Text chat mode switch. Voice (Jarvis) stays the default;
 * text chat is the backup surface. Rendered in the header so it is reachable
 * from every route.
 */
export function ChatModeToggle({ className }: { className?: string }) {
  const { mode, setMode } = useChatMode()

  return (
    <div
      role="radiogroup"
      aria-label="Chat mode"
      className={cn(
        'flex items-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] p-0.5',
        className,
      )}
    >
      {(['voice', 'text'] as const).map((m) => {
        const active = mode === m
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setMode(m)}
            className={cn(
              'rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors',
              active
                ? 'bg-neon-cyan/15 text-neon-cyan shadow-[0_0_10px_rgba(0,255,240,0.25)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {m === 'voice' ? '🎙 voice' : '⌨ text'}
          </button>
        )
      })}
    </div>
  )
}

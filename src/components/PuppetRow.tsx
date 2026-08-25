import { memo, useState } from 'react'
import { highlightJson } from '#/lib/prism-server-safe'
import type { TranscriptEntry } from '#/lib/puppet-reducer'
import { useTypewriter } from '#/lib/use-typewriter'
import { cn } from '#/lib/utils'

const KIND_STYLE: Record<string, { label: string; cls: string }> = {
  user: { label: '❯ you', cls: 'text-neon-cyan' },
  assistant: { label: '◆ agent', cls: 'text-foreground' },
  system: { label: '· sys', cls: 'text-muted-foreground' },
  event: { label: '⟐ run', cls: 'text-neon-violet' },
}

function formatTs(ts?: string): string {
  if (!ts) return ''
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour12: false })
}

/**
 * One transcript line. Memoized so virtualized re-renders skip untouched
 * rows during typing animation.
 */
export const PuppetRow = memo(function PuppetRow({
  entry,
  animate,
}: {
  entry: TranscriptEntry
  /** Character-by-character reveal for live-streaming assistant text. */
  animate: boolean
}) {
  const ts = formatTs(entry.ts)

  if (entry.kind === 'tool' && entry.tool) {
    return <ToolChip ts={ts} tool={entry.tool} />
  }

  const style = KIND_STYLE[entry.kind] ?? KIND_STYLE.system
  const isUser = entry.kind === 'user'

  return (
    <MessageRow
      ts={ts}
      label={style.label}
      cls={style.cls}
      text={entry.text}
      isUser={isUser}
      streaming={!!entry.streaming}
      animate={animate && !!entry.streaming}
    />
  )
})

function MessageRow({
  ts,
  label,
  cls,
  text,
  isUser,
  streaming,
  animate,
}: {
  ts: string
  label: string
  cls: string
  text: string
  isUser: boolean
  streaming: boolean
  animate: boolean
}) {
  // Only the newest in-flight bubble types char-by-char; sealed rows render whole.
  const { visible } = useTypewriter(text, { enabled: animate && streaming })
  const shown = animate && streaming ? visible : text

  return (
    <div className="group flex gap-2 px-3 py-0.5 leading-relaxed">
      <span className="shrink-0 select-none pt-[3px] text-[10px] tabular-nums text-muted-foreground/60">
        {ts}
      </span>
      <span className={cn('shrink-0 select-none text-[11px]', style_cls(cls))}>{label}</span>
      <span
        className={cn(
          'min-w-0 whitespace-pre-wrap break-words',
          style_cls(cls),
          isUser && 'font-semibold',
        )}
      >
        {shown}
        {streaming && (
          <span className="ml-0.5 inline-block h-3 w-2 animate-pulse bg-neon-cyan align-middle" />
        )}
      </span>
    </div>
  )
}

// KIND_STYLE.cls values are full class names; keep them verbatim.
function style_cls(c: string) {
  return c
}

/**
 * Collapsible tool chip.
 * Collapsed: status glyph + tool name + one-line arg summary.
 * Expanded: full input/output JSON with Prism syntax highlighting.
 */
function ToolChip({ ts, tool }: { ts: string; tool: NonNullable<TranscriptEntry['tool']> }) {
  const [open, setOpen] = useState(false)

  const statusGlyph =
    tool.status === 'running' ? '⠿' : tool.status === 'error' ? '✗' : '✓'
  const statusCls =
    tool.status === 'running'
      ? 'animate-pulse text-amber-400'
      : tool.status === 'error'
        ? 'text-destructive'
        : 'text-emerald-400'

  return (
    <div className="mx-3 my-1 rounded border-l-2 border-neon-violet/50 bg-white/[0.03]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid="tool-chip"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-white/[0.04]"
      >
        <span className="shrink-0 select-none text-[10px] tabular-nums text-muted-foreground/60">
          {ts}
        </span>
        <span className={cn('font-bold', statusCls)}>{statusGlyph}</span>
        <span className="font-semibold uppercase tracking-wide text-neon-violet">
          ⚙ {tool.name}
        </span>
        {tool.argsSummary && (
          <span className="min-w-0 truncate text-muted-foreground">{tool.argsSummary}</span>
        )}
        <span className="ml-auto shrink-0 select-none text-muted-foreground/60">
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <div className="space-y-2 px-3 pb-3 pt-1" data-testid="tool-detail">
          {tool.inputJson && (
            <HighlightedJson label="input" json={tool.inputJson} />
          )}
          {tool.outputJson && (
            <HighlightedJson label="output" json={tool.outputJson} />
          )}
          {!tool.inputJson && !tool.outputJson && (
            <pre className="rounded bg-black/50 p-2 text-[11px] text-muted-foreground">
              (no details)
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

/** Prism-highlighted JSON block (documented choice: prism — lighter than shiki, no async loader). */
export function HighlightedJson({ label, json }: { label: string; json: string }) {
  const html = highlightJson(json)

  return (
    <div>
      <div className="mb-0.5 text-[9px] uppercase tracking-widest text-muted-foreground/60">
        {label}
      </div>
      {html !== null ? (
        <pre
          className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded bg-black/50 p-2 text-[11px] leading-snug language-json"
          // Prism output is generated locally from escaped source — safe to inject.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded bg-black/50 p-2 text-[11px] leading-snug text-emerald-200/80">
          {json}
        </pre>
      )}
    </div>
  )
}

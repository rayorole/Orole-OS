import type { TranscriptEntry } from '#/lib/hermes'

const KIND_STYLE: Record<string, { label: string; cls: string }> = {
  user: { label: '❯ you', cls: 'text-neon-cyan' },
  assistant: { label: '◆ agent', cls: 'text-foreground' },
  system: { label: '· sys', cls: 'text-muted-foreground' },
  event: { label: '⟐ run', cls: 'text-neon-violet' },
}

/** One transcript line — message, streaming bubble, or tool block. */
export function TranscriptRow({ entry, ts }: { entry: TranscriptEntry; ts: string; index?: number }) {
  if (entry.kind === 'tool' && entry.tool) {
    return <ToolBlock ts={ts} tool={entry.tool} />
  }

  const style = KIND_STYLE[entry.kind] ?? KIND_STYLE.system
  const isUser = entry.kind === 'user'

  return (
    <div className="group flex gap-2 px-3 py-0.5 leading-relaxed">
      <span className="shrink-0 select-none text-[10px] text-muted-foreground/60 pt-[3px] tabular-nums">
        {ts}
      </span>
      <span className={`shrink-0 select-none text-[11px] ${style.cls}`}>{style.label}</span>
      <span
        className={[
          'min-w-0 whitespace-pre-wrap break-words',
          style.cls,
          isUser ? 'font-semibold' : '',
        ].join(' ')}
      >
        {entry.text}
        {entry.streaming && (
          <span className="ml-0.5 inline-block h-3 w-2 animate-pulse bg-neon-cyan align-middle" />
        )}
      </span>
    </div>
  )
}

function ToolBlock({
  ts,
  tool,
}: {
  ts: string
  tool: NonNullable<TranscriptEntry['tool']>
}) {
  const statusGlyph =
    tool.status === 'running' ? '⠿' : tool.status === 'error' ? '✗' : '✓'
  const statusCls =
    tool.status === 'running'
      ? 'text-amber-400 animate-pulse'
      : tool.status === 'error'
        ? 'text-destructive'
        : 'text-emerald-400'

  return (
    <div className="my-1 mx-3 rounded border-l-2 border-neon-violet/50 bg-white/[0.03] px-3 py-1.5">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="shrink-0 select-none text-[10px] text-muted-foreground/60 tabular-nums">
          {ts}
        </span>
        <span className={`font-bold ${statusCls}`}>{statusGlyph}</span>
        <span className="font-semibold uppercase tracking-wide text-neon-violet">
          ⚙ {tool.name}
        </span>
        {tool.argsSummary && (
          <span className="min-w-0 truncate text-muted-foreground">{tool.argsSummary}</span>
        )}
      </div>
      {tool.result && (
        <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded bg-black/50 p-2 text-[11px] leading-snug text-emerald-200/80">
{tool.result.length > 800 ? `${tool.result.slice(0, 800)}\n… (truncated)` : tool.result}
        </pre>
      )}
    </div>
  )
}

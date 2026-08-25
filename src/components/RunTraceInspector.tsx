import { useMemo, useState } from 'react'
import { Check, ChevronRight, Copy, Wrench } from 'lucide-react'

import {
  buildTrace,
  totalLatencyMs,
  totalTokens,
  type RawRunStep,
  type TraceStep,
} from '#/lib/run-trace'

function StepNode({ step, depth }: { step: TraceStep; depth: number }) {
  const [open, setOpen] = useState(depth === 0)
  const [copied, setCopied] = useState(false)

  const isTool = step.kind === 'tool_call' || step.kind === 'tool_result'
  return (
    <li className="border-l border-border/40" style={{ marginLeft: depth * 12 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono text-xs hover:bg-neon-cyan/5"
      >
        <ChevronRight
          className={`size-3 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
        />
        {isTool && <Wrench className="size-3 shrink-0 text-neon-violet" />}
        <span
          className={
            step.kind === 'prompt'
              ? 'text-neon-cyan'
              : step.kind === 'tool_call'
                ? 'text-neon-violet'
                : step.kind === 'assistant'
                  ? 'text-foreground'
                  : 'text-muted-foreground'
          }
        >
          {step.label}
        </span>
        <span className="ml-auto flex shrink-0 gap-2 text-[10px] text-muted-foreground">
          {step.tokens && (
            <span title="input/output tokens">
              {step.tokens.input}→{step.tokens.output} tok
            </span>
          )}
          {step.latencyMs != null && <span>{step.latencyMs} ms</span>}
        </span>
      </button>
      {open && (
        <div className="group relative ml-6 pr-8">
          <pre
            className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-black/40 p-2 text-[11px] leading-relaxed text-foreground/90"
            data-testid="trace-content"
          >
            {/* Plain rendering — exact content as sent/received. No typing effect. */}
            {step.content || '(empty)'}
          </pre>
          <button
            type="button"
            aria-label="Copy as JSON"
            title="Copy step as JSON"
            className="absolute right-0 top-1 inline-flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:border-neon-cyan/40 hover:text-neon-cyan"
            onClick={() => {
              void navigator.clipboard.writeText(JSON.stringify(step, null, 2)).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
            }}
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            json
          </button>
        </div>
      )}
    </li>
  )
}

/**
 * Full run trace inspector — prompt → tool call → result tree with per-step
 * token counts and latency, plus a whole-run copy-as-JSON button.
 */
export function RunTraceInspector({
  runId,
  rawSteps,
}: {
  runId: string
  rawSteps: RawRunStep[]
}) {
  const steps = useMemo(() => buildTrace(rawSteps), [rawSteps])
  const tokens = useMemo(() => totalTokens(steps), [steps])
  const latency = useMemo(() => totalLatencyMs(steps), [steps])
  const [copiedAll, setCopiedAll] = useState(false)

  if (steps.length === 0) {
    return (
      <p className="p-4 font-mono text-xs text-muted-foreground">
        no trace events for run {runId}
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
        <span>
          {steps.length} steps · {tokens.input + tokens.output} tokens ({tokens.input} in /{' '}
          {tokens.output} out) · {latency} ms total
        </span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              .writeText(JSON.stringify({ runId, steps }, null, 2))
              .then(() => {
                setCopiedAll(true)
                setTimeout(() => setCopiedAll(false), 1500)
              })
          }}
          className="inline-flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 hover:border-neon-cyan/40 hover:text-neon-cyan"
        >
          {copiedAll ? <Check className="size-3" /> : <Copy className="size-3" />}
          copy trace JSON
        </button>
      </div>
      <ul className="space-y-0.5">
        {steps.map((step) => (
          <StepNode key={`${step.index}-${step.kind}-${step.label}`} step={step} depth={0} />
        ))}
      </ul>
    </div>
  )
}

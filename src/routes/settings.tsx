import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'

export const Route = createFileRoute('/settings')({
  component: Settings,
})

const KEY_STORAGE = 'orole.apiKey'

/** Local settings: gateway API key + voice preferences. */
function Settings() {
  const [apiKey, setApiKey] = useState('')

  useEffect(() => {
    try {
      setApiKey(window.localStorage.getItem(KEY_STORAGE) ?? '')
    } catch {
      /* storage unavailable */
    }
    document.title = 'Settings — Orole-OS'
  }, [])

  return (
    <main className="page-wrap px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>
            Stored locally in your browser only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block space-y-1.5">
            <span className="font-mono text-xs uppercase tracking-widest text-[var(--muted-foreground)]">
              Gateway API key
            </span>
            <input
              data-testid="api-key-input"
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value)
                try {
                  window.localStorage.setItem(KEY_STORAGE, e.target.value)
                } catch {
                  /* storage unavailable */
                }
              }}
              className="w-full rounded-md border bg-transparent px-3 py-2 font-mono text-sm"
              placeholder="sk-…"
            />
          </label>
        </CardContent>
      </Card>
    </main>
  )
}

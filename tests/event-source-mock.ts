/**
 * Controllable EventSource mock — tests grab the latest instance via
 * FakeEventSource.latest and emit named events into the hook.
 */
export class FakeEventSource {
  static instances: FakeEventSource[] = []
  static get latest(): FakeEventSource | undefined {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1]
  }
  static reset() {
    FakeEventSource.instances = []
  }

  url: string
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  private handlers = new Map<string, Set<(ev: unknown) => void>>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(name: string, handler: (ev: unknown) => void) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set())
    this.handlers.get(name)!.add(handler)
  }

  close() {
    this.closed = true
  }

  // test controls
  open() {
    this.onopen?.()
  }
  fail() {
    this.onerror?.()
  }
  emit(name: string, data: unknown) {
    for (const h of this.handlers.get(name) ?? []) {
      h({ data: JSON.stringify(data) })
    }
  }
}

// jsdom lacks EventSource entirely — install the fake globally.
if (typeof window.EventSource === 'undefined') {
  ;(window as unknown as { EventSource: unknown }).EventSource = FakeEventSource
}

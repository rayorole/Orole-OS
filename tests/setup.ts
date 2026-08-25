import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

// jsdom lacks matchMedia; components rely on it.
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query.includes('dark'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  })
}


export class FakeEventSource {
  static instances: FakeEventSource[] = []
  static get latest(): FakeEventSource {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1]
  }
  static reset() {
    FakeEventSource.instances = []
  }
  url: string
  readyState = 0
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onopen: (() => void) | null = null
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  emit(event: string | unknown, payload?: unknown) {
    if (typeof event === 'string') { this.onmessage?.({ data: JSON.stringify({ event, ...((payload as object) ?? {}) }) }) }
    else { this.onmessage?.({ data: JSON.stringify(event) }) }
  }
  open() { this.readyState = 1; this.onopen?.() }
  error() { this.readyState = 2; this.onerror?.() }
  fail(_data?: unknown) { this.onerror?.() }
  get closed() { return this.readyState === 2 }
  close() { this.readyState = 2 }
}
